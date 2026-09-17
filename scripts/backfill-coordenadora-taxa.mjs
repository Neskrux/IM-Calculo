// Backfill do snapshot vendas.coordenadora_taxa (migration 040).
// Ver .claude/rules/sincronizacao-sienge.md (schema de métrica + idempotência)
// e docs/specs/2026-08-20-spec-relatorio-coordenadoras.md.
//
// Regra (aprovada pela gestão; mesma do repasse-mensal-coordenadora.mjs):
//   data_venda < 2025-07-15  -> 1,0
//   data_venda >= 2025-07-15 -> 0,5
//   sem data_venda           -> NÃO grava (humano_pendente)
//
// Escopo: vendas com coordenadora_id preenchido (todas as coordenadoras — a regra
// do cutover é da POLÍTICA, não de uma pessoa). Só grava quando coordenadora_taxa
// está NULL ou difere do esperado. Idempotente: 2º run => updated=0.
//
// Uso: node scripts/backfill-coordenadora-taxa.mjs           (dry-run)
//      node scripts/backfill-coordenadora-taxa.mjs --apply

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const gg = k => process.env[k] || env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const supa = createClient(gg('VITE_SUPABASE_URL'), gg('VITE_SUPABASE_ANON_KEY'))

const APPLY = process.argv.includes('--apply')
const CUT = '2025-07-15'
const PAGE = 1000

const taxaPorCutover = d => {
  const s = String(d || '').slice(0, 10)
  return s ? (s < CUT ? 1.0 : 0.5) : null
}

const vendas = []
for (let f = 0; ; f += PAGE) {
  const { data, error } = await supa
    .from('vendas')
    .select('id, unidade, data_venda, coordenadora_id, coordenadora_taxa, excluido')
    .not('coordenadora_id', 'is', null)
    .order('id')
    .range(f, f + PAGE - 1)
  if (error) throw error
  if (!data?.length) break
  vendas.push(...data)
  if (data.length < PAGE) break
}

const counts = { matched: vendas.length, updated: 0, skipped_idempotent: 0, skipped_humano: 0, errors: 0 }
const humano_pendente = []
const errors = []
const plano = []

for (const v of vendas) {
  const esperado = taxaPorCutover(v.data_venda)
  if (esperado == null) {
    counts.skipped_humano++
    humano_pendente.push({ id: v.id, unidade: v.unidade, motivo: 'sem data_venda — cutover indecidível' })
    continue
  }
  const atual = v.coordenadora_taxa == null ? null : Number(v.coordenadora_taxa)
  if (atual === esperado) { counts.skipped_idempotent++; continue }
  plano.push({ id: v.id, unidade: v.unidade, data_venda: v.data_venda, de: atual, para: esperado })
  if (APPLY) {
    const { error } = await supa.from('vendas').update({ coordenadora_taxa: esperado }).eq('id', v.id)
    if (error) { counts.errors++; errors.push({ id: v.id, msg: error.message }); continue }
    counts.updated++
  }
}

const out = {
  meta: {
    geradoEm: new Date().toISOString(),
    spec_ref: 'docs/specs/2026-08-20-spec-relatorio-coordenadoras.md',
    script: 'scripts/backfill-coordenadora-taxa.mjs',
    modo: APPLY ? 'apply' : 'dry-run',
    regra: `data_venda < ${CUT} => 1.0, senao 0.5`,
  },
  counts,
  plano,
  humano_pendente,
  errors,
}

mkdirSync('docs/auditorias/coordenadora-taxa', { recursive: true })
const file = `docs/auditorias/coordenadora-taxa/backfill-${APPLY ? 'apply' : 'dry'}.json`
writeFileSync(file, JSON.stringify(out, null, 2))
console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'}: ${counts.matched} vendas com coordenadora · ` +
  `${APPLY ? counts.updated + ' gravadas' : plano.length + ' a gravar'} · ` +
  `${counts.skipped_idempotent} já corretas · ${counts.skipped_humano} sem data_venda · ${counts.errors} erros`)
console.log(`-> ${file}`)
const porTaxa = plano.reduce((m, p) => { m[p.para] = (m[p.para] || 0) + 1; return m }, {})
console.log('   por taxa:', JSON.stringify(porTaxa))
