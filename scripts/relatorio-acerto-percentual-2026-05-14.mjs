// Gera relatorio de acerto das parcelas PAGAS com percentual errado
// (Opcao B escolhida pela gestora em 2026-05-14).
//
// NAO altera o banco. Parcelas pagas tem comissao_gerada imutavel (trigger
// 017) — o acerto e operacional (desconto no proximo repasse), nao mexe no
// historico. Ver docs/percentual-divergente-para-revisao-2026-05-14.md.
//
// Pra cada parcela paga com percentual divergente:
//   - comissao paga (atual, errada)
//   - comissao correta (recalculada com o percentual do tipo_corretor)
//   - diferenca (quanto foi pago a mais/menos)
//   - parte do CORRETOR especificamente (cargo Corretor) — e com ele que o
//     acerto de repasse acontece
//
// Agrupa por corretor. Saida: docs/relatorio-acerto-percentual-{date}.json + .md
//
// Spec: .claude/rules/fator-comissao.md, .claude/rules/comissao-corretor.md

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

const PCT_ESPERADO = { interno: 6.5, externo: 7 }

// percentual do cargo Corretor por tipo (de cargos_empreendimento — confirmado
// na investigacao: interno=2.5, externo=4)
const PCT_CORRETOR = { interno: 2.5, externo: 4 }

const d = JSON.parse(readFileSync('docs/varredura-percentual-vs-tipo-2026-05-14.json', 'utf8'))

const porCorretor = new Map()
let totalParcelas = 0

for (const caso of d.casos) {
  if (String(caso.sienge_contract_id) === '80') continue // outlier conhecido
  const esperado = PCT_ESPERADO[caso.tipo_corretor]
  if (esperado == null) continue

  const { data: v } = await supa
    .from('vendas')
    .select('id, valor_venda, valor_pro_soluto, tipo_corretor, corretor_id, unidade, sienge_contract_id')
    .eq('id', caso.venda_id)
    .single()
  if (!v || !(Number(v.valor_pro_soluto) > 0)) continue

  // nome do corretor e do cliente
  let corretorNome = '(sem corretor)'
  if (v.corretor_id) {
    const { data: cor } = await supa.from('usuarios').select('nome').eq('id', v.corretor_id).maybeSingle()
    corretorNome = cor?.nome || v.corretor_id
  }
  const { data: cli } = caso.cliente_id
    ? await supa.from('clientes').select('nome_completo').eq('id', caso.cliente_id).maybeSingle()
    : { data: null }

  const fatorCorretoTotal = (Number(v.valor_venda) * (esperado / 100)) / Number(v.valor_pro_soluto)

  // parcelas PAGAS com percentual divergente
  const { data: pags } = await supa
    .from('pagamentos_prosoluto')
    .select('id, numero_parcela, valor, status, percentual_comissao_total, comissao_gerada')
    .eq('venda_id', v.id)
    .eq('status', 'pago')
  const erradas = (pags || []).filter(
    (p) => p.percentual_comissao_total != null && Number(p.percentual_comissao_total) !== esperado,
  )
  if (erradas.length === 0) continue

  let difTotalVenda = 0
  let difCorretorVenda = 0
  for (const p of erradas) {
    const comissaoAtual = Number(p.comissao_gerada) || 0
    const comissaoCorreta = Number(p.valor) * fatorCorretoTotal
    const dif = comissaoAtual - comissaoCorreta
    // parte do corretor: proporcao do cargo Corretor dentro do total
    const fracaoCorretor = PCT_CORRETOR[caso.tipo_corretor] / esperado
    const difCorretor = dif * fracaoCorretor
    difTotalVenda += dif
    difCorretorVenda += difCorretor
    totalParcelas++
  }

  if (!porCorretor.has(corretorNome)) porCorretor.set(corretorNome, { vendas: [], difTotal: 0, difCorretor: 0, parcelas: 0 })
  const reg = porCorretor.get(corretorNome)
  reg.vendas.push({
    cliente: cli?.nome_completo || caso.cliente,
    unidade: v.unidade,
    sienge_contract_id: v.sienge_contract_id,
    tipo_corretor: caso.tipo_corretor,
    parcelas_pagas_erradas: erradas.length,
    dif_total: Number(difTotalVenda.toFixed(2)),
    dif_parte_corretor: Number(difCorretorVenda.toFixed(2)),
  })
  reg.difTotal += difTotalVenda
  reg.difCorretor += difCorretorVenda
  reg.parcelas += erradas.length
}

const corretores = [...porCorretor.entries()].map(([nome, r]) => ({
  corretor: nome,
  parcelas: r.parcelas,
  dif_comissao_total: Number(r.difTotal.toFixed(2)),
  dif_parte_corretor: Number(r.difCorretor.toFixed(2)),
  vendas: r.vendas,
})).sort((a, b) => b.dif_parte_corretor - a.dif_parte_corretor)

const somaTotal = corretores.reduce((s, c) => s + c.dif_comissao_total, 0)
const somaCorretor = corretores.reduce((s, c) => s + c.dif_parte_corretor, 0)

const data = new Date().toISOString().slice(0, 10)
writeFileSync(
  `docs/relatorio-acerto-percentual-${data}.json`,
  JSON.stringify({ meta: { geradoEm: new Date().toISOString(), totalParcelas, somaTotal: Number(somaTotal.toFixed(2)), somaCorretor: Number(somaCorretor.toFixed(2)) }, corretores }, null, 2),
)

// markdown pra gestora
const L = ['# Relatório de acerto — comissão paga a mais (percentual 7% vs 6,5%) — 2026-05-14', '']
L.push(`Você escolheu a **Opção B** — acertar com os corretores. Aqui está quanto cada corretor recebeu a mais nas parcelas que foram pagas com 7% quando deviam ser 6,5%.`)
L.push('')
L.push('**Como ler:**')
L.push('- **Comissão total a mais** = soma de todos os cargos (corretor + diretor + nohros + etc) que foi paga a mais naquela parcela.')
L.push('- **Parte do corretor a mais** = só a fatia do corretor — **é esse o valor a descontar no repasse dele**.')
L.push('')
L.push('> As parcelas pagas **não foram alteradas** no sistema (pagamento auditado é protegido). O acerto é operacional: você desconta nos próximos repasses.')
L.push('')
L.push(`**Total geral:** R$ ${somaCorretor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} a descontar dos corretores (de R$ ${somaTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} de comissão total paga a mais).`)
L.push('')
L.push('---')
L.push('')
for (const c of corretores) {
  L.push(`## ${c.corretor}`)
  L.push('')
  L.push(`**A descontar no repasse: R$ ${c.dif_parte_corretor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}** (${c.parcelas} parcelas em ${c.vendas.length} venda(s))`)
  L.push('')
  L.push('| Cliente | Unidade | Parcelas | Parte do corretor a mais | Comissão total a mais |')
  L.push('|---|---|---:|---:|---:|')
  for (const v of c.vendas.sort((a, b) => b.dif_parte_corretor - a.dif_parte_corretor)) {
    L.push(`| ${v.cliente || '-'} | ${v.unidade || '-'} | ${v.parcelas_pagas_erradas} | R$ ${v.dif_parte_corretor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | R$ ${v.dif_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} |`)
  }
  L.push('')
}
L.push('---')
L.push('')
L.push('*Observação: a "parte do corretor" assume o cargo Corretor padrão (interno 2,5% / externo 4%). Se algum corretor tem percentual diferente cadastrado, o número exato pode variar — me avisa que eu ajusto.*')
writeFileSync(`docs/relatorio-acerto-percentual-${data}.md`, L.join('\n'))

console.log(`Parcelas pagas erradas analisadas: ${totalParcelas}`)
console.log(`Corretores afetados: ${corretores.length}`)
console.log(`Soma comissao total paga a mais: R$ ${somaTotal.toFixed(2)}`)
console.log(`Soma PARTE DO CORRETOR a descontar: R$ ${somaCorretor.toFixed(2)}`)
console.log('')
console.log('Por corretor (parte do corretor a descontar):')
for (const c of corretores) console.log(`  ${c.corretor}: R$ ${c.dif_parte_corretor.toFixed(2)} (${c.parcelas} parcelas, ${c.vendas.length} vendas)`)
console.log(`\nSalvo: docs/relatorio-acerto-percentual-${data}.json + .md`)
