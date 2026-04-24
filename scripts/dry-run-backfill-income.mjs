// Etapa 3 — DRY RUN do backfill de pagamentos_prosoluto.
// ver .claude/rules/sincronizacao-sienge.md
//
// Faz o match em memória, sem tocar o banco. Reporta:
//   matched            — linhas que casam por (venda_id, numero_parcela) e tipo compatível
//   no_match_venda     — billId do Sienge que nao tem venda local
//   no_match_parcela   — venda existe mas numero_parcela nao existe em pagamentos_prosoluto
//   tipo_divergente    — parcela existe mas com tipo diferente do esperado
//   ja_pago            — pagamento ja esta status=pago (nao sera tocado)
//   drift_valor        — valor difere > R$ 0,01
//   drift_data_prevista— data_prevista difere do dueDate do Sienge (>1 dia)
//   would_update       — set final que a Etapa 4 faria UPDATE
//
// Input: docs/backfill-stage.json, REST API Supabase (anon)
// Output: docs/dry-run-match.json

import { readFileSync, writeFileSync } from 'node:fs'

const SUPABASE_URL = 'https://jdkkusrxullttyeakwib.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY
if (!ANON_KEY) {
  console.error('Faltando SUPABASE_ANON_KEY no env (ou passar via .env).')
  // tentar pegar do .env
  const env = readFileSync('.env', 'utf8')
  const m = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)
  if (!m) process.exit(1)
  process.env.SUPABASE_ANON_KEY = m[1].trim()
}
const KEY = process.env.SUPABASE_ANON_KEY

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
}

async function fetchPage(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: H })
  if (!r.ok) {
    console.error(`HTTP ${r.status} em ${path}: ${await r.text()}`)
    process.exit(1)
  }
  return r.json()
}

async function fetchAll(table, select, filters = '') {
  const pageSize = 1000
  let offset = 0
  const all = []
  while (true) {
    const path = `${table}?select=${select}${filters ? '&' + filters : ''}&order=id&limit=${pageSize}&offset=${offset}`
    const page = await fetchPage(path)
    all.push(...page)
    process.stdout.write(`  ${table}: ${all.length} rows\r`)
    if (page.length < pageSize) break
    offset += pageSize
  }
  process.stdout.write('\n')
  return all
}

console.log('Carregando vendas (com sienge_receivable_bill_id)...')
const vendas = await fetchAll(
  'vendas',
  'id,sienge_contract_id,sienge_receivable_bill_id,excluido',
  'sienge_receivable_bill_id=not.is.null&excluido=is.false'
)

console.log(`  total vendas com bill_id: ${vendas.length}`)

// indexar vendas por bill_id
const vendaByBillId = new Map()
for (const v of vendas) {
  vendaByBillId.set(Number(v.sienge_receivable_bill_id), v)
}
console.log(`  billIds distintos: ${vendaByBillId.size}`)

console.log('\nCarregando pagamentos_prosoluto (apenas das vendas com bill_id)...')
const vendaIds = vendas.map(v => v.id)
// fetch em lotes de venda_ids via in(), paginando com offset (Supabase cap = 1000)
const pagamentos = []
const BATCH = 150
const PAGE = 1000
for (let i = 0; i < vendaIds.length; i += BATCH) {
  const batch = vendaIds.slice(i, i + BATCH)
  const inClause = `venda_id=in.(${batch.join(',')})`
  let offset = 0
  while (true) {
    const page = await fetchPage(
      `pagamentos_prosoluto?select=id,venda_id,tipo,numero_parcela,valor,data_prevista,data_pagamento,status&${inClause}&order=id&limit=${PAGE}&offset=${offset}`
    )
    pagamentos.push(...page)
    process.stdout.write(`  pagamentos: ${pagamentos.length}\r`)
    if (page.length < PAGE) break
    offset += PAGE
  }
}
process.stdout.write('\n')
console.log(`  total pagamentos: ${pagamentos.length}`)

// indexar pagamentos por (venda_id, numero_parcela) — pode ter mais de um tipo no mesmo numero
const pagByVendaParcela = new Map()
for (const p of pagamentos) {
  if (p.numero_parcela == null) continue
  const k = `${p.venda_id}|${p.numero_parcela}`
  if (!pagByVendaParcela.has(k)) pagByVendaParcela.set(k, [])
  pagByVendaParcela.get(k).push(p)
}

console.log('\nLendo staging (docs/backfill-stage.json)...')
const raw = JSON.parse(readFileSync('docs/backfill-stage.json', 'utf8'))
const stage = raw.stage || []
console.log(`  ${stage.length} linhas no stage`)

// tipos compativeis — sinal pode virar 'sinal' ou 'entrada' (historico), parcela_entrada
// vira 'parcela_entrada', balao vira 'balao'. Faz match permissivo primeiro, relata divergencia.
const TIPOS_ACEITOS = {
  parcela_entrada: ['parcela_entrada'],
  sinal: ['sinal', 'entrada'],
  balao: ['balao'],
}

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    totalStage: stage.length,
    totalVendasComBillId: vendas.length,
    totalPagamentos: pagamentos.length,
  },
  counts: {
    matched: 0,
    no_match_venda: 0,
    no_match_parcela: 0,
    tipo_divergente: 0,
    ja_pago: 0,
    ja_pago_drift_data: 0,
    drift_valor: 0,
    drift_data_prevista: 0,
    would_update: 0,
  },
  samples: {
    no_match_venda: [],
    no_match_parcela: [],
    tipo_divergente: [],
    ja_pago: [],
    ja_pago_drift_data: [],
    drift_valor: [],
    drift_data_prevista: [],
    would_update: [],
  },
  byTipo: {},
  byBillIdSemMatch: {},
}

function addSample(key, obj, max = 10) {
  if (report.samples[key].length < max) report.samples[key].push(obj)
}

function diffDias(a, b) {
  if (!a || !b) return null
  const da = new Date(a)
  const db = new Date(b)
  return Math.round(Math.abs(da - db) / 86400000)
}

for (const s of stage) {
  const venda = vendaByBillId.get(s.billId)
  if (!venda) {
    report.counts.no_match_venda++
    report.byBillIdSemMatch[s.billId] = (report.byBillIdSemMatch[s.billId] || 0) + 1
    addSample('no_match_venda', { billId: s.billId, clientName: s.clientName, numeroParcela: s.numeroParcela })
    continue
  }

  const key = `${venda.id}|${s.numeroParcela}`
  const candidatos = pagByVendaParcela.get(key) || []
  if (candidatos.length === 0) {
    report.counts.no_match_parcela++
    addSample('no_match_parcela', {
      billId: s.billId, vendaId: venda.id, numeroParcela: s.numeroParcela,
      tipoInterno: s.tipoInterno, paymentDate: s.paymentDate,
    })
    continue
  }

  // procurar candidato com tipo compativel
  const tiposEsperados = TIPOS_ACEITOS[s.tipoInterno] || [s.tipoInterno]
  const candidatoOk = candidatos.find(p => tiposEsperados.includes(p.tipo))
  if (!candidatoOk) {
    report.counts.tipo_divergente++
    addSample('tipo_divergente', {
      billId: s.billId, vendaId: venda.id, numeroParcela: s.numeroParcela,
      tipoStageEsperado: s.tipoInterno, tiposEncontrados: candidatos.map(c => c.tipo),
    })
    continue
  }

  report.counts.matched++
  report.byTipo[s.tipoInterno] = (report.byTipo[s.tipoInterno] || 0) + 1

  // ja pago?
  if (candidatoOk.status === 'pago') {
    report.counts.ja_pago++
    const dDias = diffDias(candidatoOk.data_pagamento, s.paymentDate)
    if (dDias != null && dDias > 1) {
      report.counts.ja_pago_drift_data++
      addSample('ja_pago_drift_data', {
        billId: s.billId, vendaId: venda.id, numeroParcela: s.numeroParcela,
        dataLocal: candidatoOk.data_pagamento, dataSienge: s.paymentDate, dDias,
      })
    } else {
      addSample('ja_pago', {
        billId: s.billId, vendaId: venda.id, numeroParcela: s.numeroParcela,
        dataLocal: candidatoOk.data_pagamento, dataSienge: s.paymentDate,
      })
    }
    continue
  }

  // drift valor (trigger 017 nao barra update em pendente, mas queremos auditar)
  const vBanco = Number(candidatoOk.valor)
  const vSienge = Number(s.valorOriginal)
  if (Math.abs(vBanco - vSienge) > 0.01) {
    report.counts.drift_valor++
    addSample('drift_valor', {
      billId: s.billId, vendaId: venda.id, numeroParcela: s.numeroParcela,
      valorBanco: vBanco, valorSienge: vSienge, diff: Number((vSienge - vBanco).toFixed(2)),
    })
  }

  // drift data_prevista
  const dDiasPrev = diffDias(candidatoOk.data_prevista, s.dueDate)
  if (dDiasPrev != null && dDiasPrev > 1) {
    report.counts.drift_data_prevista++
    addSample('drift_data_prevista', {
      billId: s.billId, vendaId: venda.id, numeroParcela: s.numeroParcela,
      dataPrevistaBanco: candidatoOk.data_prevista, dueDateSienge: s.dueDate, dDias: dDiasPrev,
    })
  }

  report.counts.would_update++
  addSample('would_update', {
    billId: s.billId, vendaId: venda.id, pagamentoId: candidatoOk.id,
    numeroParcela: s.numeroParcela, tipo: candidatoOk.tipo,
    paymentDate: s.paymentDate, valorPago: s.valorPago,
  })
}

// ordenar byBillIdSemMatch
report.byBillIdSemMatch = Object.fromEntries(
  Object.entries(report.byBillIdSemMatch).sort((a, b) => b[1] - a[1]).slice(0, 30)
)

console.log('')
console.log('================================================================')
console.log('DRY RUN — resultado')
console.log('================================================================')
for (const [k, v] of Object.entries(report.counts)) {
  console.log(`  ${k.padEnd(22)} ${String(v).padStart(5)}`)
}
console.log('')
console.log('Por tipo (matched):')
for (const [t, n] of Object.entries(report.byTipo).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(18)} ${String(n).padStart(5)}`)
}
console.log('')

writeFileSync('docs/dry-run-match.json', JSON.stringify(report, null, 2))
console.log('Output: docs/dry-run-match.json')

// Materializa o set COMPLETO de would_update (sem cap de samples)
// pra Etapa 4 consumir. Schema minimo: id + data_pagamento.
const wouldUpdateFull = []
for (const s of stage) {
  const venda = vendaByBillId.get(s.billId)
  if (!venda) continue
  const key = `${venda.id}|${s.numeroParcela}`
  const candidatos = pagByVendaParcela.get(key) || []
  const tiposEsperados = TIPOS_ACEITOS[s.tipoInterno] || [s.tipoInterno]
  const cand = candidatos.find(p => tiposEsperados.includes(p.tipo))
  if (!cand) continue
  if (cand.status === 'pago') continue
  wouldUpdateFull.push({
    pagamento_id: cand.id,
    data_pagamento: s.paymentDate,
    // auditoria — nao vai no UPDATE
    _billId: s.billId,
    _numeroParcela: s.numeroParcela,
    _tipo: cand.tipo,
  })
}
writeFileSync('docs/backfill-would-update.json', JSON.stringify({
  meta: { geradoEm: new Date().toISOString(), total: wouldUpdateFull.length },
  rows: wouldUpdateFull,
}, null, 2))
console.log(`Output: docs/backfill-would-update.json (${wouldUpdateFull.length} rows)`)

// Materializa set COMPLETO de ja_pago_drift_data pra Etapa 5A.
// Schema: pagamento_id + data_pagamento_sienge (correta)
const driftDataPagFull = []
for (const s of stage) {
  const venda = vendaByBillId.get(s.billId)
  if (!venda) continue
  const key = `${venda.id}|${s.numeroParcela}`
  const candidatos = pagByVendaParcela.get(key) || []
  const tiposEsperados = TIPOS_ACEITOS[s.tipoInterno] || [s.tipoInterno]
  const cand = candidatos.find(p => tiposEsperados.includes(p.tipo))
  if (!cand) continue
  if (cand.status !== 'pago') continue
  const dDias = diffDias(cand.data_pagamento, s.paymentDate)
  if (dDias == null || dDias <= 1) continue
  driftDataPagFull.push({
    pagamento_id: cand.id,
    data_pagamento_local: cand.data_pagamento,
    data_pagamento_sienge: s.paymentDate,
    dDias,
    _billId: s.billId,
    _numeroParcela: s.numeroParcela,
  })
}
writeFileSync('docs/backfill-drift-data-pagamento.json', JSON.stringify({
  meta: { geradoEm: new Date().toISOString(), total: driftDataPagFull.length },
  rows: driftDataPagFull,
}, null, 2))
console.log(`Output: docs/backfill-drift-data-pagamento.json (${driftDataPagFull.length} rows)`)
