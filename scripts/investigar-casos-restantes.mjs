// Analisa os 38 casos que NAO foram corrigidos automaticamente em
// docs/plano-correcao-data-prevista-2026-05-13.json:
//   - 19 drifts > 365d (suspeitos — provavelmente as 11 duplicatas)
//   - 19 sem match no income Sienge (parcelas locais sem par)
// READ-ONLY: nao toca o banco. Saida em docs/casos-restantes-{date}.md

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

const plano = JSON.parse(readFileSync('docs/plano-correcao-data-prevista-2026-05-13.json', 'utf8'))
const driftGrande = plano.drift_grande_amostras || []
const semMatch = plano.sem_match_amostras || []

// puxar metadata das vendas
const vendaIds = [...new Set([...driftGrande, ...semMatch].map((x) => x.venda_id).filter(Boolean))]
const vendasMeta = new Map()
for (let i = 0; i < vendaIds.length; i += 100) {
  const { data } = await supa
    .from('vendas')
    .select('id, sienge_contract_id, sienge_receivable_bill_id, numero_contrato, unidade, valor_venda, cliente_id, corretor_id')
    .in('id', vendaIds.slice(i, i + 100))
  for (const v of data || []) vendasMeta.set(v.id, v)
}
const clienteIds = [...new Set([...vendasMeta.values()].map((v) => v.cliente_id).filter(Boolean))]
const clientes = new Map()
for (let i = 0; i < clienteIds.length; i += 100) {
  const { data } = await supa.from('clientes').select('id, nome_completo, cpf').in('id', clienteIds.slice(i, i + 100))
  for (const c of data || []) clientes.set(c.id, c)
}

// agrupar drift_grande por venda
const driftPorVenda = new Map()
for (const d of driftGrande) {
  if (!driftPorVenda.has(d.venda_id)) driftPorVenda.set(d.venda_id, [])
  driftPorVenda.get(d.venda_id).push(d)
}

// agrupar sem_match por venda
const semMatchPorVenda = new Map()
for (const d of semMatch) {
  if (!semMatchPorVenda.has(d.venda_id)) semMatchPorVenda.set(d.venda_id, [])
  semMatchPorVenda.get(d.venda_id).push(d)
}

// b7 ja gerada
const b7 = JSON.parse(readFileSync('docs/b7-duplicatas-numero-parcela.json', 'utf8'))
const b7VendaIds = new Set(b7.casos.map((c) => c.venda_id))

const linhas = ['# Casos restantes — diagnóstico (2026-05-13)', '']
linhas.push(`Análise dos 38 casos que não foram corrigidos pelo cron automático.`)
linhas.push('')
linhas.push('---')
linhas.push('')
linhas.push('## Grupo A — Drifts > 365 dias (19 parcelas)')
linhas.push('')
linhas.push(`Vendas afetadas: ${driftPorVenda.size}. Cruzando com a rodada b7 (11 vendas com duplicata):`)
linhas.push('')

let coincidiuB7 = 0
for (const [vid, arr] of driftPorVenda.entries()) {
  const v = vendasMeta.get(vid) || {}
  const cli = clientes.get(v.cliente_id)
  const naB7 = b7VendaIds.has(vid)
  if (naB7) coincidiuB7++
  linhas.push(
    `### ${naB7 ? '✅ ' : '⚠️ '}Contrato ${v.numero_contrato || '-'} — Sienge ${v.sienge_contract_id || '-'} — Unidade ${v.unidade || '-'}` +
      `${naB7 ? ' (já está na rodada b7)' : ' (NÃO está na b7 — investigar separado)'}`,
  )
  linhas.push(`- **Cliente:** ${cli?.nome_completo || '-'}`)
  linhas.push(`- **Parcelas afetadas:** ${arr.length}`)
  for (const d of arr) {
    linhas.push(
      `  - parc ${d.numero_parcela} (${d.status}): local=\`${d.data_prevista_atual}\` Sienge=\`${d.data_prevista_correta}\` drift=${d.drift_dias}d valor=R$ ${d.valor_local}`,
    )
  }
  linhas.push('')
}
linhas.push(`**Sobreposição com rodada b7:** ${coincidiuB7}/${driftPorVenda.size} vendas. ${coincidiuB7 === driftPorVenda.size ? 'Todas drift>365d já estão capturadas pela b7.' : 'Há casos NOVOS fora da b7.'}`)
linhas.push('')
linhas.push('---')
linhas.push('')
linhas.push('## Grupo B — Sem-match no Sienge (19 parcelas)')
linhas.push('')
linhas.push(`Vendas afetadas: ${semMatchPorVenda.size}. Parcelas locais que **não têm correspondente** no \`/bulk-data/v1/income\`.`)
linhas.push('')
linhas.push('Hipóteses possíveis:')
linhas.push('- Parcela criada pelo gerador antigo a mais do que o Sienge tem.')
linhas.push('- Parcela cujo `numero_parcela` local não bate com o `installmentNumber` Sienge (re-numeração).')
linhas.push('- Parcela cancelada no Sienge mas ainda viva localmente.')
linhas.push('')

let semMatchNaB7 = 0
for (const [vid, arr] of semMatchPorVenda.entries()) {
  const v = vendasMeta.get(vid) || {}
  const cli = clientes.get(v.cliente_id)
  const naB7 = b7VendaIds.has(vid)
  if (naB7) semMatchNaB7++
  linhas.push(`### ${naB7 ? '✅ ' : '⚠️ '}Contrato ${v.numero_contrato || '-'} — Sienge ${v.sienge_contract_id || '-'} — Unidade ${v.unidade || '-'}${naB7 ? ' (também na b7)' : ' (NOVO caso)'}`)
  linhas.push(`- **Cliente:** ${cli?.nome_completo || '-'}`)
  linhas.push(`- **Parcelas sem match:** ${arr.length}`)
  for (const d of arr) {
    linhas.push(
      `  - parc ${d.numero_parcela} (status=?): data_prevista_local=\`${d.data_prevista_local}\` bill_id=${d.bill_id} | ${d.total_matches_nao_pm > 0 ? `${d.total_matches_nao_pm} match(es) com tipo ≠ PM (provavelmente sinal/balão)` : 'zero matches no Sienge'}`,
    )
  }
  linhas.push('')
}
linhas.push(`**Sobreposição com rodada b7:** ${semMatchNaB7}/${semMatchPorVenda.size}.`)
linhas.push('')
linhas.push('---')
linhas.push('')
linhas.push('## Conclusão')
linhas.push('')
const fora = driftPorVenda.size - coincidiuB7
const foraSemMatch = semMatchPorVenda.size - semMatchNaB7
linhas.push(`- ${coincidiuB7 + semMatchNaB7} dos 38 casos já estão cobertos pela rodada b7 (vão ser resolvidos quando a quota Sienge voltar + migration 023 aplicada).`)
linhas.push(`- ${fora + foraSemMatch} casos NOVOS, fora da b7 — precisam ser adicionados à fila de revisão.`)
linhas.push('')
linhas.push('### Recomendação')
linhas.push('')
if (fora + foraSemMatch === 0) {
  linhas.push('Nada novo. Os 38 casos são apenas variações dos 11 que já estão na b7. Quando a quota Sienge voltar:')
  linhas.push('1. Aplicar migration 023.')
  linhas.push('2. Re-baixar income.')
  linhas.push('3. Popular `sienge_installment_id` nas parcelas das 11 vendas.')
  linhas.push('4. Aplicar respostas da b7.')
} else {
  linhas.push(`Casos novos detectados (${fora + foraSemMatch}). Sugiro:`)
  linhas.push('1. Estender rodada b7 com esses casos novos.')
  linhas.push('2. Investigar caso a caso o motivo do drift gigante (re-numeração? regeneração antiga?).')
}

const out = `docs/casos-restantes-${new Date().toISOString().slice(0, 10)}.md`
writeFileSync(out, linhas.join('\n'))
console.log(`Salvo: ${out}`)
console.log(`\nResumo:`)
console.log(`  drifts > 365d: ${driftGrande.length} parcelas em ${driftPorVenda.size} vendas (${coincidiuB7} na b7, ${driftPorVenda.size - coincidiuB7} fora)`)
console.log(`  sem-match: ${semMatch.length} parcelas em ${semMatchPorVenda.size} vendas (${semMatchNaB7} na b7, ${semMatchPorVenda.size - semMatchNaB7} fora)`)
