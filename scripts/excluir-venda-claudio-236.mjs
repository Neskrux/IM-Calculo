// Soft-delete da venda 236 do CLAUDIO MARTIRE — duplicata obsoleta.
//
// Contexto: contrato 236 foi reemitido no Sienge como 390 (bill 462, unidade
// 1008 C). A venda 390 ja esta no banco completa e correta (60 parcelas, 12
// pagas). A venda 236 e duplicata — 3 parcelas pagas-fantasma que fazem o
// CLAUDIO aparecer 2x no dashboard.
//
// Gestora autorizou a exclusao em 2026-05-14.
//
// Metodo: soft delete (excluido=TRUE). Reversivel, nao aciona trigger 017
// (que protege pagamentos_prosoluto, nao vendas). AdminDashboard ja filtra
// excluido=true (linha ~1029) — a venda e seus pagamentos somem da listagem.
// Migration 022 exige motivo_exclusao (min 10 chars).
//
// Spec: .claude/rules/sincronizacao-sienge.md (invariante excluido + revisao humana)
//
// Uso:
//   node scripts/excluir-venda-claudio-236.mjs          (dry-run)
//   node scripts/excluir-venda-claudio-236.mjs --apply  (executa)

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const DRY = !process.argv.includes('--apply')
console.log(`Modo: ${DRY ? 'dry-run' : 'apply'}\n`)

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

// id de quem autorizou (conta do Bruno) — pra excluido_por
const EXCLUIDO_POR = 'c8cff026-b79f-41e1-a9c1-93547d484758'
const MOTIVO =
  'Venda duplicada: contrato 236 foi reemitido no Sienge como 390 (bill 462, unidade 1008 C). ' +
  'Os pagamentos reais do CLAUDIO MARTIRE estao na venda do contrato 390 (60 parcelas, 12 pagas). ' +
  'Esta venda (236) tem 3 parcelas pagas-fantasma. Exclusao autorizada pela gestora em 2026-05-14.'

console.log('=== Venda 236 (CLAUDIO MARTIRE) ===')
const { data: vendas } = await supa.from('vendas').select('*').eq('sienge_contract_id', '236')
const venda = vendas?.[0]
if (!venda) {
  console.log('  venda 236 nao encontrada — ja excluida? (idempotente, ok)')
  process.exit(0)
}
console.log(`  id: ${venda.id}`)
console.log(`  unidade: ${venda.unidade} | numero_contrato: ${venda.numero_contrato}`)
console.log(`  status: ${venda.status} | excluido atual: ${venda.excluido}`)
if (venda.excluido === true) {
  console.log('  ja esta excluido=true — nada a fazer (idempotente)')
  process.exit(0)
}

// confirma que a venda 390 (a boa) existe e esta sa
const { data: v390 } = await supa
  .from('vendas')
  .select('id, sienge_contract_id, unidade, excluido')
  .eq('sienge_contract_id', '390')
if (!v390?.[0]) {
  console.error('  ✗ ABORTANDO: venda do contrato 390 NAO encontrada. Nao posso excluir a 236 sem a 390 existir.')
  process.exit(1)
}
if (v390[0].excluido === true) {
  console.error('  ✗ ABORTANDO: venda 390 esta com excluido=true. Algo errado — revisar manualmente.')
  process.exit(1)
}
console.log(`  ✓ venda 390 confirmada existente e ativa (id=${v390[0].id}, unidade=${v390[0].unidade})`)

// conta pagamentos da 236 (so pra registro)
const { data: pags236 } = await supa
  .from('pagamentos_prosoluto')
  .select('status')
  .eq('venda_id', venda.id)
const pagos = (pags236 || []).filter((p) => p.status === 'pago').length
console.log(`  pagamentos da 236: ${pags236?.length || 0} (${pagos} pagos)`)
console.log(`  -> ficam no banco, mas a venda some do dashboard (pagamentos viram orfaos ignorados)`)

const update = {
  excluido: true,
  motivo_exclusao: MOTIVO,
  excluido_por: EXCLUIDO_POR,
  excluido_em: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    spec_ref: '.claude/rules/sincronizacao-sienge.md',
    script: 'scripts/excluir-venda-claudio-236.mjs',
    modo: DRY ? 'dry-run' : 'apply',
    venda_id: venda.id,
    autorizacao: 'gestora 2026-05-14',
  },
  update,
  counts: { updated: 0, errors: 0 },
}

if (DRY) {
  console.log('\n  UPDATE que seria aplicado:')
  console.log(`    excluido = true`)
  console.log(`    motivo_exclusao = "${MOTIVO.slice(0, 80)}..."`)
  console.log(`    excluido_por = ${EXCLUIDO_POR}`)
  console.log('\nDry-run apenas. Pra aplicar: --apply')
  process.exit(0)
}

// APPLY — WHERE inclui excluido=false (idempotencia). A venda foi confirmada
// acima com excluido !== true, entao filtrar is.false e suficiente.
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
const url = `${URL}/rest/v1/vendas?id=eq.${venda.id}&excluido=is.false`
const res = await fetch(url, { method: 'PATCH', headers: H, body: JSON.stringify(update) })
if (!res.ok) {
  const txt = await res.text()
  console.error(`  ✗ ERRO HTTP ${res.status}: ${txt.slice(0, 300)}`)
  report.counts.errors = 1
  report.errMsg = txt.slice(0, 300)
} else {
  const arr = await res.json()
  report.counts.updated = arr.length
  console.log(`\n  ✓ updated: ${arr.length}`)
  if (arr.length > 0) {
    console.log('  Venda 236 marcada como excluida. CLAUDIO MARTIRE agora aparece so 1x (venda 390).')
  } else {
    console.log('  (0 linhas — ja estava excluida, idempotente)')
  }
}

const out = `docs/exclusao-venda-claudio-236-${new Date().toISOString().slice(0, 10)}.json`
writeFileSync(out, JSON.stringify(report, null, 2))
console.log(`\nReport: ${out}`)
