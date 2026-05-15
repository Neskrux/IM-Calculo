// Dispara a edge function sienge-sync pra trazer vendas novas do Sienge
// (sales-contracts + receivable-bills) e atualizar dados existentes.
//
// Equivalente ao botao "Sincronizar Sienge" do admin dashboard, mas roda
// sem UI — pra cron diario fechar o ciclo de automacao.
//
// Authentica via SUPABASE_SERVICE_ROLE_KEY (a edge function aceita).
// Sem service_role, falha (anon nao tem permissao pra disparar).
//
// Uso:
//   node scripts/sincronizar-vendas-sienge.mjs

import { readFileSync, existsSync, writeFileSync } from 'node:fs'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const ANON = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || fromFile('SUPABASE_SERVICE_ROLE_KEY')

if (!SERVICE) {
  console.error('SUPABASE_SERVICE_ROLE_KEY ausente — necessario pra disparar a edge function')
  process.exit(1)
}

const FUNC = `${URL}/functions/v1/sienge-sync`
const H = {
  Authorization: `Bearer ${SERVICE}`,
  apikey: ANON,
  'Content-Type': 'application/json',
}

async function post(path, body) {
  const res = await fetch(`${FUNC}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body || {}) })
  const txt = await res.text()
  let data
  try { data = txt ? JSON.parse(txt) : null } catch { data = { raw: txt } }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 300)}`)
  return data
}

async function get(path) {
  const res = await fetch(`${FUNC}${path}`, { headers: H })
  const txt = await res.text()
  let data
  try { data = txt ? JSON.parse(txt) : null } catch { data = { raw: txt } }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 300)}`)
  return data
}

async function aguardarRun(runId, timeoutMs = 10 * 60 * 1000) {
  const start = Date.now()
  while (true) {
    const r = await get(`/runs/${runId}`)
    const run = r.run
    if (!run) throw new Error(`run ${runId} nao encontrado`)
    if (run.status !== 'RUNNING') return run
    if (Date.now() - start > timeoutMs) throw new Error(`timeout aguardando run ${runId}`)
    await new Promise((r) => setTimeout(r, 4000))
  }
}

const report = { meta: { geradoEm: new Date().toISOString() }, runs: [], errors: [] }

// dispara as 2 entidades (sales-contracts e receivable-bills) em sequencia
// — a edge function dispara em background e retorna runId.
for (const entity of ['sales-contracts', 'receivable-bills']) {
  console.log(`\n=== ${entity} ===`)
  try {
    const kick = await post('/sync/full', { entities: [entity] })
    console.log(`  runId: ${kick.runId}`)
    const run = await aguardarRun(kick.runId)
    console.log(`  status: ${run.status} | metrics:`, JSON.stringify(run.metrics).slice(0, 400))
    report.runs.push({ entity, runId: kick.runId, status: run.status, metrics: run.metrics })
    if (run.status !== 'OK') report.errors.push({ entity, runId: kick.runId, status: run.status })
  } catch (e) {
    console.error(`  ERRO: ${String(e).slice(0, 300)}`)
    report.errors.push({ entity, msg: String(e).slice(0, 300) })
  }
}

const data = new Date().toISOString().slice(0, 10)
const out = `docs/sincronizacao-vendas-sienge-${data}.json`
writeFileSync(out, JSON.stringify(report, null, 2))
console.log(`\nReport: ${out}`)
if (report.errors.length > 0) {
  console.error(`${report.errors.length} erros — vide report`)
  process.exit(1)
}
