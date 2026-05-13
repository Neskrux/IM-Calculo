// Conta vendas por corretora chamada Caroline/Carolina e compara com o que o
// relatorio gerado mostraria. Investigacao do relatorio incompleto.
//
// ver .claude/rules/visualizacao-totais.md

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

// 1. encontra todas as Carolines/Carolinas
const { data: carolines } = await supa
  .from('usuarios')
  .select('id, nome, email, tipo, tipo_corretor, ativo')
  .or('nome.ilike.%caroline%,nome.ilike.%carolina%,nome.ilike.%karoline%,nome.ilike.%karolina%')
  .eq('tipo', 'corretor')
console.log('=== CORRETORAS COM NOME CAROLINE/CAROLINA ===')
for (const c of carolines || []) {
  console.log(`  ${c.id}  ${c.nome}  (${c.email}, ${c.tipo_corretor || '-'}, ativo=${c.ativo})`)
}

// 2. pra cada uma, conta vendas no banco
console.log('\n=== VENDAS POR CORRETORA ===')
for (const c of carolines || []) {
  const { data: vendasTodas } = await supa
    .from('vendas')
    .select('id, sienge_contract_id, numero_contrato, unidade, valor_venda, excluido, status, data_venda, corretor_id_origem')
    .eq('corretor_id', c.id)
    .order('data_venda', { ascending: false })

  const ativas = (vendasTodas || []).filter(v => v.excluido !== true)
  const excluidas = (vendasTodas || []).filter(v => v.excluido === true)
  const distrato = (vendasTodas || []).filter(v => v.status === 'distrato')

  console.log(`\n${c.nome}  (${c.id})`)
  console.log(`  total no banco: ${vendasTodas?.length || 0}`)
  console.log(`  ativas (excluido!=true): ${ativas.length}`)
  console.log(`  excluidas: ${excluidas.length}`)
  console.log(`  com status=distrato: ${distrato.length}`)

  if (ativas.length > 0) {
    console.log(`  primeiras 5 ativas:`)
    for (const v of ativas.slice(0, 5)) {
      console.log(`    contract=${v.sienge_contract_id || '-'} num=${v.numero_contrato || '-'} unid=${v.unidade || '-'} valor=${v.valor_venda} data=${v.data_venda} status=${v.status || '-'}`)
    }
  }
}
