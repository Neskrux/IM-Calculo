// Aplica b6 Grupo 1 — cancela parcelas pendentes EXTRAS criadas pelo gerador
// antigo, que nao tem par no Sienge. Spec autoriza UPDATE de pendente -> cancelado
// sem revisao adicional (sem pagas envolvidas).
//
// Origem: docs/b6-texto-para-usuaria.md (Grupo 1: 23 parcelas em 4 contratos).
// Universo coberto AGORA: 19 parcelas em 2 contratos (Fernanda 287, Caroline 340)
// — as outras 4 (contratos 83, 127) nao apareceram na varredura de 2026-05-13
// porque seus contratos nao tem o sintoma de drift que disparou a varredura.
//
// Spec: .claude/rules/sincronizacao-sienge.md, .claude/rules/rodadas-b.md
//
// Uso:
//   node scripts/aplicar-b6-grupo1.mjs          (dry-run, default)
//   node scripts/aplicar-b6-grupo1.mjs --apply  (executa)

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const DRY = !process.argv.includes('--apply')
console.log(`Modo: ${DRY ? 'dry-run' : 'apply'}\n`)

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

// Pega os pagamento_ids do plano sem_match_amostras (so PM-extras)
const plano = JSON.parse(readFileSync('docs/plano-correcao-data-prevista-2026-05-13.json', 'utf8'))
const semMatch = plano.sem_match_amostras || []
console.log(`sem_match no plano: ${semMatch.length}`)

// Verifica que sao realmente parcelas extras (numero_parcela > 46 pra 287, > 55 pra 340)
const contratos_b6 = {
  287: { contrato: 195, unidade: '1004 D', cliente: 'FERNANDA DOS SANTOS DE ALMEIDA', max_sienge: 46 },
  340: { contrato: 243, unidade: '905 B', cliente: 'CAROLINE SARAIVA DA SILVEIRA RODRIGUES', max_sienge: 55 },
}

const alvos = []
for (const sm of semMatch) {
  // achar contrato via venda_id
  const { data: v } = await supa.from('vendas').select('sienge_contract_id').eq('id', sm.venda_id).single()
  if (!v) continue
  const cid = Number(v.sienge_contract_id)
  if (!contratos_b6[cid]) {
    console.log(`  IGNORADO: contrato ${cid} fora do escopo b6 G1`)
    continue
  }
  if (sm.numero_parcela <= contratos_b6[cid].max_sienge) {
    console.log(`  IGNORADO: parc ${sm.numero_parcela} de ${cid} esta no range Sienge (<=${contratos_b6[cid].max_sienge})`)
    continue
  }
  alvos.push({ ...sm, contrato_info: contratos_b6[cid] })
}

console.log(`\nalvos para cancelar: ${alvos.length}`)
for (const a of alvos.slice(0, 5)) {
  console.log(`  pag=${a.pagamento_id?.slice(0, 8) || '?'} contrato=${a.contrato_info.contrato} parc=${a.numero_parcela} venc=${a.data_prevista_local}`)
}
if (alvos.length > 5) console.log(`  ... +${alvos.length - 5}`)

// nota: o sem_match_amostras nao tem pagamento_id (so dados de match). Vou
// re-puxar pagamento_id direto do banco filtrando por venda_id + numero_parcela.
console.log('\nResolvendo pagamento_id real (via banco)...')
const planoApply = []
for (const a of alvos) {
  const { data } = await supa
    .from('pagamentos_prosoluto')
    .select('id, venda_id, numero_parcela, tipo, valor, data_prevista, status')
    .eq('venda_id', a.venda_id)
    .eq('numero_parcela', a.numero_parcela)
    .eq('tipo', 'parcela_entrada')
  // Pode ter mais de uma linha com mesma chave (duplicata). Cancelar so as pendentes.
  for (const p of data || []) {
    if (p.status !== 'pendente') continue
    planoApply.push({
      pagamento_id: p.id,
      venda_id: p.venda_id,
      contrato: a.contrato_info.contrato,
      numero_parcela: p.numero_parcela,
      data_prevista: p.data_prevista,
      status_atual: p.status,
    })
  }
}
console.log(`linhas a cancelar (status='pendente'): ${planoApply.length}`)

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    spec_ref: '.claude/rules/sincronizacao-sienge.md, .claude/rules/rodadas-b.md',
    script: 'scripts/aplicar-b6-grupo1.mjs',
    modo: DRY ? 'dry-run' : 'apply',
    origem: 'docs/b6-texto-para-usuaria.md Grupo 1 (parcelas extras sem par no Sienge)',
  },
  counts: {
    matched: planoApply.length,
    updated: 0,
    skipped_idempotent: 0,
    errors: 0,
  },
  drift: [],
  errors: [],
}

if (DRY) {
  console.log(`\nDry-run apenas. Pra aplicar: --apply`)
  writeFileSync(
    `docs/aplicacao-b6-g1-${new Date().toISOString().slice(0, 10)}-dryrun.json`,
    JSON.stringify(report, null, 2),
  )
  process.exit(0)
}

// APPLY — usa PATCH REST com filtro idempotente (status=eq.pendente)
const SUPABASE_URL = URL
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }

let updated = 0
let skipped = 0
let errors = 0
for (const p of planoApply) {
  const url = `${SUPABASE_URL}/rest/v1/pagamentos_prosoluto?id=eq.${p.pagamento_id}&status=eq.pendente`
  const body = JSON.stringify({ status: 'cancelado', updated_at: new Date().toISOString() })
  try {
    const res = await fetch(url, { method: 'PATCH', headers: H, body })
    if (!res.ok) {
      const txt = await res.text()
      report.errors.push({ id: p.pagamento_id, msg: `HTTP ${res.status}: ${txt.slice(0, 200)}` })
      errors++
      continue
    }
    const arr = await res.json()
    if (arr.length === 0) {
      skipped++
    } else {
      updated++
      report.drift.push({
        id: p.pagamento_id,
        campo: 'status',
        antes: 'pendente',
        depois: 'cancelado',
        motivo: `parcela extra (gerador antigo, sem par no Sienge income); contrato ${p.contrato} parc ${p.numero_parcela}`,
      })
    }
  } catch (e) {
    report.errors.push({ id: p.pagamento_id, msg: String(e).slice(0, 200) })
    errors++
  }
}

report.counts.updated = updated
report.counts.skipped_idempotent = skipped
report.counts.errors = errors

const out = `docs/aplicacao-b6-g1-${new Date().toISOString().slice(0, 10)}.json`
writeFileSync(out, JSON.stringify(report, null, 2))

console.log(`\n=== Aplicacao b6 G1 ===`)
console.log(`  alvo:               ${planoApply.length}`)
console.log(`  updated:            ${updated}`)
console.log(`  skipped (idemp):    ${skipped}`)
console.log(`  errors:             ${errors}`)
console.log(`Report: ${out}`)
