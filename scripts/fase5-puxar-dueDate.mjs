// Etapa 5 — dispara 1 request bulk pra pegar universo completo de parcelas
// (pagas + pendentes + futuras) filtrado por dueDate, companyId=5.
// ver .claude/rules/sincronizacao-sienge.md
//
// DESIGN:
//  1. Salva o raw ANTES de qualquer parse via STREAM (response.body pipado pra
//     createWriteStream). Evita OOM mesmo que resposta seja 50MB+.
//  2. Se status != 200 aborta antes de baixar corpo (evita "gastar" token em 429).
//  3. Parse/summary acontece DEPOIS da escrita, em try/catch que nao mata o run.
//
// Pre-check: probe do dia 23 confirmou endpoint vivo, paginacao nao funciona
// (sempre retorna dataset completo), companyId=5 == unico empreendimento ativo.
// selectionType=D nao foi testado no probe — essa e a primeira chamada.

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

// Valida env antes de qualquer fetch
for (const k of ['SIENGE_USERNAME', 'SIENGE_PASSWORD', 'SIENGE_SUBDOMAIN']) {
  if (!env[k]) {
    console.error(`ERRO: ${k} ausente em .env`)
    process.exit(1)
  }
}

const AUTH = 'Basic ' + Buffer.from(`${env.SIENGE_USERNAME}:${env.SIENGE_PASSWORD}`).toString('base64')
const BULK_BASE = `https://api.sienge.com.br/${env.SIENGE_SUBDOMAIN}/public/api`
const TIMEOUT_MS = 300_000 // 5min — dataset D pode ser 50MB+

const query = {
  selectionType: 'D',
  startDate: '2015-01-01',
  endDate: '2045-12-31',
  companyId: 5,
}

const params = new URLSearchParams()
for (const [k, v] of Object.entries(query)) params.set(k, String(v))
const url = `${BULK_BASE}/bulk-data/v1/income?${params.toString()}`
console.log(`GET ${url}`)
console.log(`Timeout: ${TIMEOUT_MS / 1000}s`)
console.log('')

const t0 = Date.now()
const ctrl = new AbortController()
const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

const RAW_PATH = 'docs/fase5-universo-dueDate-RAW.json'
const META_PATH = 'docs/fase5-universo-dueDate-META.json'

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

  // Meta salvo ANTES de consumir body (persiste mesmo se stream falhar no meio)
  writeFileSync(META_PATH, JSON.stringify({
    geradoEm: new Date().toISOString(),
    query, url,
    status: res.status,
    elapsedHeadersMs,
    rateLimit,
    retryAfter,
    contentLength,
  }, null, 2))

  // 429 ou erro: baixa corpo pequeno (ate 4KB) pra log, aborta
  if (!res.ok) {
    const bodyText = await res.text()
    writeFileSync(RAW_PATH, bodyText)
    console.error(`\nHTTP nao-ok (${res.status}). Body salvo em ${RAW_PATH}.`)
    console.error(`Preview: ${bodyText.slice(0, 500)}`)
    process.exit(1)
  }

  // Status OK — pipeia body pra disco via stream
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

  // Atualiza meta com metricas finais
  writeFileSync(META_PATH, JSON.stringify({
    geradoEm: new Date().toISOString(),
    query, url,
    status: res.status,
    elapsedHeadersMs,
    elapsedBodyMs,
    totalElapsedMs,
    rateLimit,
    retryAfter,
    contentLength,
    bytes,
  }, null, 2))

  // Summary best-effort — NAO falha o script se parse quebrar (raw ja esta no disco)
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
      const keys = Object.keys(r).slice(0, 12).join(', ')
      console.log(`  first row keys:      ${keys}...`)
      console.log(`  has dueDate:         ${r.dueDate != null}`)
      console.log(`  has receipts:        ${Array.isArray(r.receipts)}`)
      const withReceipts = rows.filter(x => Array.isArray(x.receipts) && x.receipts.length > 0).length
      const withoutReceipts = rows.length - withReceipts
      console.log(`  com receipts (pago): ${withReceipts}`)
      console.log(`  sem receipts (pend): ${withoutReceipts}`)
    }
    console.log('')
    console.log('Proximo passo: scripts/fase5-analisar-dueDate.mjs (parse offline)')
  } catch (err) {
    console.error(`\n[parse summary falhou — RAW esta OK no disco] ${err.message}`)
  }
} catch (err) {
  console.error('ERRO:', err)
  process.exit(1)
} finally {
  clearTimeout(timer)
}
