// Fase 0 — Verificação semântica de endDate em selectionType=P.
// ver .claude/rules/sincronizacao-sienge.md
//
// UMA ÚNICA request bulk. Sem retry.
// Objetivo: detectar pagamentos antecipados (paymentDate passada, dueDate futura)
// que podem ter sido perdidos no R2 original (endDate=hoje).
//
// R: /bulk-data/v1/income selectionType=P  startDate=2020-01-01 endDate=2050-12-31 companyId=5
//    → se rows > 3719: endDate filtra por dueDate (bug silencioso confirmado)
//    → se rows = 3719: endDate filtra por paymentDate (R2 já tinha tudo)
//
// Saída: docs/fase0-universo-pagos-futuro.json

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
  for (const k of ['results', 'data', 'income', 'bills']) {
    if (Array.isArray(data[k])) return data[k]
  }
  if (data.data && Array.isArray(data.data.results)) return data.data.results
  return []
}

mkdirSync('docs', { recursive: true })

console.log('================================================================')
console.log('FASE 0 — Verificação semântica de endDate em selectionType=P')
console.log('================================================================')
console.log('R2 original teve 3719 rows com endDate=2026-04-23')
console.log('Esta request usa endDate=2050-12-31 pra forçar varredura futura')
console.log('Gasto: 1 token bulk')
console.log('----------------------------------------------------------------')

const QUERY = {
  startDate: '2020-01-01',
  endDate: '2050-12-31',
  selectionType: 'P',
  companyId: 5,
}
const params = new URLSearchParams()
for (const [k, v] of Object.entries(QUERY)) params.set(k, String(v))
const url = `${BULK_BASE}/bulk-data/v1/income?${params.toString()}`

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

if (res.status !== 200) {
  writeFileSync('docs/fase0-universo-pagos-futuro.json', JSON.stringify({ status: res.status, body }, null, 2))
  console.error('Falha:', JSON.stringify(body).slice(0, 500))
  process.exit(1)
}

const rows = extractRows(body)

writeFileSync('docs/fase0-universo-pagos-futuro.json', JSON.stringify({
  meta: { ...QUERY, elapsedMs, rateLimit, bytes: bodyText.length, rows: rows.length },
  rows,
}, null, 2))

// Detectar pagamentos antecipados: paymentDate <= hoje mas dueDate > hoje
const HOJE = '2026-04-23'
let antecipadosCount = 0
const antecipadosSample = []
for (const row of rows) {
  const receipts = Array.isArray(row.receipts) ? row.receipts : []
  const maxPaymentDate = receipts
    .map((rc) => rc.paymentDate)
    .filter(Boolean)
    .sort()
    .pop()
  if (!maxPaymentDate) continue
  if (maxPaymentDate <= HOJE && row.dueDate && row.dueDate > HOJE) {
    antecipadosCount++
    if (antecipadosSample.length < 5) {
      antecipadosSample.push({
        billId: row.billId,
        installmentId: row.installmentId,
        installmentNumber: row.installmentNumber,
        clientName: row.clientName,
        dueDate: row.dueDate,
        paymentDate: maxPaymentDate,
        originalAmount: row.originalAmount,
        paymentTerm: row.paymentTerm,
      })
    }
  }
}

console.log('\n----------------------------------------------------------------')
console.log(`Rows retornadas:            ${rows.length}`)
console.log(`R2 original retornou:       3719`)
console.log(`DIFERENÇA:                  ${rows.length - 3719}`)
console.log('')
console.log(`Pagamentos ANTECIPADOS detectados (paymentDate<=${HOJE} & dueDate>${HOJE}): ${antecipadosCount}`)
console.log('')
if (rows.length === 3719) {
  console.log('>> VEREDITO: endDate filtra por paymentDate. R2 original já estava completo. <<')
} else if (rows.length > 3719) {
  console.log(`>> VEREDITO: endDate filtra por dueDate. R2 perdeu ${rows.length - 3719} pagamentos antecipados. <<`)
} else {
  console.log(`>> VEREDITO: INESPERADO — ${rows.length} rows menor que 3719. Investigar. <<`)
}
console.log('')
if (antecipadosSample.length > 0) {
  console.log('Amostra de antecipados:')
  console.log(JSON.stringify(antecipadosSample, null, 2))
}
console.log('----------------------------------------------------------------')
console.log(`Tokens restantes: ${rateLimit}`)
console.log(`Output: docs/fase0-universo-pagos-futuro.json`)
