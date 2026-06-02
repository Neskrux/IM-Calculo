// Varredura: vendas cujo percentual_comissao_total dos pagamentos NAO bate
// com o tipo_corretor da venda.
//   interno -> deveria ser 6.5
//   externo -> deveria ser 7
//
// Origem: gestora reportou em 2026-05-14 que a venda THAINARA (903 A, interno)
// estava com pagamentos gerados a 7% (externo). Causa: mudanca de tipo_corretor
// sem regeneracao da grade. Ver CLAUDE.md "P3 — vendas divergentes".
//
// READ-ONLY. Saida: docs/varredura-percentual-vs-tipo-{date}.json
// Spec: .claude/rules/fator-comissao.md, .claude/rules/sincronizacao-sienge.md

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

const PCT_ESPERADO = { interno: 6.5, externo: 7 }

// 1. carregar vendas (id, tipo_corretor, valores)
console.log('=== 1. Carregando vendas ===')
const vendas = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supa
    .from('vendas')
    .select('id, sienge_contract_id, numero_contrato, unidade, tipo_corretor, valor_venda, valor_pro_soluto, fator_comissao, cliente_id, corretor_id, excluido')
    .or('excluido.eq.false,excluido.is.null')
    .range(from, from + 999)
  if (error) { console.error('erro:', error); process.exit(1) }
  if (!data?.length) break
  vendas.push(...data)
  if (data.length < 1000) break
}
console.log(`  vendas ativas: ${vendas.length}`)
const vendaMap = new Map(vendas.map((v) => [v.id, v]))

// 2. carregar pagamentos (id, venda_id, status, percentual_comissao_total, comissao_gerada, valor)
console.log('=== 2. Carregando pagamentos ===')
const pagamentos = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supa
    .from('pagamentos_prosoluto')
    .select('id, venda_id, status, percentual_comissao_total, comissao_gerada, valor, fator_comissao_aplicado')
    .range(from, from + 999)
  if (error) { console.error('erro:', error); process.exit(1) }
  if (!data?.length) break
  pagamentos.push(...data)
  if (data.length < 1000) break
}
console.log(`  pagamentos: ${pagamentos.length}`)

// 3. agrupar pagamentos por venda, detectar divergencia
const porVenda = new Map()
for (const p of pagamentos) {
  if (!porVenda.has(p.venda_id)) porVenda.set(p.venda_id, [])
  porVenda.get(p.venda_id).push(p)
}

const casos = []
for (const [vid, ps] of porVenda.entries()) {
  const v = vendaMap.get(vid)
  if (!v) continue // venda excluida ou nao carregada
  const tipo = v.tipo_corretor
  const esperado = PCT_ESPERADO[tipo]
  if (esperado == null) continue // tipo desconhecido — ignora

  // percentuais distintos encontrados nos pagamentos ativos
  const ativos = ps.filter((p) => p.status !== 'cancelado')
  const pctSet = new Map() // pct -> count
  for (const p of ativos) {
    const pct = p.percentual_comissao_total == null ? 'null' : Number(p.percentual_comissao_total)
    pctSet.set(pct, (pctSet.get(pct) || 0) + 1)
  }
  // divergente se algum pct != esperado (e nao null)
  const pctsDivergentes = [...pctSet.keys()].filter((pct) => pct !== 'null' && Number(pct) !== esperado)
  if (pctsDivergentes.length === 0) continue

  const pagos = ativos.filter((p) => p.status === 'pago')
  const comissaoAtual = ativos.reduce((s, p) => s + Number(p.comissao_gerada || 0), 0)
  // comissao correta estimada: valor * fator canonico com pct esperado
  const fatorCorreto =
    Number(v.valor_pro_soluto) > 0 ? (Number(v.valor_venda) * (esperado / 100)) / Number(v.valor_pro_soluto) : 0
  const comissaoCorretaEstimada = ativos.reduce((s, p) => s + Number(p.valor || 0) * fatorCorreto, 0)

  casos.push({
    venda_id: vid,
    sienge_contract_id: v.sienge_contract_id,
    numero_contrato: v.numero_contrato,
    unidade: v.unidade,
    cliente_id: v.cliente_id,
    tipo_corretor: tipo,
    pct_esperado: esperado,
    pcts_encontrados: Object.fromEntries(pctSet),
    pcts_divergentes: pctsDivergentes,
    total_pagamentos_ativos: ativos.length,
    pagos: pagos.length,
    comissao_atual: Number(comissaoAtual.toFixed(2)),
    comissao_correta_estimada: Number(comissaoCorretaEstimada.toFixed(2)),
    diferenca: Number((comissaoAtual - comissaoCorretaEstimada).toFixed(2)),
  })
}

casos.sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca))

// 4. enriquecer com nome do cliente
const clienteIds = [...new Set(casos.map((c) => c.cliente_id).filter(Boolean))]
const clientes = new Map()
for (let i = 0; i < clienteIds.length; i += 100) {
  const { data } = await supa.from('clientes').select('id, nome_completo').in('id', clienteIds.slice(i, i + 100))
  for (const c of data || []) clientes.set(c.id, c.nome_completo)
}
for (const c of casos) c.cliente = clientes.get(c.cliente_id) || null

const data = new Date().toISOString().slice(0, 10)
const totalDif = casos.reduce((s, c) => s + c.diferenca, 0)
const out = {
  meta: {
    geradoEm: new Date().toISOString(),
    regra: 'percentual_comissao_total dos pagamentos != esperado pelo tipo_corretor (interno=6.5, externo=7)',
    total_vendas_divergentes: casos.length,
    soma_diferenca_comissao: Number(totalDif.toFixed(2)),
  },
  casos,
}
writeFileSync(`docs/varredura-percentual-vs-tipo-${data}.json`, JSON.stringify(out, null, 2))

console.log(`\n=== Resultado ===`)
console.log(`  vendas com percentual divergente do tipo_corretor: ${casos.length}`)
console.log(`  soma da diferenca de comissao: R$ ${totalDif.toFixed(2)}`)
const comPagos = casos.filter((c) => c.pagos > 0).length
console.log(`  dessas, com parcelas ja pagas: ${comPagos} (correcao precisa de revisao humana)`)
console.log(`\n  Top 15 por diferenca:`)
console.log('  contrato | unidade  | tipo    | pct encontrado->esperado | pagos | comissao atual -> correta | dif')
for (const c of casos.slice(0, 15)) {
  console.log(
    `  ${String(c.sienge_contract_id || '-').padStart(8)} | ${(c.unidade || '-').padEnd(8)} | ${(c.tipo_corretor || '-').padEnd(7)} | ` +
      `${c.pcts_divergentes.join(',')}->${c.pct_esperado} | ${String(c.pagos).padStart(5)} | ` +
      `${String(c.comissao_atual).padStart(10)} -> ${String(c.comissao_correta_estimada).padStart(10)} | ${c.diferenca > 0 ? '+' : ''}${c.diferenca}`,
  )
}
console.log(`\nSalvo: docs/varredura-percentual-vs-tipo-${data}.json`)
