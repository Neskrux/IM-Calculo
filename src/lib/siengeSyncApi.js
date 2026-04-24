import { supabase } from './supabase'

const FUNCTION_NAME = 'sienge-sync'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1/${FUNCTION_NAME}`

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error(`auth.getSession: ${error.message}`)
  const token = data?.session?.access_token
  if (!token) throw new Error('no active session')
  return token
}

async function invoke(method, path, body) {
  const token = await getAccessToken()
  const res = await fetch(`${FUNCTIONS_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  })
  const text = await res.text()
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = { raw: text } }
  if (!res.ok) {
    const msg = parsed?.error || parsed?.raw || `HTTP ${res.status}`
    throw new Error(`[${res.status}] ${msg}`)
  }
  return parsed
}

export async function triggerIncrementalSync(entities) {
  return invoke('POST', '/sync/incremental', entities ? { entities } : undefined)
}

export async function triggerFullSync(entities) {
  return invoke('POST', '/sync/full', entities ? { entities } : undefined)
}

export async function triggerNormalizeOnly(entities, opts = {}) {
  const body = { ...(entities ? { entities } : {}) }
  if (opts.offset != null) body.offset = opts.offset
  if (opts.limit != null) body.limit = opts.limit
  if (opts.apiBudget != null) body.apiBudget = opts.apiBudget
  return invoke('POST', '/sync/normalize-only', Object.keys(body).length ? body : undefined)
}

export async function getRun(runId) {
  return invoke('GET', `/runs/${runId}`)
}

export async function listRecentRuns() {
  return invoke('GET', '/runs')
}

export async function getStats() {
  return invoke('GET', '/stats')
}

export async function probeSienge(path, query) {
  return invoke('POST', '/probe', { path, query })
}

export async function pollRunUntilDone(runId, { intervalMs = 3000, timeoutMs = 10 * 60 * 1000 } = {}) {
  const start = Date.now()
  while (true) {
    const { run } = await getRun(runId)
    if (!run) throw new Error(`run ${runId} not found`)
    if (run.status !== 'RUNNING') return run
    if (Date.now() - start > timeoutMs) throw new Error(`poll timeout for run ${runId}`)
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}
