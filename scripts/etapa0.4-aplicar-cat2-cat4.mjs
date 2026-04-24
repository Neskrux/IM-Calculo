// Aplica correcoes CAT 2 (data_pagamento) e CAT 4 (pendente->pago) novidades.
// ver .claude/rules/sincronizacao-sienge.md
//
// Autorizacao:
// - CAT 2: Sienge e fonte da verdade temporal. Migration 020 (2026-04-23)
//   libera UPDATE de data_pagamento em status=pago.
// - CAT 4: parcelas com paymentDate no Sienge mas status=pendente no banco.
//   UPDATE pendente->pago + data_pagamento = Sienge (atomico).
//
// Exclui: casos ja cobertos por B.5 (rodar plano B.5 antes) ou B.6.
// Idempotente: rerun nao muda nada se ja aplicado.

import { readFileSync, writeFileSync } from 'node:fs'

const SUPABASE_URL = 'https://jdkkusrxullttyeakwib.supabase.co'
const env = readFileSync('.env', 'utf8')
const SERVICE = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim()
  || env.match(/VITE_SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim()
const ANON = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim()
const KEY = SERVICE || ANON
if (!SERVICE) console.warn('[WARN] SUPABASE_SERVICE_ROLE_KEY nao encontrada; usando ANON (UPDATE pode ser bloqueado por RLS)')
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }

const DRY_RUN = process.argv.includes('--dry-run')
const APPLY = process.argv.includes('--apply')
if (!DRY_RUN && !APPLY) {
  console.error('Use --dry-run ou --apply')
  process.exit(1)
}

const cruz = JSON.parse(readFileSync('docs/etapa0.4-cruzamento.json', 'utf8'))

const cat2 = cruz.cat2_data_pagamento_divergente.novidade
const cat4 = cruz.cat4_pendente_local_pago_sienge.novidade

console.log(`CAT 2 novidades: ${cat2.length}`)
console.log(`CAT 4 novidades: ${cat4.length}`)
console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (sem UPDATE)' : 'APPLY (UPDATE real)'}\n`)

const log = { cat2_updated: 0, cat2_failed: [], cat4_updated: 0, cat4_failed: [] }

async function atualizar(id, patch, rotulo) {
  if (DRY_RUN) return { ok: true, dry: true }
  const url = `${SUPABASE_URL}/rest/v1/pagamentos_prosoluto?id=eq.${id}`
  const r = await fetch(url, { method: 'PATCH', headers: H, body: JSON.stringify(patch) })
  if (!r.ok) {
    const txt = await r.text()
    return { ok: false, error: `HTTP ${r.status}: ${txt}` }
  }
  const j = await r.json()
  return { ok: true, rows: j.length }
}

console.log('[1/2] CAT 2 — corrigindo data_pagamento (Sienge fonte)...')
for (const x of cat2) {
  const id = x.banco.id
  const novaData = x.sienge.paymentDate
  const r = await atualizar(id, { data_pagamento: novaData }, 'cat2')
  if (r.ok) { log.cat2_updated++ }
  else { log.cat2_failed.push({ id, contrato: x.sienge_contract_id, tipo: x.tipo, seq: x.seq, error: r.error }) }
  if (log.cat2_updated % 10 === 0) process.stdout.write(`  ${log.cat2_updated}/${cat2.length}\r`)
}
process.stdout.write('\n')
console.log(`  OK: ${log.cat2_updated}  FAIL: ${log.cat2_failed.length}`)

console.log('\n[2/2] CAT 4 — pendente->pago + data_pagamento (atomico)...')
for (const x of cat4) {
  const id = x.banco.id
  const paymentDate = x.sienge.paymentDate
  // atomico: status + data_pagamento no mesmo PATCH
  const r = await atualizar(id, { status: 'pago', data_pagamento: paymentDate }, 'cat4')
  if (r.ok) { log.cat4_updated++ }
  else { log.cat4_failed.push({ id, contrato: x.sienge_contract_id, tipo: x.tipo, seq: x.seq, error: r.error }) }
  if (log.cat4_updated % 20 === 0) process.stdout.write(`  ${log.cat4_updated}/${cat4.length}\r`)
}
process.stdout.write('\n')
console.log(`  OK: ${log.cat4_updated}  FAIL: ${log.cat4_failed.length}`)

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    modo: DRY_RUN ? 'dry-run' : 'apply',
    regra: 'Sienge fonte da verdade. Migration 020 libera data_pagamento em pago. CAT 4 = INSERT de status pago real.',
  },
  resumo: {
    cat2_tentativas: cat2.length,
    cat2_updated: log.cat2_updated,
    cat2_failed: log.cat2_failed.length,
    cat4_tentativas: cat4.length,
    cat4_updated: log.cat4_updated,
    cat4_failed: log.cat4_failed.length,
  },
  falhas_cat2: log.cat2_failed,
  falhas_cat4: log.cat4_failed,
}

const outFile = DRY_RUN ? 'docs/etapa0.4-aplicar-dry-run.json' : 'docs/etapa0.4-aplicar-execucao.json'
writeFileSync(outFile, JSON.stringify(report, null, 2))
console.log(`\nOutput: ${outFile}`)
