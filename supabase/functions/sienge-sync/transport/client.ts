import { loadSiengeConfig, type SiengeConfig } from "../lib/env.ts"
import { log } from "../lib/log.ts"

const MAX_RPM = 180
const WINDOW_MS = 60_000
const MAX_RETRIES = 2
const REQUEST_TIMEOUT_MS = 20_000

class TokenBucket {
  private timestamps: number[] = []

  async acquire(): Promise<void> {
    while (true) {
      const now = Date.now()
      this.timestamps = this.timestamps.filter((t) => now - t < WINDOW_MS)
      if (this.timestamps.length < MAX_RPM) {
        this.timestamps.push(now)
        return
      }
      const waitMs = WINDOW_MS - (now - this.timestamps[0]) + 50
      log("debug", "token_bucket_wait", { waitMs, size: this.timestamps.length })
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 5_000)))
    }
  }
}

const bucket = new TokenBucket()

let cachedConfig: SiengeConfig | null = null
function config(): SiengeConfig {
  if (!cachedConfig) cachedConfig = loadSiengeConfig()
  return cachedConfig
}

export interface SiengeGetOptions {
  path: string
  query?: Record<string, string | number | undefined>
}

export interface SiengeResponse<T> {
  status: number
  data: T
  url: string
}

async function doFetch(url: string, headers: Record<string, string>): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { method: "GET", headers, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function siengeGet<T = unknown>(opts: SiengeGetOptions): Promise<SiengeResponse<T>> {
  const cfg = config()
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v))
  }
  const qs = params.toString()
  // Sienge tem duas bases: REST v1 (/public/api/v1) e Bulk-Data v1 (/public/api/bulk-data/v1).
  // Se o path começa com /bulk-data/, troca a base; senão usa REST v1.
  const isBulk = opts.path.startsWith("/bulk-data/")
  const base = isBulk
    ? `https://api.sienge.com.br/${cfg.subdomain}/public/api`
    : cfg.baseUrl
  const url = `${base}${opts.path}${qs ? "?" + qs : ""}`

  const headers = {
    Authorization: cfg.authHeader,
    Accept: "application/json",
  }

  let attempt = 0
  let lastErr: unknown = null
  while (attempt < MAX_RETRIES) {
    attempt++
    await bucket.acquire()
    try {
      const res = await doFetch(url, headers)
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "5")
        const waitMs = Math.min(Math.max(retryAfter, 1), 60) * 1000
        const body = await res.text().catch(() => "")
        log("warn", "sienge_429", { attempt, waitMs, url, body: body.slice(0, 200) })
        // Preserva info pro erro final — continue pula o catch, lastErr ficaria null
        lastErr = new Error(`Sienge 429 on ${opts.path} (Retry-After=${retryAfter}s): ${body.slice(0, 200)}`)
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      if (res.status >= 500 && res.status < 600) {
        // Sienge 5xx em bulk geralmente é timeout do lado deles — retry não resolve.
        const body = await res.text().catch(() => "")
        log("warn", "sienge_5xx_no_retry", { attempt, status: res.status, url, body: body.slice(0, 300) })
        throw new Error(`Sienge ${res.status} on ${opts.path}: ${body.slice(0, 300)}`)
      }
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Sienge ${res.status} on ${opts.path}: ${body.slice(0, 500)}`)
      }
      const data = (await res.json()) as T
      return { status: res.status, data, url }
    } catch (err) {
      lastErr = err
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 10_000)
      log("warn", "sienge_fetch_error", { attempt, backoff, url, err: String(err) })
      if (attempt >= MAX_RETRIES) break
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
  throw new Error(`Sienge GET ${opts.path} failed after ${MAX_RETRIES} attempts: ${String(lastErr)}`)
}

export interface PaginatedResult<T> {
  resultSetMetadata?: { count?: number; offset?: number; limit?: number }
  results?: T[]
}

export async function* siengePaginate<T = unknown>(
  opts: SiengeGetOptions & { pageSize?: number },
): AsyncGenerator<T[], void, void> {
  const pageSize = opts.pageSize ?? 200
  let offset = 0
  while (true) {
    const res = await siengeGet<PaginatedResult<T> | T[]>({
      path: opts.path,
      query: { ...(opts.query ?? {}), limit: pageSize, offset },
    })
    const payload = res.data
    const items: T[] = Array.isArray(payload) ? payload : (payload.results ?? [])
    if (items.length === 0) return
    yield items
    if (items.length < pageSize) return
    offset += items.length
  }
}
