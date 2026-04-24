// Helper HTTP compartilhado pelos scripts de discovery/backfill Sienge.
// ver .claude/rules/sincronizacao-sienge.md
import { readFileSync } from 'node:fs'

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

export async function siengeGet({ path, query = {} }) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const isBulk = path.startsWith('/bulk-data/')
  const base = isBulk ? BULK_BASE : REST_BASE
  const url = `${base}${path}${params.toString() ? '?' + params.toString() : ''}`

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
      return { status: res.status, data, url }
    } catch (err) {
      clearTimeout(timer)
      lastErr = err
      console.warn(`[err] ${path} attempt=${attempt} err=${String(err).slice(0, 200)}`)
      const backoff = Math.min(2000 * attempt, 10_000)
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
  throw new Error(`Sienge GET ${path} falhou após ${MAX_RETRIES} tentativas: ${String(lastErr)}`)
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
