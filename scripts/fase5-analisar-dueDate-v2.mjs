// Etapa 5B v2 — analisador OFFLINE com chave de match correta.
// Descoberto 2026-04-24: billId+numero_parcela NAO e unico no Sienge.
// Chave correta: (billId, paymentTerm.id → tipo canonico, seq).
// ver .claude/rules/sincronizacao-sienge.md

import { readFileSync, writeFileSync } from 'node:fs'

const SUPABASE_URL = 'https://jdkkusrxullttyeakwib.supabase.co'
const env = readFileSync('.env', 'utf8')
const KEY = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

// Mapa paymentTerm.id (Sienge) → (tipo canonico local, seq)
// Batido com o time IM:
//   DESCARTAR: PU, PA, CA, CV, BN (+ outros nao-mapeados: FI, PE, CH, "10", etc)
//   INCLUIR:  PM→parcela_entrada, AT/SN→sinal, B1-B9/BA→balao
const PT_MAP = {
  PM: { tipo: 'parcela_entrada', seqFromInstallment: true },
  SN: { tipo: 'sinal', seq: 1 },
  AT: { tipo: 'sinal', seq: 1 },
  B1: { tipo: 'balao', seq: 1 },
  B2: { tipo: 'balao', seq: 2 },
  B3: { tipo: 'balao', seq: 3 },
  B4: { tipo: 'balao', seq: 4 },
  B5: { tipo: 'balao', seq: 5 },
  B6: { tipo: 'balao', seq: 6 },
  B7: { tipo: 'balao', seq: 7 },
  B8: { tipo: 'balao', seq: 8 },
  B9: { tipo: 'balao', seq: 9 },
  BA: { tipo: 'balao', seqFromInstallment: true }, // balao legado: usa installmentNumber
}

console.log('[1/5] Carregando RAWs bulk...')
const rawDue = JSON.parse(readFileSync('docs/fase5-universo-dueDate-RAW.json', 'utf8'))
const rowsDue = rawDue.data || []
const rawCancel = JSON.parse(readFileSync('docs/fase5-sales-cancelados-RAW.json', 'utf8'))
const rowsCancel = rawCancel.data || []
console.log(`  bulk D: ${rowsDue.length} rows`)
console.log(`  bulk cancelados: ${rowsCancel.length} rows\n`)

// ============================================================
// 2. INDEXAR BULK com chave correta
// ============================================================
console.log('[2/5] Indexando bulk D por (billId, tipo, seq)...')
const bulkIdx = new Map()
const ptStats = { mapped: 0, descartado: 0, desconhecido: 0 }
const ptDesconhecidos = new Set()
const colisoes = []

for (const r of rowsDue) {
  const ptId = r.paymentTerm?.id
  if (!ptId) { ptStats.descartado++; continue }
  const map = PT_MAP[ptId]
  if (!map) {
    // Lixo: PU/PA/CA/CV/BN + outros desconhecidos
    ptStats.descartado++
    ptDesconhecidos.add(ptId)
    continue
  }
  let seq = map.seq
  if (map.seqFromInstallment) {
    const [n] = String(r.installmentNumber || '').split('/')
    seq = parseInt(n, 10)
    if (!Number.isFinite(seq)) continue
  }
  const key = `${r.billId}|${map.tipo}|${seq}`
  const temReceipt = Array.isArray(r.receipts) && r.receipts.length > 0
  const paymentDate = temReceipt ? r.receipts[0].paymentDate : null
  if (bulkIdx.has(key)) {
    colisoes.push({ key, dueDateA: bulkIdx.get(key).dueDate, dueDateB: r.dueDate, installmentId_new: r.installmentId })
  }
  bulkIdx.set(key, { dueDate: r.dueDate, temReceipt, paymentDate, installmentId: r.installmentId, ptId, originalAmount: r.originalAmount })
  ptStats.mapped++
}
console.log(`  mapeados:     ${ptStats.mapped}`)
console.log(`  descartados:  ${ptStats.descartado}`)
console.log(`  chaves unicas:${bulkIdx.size}`)
console.log(`  colisoes (mesma chave):${colisoes.length}`)
if (ptDesconhecidos.size > 0) console.log(`  paymentTerms descartados: ${[...ptDesconhecidos].join(', ')}`)
console.log('')

// Set cancelados
const canceladosMap = new Map()
for (const s of rowsCancel) {
  canceladosMap.set(String(s.id), { cancellationDate: s.cancellationDate, receivableBillId: s.receivableBillId, cancellationReason: s.cancellationReason })
}

// ============================================================
// 3. CARREGAR LOCAL
// ============================================================
async function fetchAll(pathQuery) {
  const PAGE = 1000
  const all = []
  let offset = 0
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${pathQuery}&limit=${PAGE}&offset=${offset}`
    const r = await fetch(url, { headers: { ...H, Accept: 'application/json' } })
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
    const arr = await r.json()
    all.push(...arr)
    if (arr.length < PAGE) break
    offset += PAGE
  }
  return all
}

console.log('[3/5] Carregando local...')
const vendas = await fetchAll('vendas?select=id,sienge_contract_id,sienge_receivable_bill_id&sienge_contract_id=not.is.null&order=id')
const vendaByContractId = new Map()
const vendaById = new Map()
for (const v of vendas) {
  vendaByContractId.set(String(v.sienge_contract_id), v)
  vendaById.set(v.id, v)
}
const pagamentos = await fetchAll('pagamentos_prosoluto?select=id,venda_id,numero_parcela,data_prevista,data_pagamento,status,valor,tipo&order=id')
console.log(`  vendas: ${vendas.length}  pagamentos: ${pagamentos.length}\n`)

// ============================================================
// 4. CROSS-MATCH com chave correta
// ============================================================
console.log('[4/5] Cross-match...')

const vendasCanceladasIds = new Set()
const planoCancelados = []
for (const [contractId, meta] of canceladosMap.entries()) {
  const v = vendaByContractId.get(contractId)
  if (!v) continue
  vendasCanceladasIds.add(v.id)
}

const driftDataPrevista = []
const orfaos = []
let matchedD = 0
let skipPorCancelada = 0
let skipTipoNaoMapeavel = 0
let skipSemBridge = 0

for (const p of pagamentos) {
  if (vendasCanceladasIds.has(p.venda_id)) { skipPorCancelada++; continue }
  const v = vendaById.get(p.venda_id)
  if (!v?.sienge_receivable_bill_id) { skipSemBridge++; continue }
  // Tipos locais que mapeiam pra bulk: sinal, parcela_entrada, balao
  // Outros tipos locais (ex: comissao_integral, entrada): nao tem correspondencia no bulk
  if (!['sinal', 'parcela_entrada', 'balao'].includes(p.tipo)) { skipTipoNaoMapeavel++; continue }

  const key = `${v.sienge_receivable_bill_id}|${p.tipo}|${p.numero_parcela}`
  const bulkRow = bulkIdx.get(key)

  if (!bulkRow) {
    if (p.status === 'pendente') {
      orfaos.push({
        pagamento_id: p.id,
        venda_id: p.venda_id,
        sienge_contract_id: v.sienge_contract_id,
        sienge_receivable_bill_id: v.sienge_receivable_bill_id,
        tipo: p.tipo,
        numero_parcela: p.numero_parcela,
        valor: p.valor,
        data_prevista_atual: p.data_prevista,
      })
    }
    continue
  }
  matchedD++

  if (bulkRow.dueDate && p.data_prevista && bulkRow.dueDate !== p.data_prevista) {
    const deltaDays = Math.round((new Date(bulkRow.dueDate) - new Date(p.data_prevista)) / 86400000)
    driftDataPrevista.push({
      pagamento_id: p.id,
      venda_id: p.venda_id,
      sienge_receivable_bill_id: v.sienge_receivable_bill_id,
      installmentId: bulkRow.installmentId,
      ptId: bulkRow.ptId,
      tipo: p.tipo,
      numero_parcela: p.numero_parcela,
      status: p.status,
      valor: p.valor,
      valor_sienge: bulkRow.originalAmount,
      data_prevista_atual: p.data_prevista,
      data_prevista_sienge: bulkRow.dueDate,
      delta_dias: deltaDays,
    })
  }
}

// Cancelados (pagos nao mexemos — trigger 017 protege status)
const pagsByVenda = new Map()
for (const p of pagamentos) {
  if (!pagsByVenda.has(p.venda_id)) pagsByVenda.set(p.venda_id, [])
  pagsByVenda.get(p.venda_id).push(p)
}
for (const vid of vendasCanceladasIds) {
  const v = vendaById.get(vid)
  const meta = canceladosMap.get(String(v.sienge_contract_id))
  const pags = pagsByVenda.get(vid) || []
  for (const p of pags) {
    if (p.status === 'pago' || p.status === 'cancelado') continue
    planoCancelados.push({
      pagamento_id: p.id,
      venda_id: vid,
      sienge_contract_id: v.sienge_contract_id,
      tipo: p.tipo,
      numero_parcela: p.numero_parcela,
      status_atual: p.status,
      valor: p.valor,
      cancellationDate: meta.cancellationDate,
      cancellationReason: meta.cancellationReason,
    })
  }
}

console.log(`  matched em bulk D:            ${matchedD}`)
console.log(`  drift data_prevista:          ${driftDataPrevista.length}`)
console.log(`  skip por venda cancelada:     ${skipPorCancelada}`)
console.log(`  skip sem bridge (sienge_rb):  ${skipSemBridge}`)
console.log(`  skip tipo nao mapeavel:       ${skipTipoNaoMapeavel}`)
console.log(`  orfaos (pendente sem match):  ${orfaos.length}`)
console.log(`  plano cancelados:             ${planoCancelados.length}\n`)

// ============================================================
// 5. OUTPUT
// ============================================================
const meta = {
  geradoEm: new Date().toISOString(),
  versao: 'v2 (chave correta: billId+tipo+seq)',
  counts: {
    bulkD_rows: rowsDue.length,
    bulkD_mapped: ptStats.mapped,
    bulkD_descartados: ptStats.descartado,
    bulkD_indexed: bulkIdx.size,
    bulkD_colisoes: colisoes.length,
    cancelados_bulk: rowsCancel.length,
    cancelados_local_match: vendasCanceladasIds.size,
    vendas_local: vendas.length,
    pagamentos_local: pagamentos.length,
    matched_em_D: matchedD,
    drift_data_prevista: driftDataPrevista.length,
    plano_cancelados: planoCancelados.length,
    orfaos: orfaos.length,
    skip_por_cancelada: skipPorCancelada,
    skip_sem_bridge: skipSemBridge,
    skip_tipo_nao_mapeavel: skipTipoNaoMapeavel,
  },
}

writeFileSync('docs/fase5-plano-drift-data-prevista-v2.json', JSON.stringify({ meta, rows: driftDataPrevista }, null, 2))
writeFileSync('docs/fase5-plano-cancelados-v2.json', JSON.stringify({ meta, rows: planoCancelados }, null, 2))
writeFileSync('docs/fase5-pagamentos-orfaos-v2.json', JSON.stringify({ meta, rows: orfaos }, null, 2))
writeFileSync('docs/fase5-colisoes-chave.json', JSON.stringify({ meta: { count: colisoes.length }, rows: colisoes.slice(0, 100) }, null, 2))

console.log('================================================================')
console.log('ANALISE ETAPA 5B v2 — DRY RUN')
console.log('================================================================')
console.log(`  bulk D rows total:           ${rowsDue.length}`)
console.log(`  bulk D mapeaveis:            ${ptStats.mapped}`)
console.log(`  bulk D chaves unicas:        ${bulkIdx.size}`)
console.log(`  colisoes de chave:           ${colisoes.length}`)
console.log(`  pagamentos local:            ${pagamentos.length}`)
console.log(`  matched em bulk D:           ${matchedD}`)
console.log(`  drift data_prevista:         ${driftDataPrevista.length}`)
console.log(`  plano cancelados:            ${planoCancelados.length}`)
console.log(`  orfaos pendentes:            ${orfaos.length}`)

if (driftDataPrevista.length > 0) {
  const bucket = { '<=7d':0, '8-30d':0, '31-180d':0, '181-365d':0, '>365d':0 }
  for (const r of driftDataPrevista) {
    const d = Math.abs(r.delta_dias)
    if (d<=7) bucket['<=7d']++
    else if (d<=30) bucket['8-30d']++
    else if (d<=180) bucket['31-180d']++
    else if (d<=365) bucket['181-365d']++
    else bucket['>365d']++
  }
  console.log('\nDistribuicao |delta| drift data_prevista:', JSON.stringify(bucket))
  const porTipo = {}
  const porStatus = {}
  for (const r of driftDataPrevista) {
    porTipo[r.tipo] = (porTipo[r.tipo]||0)+1
    porStatus[r.status] = (porStatus[r.status]||0)+1
  }
  console.log('Por tipo:', JSON.stringify(porTipo))
  console.log('Por status:', JSON.stringify(porStatus))
}

console.log('\nOutputs:')
console.log('  docs/fase5-plano-drift-data-prevista-v2.json')
console.log('  docs/fase5-plano-cancelados-v2.json')
console.log('  docs/fase5-pagamentos-orfaos-v2.json')
console.log('  docs/fase5-colisoes-chave.json')
