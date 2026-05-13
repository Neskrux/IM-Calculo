// Reproduz a mesma derivacao do relatorio PDF (gerarRelatorioPDF) pra Carolina Rita.
// Conta vendas dela vs vendas que apareceriam no PDF.
//
// ver src/pages/AdminDashboard.jsx:4028 (gerarRelatorioPDF) + .claude/rules/visualizacao-totais.md

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=')
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)
const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

const CAROLINA_ID = '4c04b405-d75b-4638-9dab-c149e563bc0c'

// vendas dela (mesmo filtro do fetchData: excluido=false ou null)
const { data: vendas } = await supa
  .from('vendas')
  .select('id, sienge_contract_id, numero_contrato, unidade, valor_venda, valor_pro_soluto, excluido, status, data_venda')
  .eq('corretor_id', CAROLINA_ID)
  .or('excluido.eq.false,excluido.is.null')
  .order('data_venda', { ascending: false })

console.log(`vendas da Carolina (excluido!=true): ${vendas.length}`)

// pagamentos de cada venda
console.log('\n=== AUDITORIA POR VENDA ===')
for (const v of vendas) {
  const { data: pags } = await supa
    .from('pagamentos_prosoluto')
    .select('id, status, valor, comissao_gerada, data_prevista, data_pagamento')
    .eq('venda_id', v.id)
  const pagos = pags.filter(p => p.status === 'pago')
  const pendentes = pags.filter(p => p.status === 'pendente')
  const totalComissao = pags.reduce((s, p) => s + (parseFloat(p.comissao_gerada) || 0), 0)

  console.log(`\nvenda ${v.id.slice(0, 8)}... contract=${v.sienge_contract_id} unid=${v.unidade}`)
  console.log(`  data_venda=${v.data_venda} status_venda=${v.status} valor=${v.valor_venda}`)
  console.log(`  pagamentos total: ${pags.length} (pagos=${pagos.length} pendentes=${pendentes.length})`)
  console.log(`  soma comissao gerada: R$ ${totalComissao.toFixed(2)}`)

  // simula o filtro: aparece no PDF se tem pelo menos 1 pagamento
  if (pags.length === 0) {
    console.log('  ⚠️ NAO APARECE NO PDF — sem pagamentos em pagamentos_prosoluto')
  }
}

// pra cada filtro do relatorio que pode esconder vendas:
console.log('\n=== HIPOTESES DE FILTRO ESCONDENDO VENDAS ===')

// Hipotese 1: vendas sem pagamentos
const vendasSemPag = []
for (const v of vendas) {
  const { count } = await supa
    .from('pagamentos_prosoluto')
    .select('*', { count: 'exact', head: true })
    .eq('venda_id', v.id)
  if (count === 0) vendasSemPag.push(v)
}
console.log(`vendas SEM pagamento (sumiriam do PDF): ${vendasSemPag.length}`)
for (const v of vendasSemPag) {
  console.log(`  - contract=${v.sienge_contract_id} unid=${v.unidade} data=${v.data_venda}`)
}

// Hipotese 2: vendas com apenas pagamentos pendentes — se filtro status='pago', somem
const vendasSoPendente = []
for (const v of vendas) {
  const { count: totalCount } = await supa
    .from('pagamentos_prosoluto')
    .select('*', { count: 'exact', head: true })
    .eq('venda_id', v.id)
  const { count: pagoCount } = await supa
    .from('pagamentos_prosoluto')
    .select('*', { count: 'exact', head: true })
    .eq('venda_id', v.id)
    .eq('status', 'pago')
  if (totalCount > 0 && pagoCount === 0) vendasSoPendente.push(v)
}
console.log(`\nvendas SO COM pagamentos pendentes (sumiriam se filtro=pago): ${vendasSoPendente.length}`)
for (const v of vendasSoPendente) {
  console.log(`  - contract=${v.sienge_contract_id} unid=${v.unidade}`)
}
