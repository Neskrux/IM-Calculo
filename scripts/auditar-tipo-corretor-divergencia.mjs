// Lista corretores onde usuarios.tipo_corretor != vendas.tipo_corretor.
// Caso classico: corretor reclassificado em usuarios (ex.: externo->interno)
// mas vendas dele ainda tem tipo_corretor='externo' porque o sync gravou antes
// e nao reprocessou. Afeta calculo de comissao (percentual interno x externo
// no empreendimento).
//
// Tambem destaca corretores com tipo_corretor='interno' E imobiliaria definida
// (combinacao suspeita — imobiliaria geralmente eh externo).

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

// 1. corretores INTERNOS no banco
const { data: internos } = await supa
  .from('usuarios')
  .select('id, nome, email, tipo_corretor, imobiliaria, sienge_broker_id, origem, updated_at')
  .eq('tipo', 'corretor')
  .eq('tipo_corretor', 'interno')
console.log(`=== CORRETORES INTERNOS no banco: ${internos.length} ===`)
for (const c of internos) {
  console.log(`  ${c.nome}  email=${c.email}  imobiliaria=${c.imobiliaria || '-'}  broker=${c.sienge_broker_id || '-'}  origem=${c.origem}  updated=${c.updated_at}`)
}

// 2. Pra cada interno, ver as vendas dele e o tipo_corretor de cada
console.log('\n=== DIVERGENCIAS vendas.tipo_corretor != usuarios.tipo_corretor ===')
const divergencias = []
for (const c of internos) {
  const { data: vendas } = await supa
    .from('vendas')
    .select('id, sienge_contract_id, tipo_corretor, valor_venda, data_venda, corretor_id_origem')
    .eq('corretor_id', c.id)
    .or('excluido.eq.false,excluido.is.null')
  const vendasExternas = (vendas || []).filter(v => v.tipo_corretor === 'externo')
  if (vendasExternas.length > 0) {
    divergencias.push({ corretor: c, vendas: vendas, externas: vendasExternas })
    console.log(`\n  ${c.nome}  (interno em usuarios, broker=${c.sienge_broker_id || '-'})`)
    console.log(`    vendas total: ${vendas.length}  | divergentes (vendas.tipo_corretor='externo'): ${vendasExternas.length}`)
    for (const v of vendasExternas.slice(0, 5)) {
      console.log(`      contract=${v.sienge_contract_id} R$ ${v.valor_venda} data=${v.data_venda} origem=${v.corretor_id_origem}`)
    }
    if (vendasExternas.length > 5) console.log(`      ... + ${vendasExternas.length - 5}`)
  }
}

if (divergencias.length === 0) {
  console.log('\n  ✓ nenhuma divergencia entre tipo_corretor de usuarios e vendas')
}

// 3. Para cada divergencia, calcular impacto financeiro: comissao usaria
// percentual diferente
console.log('\n=== IMPACTO FINANCEIRO POR DIVERGENCIA ===')
const { data: emps } = await supa.from('empreendimentos').select('id, nome, comissao_total_externo, comissao_total_interno')
const empById = new Map((emps || []).map(e => [e.id, e]))
for (const d of divergencias) {
  let totalAtual = 0  // soma de comissao_gerada nos pagamentos
  for (const v of d.externas) {
    const { data: pags } = await supa
      .from('pagamentos_prosoluto')
      .select('comissao_gerada')
      .eq('venda_id', v.id)
    totalAtual += (pags || []).reduce((s, p) => s + (parseFloat(p.comissao_gerada) || 0), 0)
  }
  console.log(`\n  ${d.corretor.nome}: soma de comissao_gerada em vendas divergentes = R$ ${totalAtual.toFixed(2)}`)
  console.log(`    NOTA: se reprocessar como interno, valores das comissoes pendentes mudam (% interno != % externo).`)
  console.log(`          comissoes ja pagas (snapshot fator_comissao_aplicado) ficam preservadas pelo trigger 017/018.`)
}
