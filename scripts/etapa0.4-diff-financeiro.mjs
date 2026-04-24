// Etapa 0.4 — diff financeiro Sienge vs banco.
// ver .claude/rules/sincronizacao-sienge.md
//
// Pergunta: das parcelas que ja pareamos (Etapa 0.3), quantas divergem em
// valor, data_pagamento ou status? Sienge e fonte da verdade.
//
// Quatro categorias de divergencia:
//   1) valor_divergente:               |banco.valor - sienge.originalAmount| > 0.01
//   2) data_pagamento_divergente:       ambos pagos mas datas diferentes
//   3) pago_local_pendente_sienge:      banco status=pago, Sienge sem paymentDate e balanceAmount>0
//   4) pendente_local_pago_sienge:      banco status=pendente, Sienge tem paymentDate ou balanceAmount=0
//
// Fontes (offline):
//   docs/fase5-universo-dueDate-RAW.json — bulk /v1/income (Sienge, CT Figueira)
//   Supabase vendas + pagamentos_prosoluto — local
//
// Output: docs/etapa0.4-diff-financeiro.json

import { readFileSync, writeFileSync } from 'node:fs'

const SUPABASE_URL = 'https://jdkkusrxullttyeakwib.supabase.co'
const env = readFileSync('.env', 'utf8')
const KEY = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

const PT_MAP = {
  PM: { tipo: 'parcela_entrada', seqFromInstallment: true },
  SN: { tipo: 'sinal', seq: 1 },
  AT: { tipo: 'sinal', seq: 1 },
  B1: { tipo: 'balao', seq: 1 }, B2: { tipo: 'balao', seq: 2 }, B3: { tipo: 'balao', seq: 3 },
  B4: { tipo: 'balao', seq: 4 }, B5: { tipo: 'balao', seq: 5 }, B6: { tipo: 'balao', seq: 6 },
  B7: { tipo: 'balao', seq: 7 }, B8: { tipo: 'balao', seq: 8 }, B9: { tipo: 'balao', seq: 9 },
  BA: { tipo: 'balao', seqFromInstallment: true },
}

function extrairStatusSienge(r) {
  const receipts = Array.isArray(r.receipts) ? r.receipts : []
  const pagos = receipts
    .filter(x => x && x.paymentDate)
    .sort((a, b) => String(b.paymentDate).localeCompare(String(a.paymentDate)))
  const paymentDate = pagos[0]?.paymentDate || null
  const balance = Number(r.balanceAmount)
  const pago = paymentDate != null || balance === 0
  return { paymentDate, pago, balanceAmount: balance }
}

console.log('[1/4] Carregando bulk Sienge (RAW)...')
const raw = JSON.parse(readFileSync('docs/fase5-universo-dueDate-RAW.json', 'utf8'))
const bulkRows = (raw.data || []).filter(r => (r.documentIdentificationId || '').trim() === 'CT')
console.log(`  bulk rows (CT apenas): ${bulkRows.length}`)

// Index Sienge: billId -> tipo -> seq -> info
const siengeIdx = new Map()
let skippedPT = 0
let siengeTotalParcelas = 0
for (const r of bulkRows) {
  const ptId = r.paymentTerm?.id
  const map = PT_MAP[ptId]
  if (!map) { skippedPT++; continue }
  let seq = map.seq
  if (map.seqFromInstallment) {
    const [n] = String(r.installmentNumber || '').split('/')
    seq = parseInt(n, 10)
    if (!Number.isFinite(seq)) continue
  }
  if (!siengeIdx.has(r.billId)) siengeIdx.set(r.billId, new Map())
  const b = siengeIdx.get(r.billId)
  if (!b.has(map.tipo)) b.set(map.tipo, new Map())
  if (b.get(map.tipo).has(seq)) continue // ja indexado (duplicata rara no bulk)
  const status = extrairStatusSienge(r)
  b.get(map.tipo).set(seq, {
    billId: r.billId,
    tipo: map.tipo,
    seq,
    paymentTermId: ptId,
    installment: r.installmentNumber,
    dueDate: r.dueDate,
    originalAmount: Number(r.originalAmount || 0),
    balanceAmount: status.balanceAmount,
    paymentDate: status.paymentDate,
    pago: status.pago,
    clientName: r.clientName,
  })
  siengeTotalParcelas++
}
console.log(`  billIds Sienge (CT): ${siengeIdx.size}`)
console.log(`  parcelas indexadas:  ${siengeTotalParcelas}`)
console.log(`  pulados por paymentTerm: ${skippedPT}`)

console.log('\n[2/4] Baixando vendas com sienge_receivable_bill_id...')
const vendaPorBill = new Map()
const vendaPorId = new Map()
let offset = 0
const PAGE = 1000
while (true) {
  const url = `${SUPABASE_URL}/rest/v1/vendas?select=id,sienge_contract_id,sienge_receivable_bill_id,unidade&sienge_receivable_bill_id=not.is.null&limit=${PAGE}&offset=${offset}`
  const r = await fetch(url, { headers: H })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  const arr = await r.json()
  if (arr.length === 0) break
  for (const v of arr) {
    vendaPorBill.set(Number(v.sienge_receivable_bill_id), { venda_id: v.id, sienge_contract_id: v.sienge_contract_id, unidade: v.unidade })
    vendaPorId.set(v.id, { sienge_contract_id: v.sienge_contract_id, unidade: v.unidade })
  }
  offset += arr.length
  if (arr.length < PAGE) break
}
console.log(`  vendas com bill_id: ${vendaPorBill.size}`)

console.log('\n[3/4] Baixando pagamentos_prosoluto (ativas — pago + pendente)...')
const localIdx = new Map() // venda_id -> tipo -> seq -> row
offset = 0
let totalAtivas = 0
while (true) {
  const url = `${SUPABASE_URL}/rest/v1/pagamentos_prosoluto?select=id,venda_id,tipo,numero_parcela,valor,data_prevista,data_pagamento,status,comissao_gerada&status=in.(pago,pendente)&limit=${PAGE}&offset=${offset}`
  const r = await fetch(url, { headers: H })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  const arr = await r.json()
  if (arr.length === 0) break
  for (const p of arr) {
    const seq = (p.tipo === 'sinal' && p.numero_parcela == null) ? 1 : p.numero_parcela
    if (!localIdx.has(p.venda_id)) localIdx.set(p.venda_id, new Map())
    const v = localIdx.get(p.venda_id)
    if (!v.has(p.tipo)) v.set(p.tipo, new Map())
    if (!v.get(p.tipo).has(seq)) v.get(p.tipo).set(seq, p)
    totalAtivas++
  }
  offset += arr.length
  process.stdout.write(`  lidos ${offset}\r`)
  if (arr.length < PAGE) break
}
process.stdout.write('\n')
console.log(`  vendas com pagamentos ativos: ${localIdx.size}`)
console.log(`  parcelas ativas totais:       ${totalAtivas}`)

console.log('\n[4/4] Cruzando e detectando divergencias...')
const valorDivergente = []
const dataPagamentoDivergente = []
const pagoLocalPendenteSienge = []
const pendenteLocalPagoSienge = []
let pareadas = 0
let siengeSemVendaLocal = 0
let siengeSemParcelaLocal = 0

for (const [bid, tipos] of siengeIdx) {
  const venda = vendaPorBill.get(bid)
  if (!venda) {
    let n = 0
    for (const m of tipos.values()) n += m.size
    siengeSemVendaLocal += n
    continue
  }
  const localTipos = localIdx.get(venda.venda_id)
  for (const [tipo, seqMap] of tipos) {
    for (const [seq, info] of seqMap) {
      const local = localTipos?.get(tipo)?.get(seq)
      if (!local) { siengeSemParcelaLocal++; continue }
      pareadas++

      // 1) valor
      const bancoValor = Number(local.valor)
      if (Math.abs(bancoValor - info.originalAmount) > 0.01) {
        valorDivergente.push({
          venda_id: venda.venda_id,
          sienge_contract_id: venda.sienge_contract_id,
          billId: bid,
          tipo, seq,
          paymentTermId: info.paymentTermId,
          installment: info.installment,
          banco: { id: local.id, valor: bancoValor, status: local.status },
          sienge: { originalAmount: info.originalAmount },
          diff: Number((bancoValor - info.originalAmount).toFixed(2)),
        })
      }

      const bancoPago = local.status === 'pago'
      const siengePago = info.pago

      // 3) banco=pago, Sienge=pendente
      if (bancoPago && !siengePago) {
        pagoLocalPendenteSienge.push({
          venda_id: venda.venda_id,
          sienge_contract_id: venda.sienge_contract_id,
          billId: bid, tipo, seq,
          installment: info.installment,
          banco: { id: local.id, data_pagamento: local.data_pagamento, valor: bancoValor },
          sienge: { dueDate: info.dueDate, balanceAmount: info.balanceAmount, paymentDate: null },
        })
        continue
      }

      // 4) banco=pendente, Sienge=pago (backfill de income deixou passar)
      if (!bancoPago && siengePago) {
        pendenteLocalPagoSienge.push({
          venda_id: venda.venda_id,
          sienge_contract_id: venda.sienge_contract_id,
          billId: bid, tipo, seq,
          installment: info.installment,
          banco: { id: local.id, data_prevista: local.data_prevista, valor: bancoValor },
          sienge: { paymentDate: info.paymentDate, balanceAmount: info.balanceAmount },
        })
        continue
      }

      // 2) ambos pago mas data divergente
      if (bancoPago && siengePago) {
        const bancoData = local.data_pagamento || null
        const siengeData = info.paymentDate
        if (bancoData && siengeData && bancoData !== siengeData) {
          dataPagamentoDivergente.push({
            venda_id: venda.venda_id,
            sienge_contract_id: venda.sienge_contract_id,
            billId: bid, tipo, seq,
            installment: info.installment,
            banco: { id: local.id, data_pagamento: bancoData },
            sienge: { paymentDate: siengeData },
            diff_dias: Math.round((new Date(siengeData) - new Date(bancoData)) / 86400000),
          })
        } else if (bancoPago && !bancoData) {
          // invariante ja zero pela Etapa 2, mas guard
          pagoLocalPendenteSienge.push({
            venda_id: venda.venda_id,
            sienge_contract_id: venda.sienge_contract_id,
            billId: bid, tipo, seq,
            observacao: 'pago local sem data_pagamento (invariante violada)',
            banco: { id: local.id },
            sienge: { paymentDate: siengeData },
          })
        }
      }
    }
  }
}

console.log(`\n  parcelas pareadas:               ${pareadas}`)
console.log(`  Sienge sem venda local:          ${siengeSemVendaLocal}`)
console.log(`  Sienge sem parcela local:        ${siengeSemParcelaLocal}`)
console.log('')
console.log(`  [CAT 1] valor_divergente:              ${valorDivergente.length}`)
console.log(`  [CAT 2] data_pagamento_divergente:     ${dataPagamentoDivergente.length}`)
console.log(`  [CAT 3] pago_local_pendente_sienge:    ${pagoLocalPendenteSienge.length}  (← suspeita de baixa manual sem reflexo no Sienge)`)
console.log(`  [CAT 4] pendente_local_pago_sienge:    ${pendenteLocalPagoSienge.length}  (← backfill income deixou passar)`)

// Amostras pro usuario auditar
console.log('\nAmostras (ate 3 por categoria):')
for (const [rotulo, arr] of [
  ['valor_divergente', valorDivergente],
  ['data_pagamento_divergente', dataPagamentoDivergente],
  ['pago_local_pendente_sienge', pagoLocalPendenteSienge],
  ['pendente_local_pago_sienge', pendenteLocalPagoSienge],
]) {
  if (arr.length === 0) continue
  console.log(`  ${rotulo}:`)
  for (const ex of arr.slice(0, 3)) console.log('    ' + JSON.stringify(ex))
}

const diffValorTotalAbs = valorDivergente.reduce((acc, x) => acc + Math.abs(x.diff), 0)

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    fonteSienge: 'docs/fase5-universo-dueDate-RAW.json (bulk /v1/income, Figueira 2104)',
    escopo: 'CT apenas; parcelas ativas (pago+pendente) do banco',
    siengeTotalParcelas,
    bancoTotalAtivas: totalAtivas,
    parcelasPareadas: pareadas,
    siengeSemVendaLocal,
    siengeSemParcelaLocal,
    totais: {
      valor_divergente: valorDivergente.length,
      data_pagamento_divergente: dataPagamentoDivergente.length,
      pago_local_pendente_sienge: pagoLocalPendenteSienge.length,
      pendente_local_pago_sienge: pendenteLocalPagoSienge.length,
    },
    impacto: {
      diff_valor_total_abs: Number(diffValorTotalAbs.toFixed(2)),
    },
    regra: 'Sienge e fonte da verdade. Qualquer divergencia de valor/data/status em parcela pareada deve ser investigada antes do go-live.',
  },
  valor_divergente: valorDivergente,
  data_pagamento_divergente: dataPagamentoDivergente,
  pago_local_pendente_sienge: pagoLocalPendenteSienge,
  pendente_local_pago_sienge: pendenteLocalPagoSienge,
}

writeFileSync('docs/etapa0.4-diff-financeiro.json', JSON.stringify(report, null, 2))
console.log('\nOutput: docs/etapa0.4-diff-financeiro.json')
console.log(`  Impacto absoluto em diff de valor: R$ ${diffValorTotalAbs.toFixed(2)}`)
