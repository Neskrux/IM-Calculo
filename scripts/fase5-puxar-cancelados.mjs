// Etapa 5B-cancelados — dispara 1 request bulk pra pegar contratos CANCELADOS
// da Figueira (companyId=5) e detectar parcelas locais "orfas" (presentes local,
// ausentes no bulk income/D) que na verdade foram canceladas no Sienge.
// ver .claude/rules/sincronizacao-sienge.md
//
// DESIGN: raw-first, stream pra disco, meta separado.
// Pre-check: /bulk-data/v1/sales confirmado no YAML oficial com situation=CANCELED,
// cancellationDate, refundBillId. Paginacao nao existe (bulk retorna tudo).

import { readFileSync, writeFileSync, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

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

for (const k of ['SIENGE_USERNAME', 'SIENGE_PASSWORD', 'SIENGE_SUBDOMAIN']) {
  if (!env[k]) { console.error(`ERRO: ${k} ausente em .env`); process.exit(1) }
}

const AUTH = 'Basic ' + Buffer.from(`${env.SIENGE_USERNAME}:${env.SIENGE_PASSWORD}`).toString('base64')
const BULK_BASE = `https://api.sienge.com.br/${env.SIENGE_SUBDOMAIN}/public/api`
const TIMEOUT_MS = 300_000

// Filtro: contratos cancelados da Figueira, janela ampla.
// NOTA: diferente de /income, bulk /sales EXIGE enterpriseId (400 sem ele).
// Confirmado empiricamente 2026-04-24: "Required Integer parameter 'enterpriseId' is not present"
const query = {
  enterpriseId: 2104, // FIGUEIRA GARCIA
  situation: 'CANCELED',
  createdAfter: '2015-01-01',
  createdBefore: '2026-04-24',
  companyId: 5,
}

const params = new URLSearchParams()
for (const [k, v] of Object.entries(query)) params.set(k, String(v))
const url = `${BULK_BASE}/bulk-data/v1/sales?${params.toString()}`
console.log(`GET ${url}`)
console.log(`Timeout: ${TIMEOUT_MS / 1000}s\n`)

const t0 = Date.now()
const ctrl = new AbortController()
const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

const RAW_PATH = 'docs/fase5-sales-cancelados-RAW.json'
const META_PATH = 'docs/fase5-sales-cancelados-META.json'

try {
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: AUTH, Accept: 'application/json' },
    signal: ctrl.signal,
  })
  const elapsedHeadersMs = Date.now() - t0
  const rateLimit = res.headers.get('X-Rate-Limit-Remaining') || res.headers.get('RateLimit-Remaining')
  const retryAfter = res.headers.get('Retry-After')
  const contentLength = res.headers.get('Content-Length')

  console.log(`[HEADERS] status=${res.status}  elapsed=${elapsedHeadersMs}ms  rateLimit=${rateLimit}  contentLength=${contentLength}  retryAfter=${retryAfter}`)

  writeFileSync(META_PATH, JSON.stringify({
    geradoEm: new Date().toISOString(),
    query, url,
    status: res.status, elapsedHeadersMs, rateLimit, retryAfter, contentLength,
  }, null, 2))

  if (!res.ok) {
    const bodyText = await res.text()
    writeFileSync(RAW_PATH, bodyText)
    console.error(`\nHTTP nao-ok (${res.status}). Body salvo em ${RAW_PATH}.`)
    console.error(`Preview: ${bodyText.slice(0, 500)}`)
    process.exit(1)
  }

  console.log('\n[STREAMING] escrevendo corpo direto pra disco...')
  const t1 = Date.now()
  const out = createWriteStream(RAW_PATH)
  await pipeline(Readable.fromWeb(res.body), out)
  const elapsedBodyMs = Date.now() - t1
  const totalElapsedMs = Date.now() - t0

  const stats = readFileSync(RAW_PATH)
  const bytes = stats.length

  console.log(`[RAW SALVO] ${RAW_PATH} (${bytes} bytes)`)
  console.log(`[TIMING] headers=${elapsedHeadersMs}ms  body=${elapsedBodyMs}ms  total=${totalElapsedMs}ms`)

  writeFileSync(META_PATH, JSON.stringify({
    geradoEm: new Date().toISOString(),
    query, url,
    status: res.status, elapsedHeadersMs, elapsedBodyMs, totalElapsedMs,
    rateLimit, retryAfter, contentLength, bytes,
  }, null, 2))

  try {
    const body = stats.toString('utf8')
    const parsed = JSON.parse(body)
    const rows = Array.isArray(parsed) ? parsed : (parsed.results || parsed.data || parsed.items || [])
    console.log('')
    console.log('================================================================')
    console.log('SHAPE SUMMARY')
    console.log('================================================================')
    console.log(`  top-level type:      ${Array.isArray(parsed) ? 'array' : typeof parsed}`)
    console.log(`  rows encontradas:    ${rows.length}`)
    if (rows.length > 0) {
      const r = rows[0]
      const keys = Object.keys(r).slice(0, 15).join(', ')
      console.log(`  first row keys:      ${keys}...`)
      console.log(`  has cancellationDate:${r.cancellationDate != null}`)
      console.log(`  has refundBillId:    ${r.refundBillId != null}`)
      console.log(`  has situation:       ${r.situation != null} (${r.situation})`)
      const withCancelDate = rows.filter(x => x.cancellationDate).length
      console.log(`  com cancellationDate:${withCancelDate}`)
    }
    console.log('')
    console.log('Proximo passo: analise offline cross-match com vendas local')
  } catch (err) {
    console.error(`\n[parse summary falhou — RAW esta OK no disco] ${err.message}`)
  }
} catch (err) {
  console.error('ERRO:', err)
  process.exit(1)
} finally {
  clearTimeout(timer)
}
