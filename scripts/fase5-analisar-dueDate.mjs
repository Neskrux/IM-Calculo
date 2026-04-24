// Etapa 5B — analisador OFFLINE (zero tokens bulk).
// Cruza:
//   - docs/fase5-universo-dueDate-RAW.json  (bulk income selectionType=D, 17360 rows)
//   - docs/fase5-sales-cancelados-RAW.json  (bulk sales situation=CANCELED, 31 rows)
//   - vendas + pagamentos_prosoluto via REST Supabase
//
// Produz dry-run plan (nao toca banco):
//   docs/fase5-plano-drift-data-prevista.json  — UPDATEs de data_prevista
//   docs/fase5-plano-cancelados.json           — UPDATEs de status='cancelado'
//   docs/fase5-pagamentos-orfaos.json          — pendentes sem match em D nem cancelado
//
// ver .claude/rules/sincronizacao-sienge.md

import { readFileSync, writeFileSync } from 'node:fs'

const SUPABASE_URL = 'https://jdkkusrxullttyeakwib.supabase.co'
const env = readFileSync('.env', 'utf8')
const KEY = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

// ============================================================
// 1. CARREGAR RAW BULK
// ============================================================
console.log('[1/5] Carregando RAWs bulk...')
const rawDue = JSON.parse(readFileSync('docs/fase5-universo-dueDate-RAW.json', 'utf8'))
const rowsDue = rawDue.data || []
const rawCancel = JSON.parse(readFileSync('docs/fase5-sales-cancelados-RAW.json', 'utf8'))
const rowsCancel = rawCancel.data || []
console.log(`  bulk D: ${rowsDue.length} rows`)
console.log(`  bulk cancelados: ${rowsCancel.length} rows\n`)

// ============================================================
// 2. INDEXAR BULK
// ============================================================
console.log('[2/5] Indexando bulk D por (billId, numero_parcela)...')
// Map<`${billId}|${num}`, { dueDate, temReceipt, paymentDate }>
const bulkIdx = new Map()
for (const r of rowsDue) {
  const [num] = String(r.installmentNumber || '').split('/')
  const n = parseInt(num, 10)
  if (!Number.isFinite(n)) continue
  const key = `${r.billId}|${n}`
  const temReceipt = Array.isArray(r.receipts) && r.receipts.length > 0
  const paymentDate = temReceipt ? r.receipts[0].paymentDate : null
  bulkIdx.set(key, { dueDate: r.dueDate, temReceipt, paymentDate })
}
console.log(`  chaves indexadas: ${bulkIdx.size}\n`)

// Set<sienge_contract_id> dos cancelados (campo `id` do /sales)
const canceladosSet = new Map()
for (const s of rowsCancel) {
  canceladosSet.set(String(s.id), { cancellationDate: s.cancellationDate, receivableBillId: s.receivableBillId, cancellationReason: s.cancellationReason })
}
console.log(`[cancelados] contract_ids: ${[...canceladosSet.keys()].slice(0, 10).join(', ')}${canceladosSet.size > 10 ? '...' : ''}\n`)

// ============================================================
// 3. CARREGAR LOCAL (vendas bridge + pagamentos)
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

console.log('[3/5] Carregando vendas + pagamentos local...')
const vendas = await fetchAll('vendas?select=id,sienge_contract_id,sienge_receivable_bill_id&sienge_contract_id=not.is.null&order=id')
console.log(`  vendas com sienge_contract_id: ${vendas.length}`)
const vendaByContractId = new Map()
const vendaByReceivableBillId = new Map()
for (const v of vendas) {
  vendaByContractId.set(String(v.sienge_contract_id), v)
  if (v.sienge_receivable_bill_id) vendaByReceivableBillId.set(String(v.sienge_receivable_bill_id), v)
}
console.log(`  bridge contract_id: ${vendaByContractId.size}`)
console.log(`  bridge receivable_bill_id: ${vendaByReceivableBillId.size}`)

const pagamentos = await fetchAll('pagamentos_prosoluto?select=id,venda_id,numero_parcela,data_prevista,data_pagamento,status,valor,tipo&order=id')
console.log(`  pagamentos_prosoluto: ${pagamentos.length}\n`)

// Agrupa pagamentos por venda_id
const pagsByVenda = new Map()
for (const p of pagamentos) {
  if (!pagsByVenda.has(p.venda_id)) pagsByVenda.set(p.venda_id, [])
  pagsByVenda.get(p.venda_id).push(p)
}

// ============================================================
// 4. CROSS-MATCH
// ============================================================
console.log('[4/5] Cross-match...')

const driftDataPrevista = []
const planoCancelados = []
const orfaos = []

// Set de venda_ids canceladas (p/ eficiencia)
const vendasCanceladasIds = new Set()
for (const [contractId, meta] of canceladosSet.entries()) {
  const v = vendaByContractId.get(contractId)
  if (!v) continue // cancelado no sienge mas nao existe local — pre-cleanup?
  vendasCanceladasIds.add(v.id)
  // Pagamentos nao-pagos dessa venda sao candidatos a cancelar
  const pags = pagsByVenda.get(v.id) || []
  for (const p of pags) {
    if (p.status === 'pago') continue // protegido pela trigger 017
    if (p.status === 'cancelado') continue
    planoCancelados.push({
      pagamento_id: p.id,
      venda_id: v.id,
      sienge_contract_id: contractId,
      numero_parcela: p.numero_parcela,
      tipo: p.tipo,
      status_atual: p.status,
      data_prevista_atual: p.data_prevista,
      cancellationDate: meta.cancellationDate,
      cancellationReason: meta.cancellationReason,
    })
  }
}
console.log(`  vendas canceladas encontradas local: ${vendasCanceladasIds.size}/${canceladosSet.size}`)
console.log(`  pagamentos-candidatos-cancelar: ${planoCancelados.length}`)

// Drift data_prevista + orfaos
let matchedD = 0
for (const p of pagamentos) {
  // Se venda cancelada, nao conta como drift (ja vai virar cancelado)
  if (vendasCanceladasIds.has(p.venda_id)) continue

  const v = vendas.find(x => x.id === p.venda_id)
  if (!v?.sienge_receivable_bill_id) continue

  const key = `${v.sienge_receivable_bill_id}|${p.numero_parcela}`
  const bulkRow = bulkIdx.get(key)

  if (!bulkRow) {
    // Orfao: pagamento local sem match em D e venda nao cancelada
    if (p.status === 'pendente') {
      orfaos.push({
        pagamento_id: p.id,
        venda_id: p.venda_id,
        sienge_contract_id: v.sienge_contract_id,
        sienge_receivable_bill_id: v.sienge_receivable_bill_id,
        numero_parcela: p.numero_parcela,
        tipo: p.tipo,
        data_prevista_atual: p.data_prevista,
      })
    }
    continue
  }
  matchedD++

  // Drift data_prevista?
  if (bulkRow.dueDate && p.data_prevista && bulkRow.dueDate !== p.data_prevista) {
    const deltaDays = Math.round((new Date(bulkRow.dueDate) - new Date(p.data_prevista)) / 86400000)
    driftDataPrevista.push({
      pagamento_id: p.id,
      venda_id: p.venda_id,
      sienge_receivable_bill_id: v.sienge_receivable_bill_id,
      numero_parcela: p.numero_parcela,
      tipo: p.tipo,
      status: p.status,
      data_prevista_atual: p.data_prevista,
      data_prevista_sienge: bulkRow.dueDate,
      delta_dias: deltaDays,
    })
  }
}

console.log(`  matched em bulk D:       ${matchedD}`)
console.log(`  drift data_prevista:     ${driftDataPrevista.length}`)
console.log(`  orfaos (pendente s/match):${orfaos.length}\n`)

// ============================================================
// 5. ESCREVER PLANOS (DRY RUN)
// ============================================================
console.log('[5/5] Escrevendo planos dry-run...')

const meta = {
  geradoEm: new Date().toISOString(),
  source: {
    bulkD: 'docs/fase5-universo-dueDate-RAW.json',
    bulkCancelados: 'docs/fase5-sales-cancelados-RAW.json',
  },
  counts: {
    bulkD_rows: rowsDue.length,
    bulkD_indexed: bulkIdx.size,
    cancelados_bulk: canceladosSet.size,
    cancelados_local_match: vendasCanceladasIds.size,
    vendas_local_bridge: vendaByContractId.size,
    pagamentos_local: pagamentos.length,
    matched_em_D: matchedD,
    drift_data_prevista: driftDataPrevista.length,
    plano_cancelados: planoCancelados.length,
    orfaos_pendente_sem_match: orfaos.length,
  },
}

writeFileSync('docs/fase5-plano-drift-data-prevista.json', JSON.stringify({ meta, rows: driftDataPrevista }, null, 2))
writeFileSync('docs/fase5-plano-cancelados.json', JSON.stringify({ meta, rows: planoCancelados }, null, 2))
writeFileSync('docs/fase5-pagamentos-orfaos.json', JSON.stringify({ meta, rows: orfaos }, null, 2))

console.log('\n================================================================')
console.log('ANALISE ETAPA 5B — DRY RUN')
console.log('================================================================')
console.log(`  bulk D rows:                 ${rowsDue.length}`)
console.log(`  bulk cancelados:             ${rowsCancel.length}`)
console.log(`  vendas local com bridge:     ${vendaByContractId.size}`)
console.log(`  pagamentos local:            ${pagamentos.length}`)
console.log(`  matched em bulk D:           ${matchedD}`)
console.log(`  drift data_prevista:         ${driftDataPrevista.length}`)
console.log(`  cancelados candidatos:       ${planoCancelados.length}`)
console.log(`  orfaos pendentes sem match:  ${orfaos.length}`)
console.log('')
console.log('Output:')
console.log('  docs/fase5-plano-drift-data-prevista.json')
console.log('  docs/fase5-plano-cancelados.json')
console.log('  docs/fase5-pagamentos-orfaos.json')

// Histograma de deltas
if (driftDataPrevista.length > 0) {
  const deltas = driftDataPrevista.map(r => Math.abs(r.delta_dias)).sort((a, b) => a - b)
  const p = pct => deltas[Math.floor(deltas.length * pct)]
  console.log('')
  console.log('Histograma |delta_dias| drift data_prevista:')
  console.log(`  min=${deltas[0]}  p25=${p(0.25)}  p50=${p(0.5)}  p75=${p(0.75)}  p95=${p(0.95)}  max=${deltas[deltas.length - 1]}`)
}
