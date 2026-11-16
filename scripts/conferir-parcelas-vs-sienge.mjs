// Conferência diária parcela a parcela IM × Sienge — SÓ LEITURA.
// Spec: docs/specs/2026-11-16-spec-conferencia-diaria-parcelas.md
// ver .claude/rules/sincronizacao-sienge.md
//
// Não escreve no banco. Usa o income que o reconciliador já baixou no mesmo run (cache de
// 1h do _sienge-http.mjs), então não gasta cota. Saída: JSON no schema canônico +
// resumo no painel do run (GITHUB_STEP_SUMMARY).
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { siengeGet, extractRows } from './_sienge-http.mjs'
import { conferirParcelas } from './_conferencia-parcelas.mjs'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const supa = createClient(
  process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL'),
  process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY'),
)

// Paginação com término por página incompleta e ordem total (.claude/rules/leitura-de-listas-e-refetch.md).
async function todas(tabela, colunas, filtro = (q) => q) {
  const linhas = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await filtro(supa.from(tabela).select(colunas)).order('id').range(de, de + 999)
    if (error) throw new Error(`${tabela}: ${error.message}`)
    linhas.push(...data)
    if (data.length < 1000) break
  }
  return linhas
}

const r = await siengeGet({
  path: '/bulk-data/v1/income',
  query: { startDate: '2023-01-01', endDate: '2031-12-31', selectionType: 'D', companyId: 5 },
})
const income = extractRows(r.data)

const pagamentos = await todas('pagamentos_prosoluto',
  'id,venda_id,tipo,numero_parcela,sienge_bill_id,sienge_installment_id,valor,comissao_gerada,status,data_prevista,data_pagamento',
  (q) => q.not('sienge_installment_id', 'is', null).neq('status', 'cancelado'))
const vendas = await todas('vendas', 'id,unidade,sienge_contract_id,excluido')
const unidade = new Map(vendas.map((v) => [v.id, v]))

const arqConhecidas = new URL('./conferencia-parcelas-conhecidas.json', import.meta.url)
const conhecidas = existsSync(arqConhecidas) ? JSON.parse(readFileSync(arqConhecidas, 'utf8')).conhecidas : []

const { divergencias, counts } = conferirParcelas(pagamentos, income, { conhecidas })
for (const d of divergencias) {
  const v = unidade.get(d.venda_id)
  d.unidade = v?.unidade ?? null
  d.contrato = v?.sienge_contract_id ?? null
}

const porTipo = {}
for (const d of divergencias) {
  porTipo[d.tipo] ??= { n: 0, novas: 0, comissao: 0 }
  porTipo[d.tipo].n++
  if (!d.conhecida && d.tipo !== 'aguardando_sienge') porTipo[d.tipo].novas++
  porTipo[d.tipo].comissao = Math.round((porTipo[d.tipo].comissao + d.comissao) * 100) / 100
}

const hoje = new Date().toISOString().slice(0, 10)
const saida = {
  meta: {
    geradoEm: new Date().toISOString(),
    spec_ref: 'docs/specs/2026-11-16-spec-conferencia-diaria-parcelas.md',
    script: 'scripts/conferir-parcelas-vs-sienge.mjs',
    modo: 'leitura',
    income_linhas: income.length,
  },
  counts: { ...counts, errors: 0 },
  por_tipo: porTipo,
  divergencias: divergencias.sort((a, b) => Number(a.conhecida) - Number(b.conhecida) || b.comissao - a.comissao),
}
mkdirSync('docs/auditorias', { recursive: true })
const arq = `docs/auditorias/conferencia-parcelas-${hoje}.json`
writeFileSync(arq, JSON.stringify(saida, null, 2))

const fmt = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
console.log(`Conferidas ${counts.conferidas} parcelas · ${counts.novas} alarmes · ${counts.informativas} aguardando Sienge · ${counts.conhecidas} conhecidas`)
for (const [t, x] of Object.entries(porTipo)) console.log(`  ${t}: ${x.n} (${x.novas} novas) · comissão R$ ${fmt(x.comissao)}`)
console.log(`Relatório: ${arq}`)

if (process.env.GITHUB_STEP_SUMMARY) {
  const novas = saida.divergencias.filter((d) => !d.conhecida && d.tipo !== 'aguardando_sienge')
  const linhas = [
    `## Conferência parcela a parcela IM × Sienge — ${hoje}`,
    '',
    `**${counts.conferidas}** parcelas conferidas · **${counts.novas} alarmes** · ${counts.informativas} aguardando o Sienge (baixa no IM há até 15 dias) · ${counts.conhecidas} conhecidas`,
    '',
    '| Tipo | Total | Novas | Comissão (R$) |', '|---|---|---|---|',
    ...Object.entries(porTipo).map(([t, x]) => `| ${t} | ${x.n} | ${x.novas} | ${fmt(x.comissao)} |`),
    '',
  ]
  if (novas.length) {
    linhas.push('### Alarmes (até 50)', '', '| Unidade | Título/parcela | Tipo | IM | Sienge | Comissão |', '|---|---|---|---|---|---|')
    for (const d of novas.slice(0, 50)) {
      linhas.push(`| ${d.unidade ?? '?'} | ${d.sienge_bill_id}/${d.sienge_installment_id} | ${d.tipo} | ${d.im ?? '-'} | ${d.sienge ?? '-'} | ${fmt(d.comissao)} |`)
    }
  }
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, linhas.join('\n') + '\n')
}
