// Olha campos do Sienge no perfil da Carolina + busca vestigios dela em
// tabelas raw (sales-contracts/income) pra ver se ha vendas em outros
// empreendimentos que nao entraram no escopo de sync (FIGUEIRA = enterpriseId=2104).
//
// ver .claude/rules/sincronizacao-sienge.md

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

// 1. perfil completo da Carolina
const { data: u } = await supa.from('usuarios').select('*').eq('id', CAROLINA_ID).maybeSingle()
console.log('=== PERFIL CAROLINA (todas as colunas) ===')
for (const [k, v] of Object.entries(u || {})) {
  if (v != null && v !== '' && v !== false) console.log(`  ${k}: ${JSON.stringify(v)}`)
}

// 2. todas as vendas dela (sem filtro de excluido)
const { data: vendas } = await supa
  .from('vendas')
  .select('id, sienge_contract_id, empreendimento_id, unidade, valor_venda, excluido, data_venda')
  .eq('corretor_id', CAROLINA_ID)
const { data: emps } = await supa.from('empreendimentos').select('id, nome')
const empMap = new Map((emps || []).map(e => [e.id, e.nome]))
console.log(`\n=== VENDAS DELA NO BANCO (todas, inclusive excluidas) ===`)
for (const v of vendas || []) {
  console.log(`  ${v.sienge_contract_id || '-'} | ${empMap.get(v.empreendimento_id) || v.empreendimento_id} | unid ${v.unidade} | ${v.data_venda} | excluido=${v.excluido}`)
}

// 3. tabela raw de sales-contracts (se existir) — checa por nome do corretor
const tabelasPossiveis = [
  'sienge_sales_contracts_raw',
  'sales_contracts_raw',
  'raw_sales_contracts',
  'sienge_raw_sales_contracts',
]
console.log('\n=== TABELAS RAW DE SALES-CONTRACTS ===')
for (const t of tabelasPossiveis) {
  const { count, error } = await supa.from(t).select('*', { count: 'exact', head: true })
  if (!error) {
    console.log(`  ${t}: existe (${count} linhas)`)
  } else if (error.code === '42P01' || error.message?.includes('does not exist') || error.code === 'PGRST205') {
    // tabela nao existe — silencioso
  } else {
    console.log(`  ${t}: erro ${error.code} ${error.message}`)
  }
}
