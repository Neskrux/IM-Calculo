// Identifica o corretor que ficou com a venda 138 no banco local (em vez da
// Carolina, que e o broker correto no Sienge).
//
// ver .claude/rules/sincronizacao-sienge.md (vendas.corretor_id / origem)

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

const CORRETOR_ID = '8d364f54-cb5f-45ae-af2b-862c1694426e'
const VENDA_ID = '45ea6703-2e75-4c9a-a572-27710936f03b'

// quem eh
console.log('=== CORRETOR QUE FICOU COM A VENDA 138 ===')
const { data: u } = await supa.from('usuarios').select('*').eq('id', CORRETOR_ID).maybeSingle()
if (!u) console.log('  NAO ENCONTRADO')
else {
  console.log(`  ${u.nome}  (${u.email})`)
  console.log(`  tipo=${u.tipo}  tipo_corretor=${u.tipo_corretor}  ativo=${u.ativo}`)
  console.log(`  sienge_broker_id=${u.sienge_broker_id}  origem=${u.origem}`)
  console.log(`  created_at=${u.created_at}  updated_at=${u.updated_at}`)
}

// origem do corretor_id na venda
console.log('\n=== METADADOS DA VENDA 138 NO BANCO ===')
const { data: v } = await supa.from('vendas').select('*').eq('id', VENDA_ID).maybeSingle()
const camposChave = [
  'id', 'sienge_contract_id', 'numero_contrato', 'corretor_id', 'corretor_id_origem',
  'cliente_id', 'cliente_id_origem',
  'tipo_corretor', 'created_at', 'updated_at',
]
for (const c of camposChave) console.log(`  ${c}: ${JSON.stringify(v?.[c])}`)

// quantas vendas tem esse corretor "errado"
const { count: countDele } = await supa
  .from('vendas')
  .select('*', { count: 'exact', head: true })
  .eq('corretor_id', CORRETOR_ID)
console.log(`\n  vendas atribuidas a esse corretor no total: ${countDele}`)
