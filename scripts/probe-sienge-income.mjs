// Fase 0 — validação do endpoint /bulk-data/v1/income sem gastar quota.
// ver .claude/rules/sincronizacao-sienge.md
//
// Executa até 5 requisições crus (SEM retry, SEM bucket) pra responder:
//   1. Endpoint retorna dados reais e paginação funciona?
//   2. `paymentDate` existe nas linhas (selectionType=P)?
//   3. Filtro `enterpriseId=2104` é aceito no bulk?
//   4. Contratos retornados batem com os 299 sales-contracts do banco?
//   5. Se 429: imediato (throttle curto) ou depois de N chamadas (quota)?
//
// Saída: docs/fase0-income-probe.json

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

function loadEnv() {
  const raw = readFileSync('.env', 'utf8')
  const env = {}
  for (const line of raw.split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue
    const idx = line.indexOf('=')
    const k = line.slice(0, idx).trim()
    const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    env[k] = v
  }
  return { ...process.env, ...env }
}
const env = loadEnv()
const AUTH = 'Basic ' + Buffer.from(`${env.SIENGE_USERNAME}:${env.SIENGE_PASSWORD}`).toString('base64')
const BULK_BASE = `https://api.sienge.com.br/${env.SIENGE_SUBDOMAIN}/public/api`
const TIMEOUT_MS = 45_000

async function rawGet({ label, query }) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const url = `${BULK_BASE}/bulk-data/v1/income?${params.toString()}`
  const t0 = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: AUTH, Accept: 'application/json' },
      signal: ctrl.signal,
    })
    const elapsedMs = Date.now() - t0
    const retryAfter = res.headers.get('Retry-After')
    const rateLimit = res.headers.get('X-Rate-Limit-Remaining') || res.headers.get('RateLimit-Remaining')
    const bodyText = await res.text()
    let body
    try { body = JSON.parse(bodyText) } catch { body = bodyText.slice(0, 500) }
    return { label, url, status: res.status, elapsedMs, retryAfter, rateLimit, body }
  } catch (err) {
    return { label, url, status: 'ERR', elapsedMs: Date.now() - t0, err: String(err) }
  } finally {
    clearTimeout(timer)
  }
}

function extractRows(data) {
  if (!data) return []
  if (Array.isArray(data)) return data
  for (const k of ['results', 'data', 'income', 'bills']) {
    if (Array.isArray(data[k])) return data[k]
  }
  if (data.data && Array.isArray(data.data.results)) return data.data.results
  return []
}

function summary(res) {
  if (res.status === 'ERR') return { label: res.label, status: 'ERR', elapsedMs: res.elapsedMs, err: res.err }
  const rows = extractRows(res.body)
  const first = rows[0] || null
  const withPaymentDate = rows.filter((r) =>
    r?.paymentDate ||
    (Array.isArray(r?.receipts) && r.receipts.some((x) => x?.paymentDate))
  ).length
  const contractIds = [...new Set(rows.map((r) => r?.contractId).filter((x) => x != null))].slice(0, 20)
  return {
    label: res.label,
    status: res.status,
    elapsedMs: res.elapsedMs,
    retryAfter: res.retryAfter,
    rateLimit: res.rateLimit,
    rows: rows.length,
    withPaymentDate,
    contractIds,
    firstRowKeys: first ? Object.keys(first) : [],
    firstRowReceiptKeys: first?.receipts?.[0] ? Object.keys(first.receipts[0]) : [],
    firstRowInstallmentKeys: first?.installments?.[0] ? Object.keys(first.installments[0]) : [],
    firstRowSample: first,
    errorBody: res.status >= 400 ? res.body : undefined,
  }
}

mkdirSync('docs', { recursive: true })
const OUT_PATH = 'docs/fase0-income-probe.json'

const BASE_QUERY = {
  startDate: env.PROBE_START_DATE || '2020-01-01',
  endDate: env.PROBE_END_DATE || new Date().toISOString().slice(0, 10),
  selectionType: 'P',
  companyId: 5,
}

console.log('================================================================')
console.log('FASE 0 — PROBE /bulk-data/v1/income (≤ 5 requests, sem retry)')
console.log('================================================================')
console.log('startDate:', BASE_QUERY.startDate, ' endDate:', BASE_QUERY.endDate)
console.log('selectionType=P  companyId=5')
console.log('----------------------------------------------------------------')

const results = []

// R1 — shape probe: limit=1 offset=0 (deve retornar 1 linha com paymentDate)
results.push(await rawGet({ label: 'R1_shape_limit1_offset0', query: { ...BASE_QUERY, limit: 1, offset: 0 } }))
console.log(`[R1] status=${results[0].status} elapsed=${results[0].elapsedMs}ms`)

// R2 — paginação: limit=1 offset=1 (deve retornar linha DIFERENTE do R1)
if (results[0].status === 200) {
  results.push(await rawGet({ label: 'R2_pagination_offset1', query: { ...BASE_QUERY, limit: 1, offset: 1 } }))
  console.log(`[R2] status=${results[1].status} elapsed=${results[1].elapsedMs}ms`)
}

// R3 — enterpriseId filter: adiciona enterpriseId=2104
if (results[0].status === 200) {
  results.push(await rawGet({
    label: 'R3_enterpriseId_filter',
    query: { ...BASE_QUERY, limit: 1, offset: 0, enterpriseId: 2104 },
  }))
  console.log(`[R3] status=${results[2].status} elapsed=${results[2].elapsedMs}ms`)
}

// R4 — amostra: limit=50 pra cruzar contractIds contra banco
if (results[0].status === 200) {
  results.push(await rawGet({ label: 'R4_sample_limit50', query: { ...BASE_QUERY, limit: 50, offset: 0 } }))
  console.log(`[R4] status=${results[3].status} elapsed=${results[3].elapsedMs}ms`)
}

// Diagnóstico de throttle: se TODOS passaram, não houve 429. Se algum falhou com 429, já sabemos o padrão.
// NÃO fazemos R5 extra pra preservar quota — já temos dados suficientes.

const summarized = results.map(summary)

const verdict = {
  endpoint_vivo: results[0]?.status === 200,
  paginacao_ok: summarized[0]?.rows > 0 && summarized[1]?.rows > 0 &&
                summarized[0].contractIds[0] !== undefined &&
                summarized[0].firstRowSample &&
                summarized[1]?.firstRowSample &&
                JSON.stringify(summarized[0].firstRowSample) !== JSON.stringify(summarized[1].firstRowSample),
  paymentDate_presente: summarized[0]?.withPaymentDate > 0,
  enterpriseId_aceito: summarized[2]?.status === 200 && summarized[2]?.rows > 0,
  throttle_detectado: results.some((r) => r.status === 429),
  primeiro_429_em: results.findIndex((r) => r.status === 429),
  requests_feitos: results.length,
}

const out = {
  runStartedAt: new Date().toISOString(),
  base_query: BASE_QUERY,
  verdict,
  summarized,
}

writeFileSync(OUT_PATH, JSON.stringify(out, null, 2))

console.log('----------------------------------------------------------------')
console.log('VEREDITO:')
for (const [k, v] of Object.entries(verdict)) console.log(`  ${k.padEnd(25)} ${v}`)
console.log('----------------------------------------------------------------')
console.log('contractIds amostrados (R4):', summarized[3]?.contractIds || 'N/A')
console.log('Output:', OUT_PATH)
