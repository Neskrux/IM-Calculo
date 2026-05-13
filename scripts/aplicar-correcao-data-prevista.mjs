// Aplica plano de correcao de data_prevista gerado por
// scripts/gerar-plano-correcao-data-prevista.mjs (docs/plano-correcao-data-prevista-{date}.json).
//
// ver .claude/rules/sincronizacao-sienge.md
//
// Spec autoriza UPDATE de data_prevista mesmo em status='pago' (migration 020,
// 2026-04-23 — Sienge eh fonte da verdade temporal). NUNCA altera valor, tipo,
// comissao_gerada ou data_pagamento.
//
// Idempotente: usa filtro id+data_prevista_atual no PATCH — se ja foi
// atualizado, o WHERE nao casa e nada acontece. Rerun reporta updated=0.
//
// Uso:
//   node scripts/aplicar-correcao-data-prevista.mjs --dry-run   (default, nao executa)
//   node scripts/aplicar-correcao-data-prevista.mjs --apply     (executa de verdade)

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'

const DRY = !process.argv.includes('--apply')
const MODO = DRY ? 'dry-run' : 'apply'
console.log(`Modo: ${MODO}\n`)

// Env: tenta .env primeiro (dev local), cai pra process.env (CI runner).
const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (key) => envFile.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim()
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL') || 'https://jdkkusrxullttyeakwib.supabase.co'
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
  fromFile('SUPABASE_SERVICE_ROLE_KEY') ||
  fromFile('VITE_SUPABASE_SERVICE_ROLE_KEY')
const ANON = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const KEY = SERVICE || ANON
if (!KEY) {
  console.error('faltando VITE_SUPABASE_ANON_KEY ou SUPABASE_SERVICE_ROLE_KEY (.env ou env vars)')
  process.exit(1)
}
if (!SERVICE) console.warn('[INFO] SUPABASE_SERVICE_ROLE_KEY nao encontrada; usando ANON (RLS pode bloquear).\n')

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }

// Achar o plano mais recente
const planoFile = readdirSync('docs')
  .filter((f) => f.startsWith('plano-correcao-data-prevista-') && f.endsWith('.json'))
  .sort()
  .pop()
if (!planoFile) {
  console.error('Nenhum plano encontrado em docs/plano-correcao-data-prevista-*.json. Rode antes scripts/gerar-plano-correcao-data-prevista.mjs.')
  process.exit(1)
}
console.log(`Usando plano: docs/${planoFile}`)
const plano = JSON.parse(readFileSync(`docs/${planoFile}`, 'utf8'))
const rows = plano.plano || []
console.log(`Linhas no plano: ${rows.length}\n`)

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    spec_ref: '.claude/rules/sincronizacao-sienge.md',
    script: 'scripts/aplicar-correcao-data-prevista.mjs',
    modo: MODO,
    plano_origem: `docs/${planoFile}`,
  },
  counts: {
    matched: rows.length,
    updated: 0,
    inserted: 0,
    skipped_idempotent: 0,
    drift_detected: rows.length,
    drift_corrected: 0,
    noMatch: 0,
    skipped_humano: 0,
    errors: 0,
  },
  drift: [],
  humano_pendente: [],
  errors: [],
}

if (DRY) {
  console.log('Sample do que seria atualizado (top 10):')
  for (const r of rows.slice(0, 10)) {
    console.log(
      `  pag=${r.pagamento_id.slice(0, 8)}... contract=${r.contract} unid=${r.unidade} parc=${r.numero_parcela} ` +
        `status=${r.status} valor=${r.valor_local} | atual=${r.data_prevista_atual} -> correto=${r.data_prevista_correta} (drift=${r.drift_dias}d)`,
    )
  }
  console.log(`\nDry-run apenas. Pra aplicar de verdade: node scripts/aplicar-correcao-data-prevista.mjs --apply`)
  // ainda salva report
  writeFileSync(`docs/aplicacao-data-prevista-${new Date().toISOString().slice(0, 10)}-dryrun.json`, JSON.stringify(report, null, 2))
  process.exit(0)
}

// APPLY MODE
// Estrategia: 1 PATCH por linha pra preservar idempotencia via WHERE
// (id=eq.X & data_prevista=eq.{atual}). Concorrencia limitada pra nao
// estourar PostgREST.

const CONCURRENCY = 8
let processados = 0
let updated = 0
let skipped = 0
let errors = 0

async function patchOne(r) {
  // WHERE inclui data_prevista atual — garante idempotencia (se ja atualizou,
  // PATCH nao casa e retorna []).
  const url =
    `${SUPABASE_URL}/rest/v1/pagamentos_prosoluto` +
    `?id=eq.${r.pagamento_id}` +
    `&data_prevista=eq.${r.data_prevista_atual}`
  const body = JSON.stringify({
    data_prevista: r.data_prevista_correta,
    updated_at: new Date().toISOString(),
  })
  try {
    const res = await fetch(url, { method: 'PATCH', headers: H, body })
    if (!res.ok) {
      const txt = await res.text()
      report.errors.push({ id: r.pagamento_id, msg: `HTTP ${res.status}: ${txt.slice(0, 200)}` })
      errors++
      return
    }
    const arr = await res.json()
    if (arr.length === 0) {
      skipped++ // idempotente — nada bateu (ja atualizado ou mudou)
    } else {
      updated++
      report.drift.push({
        id: r.pagamento_id,
        campo: 'data_prevista',
        antes: r.data_prevista_atual,
        depois: r.data_prevista_correta,
        motivo: `Sienge dueDate (billId=${r.bill_id} parc=${r.numero_parcela}); drift original = ${r.drift_dias}d`,
      })
    }
  } catch (e) {
    report.errors.push({ id: r.pagamento_id, msg: String(e).slice(0, 200) })
    errors++
  }
}

console.log(`Aplicando ${rows.length} PATCHs (concorrencia=${CONCURRENCY})...`)
for (let i = 0; i < rows.length; i += CONCURRENCY) {
  const batch = rows.slice(i, i + CONCURRENCY)
  await Promise.all(batch.map(patchOne))
  processados += batch.length
  process.stdout.write(`  ${processados}/${rows.length} | updated=${updated} skipped=${skipped} errors=${errors}\r`)
}
console.log('')

report.counts.updated = updated
report.counts.skipped_idempotent = skipped
report.counts.drift_corrected = updated
report.counts.errors = errors

const out = `docs/aplicacao-data-prevista-${new Date().toISOString().slice(0, 10)}.json`
writeFileSync(out, JSON.stringify(report, null, 2))

console.log('')
console.log('================================================================')
console.log('Aplicacao concluida')
console.log('================================================================')
console.log(`  alvo:                ${rows.length}`)
console.log(`  updated:             ${updated}`)
console.log(`  skipped (idemp):     ${skipped}`)
console.log(`  errors:              ${errors}`)
console.log(`\nReport: ${out}`)
