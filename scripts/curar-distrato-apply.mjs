// Cura de distrato — APPLY (gated, requer OK explícito da gestão).
//
// Recalcula o plano AO VIVO (mesma lógica do dry-run, nunca confia em JSON velho) e:
//   1. "Excluir Baixa": status='pendente' + data_pagamento=NULL no MESMO UPDATE (trigger 020)
//   2. status='cancelado' + motivo_cancelamento_parcela='distrato'
//   3. vendas.status='distrato' (alinha com a ponte A.1 da edge)
// Preserva as pagas PRÉ-distrato (pagamento real). Idempotente: rerun acha 0.
//
// Proteção pós-cura (verificada nesta sessão): reconciliador da main é distrato-aware
// (pula baixa paymentDate >= data_distrato) e motivo-aware (nunca reativa cancelada com
// motivo) desde 06-10 — o que desfez o curativo de maio foi o cron rodando código velho
// de 06-06 a 06-09, antes do merge.
//
// ver .claude/rules/sincronizacao-sienge.md
// Uso: node scripts/curar-distrato-apply.mjs          # dry-run (igual curar-distrato-dryrun)
//      node scripts/curar-distrato-apply.mjs --apply  # ESCREVE

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const FIGUEIRA = '0d7d01f4-c398-4d9a-a280-13f44c957279'
const PAGE = 1000
const env = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const get = (k) => process.env[k] || env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const supa = createClient(get('VITE_SUPABASE_URL'), get('VITE_SUPABASE_ANON_KEY'))
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const d10 = (x) => (x ? String(x).slice(0, 10) : null)

// 1. vendas distrato (situacao=3) — data_distrato deve estar no banco (backfill já rodado)
const vendas = []
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supa.from('vendas')
    .select('id, sienge_contract_id, unidade, data_distrato, status')
    .eq('empreendimento_id', FIGUEIRA).eq('excluido', false).eq('situacao_contrato', '3').range(from, from + PAGE - 1)
  if (error) { console.error(error); process.exit(1) }
  if (!data?.length) break
  vendas.push(...data); if (data.length < PAGE) break
}
const semData = vendas.filter((v) => !v.data_distrato)
console.log(`vendas distrato: ${vendas.length} (${semData.length} sem data — não curáveis)`)
if (semData.length) for (const v of semData) console.log(`  ⚠️ sem data: c${v.sienge_contract_id} ${v.unidade}`)

// 2. pagas dessas vendas
const ids = vendas.map((v) => v.id)
const pagasPorVenda = new Map()
for (let i = 0; i < ids.length; i += 50) {
  const chunk = ids.slice(i, i + 50)
  for (let f = 0; ; f += PAGE) {
    const { data } = await supa.from('pagamentos_prosoluto')
      .select('id, venda_id, numero_parcela, tipo, valor, comissao_gerada, data_pagamento, status')
      .in('venda_id', chunk).eq('status', 'pago').order('id').range(f, f + PAGE - 1)
    if (!data?.length) break
    for (const p of data) { if (!pagasPorVenda.has(p.venda_id)) pagasPorVenda.set(p.venda_id, []); pagasPorVenda.get(p.venda_id).push(p) }
    if (data.length < PAGE) break
  }
}

// 3. plano vivo
const plano = []
for (const v of vendas) {
  const dd = d10(v.data_distrato)
  if (!dd) continue
  const pagas = pagasPorVenda.get(v.id) || []
  const pos = pagas.filter((p) => d10(p.data_pagamento) >= dd)
  const pre = pagas.filter((p) => d10(p.data_pagamento) < dd)
  plano.push({ venda: v, dd, pos, pre })
}
const totCancelar = plano.reduce((s, x) => s + x.pos.length, 0)
const totComissao = round2(plano.reduce((s, x) => s + x.pos.reduce((a, p) => a + (p.comissao_gerada || 0), 0), 0))
const totPreservar = plano.reduce((s, x) => s + x.pre.length, 0)
console.log(`plano vivo: cancelar ${totCancelar} baixas (R$ ${totComissao}) | preservar ${totPreservar} pré-distrato | ${plano.filter((x) => x.pos.length).length} vendas`)

const out = {
  meta: { geradoEm: new Date().toISOString(), spec_ref: '.claude/rules/sincronizacao-sienge.md',
    doc_ref: 'docs/contexto/2026-06-10-north-star-3-ancora-correta.md (F2)', script: 'scripts/curar-distrato-apply.mjs',
    modo: APPLY ? 'apply' : 'dry-run' },
  counts: { vendas_distrato: vendas.length, vendas_sem_data: semData.length, parcelas_a_cancelar: totCancelar,
    pre_preservadas: totPreservar, updated_excluir_baixa: 0, updated_cancelado: 0, updated_venda_status: 0,
    skipped_idempotent: 0, errors: 0 },
  comissao_falsa_removida: totComissao,
  por_venda: plano.map((x) => ({ contrato: x.venda.sienge_contract_id, unidade: x.venda.unidade, data_distrato: x.dd,
    cancelar: x.pos.length, preservar: x.pre.length,
    comissao_falsa: round2(x.pos.reduce((a, p) => a + (p.comissao_gerada || 0), 0)) })).sort((a, b) => b.comissao_falsa - a.comissao_falsa),
  errors: [],
}

if (!APPLY) {
  console.log('\n(dry-run — nada escrito; use --apply)')
} else {
  const CHUNK = 100
  const todosIds = plano.flatMap((x) => x.pos.map((p) => p.id))
  if (!todosIds.length) { console.log('nada a cancelar — idempotente ✓'); out.counts.skipped_idempotent = 1 }

  // Passo 1: Excluir Baixa (pago -> pendente + data NULL, mesmo UPDATE — fluxo trigger 020)
  for (let i = 0; i < todosIds.length; i += CHUNK) {
    const chunk = todosIds.slice(i, i + CHUNK)
    const { error, count } = await supa.from('pagamentos_prosoluto')
      .update({ status: 'pendente', data_pagamento: null }, { count: 'exact' })
      .in('id', chunk).eq('status', 'pago')
    if (error) { out.counts.errors++; out.errors.push({ passo: 'excluir_baixa', msg: error.message }); console.error('  erro excluir_baixa:', error.message) }
    else out.counts.updated_excluir_baixa += count || 0
  }
  console.log(`  passo 1 (Excluir Baixa): ${out.counts.updated_excluir_baixa}`)

  // Passo 2: cancelar com motivo
  for (let i = 0; i < todosIds.length; i += CHUNK) {
    const chunk = todosIds.slice(i, i + CHUNK)
    const { error, count } = await supa.from('pagamentos_prosoluto')
      .update({ status: 'cancelado', motivo_cancelamento_parcela: 'distrato' }, { count: 'exact' })
      .in('id', chunk).eq('status', 'pendente')
    if (error) { out.counts.errors++; out.errors.push({ passo: 'cancelado', msg: error.message }); console.error('  erro cancelado:', error.message) }
    else out.counts.updated_cancelado += count || 0
  }
  console.log(`  passo 2 (cancelado+motivo): ${out.counts.updated_cancelado}`)

  // Passo 3: vendas.status='distrato'
  for (const x of plano) {
    if (x.venda.status === 'distrato') continue
    const { error } = await supa.from('vendas').update({ status: 'distrato' }).eq('id', x.venda.id)
    if (error) { out.counts.errors++; out.errors.push({ passo: 'venda_status', id: x.venda.id, msg: error.message }) }
    else out.counts.updated_venda_status++
  }
  console.log(`  passo 3 (vendas.status=distrato): ${out.counts.updated_venda_status}`)

  // Verificação imediata: 0 pagas pós-distrato restantes
  let restantes = 0
  for (const x of plano) {
    const { count } = await supa.from('pagamentos_prosoluto')
      .select('id', { count: 'exact', head: true })
      .eq('venda_id', x.venda.id).eq('status', 'pago').gte('data_pagamento', x.dd)
    restantes += count || 0
  }
  out.verificacao_pos_apply = { pagas_pos_distrato_restantes: restantes }
  console.log(`  verificação: pagas pós-distrato restantes = ${restantes} ${restantes === 0 ? '✓' : '❌'}`)
}

mkdirSync('docs/auditorias/2026-06-10-distrato', { recursive: true })
const f = `docs/auditorias/2026-06-10-distrato/cura-distrato-${APPLY ? 'apply' : 'dryrun2'}.json`
writeFileSync(f, JSON.stringify(out, null, 2))
console.log(`\nSalvo: ${f}`)
