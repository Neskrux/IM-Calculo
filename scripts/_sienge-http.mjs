// Helper HTTP compartilhado pelos scripts de discovery/backfill Sienge.
// ver .claude/rules/sincronizacao-sienge.md
//
// Recursos:
//  - rate limit: 180 RPM (bucket de timestamps).
//  - retry com backoff em 429/5xx.
//  - contador global de chamadas REST v1 vs bulk-data, com resumo
//    impresso ao final do processo.
//  - cache em disco (.sienge-cache/) com TTL 1h por default.
//    GET-only, key = hash(URL+query). Desliga via env SIENGE_CACHE_OFF=1
//    ou parametro siengeGet({..., noCache: true}).
//  - aviso quando consumo REST v1 passar de 70% da quota diaria (~100).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

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

const SIENGE_USERNAME = env.SIENGE_USERNAME
const SIENGE_PASSWORD = env.SIENGE_PASSWORD
const SIENGE_SUBDOMAIN = env.SIENGE_SUBDOMAIN
if (!SIENGE_USERNAME || !SIENGE_PASSWORD || !SIENGE_SUBDOMAIN) {
  console.error('ERRO: faltando SIENGE_USERNAME / SIENGE_PASSWORD / SIENGE_SUBDOMAIN no .env')
  process.exit(1)
}

const AUTH = 'Basic ' + Buffer.from(`${SIENGE_USERNAME}:${SIENGE_PASSWORD}`).toString('base64')
const BULK_BASE = `https://api.sienge.com.br/${SIENGE_SUBDOMAIN}/public/api`
const REST_BASE = `https://api.sienge.com.br/${SIENGE_SUBDOMAIN}/public/api/v1`

const MAX_RPM = 180
const WINDOW_MS = 60_000
const REQUEST_TIMEOUT_MS = 60_000
const MAX_RETRIES = 3

// Quota diaria REST v1 (referencia .claude/rules/sincronizacao-sienge.md).
// Bulk-data nao tem quota. Sienge nao expoe contador via API, entao
// trackeamos localmente — eh estimativa, nao verdade absoluta.
const REST_V1_DAILY_QUOTA = 100
const QUOTA_WARN_THRESHOLD = 0.7 // 70%

// Cache em disco
const CACHE_DIR = resolve(process.cwd(), '.sienge-cache')
const CACHE_TTL_MS = Number(env.SIENGE_CACHE_TTL_MS || 60 * 60 * 1000) // 1h default
const CACHE_DISABLED = env.SIENGE_CACHE_OFF === '1'

if (!CACHE_DISABLED) {
  try { if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true }) } catch { /* ignora */ }
}

function cacheKey(url) {
  return createHash('sha256').update(url).digest('hex').slice(0, 24)
}

function cacheGet(url) {
  if (CACHE_DISABLED) return null
  const f = resolve(CACHE_DIR, `${cacheKey(url)}.json`)
  try {
    if (!existsSync(f)) return null
    const age = Date.now() - statSync(f).mtimeMs
    if (age > CACHE_TTL_MS) return null
    return JSON.parse(readFileSync(f, 'utf8'))
  } catch { return null }
}

function cachePut(url, payload) {
  if (CACHE_DISABLED) return
  const f = resolve(CACHE_DIR, `${cacheKey(url)}.json`)
  try { writeFileSync(f, JSON.stringify(payload)) } catch { /* ignora */ }
}

// Contador global
const stats = {
  restV1: { calls: 0, cacheHits: 0 },
  bulk: { calls: 0, cacheHits: 0 },
  errors: 0,
  startedAt: Date.now(),
}

function imprimirResumo() {
  if (stats.restV1.calls === 0 && stats.bulk.calls === 0 && stats.restV1.cacheHits === 0 && stats.bulk.cacheHits === 0) return
  const dur = ((Date.now() - stats.startedAt) / 1000).toFixed(1)
  const restPct = ((stats.restV1.calls / REST_V1_DAILY_QUOTA) * 100).toFixed(0)
  console.log('')
  console.log('--- consumo Sienge ---')
  console.log(`  REST v1: ${stats.restV1.calls} chamadas (~${restPct}% da quota diaria de ${REST_V1_DAILY_QUOTA}) + ${stats.restV1.cacheHits} cache hits`)
  console.log(`  bulk-data: ${stats.bulk.calls} chamadas (sem quota) + ${stats.bulk.cacheHits} cache hits`)
  if (stats.errors > 0) console.log(`  erros: ${stats.errors}`)
  console.log(`  duracao: ${dur}s`)
  if (stats.restV1.calls / REST_V1_DAILY_QUOTA >= QUOTA_WARN_THRESHOLD) {
    console.log(`  ⚠️ consumo REST v1 acima de ${(QUOTA_WARN_THRESHOLD * 100)}% da quota diaria. Considere usar cache (.sienge-cache/) ou esperar.`)
  }
}

process.on('beforeExit', imprimirResumo)

const bucket = { timestamps: [] }
async function acquire() {
  while (true) {
    const now = Date.now()
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < WINDOW_MS)
    if (bucket.timestamps.length < MAX_RPM) {
      bucket.timestamps.push(now)
      return
    }
    const wait = WINDOW_MS - (now - bucket.timestamps[0]) + 50
    await new Promise((r) => setTimeout(r, Math.min(wait, 5_000)))
  }
}

export async function siengeGet({ path, query = {}, noCache = false }) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const isBulk = path.startsWith('/bulk-data/')
  const base = isBulk ? BULK_BASE : REST_BASE
  const url = `${base}${path}${params.toString() ? '?' + params.toString() : ''}`
  const cat = isBulk ? stats.bulk : stats.restV1

  // Cache hit: nao consome quota, nao gasta latencia.
  if (!noCache) {
    const cached = cacheGet(url)
    if (cached) {
      cat.cacheHits++
      return { status: cached.status, data: cached.data, url, cached: true }
    }
  }

  // Aviso preventivo de quota REST v1.
  if (!isBulk && stats.restV1.calls === Math.floor(REST_V1_DAILY_QUOTA * QUOTA_WARN_THRESHOLD)) {
    console.warn(`[quota] REST v1 atingiu ${(QUOTA_WARN_THRESHOLD * 100)}% da quota diaria (${stats.restV1.calls}/${REST_V1_DAILY_QUOTA}). Considere parar ou usar cache.`)
  }

  let attempt = 0
  let lastErr = null
  while (attempt < MAX_RETRIES) {
    attempt++
    await acquire()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: AUTH, Accept: 'application/json' },
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After') ?? '30')
        const waitMs = Math.min(Math.max(retryAfter, 1), 120) * 1000
        const body = await res.text().catch(() => '')
        console.warn(`[429] ${path} retry-after=${retryAfter}s body=${body.slice(0, 150)}`)
        lastErr = new Error(`Sienge 429 after ${retryAfter}s: ${body.slice(0, 200)}`)
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      if (res.status >= 500) {
        const body = await res.text().catch(() => '')
        lastErr = new Error(`Sienge ${res.status}: ${body.slice(0, 300)}`)
        console.warn(`[${res.status}] ${path} attempt=${attempt} body=${body.slice(0, 150)}`)
        const backoff = Math.min(2000 * attempt, 10_000)
        await new Promise((r) => setTimeout(r, backoff))
        continue
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Sienge ${res.status} on ${path}: ${body.slice(0, 500)}`)
      }
      const data = await res.json()
      cat.calls++
      const payload = { status: res.status, data, url }
      if (!noCache) cachePut(url, payload)
      return payload
    } catch (err) {
      clearTimeout(timer)
      lastErr = err
      console.warn(`[err] ${path} attempt=${attempt} err=${String(err).slice(0, 200)}`)
      const backoff = Math.min(2000 * attempt, 10_000)
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
  stats.errors++
  throw new Error(`Sienge GET ${path} falhou após ${MAX_RETRIES} tentativas: ${String(lastErr)}`)
}

// Util pra scripts de auditoria: limpa cache (use quando dado pode ter mudado
// no Sienge mas voce ja consultou no mesmo dia).
export function limparCacheSienge() {
  if (!existsSync(CACHE_DIR)) return 0
  let n = 0
  for (const f of readdirSync(CACHE_DIR)) {
    if (f.endsWith('.json')) {
      try { writeFileSync(resolve(CACHE_DIR, f), '') } catch { /* ignora */ }
      n++
    }
  }
  return n
}

export function extractRows(data) {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []
  if (Array.isArray(data.results)) return data.results
  if (Array.isArray(data.data)) return data.data
  if (Array.isArray(data.income)) return data.income
  if (Array.isArray(data.bills)) return data.bills
  if (Array.isArray(data.outcome)) return data.outcome
  if (Array.isArray(data.expenses)) return data.expenses
  if (data.data && typeof data.data === 'object' && Array.isArray(data.data.results)) return data.data.results
  return []
}

export function collectKeys(obj, into = new Set(), prefix = '') {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return into
  for (const k of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k
    into.add(fullKey)
    const v = obj[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      collectKeys(v, into, fullKey)
    }
  }
  return into
}

export { env }
