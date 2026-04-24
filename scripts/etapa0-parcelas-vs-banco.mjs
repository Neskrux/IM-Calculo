// Etapa 0.3 — parcelas Sienge vs parcelas locais (por bill comum).
// ver .claude/rules/sincronizacao-sienge.md
//
// Pergunta inversa de B.6: para cada billId que existe nos dois lados,
// o Sienge tem alguma (tipo, seq) que o banco NAO tem?
//
// Fontes (offline):
//   docs/fase5-universo-dueDate-RAW.json  — bulk /v1/income (Sienge)
//   Supabase vendas + pagamentos_prosoluto  — local
//
// Output: docs/etapa0-parcelas-faltantes.json

import { readFileSync, writeFileSync } from 'node:fs'

const SUPABASE_URL = 'https://jdkkusrxullttyeakwib.supabase.co'
const env = readFileSync('.env', 'utf8')
const KEY = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

// Tipagem canonica para match (mesma da B.6)
const PT_MAP = {
  PM: { tipo: 'parcela_entrada', seqFromInstallment: true },
  SN: { tipo: 'sinal', seq: 1 },
  AT: { tipo: 'sinal', seq: 1 },
  B1: { tipo: 'balao', seq: 1 }, B2: { tipo: 'balao', seq: 2 }, B3: { tipo: 'balao', seq: 3 },
  B4: { tipo: 'balao', seq: 4 }, B5: { tipo: 'balao', seq: 5 }, B6: { tipo: 'balao', seq: 6 },
  B7: { tipo: 'balao', seq: 7 }, B8: { tipo: 'balao', seq: 8 }, B9: { tipo: 'balao', seq: 9 },
  BA: { tipo: 'balao', seqFromInstallment: true },
}

console.log('[1/5] Carregando bulk D Sienge (RAW)...')
const raw = JSON.parse(readFileSync('docs/fase5-universo-dueDate-RAW.json', 'utf8'))
const bulkRows = (raw.data || []).filter(r => (r.documentIdentificationId || '').trim() === 'CT')
console.log(`  bulk rows (CT apenas): ${bulkRows.length}`)

// Index Sienge: billId -> Map<tipo, Map<seq, {installment, due, paid, amount, paidAmount}>>
const siengeIdx = new Map()
let skippedPT = 0
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
  if (!b.get(map.tipo).has(seq)) {
    b.get(map.tipo).set(seq, {
      billId: r.billId,
      tipo: map.tipo,
      seq,
      paymentTermId: ptId,
      installment: r.installmentNumber,
      dueDate: r.dueDate,
      paymentDate: r.paymentDate || null,
      originalAmount: Number(r.originalAmount || 0),
      paidAmount: Number(r.paidAmount || 0),
      clientName: r.clientName,
    })
  }
}
console.log(`  billIds Sienge (CT): ${siengeIdx.size}`)
console.log(`  pulados por paymentTerm desconhecido: ${skippedPT}`)

console.log('\n[2/5] Baixando vendas com bill_id...')
const vendaPorBill = new Map() // billId -> { venda_id, sienge_contract_id }
let offset = 0
const PAGE = 1000
while (true) {
  const url = `${SUPABASE_URL}/rest/v1/vendas?select=id,sienge_contract_id,sienge_receivable_bill_id&sienge_receivable_bill_id=not.is.null&limit=${PAGE}&offset=${offset}`
  const r = await fetch(url, { headers: H })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  const arr = await r.json()
  if (arr.length === 0) break
  for (const v of arr) {
    vendaPorBill.set(Number(v.sienge_receivable_bill_id), { venda_id: v.id, sienge_contract_id: v.sienge_contract_id })
  }
  offset += arr.length
  if (arr.length < PAGE) break
}
console.log(`  vendas com bill_id: ${vendaPorBill.size}`)

console.log('\n[3/5] Baixando pagamentos_prosoluto (TODAS as linhas inclusive canceladas)...')
const localIdxAtivas = new Map() // venda_id -> Map<tipo, Map<seq, row ativa>>
const localIdxCanceladas = new Map() // venda_id -> Map<tipo, Map<seq, [rows canceladas]>>
offset = 0
while (true) {
  const url = `${SUPABASE_URL}/rest/v1/pagamentos_prosoluto?select=id,venda_id,tipo,numero_parcela,valor,data_prevista,data_pagamento,status&limit=${PAGE}&offset=${offset}`
  const r = await fetch(url, { headers: H })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  const arr = await r.json()
  if (arr.length === 0) break
  for (const p of arr) {
    const seq = (p.tipo === 'sinal' && p.numero_parcela == null) ? 1 : p.numero_parcela
    const target = (p.status === 'cancelado') ? localIdxCanceladas : localIdxAtivas
    if (!target.has(p.venda_id)) target.set(p.venda_id, new Map())
    const v = target.get(p.venda_id)
    if (!v.has(p.tipo)) v.set(p.tipo, new Map())
    if (p.status === 'cancelado') {
      if (!v.get(p.tipo).has(seq)) v.get(p.tipo).set(seq, [])
      v.get(p.tipo).get(seq).push(p)
    } else {
      if (!v.get(p.tipo).has(seq)) v.get(p.tipo).set(seq, p)
    }
  }
  offset += arr.length
  process.stdout.write(`  lidos ${offset}\r`)
  if (arr.length < PAGE) break
}
process.stdout.write('\n')
console.log(`  vendas com pagamentos ativos:     ${localIdxAtivas.size}`)
console.log(`  vendas com pagamentos cancelados: ${localIdxCanceladas.size}`)

console.log('\n[4/5] Comparando Sienge -> banco...')
// Duas categorias:
//  - faltante_real: Sienge tem, banco nao tem NADA (nem cancelado)
//  - falso_cancelado: Sienge tem pendente, banco so tem CANCELADA que bate exatamente (data_prevista, valor)
const faltantesReais = []
const falsosCancelados = []
let billsComuns = 0
let billsSienge_SemVenda = 0
function diffDias(a, b) {
  if (!a || !b) return Infinity
  const da = new Date(a + 'T00:00:00Z').getTime()
  const db = new Date(b + 'T00:00:00Z').getTime()
  return Math.abs(da - db) / (24 * 3600 * 1000)
}
function bateComTolerancia(info, canceladaArr) {
  if (!canceladaArr || canceladaArr.length === 0) return null
  let melhor = null
  let melhorDist = Infinity
  for (const c of canceladaArr) {
    const valorBate = Math.abs(Number(c.valor) - info.originalAmount) < 0.01
    if (!valorBate) continue
    const dist = diffDias(c.data_prevista, info.dueDate)
    if (dist <= 30 && dist < melhorDist) {
      melhor = c
      melhorDist = dist
    }
  }
  if (!melhor) return null
  return { ...melhor, _dist_dias: melhorDist }
}
for (const [bid, siengeTipos] of siengeIdx) {
  const venda = vendaPorBill.get(bid)
  if (!venda) { billsSienge_SemVenda++; continue }
  billsComuns++
  const localAtivasTipos = localIdxAtivas.get(venda.venda_id) || new Map()
  const localCanceladasTipos = localIdxCanceladas.get(venda.venda_id) || new Map()
  for (const [tipo, seqMap] of siengeTipos) {
    const ativasSeqMap = localAtivasTipos.get(tipo) || new Map()
    const canceladasSeqMap = localCanceladasTipos.get(tipo) || new Map()
    for (const [seq, info] of seqMap) {
      if (ativasSeqMap.has(seq)) continue // ok, tem ativa
      const canceladaArr = canceladasSeqMap.get(seq)
      const cMatch = bateComTolerancia(info, canceladaArr)
      if (cMatch) {
        falsosCancelados.push({
          ...info,
          venda_id: venda.venda_id,
          sienge_contract_id: venda.sienge_contract_id,
          cancelada_id: cMatch.id,
          cancelada_data_prevista: cMatch.data_prevista,
          cancelada_valor: cMatch.valor,
          cancelada_data_pagamento: cMatch.data_pagamento,
          dist_dias: cMatch._dist_dias,
          precisa_atualizar_data_prevista: cMatch.data_prevista !== info.dueDate,
        })
      } else {
        faltantesReais.push({
          ...info,
          venda_id: venda.venda_id,
          sienge_contract_id: venda.sienge_contract_id,
          motivo: localAtivasTipos.has(tipo) ? 'seq_faltando' : 'tipo_faltando',
          possivelCancelada: canceladaArr ? canceladaArr.map(c => ({ id: c.id, dp: c.data_prevista, valor: c.valor })) : null,
        })
      }
    }
  }
}
const faltantes = faltantesReais // backcompat para o sumario
console.log(`  bills comuns Sienge+banco: ${billsComuns}`)
console.log(`  bills Sienge sem venda local: ${billsSienge_SemVenda}`)
console.log(`  faltantes REAIS (Sienge tem, banco nao tem nem cancelada que bata): ${faltantesReais.length}`)
console.log(`  FALSOS CANCELADOS (Sienge pendente, banco cancelada que bate): ${falsosCancelados.length}`)

console.log('\n[5/5] Classificando faltantes...')
const porStatus = { com_paymentDate: 0, sem_paymentDate: 0 }
const porTipo = {}
const porContrato = {}
for (const f of faltantes) {
  if (f.paymentDate) porStatus.com_paymentDate++
  else porStatus.sem_paymentDate++
  porTipo[f.tipo] = (porTipo[f.tipo] || 0) + 1
  const k = f.sienge_contract_id
  if (!porContrato[k]) porContrato[k] = { total: 0, pagos: 0, pendentes: 0 }
  porContrato[k].total++
  if (f.paymentDate) porContrato[k].pagos++
  else porContrato[k].pendentes++
}

console.log(`  por status: pagos no Sienge=${porStatus.com_paymentDate}  pendentes no Sienge=${porStatus.sem_paymentDate}`)
console.log(`  por tipo:   ${JSON.stringify(porTipo)}`)
console.log(`  por contrato (ate 20):`)
const contratosOrd = Object.entries(porContrato).sort((a, b) => b[1].total - a[1].total).slice(0, 20)
for (const [c, s] of contratosOrd) {
  console.log(`    contrato ${c}: total=${s.total} pagos=${s.pagos} pendentes=${s.pendentes}`)
}

console.log('\n=== AMOSTRA DE PARCELAS FALTANTES (5) ===')
for (const f of faltantes.slice(0, 5)) {
  console.log(`  venda=${f.sienge_contract_id} bill=${f.billId} ${f.tipo}/${f.seq} pt=${f.paymentTermId} due=${f.dueDate} paid=${f.paymentDate||'-'} R$${f.originalAmount}`)
}

writeFileSync('docs/etapa0-parcelas-faltantes.json', JSON.stringify({
  meta: {
    geradoEm: new Date().toISOString(),
    fonteSienge: 'docs/fase5-universo-dueDate-RAW.json (bulk /v1/income, Figueira 2104, CT apenas)',
    siengeBillsCT: siengeIdx.size,
    bancoVendasComBill: vendaPorBill.size,
    billsComuns,
    faltantesReaisTotal: faltantesReais.length,
    falsosCanceladosTotal: falsosCancelados.length,
    faltantesPorStatus: porStatus,
    faltantesPorTipo: porTipo,
    faltantesPorContrato: porContrato,
    regra: 'faltante real = Sienge tem, banco nao tem ativa NEM cancelada que bata por (data_prevista, valor); falso cancelado = Sienge tem pendente, banco so tem cancelada exatamente correspondente -> candidato a reverter cancelado->pendente',
    conclusao: faltantesReais.length === 0 && falsosCancelados.length === 0
      ? 'OK: banco tem 100% das parcelas que o Sienge tem para Figueira'
      : `${faltantesReais.length} faltantes reais + ${falsosCancelados.length} falsos cancelados (a reverter)`,
  },
  faltantesReais,
  falsosCancelados,
}, null, 2))

console.log('\nOutput: docs/etapa0-parcelas-faltantes.json')
