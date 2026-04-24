// Fase 0 — Probe /bulk-data/v1/outcome (contas a pagar IM → fornecedor/corretor).
// ver .claude/rules/sincronizacao-sienge.md
//
// UMA ÚNICA request bulk. Objetivo: confirmar o universo do relatório 2 da usuária Sienge.
//
// R: /bulk-data/v1/outcome selectionType=P startDate=2020-01-01 endDate=2050-12-31 companyId=5
//    → todas as parcelas já pagas pela IM Figueira (egresso de caixa)
//
// Saída: docs/fase0-universo-contas-a-pagar.json

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
const TIMEOUT_MS = 120_000

function extractRows(data) {
  if (!data) return []
  if (Array.isArray(data)) return data
  for (const k of ['results', 'data', 'outcome', 'expenses', 'bills']) {
    if (Array.isArray(data[k])) return data[k]
  }
  if (data.data && Array.isArray(data.data.results)) return data.data.results
  return []
}

mkdirSync('docs', { recursive: true })

console.log('================================================================')
console.log('FASE 0 — Probe /bulk-data/v1/outcome (contas a pagar)')
console.log('================================================================')

const QUERY = {
  startDate: '2020-01-01',
  endDate: '2050-12-31',
  selectionType: 'P',
  companyId: 5,
  correctionIndexerId: 0,
  correctionDate: '2050-12-31',
}
const params = new URLSearchParams()
for (const [k, v] of Object.entries(QUERY)) params.set(k, String(v))
const url = `${BULK_BASE}/bulk-data/v1/outcome?${params.toString()}`

console.log(`GET ${url}`)

const t0 = Date.now()
const ctrl = new AbortController()
const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

let res
try {
  res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: AUTH, Accept: 'application/json' },
    signal: ctrl.signal,
  })
} finally {
  clearTimeout(timer)
}

const elapsedMs = Date.now() - t0
const rateLimit = res.headers.get('X-Rate-Limit-Remaining') || res.headers.get('RateLimit-Remaining')
const bodyText = await res.text()
let body
try { body = JSON.parse(bodyText) } catch { body = bodyText.slice(0, 2000) }

console.log(`status=${res.status}  elapsed=${elapsedMs}ms  bytes=${(bodyText.length/1024).toFixed(0)}KB  X-Rate-Limit-Remaining=${rateLimit}`)

writeFileSync('docs/fase0-universo-contas-a-pagar.json', JSON.stringify({
  meta: { ...QUERY, status: res.status, elapsedMs, rateLimit, bytes: bodyText.length },
  body,
}, null, 2))

if (res.status !== 200) {
  console.error('Falha. Resposta:')
  console.error(JSON.stringify(body).slice(0, 800))
  console.log(`Output: docs/fase0-universo-contas-a-pagar.json`)
  process.exit(1)
}

const rows = extractRows(body)

// Distribuição por tipos de fornecedor/credor
const creditorCount = {}
const origenCount = {}
let totalPago = 0
let totalOriginal = 0
let comPayments = 0
const sampleFirst = rows[0] || null

for (const row of rows) {
  totalOriginal += Number(row.originalAmount || 0)
  const creditorName = row.creditorName || row.supplierName || 'UNKNOWN'
  const origin = row.originId || 'UNKNOWN'
  creditorCount[creditorName] = (creditorCount[creditorName] || 0) + 1
  origenCount[origin] = (origenCount[origin] || 0) + 1
  const payments = Array.isArray(row.payments) ? row.payments : []
  if (payments.length > 0) comPayments++
  for (const p of payments) totalPago += Number(p.netAmount || 0)
}

console.log('\n----------------------------------------------------------------')
console.log('RESULTADO — contas a pagar já pagas (Figueira histórico completo)')
console.log('----------------------------------------------------------------')
console.log(`Parcelas retornadas:                ${rows.length}`)
console.log(`Com payments[]:                      ${comPayments}`)
console.log(`Total originalAmount:               R$ ${totalOriginal.toFixed(2)}`)
console.log(`Total pago (sum netAmount):         R$ ${totalPago.toFixed(2)}`)
console.log('')
console.log('Top 10 credores por quantidade de parcelas:')
const topCred = Object.entries(creditorCount).sort((a, b) => b[1] - a[1]).slice(0, 10)
for (const [name, n] of topCred) console.log(`  ${String(n).padStart(5)}  ${name}`)
console.log('')
console.log('Distribuição por origin:')
for (const [k, v] of Object.entries(origenCount).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(10)} ${String(v).padStart(6)}`)
}
console.log('')
if (sampleFirst) {
  console.log('Chaves da primeira linha:')
  console.log(Object.keys(sampleFirst).join(', '))
  if (Array.isArray(sampleFirst.payments) && sampleFirst.payments[0]) {
    console.log('Chaves de payments[0]:')
    console.log(Object.keys(sampleFirst.payments[0]).join(', '))
  }
}
console.log('----------------------------------------------------------------')
console.log(`Tokens restantes: ${rateLimit}`)
console.log(`Output: docs/fase0-universo-contas-a-pagar.json`)
