// Dispara a edge function sienge-sync pra trazer vendas novas do Sienge
// (sales-contracts + receivable-bills) e atualizar dados existentes.
//
// Equivalente ao botao "Sincronizar Sienge" do admin dashboard, mas roda
// sem UI — pra cron diario fechar o ciclo de automacao.
//
// Authentica via SUPABASE_SERVICE_ROLE_KEY (a edge function aceita via
// bypass em lib/auth.ts).
//
// Usa /sync/incremental por default (modifiedAfter, so delta) — consumo
// Sienge MUITO menor que /sync/full. Em dias sem mudanca, puxa zero.
// Pra forcar puxar tudo: FULL=1 node scripts/sincronizar-vendas-sienge.mjs
//
// Uso:
//   node scripts/sincronizar-vendas-sienge.mjs           # incremental
//   FULL=1 node scripts/sincronizar-vendas-sienge.mjs    # full sync

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

// Modo por entidade — sales-contracts nao aceita o formato de modifiedAfter
// que a edge envia (Sienge devolve 400 "Failed to convert property value").
// receivable-bills aceita incremental normalmente.
// FULL=1 forca tudo pra full.
const forcaFull = process.env.FULL === '1'
const modoPorEntidade = {
  'sales-contracts': '/sync/full',          // sempre full (Sienge nao aceita modifiedAfter aqui)
  'receivable-bills': forcaFull ? '/sync/full' : '/sync/incremental',
}

for (const entity of ['sales-contracts', 'receivable-bills']) {
  const modo = modoPorEntidade[entity]
  console.log(`\n=== ${entity} (${modo}) ===`)
  try {
    const kick = await post(modo, { entities: [entity] })
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
