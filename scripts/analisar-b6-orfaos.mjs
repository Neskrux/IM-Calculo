// Etapa 5B.6 — analise de orfaos pendentes.
// ver .claude/rules/sincronizacao-sienge.md
//
// Orfao = linha local com billId preenchido e chave (billId, tipo, seq) SEM par no bulk D Sienge.
//
// Buckets de classificacao:
//   A — venda cancelada no Sienge (sales status=cancelado)
//   C1 — venda ativa, seq fora do range Sienge (sobra do gerador antigo), pendente
//   C2 — idem, mas pago (revisao humana)
//   D — venda ativa, seq dentro do range mas Sienge nao tem aquela seq (raro)
//   E — venda ativa, billId sem PMs no Sienge (venda sem contrato financeiro?)
//
// Tipos bens/comissao_integral ficam fora (tipo B, nao e receivable):
//   tratados em SQL direto pela query — nao entram como orfaos aqui.

import { readFileSync, writeFileSync } from 'node:fs'

const PT_MAP = {
  PM: { tipo: 'parcela_entrada', seqFromInstallment: true },
  SN: { tipo: 'sinal', seq: 1 },
  AT: { tipo: 'sinal', seq: 1 },
  B1: { tipo: 'balao', seq: 1 }, B2: { tipo: 'balao', seq: 2 }, B3: { tipo: 'balao', seq: 3 },
  B4: { tipo: 'balao', seq: 4 }, B5: { tipo: 'balao', seq: 5 }, B6: { tipo: 'balao', seq: 6 },
  B7: { tipo: 'balao', seq: 7 }, B8: { tipo: 'balao', seq: 8 }, B9: { tipo: 'balao', seq: 9 },
  BA: { tipo: 'balao', seqFromInstallment: true },
}

console.log('[1/5] Carregando bulk D Sienge...')
const raw = JSON.parse(readFileSync('docs/fase5-universo-dueDate-RAW.json', 'utf8'))
const bulkRows = raw.data || []
console.log(`  bulk rows: ${bulkRows.length}`)

// Index Sienge: billId -> Map<tipo, Set<seq>> + maxSeq por tipo
const siengeIdx = new Map()
for (const r of bulkRows) {
  const ptId = r.paymentTerm?.id
  const map = PT_MAP[ptId]
  if (!map) continue
  let seq = map.seq
  if (map.seqFromInstallment) {
    const [n] = String(r.installmentNumber || '').split('/')
    seq = parseInt(n, 10)
    if (!Number.isFinite(seq)) continue
  }
  if (!siengeIdx.has(r.billId)) siengeIdx.set(r.billId, { byTipo: new Map() })
  const b = siengeIdx.get(r.billId)
  if (!b.byTipo.has(map.tipo)) b.byTipo.set(map.tipo, new Set())
  b.byTipo.get(map.tipo).add(seq)
}
console.log(`  billIds no bulk Sienge: ${siengeIdx.size}`)

console.log('\n[2/5] Carregando universo local...')
const local = JSON.parse(readFileSync('docs/b6-universo-local.json', 'utf8'))
console.log(`  pagamentos locais: ${local.length}`)

console.log('\n[3/5] Detectando orfaos (sem par no bulk)...')
const orfaos = []
const emBulk = { count: 0 }
for (const r of local) {
  const b = siengeIdx.get(r.bill_id)
  if (!b) {
    orfaos.push({ ...r, motivo: 'billId_nao_existe_bulk' })
    continue
  }
  const seqs = b.byTipo.get(r.tipo)
  if (!seqs) {
    orfaos.push({ ...r, motivo: 'tipo_nao_existe_bulk' })
    continue
  }
  // Sinal no banco tem numero_parcela=null; Sienge mapeia como seq=1. Normalizar.
  const seqLocal = (r.tipo === 'sinal' && r.numero_parcela == null) ? 1 : r.numero_parcela
  if (!seqs.has(seqLocal)) {
    orfaos.push({ ...r, motivo: 'seq_nao_existe_bulk' })
    continue
  }
  emBulk.count++
}
console.log(`  em bulk (ok): ${emBulk.count}`)
console.log(`  orfaos:       ${orfaos.length}`)

console.log('\n[4/5] Carregando status de vendas canceladas Sienge...')
let salesCancelados = new Set()
try {
  const salesRaw = JSON.parse(readFileSync('docs/fase5-sales-cancelados-RAW.json', 'utf8'))
  const data = salesRaw.data || salesRaw.results || []
  for (const s of data) {
    const cid = String(s.id || s.contractId || s.salesContractId || '')
    if (cid) salesCancelados.add(cid)
  }
  console.log(`  vendas canceladas conhecidas (Sienge): ${salesCancelados.size}`)
} catch (e) {
  console.log(`  (nao foi possivel carregar sales cancelados: ${e.message})`)
}

console.log('\n[5/5] Classificando orfaos em buckets...')
const buckets = { A: [], C1: [], C2: [], D: [], E: [] }
const maxSeqByBill = new Map()
for (const [bid, b] of siengeIdx) {
  let max = 0
  for (const seqs of b.byTipo.values()) for (const s of seqs) if (s > max) max = s
  maxSeqByBill.set(bid, max)
}

for (const o of orfaos) {
  const vendaCanc = salesCancelados.has(String(o.sienge_contract_id))
  if (vendaCanc) { buckets.A.push(o); continue }

  const b = siengeIdx.get(o.bill_id)
  if (!b) { buckets.E.push(o); continue }

  const seqsTipo = b.byTipo.get(o.tipo)
  if (!seqsTipo) {
    // tipo inexistente no Sienge — trata como D (esperado ter, nao tem)
    buckets.D.push(o); continue
  }

  const maxSeqDesseTipo = Math.max(...seqsTipo)
  const seqLocal = (o.tipo === 'sinal' && o.numero_parcela == null) ? 1 : o.numero_parcela
  if (seqLocal > maxSeqDesseTipo) {
    // seq fora do range
    if (o.status === 'pago') buckets.C2.push(o)
    else buckets.C1.push(o)
  } else {
    buckets.D.push(o)
  }
}

function summary(arr) {
  const s = { total: arr.length, porStatus: {}, porTipo: {}, vendas: new Set() }
  for (const r of arr) {
    s.porStatus[r.status] = (s.porStatus[r.status] || 0) + 1
    s.porTipo[r.tipo] = (s.porTipo[r.tipo] || 0) + 1
    s.vendas.add(r.sienge_contract_id)
  }
  s.vendasDistintas = s.vendas.size
  delete s.vendas
  return s
}

console.log('\n=== BUCKETS ===')
for (const [k, arr] of Object.entries(buckets)) {
  const s = summary(arr)
  console.log(`${k}: total=${s.total}  porStatus=${JSON.stringify(s.porStatus)}  porTipo=${JSON.stringify(s.porTipo)}  vendas=${s.vendasDistintas}`)
}

console.log('\n=== AMOSTRA POR BUCKET (3 casos) ===')
for (const [k, arr] of Object.entries(buckets)) {
  console.log(`\n-- Bucket ${k} --`)
  for (const r of arr.slice(0, 3)) {
    console.log(`  venda=${r.sienge_contract_id} bill=${r.bill_id} ${r.tipo}/${r.numero_parcela}  status=${r.status}  dp=${r.data_prevista}  dpag=${r.data_pagamento}`)
  }
}

writeFileSync('docs/analise-b6-orfaos.json', JSON.stringify({
  meta: {
    geradoEm: new Date().toISOString(),
    totalLocalComBill: local.length,
    emBulk: emBulk.count,
    orfaosTotal: orfaos.length,
    vendasCanceladasSienge: salesCancelados.size,
    regra: 'A=venda cancelada Sienge; C1=seq fora range pendente; C2=seq fora range pago; D=seq dentro range mas Sienge nao tem; E=billId sem PMs no Sienge',
  },
  summary: Object.fromEntries(Object.entries(buckets).map(([k, arr]) => [k, summary(arr)])),
  buckets,
}, null, 2))

console.log('\nOutput: docs/analise-b6-orfaos.json')
