// Restaura comissao_gerada = valor x fator_comissao_aplicado nas parcelas INTERNAS
// PAGAS onde a identidade quebrou (gravadas a 7% externo; fator correto 6,5% interno).
// ver .claude/rules/fator-comissao.md          (excecao de reconciliacao auditada)
//     .claude/rules/sincronizacao-sienge.md    (schema de metrica + idempotencia)
//     docs/contexto/2026-06-03-plano-reconciliacao-fator-comissao.md
//
// PRE-REQUISITO: migration 026 aplicada (senao a trigger 017/020 bloqueia o UPDATE
// e o script reporta errors — comportamento fail-safe).
//
// Uso:  node scripts/B1-reconciliar-fator-interno-pago.mjs            (dry-run)
//       node scripts/B1-reconciliar-fator-interno-pago.mjs --apply    (escreve)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const DRY = !process.argv.includes('--apply')
const env = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const get = (k) => process.env[k] || env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const supa = createClient(get('VITE_SUPABASE_URL'), get('VITE_SUPABASE_ANON_KEY'))
const FIG = '0d7d01f4-c398-4d9a-a280-13f44c957279'
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

console.log(`Modo: ${DRY ? 'DRY-RUN (nada e escrito)' : 'APPLY (escreve em producao)'}\n`)

// 1. vendas internas FIGUEIRA ativas (nao excluida, nao distrato)
const vendas = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supa.from('vendas')
    .select('id,sienge_contract_id,unidade,tipo_corretor,excluido,situacao_contrato')
    .eq('empreendimento_id', FIG).eq('tipo_corretor', 'interno').eq('excluido', false)
    .range(from, from + 999)
  if (error) { console.error(error); process.exit(1) }
  if (!data.length) break
  vendas.push(...data.filter((v) => v.situacao_contrato !== '3'))
  if (data.length < 1000) break
}
const vById = new Map(vendas.map((v) => [v.id, v]))
const ids = vendas.map((v) => v.id)

// 2. parcelas PAGAS dessas vendas
const pags = []
for (let i = 0; i < ids.length; i += 50) {
  const chunk = ids.slice(i, i + 50)
  for (let f = 0; ; f += 1000) {
    const { data } = await supa.from('pagamentos_prosoluto')
      .select('id,venda_id,numero_parcela,tipo,valor,comissao_gerada,fator_comissao_aplicado,status')
      .in('venda_id', chunk).eq('status', 'pago').order('id').range(f, f + 999)
    if (!data?.length) break
    pags.push(...data)
    if (data.length < 1000) break
  }
}

// 3. alvos: identidade quebrada (comissao_gerada != round(valor x fator), fator>0)
const alvo = []
for (const p of pags) {
  const fator = Number(p.fator_comissao_aplicado) || 0
  if (fator <= 0) continue
  const correto = round2(Number(p.valor) * fator)
  const atual = round2(p.comissao_gerada)
  if (Math.abs(atual - correto) > 0.01) alvo.push({ ...p, correto, atual, delta: round2(atual - correto) })
}

const metric = {
  meta: { geradoEm: new Date().toISOString(), spec_ref: '.claude/rules/fator-comissao.md',
    script: 'scripts/B1-reconciliar-fator-interno-pago.mjs', modo: DRY ? 'dry-run' : 'apply' },
  counts: { matched: alvo.length, updated: 0, skipped_idempotent: 0, errors: 0 },
  totais: { vendas_afetadas: new Set(alvo.map((a) => a.venda_id)).size,
    overpay_removido: round2(alvo.reduce((s, a) => s + a.delta, 0)) },
  drift: alvo.map((a) => ({ id: a.id, contrato: vById.get(a.venda_id)?.sienge_contract_id,
    unidade: vById.get(a.venda_id)?.unidade, parcela: a.numero_parcela, tipo: a.tipo,
    campo: 'comissao_gerada', antes: a.atual, depois: a.correto,
    motivo: 'restaura identidade valor x fator (corrige 7% gravado -> 6,5% interno)' })),
  errors: [],
}

console.log(`Parcelas com identidade quebrada: ${metric.counts.matched}`)
console.log(`Vendas afetadas: ${metric.totais.vendas_afetadas}`)
console.log(`Overpay a remover: R$ ${metric.totais.overpay_removido}`)

if (!DRY) {
  for (const a of alvo) {
    const { error } = await supa.from('pagamentos_prosoluto')
      .update({ comissao_gerada: a.correto, updated_at: new Date().toISOString() })
      .eq('id', a.id).eq('status', 'pago')
    if (error) { metric.counts.errors++; metric.errors.push({ id: a.id, msg: error.message }) }
    else metric.counts.updated++
  }
  console.log(`\nAtualizadas: ${metric.counts.updated} | erros: ${metric.counts.errors}`)
  if (metric.errors.length) console.log('  1o erro:', metric.errors[0]?.msg)
}

mkdirSync('docs/auditorias/2026-06-03-fator', { recursive: true })
const out = `docs/auditorias/2026-06-03-fator/B1-fator-interno-${DRY ? 'dryrun' : 'aplicado'}.json`
writeFileSync(out, JSON.stringify(metric, null, 2))
console.log(`\nSalvo: ${out}`)
if (DRY) console.log('Dry-run apenas. Pra aplicar (apos migration 026): --apply')
