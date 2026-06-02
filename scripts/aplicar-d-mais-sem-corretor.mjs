// Aplica 5 correcoes diretas em vendas.corretor_id, todas com cadastro local
// correto via sienge_broker_id:
//
//  - contract 350: Luiz Corazza -> Felipe Madona  (caso D)
//  - contract 433: NULL -> Watson Slonski
//  - contract 434: NULL -> Watson Slonski
//  - contract 435: NULL -> Watson Slonski
//  - contract 75:  NULL -> Felipe Madona
//
// Em todas, corretor_id_origem='manual' pra proteger contra sync sobrescrever
// (migration 021 + .claude/rules/sincronizacao-sienge.md).
// Pagamentos nao sao alterados.

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

// Pega usuarios.id por sienge_broker_id
async function getCorretorPorBroker(brokerId) {
  const { data, error } = await supa
    .from('usuarios')
    .select('id, nome, tipo_corretor')
    .eq('sienge_broker_id', String(brokerId))
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`Broker ${brokerId} sem cadastro local`)
  return data
}

const correcoes = [
  { vendaId: '31c1233c-989a-40c1-a36d-895b699e9d83', siengeContract: '350', brokerSienge: 111, descricao: 'Caso D — Felipe Madona' },
  { vendaId: 'c8b843f9-7133-4720-8b3e-89517bb83ad2', siengeContract: '434', brokerSienge: null, descricao: 'sem corretor — Watson Slonski' },
  { vendaId: '22d30cd4-bbca-47d5-9d73-7008d1b36db9', siengeContract: '435', brokerSienge: null, descricao: 'sem corretor — Watson Slonski' },
  { vendaId: '73bdb2c7-b89c-45ef-84ed-156a6c24e4b1', siengeContract: '75',  brokerSienge: 111, descricao: 'sem corretor — Felipe Madona' },
  { vendaId: '63229ab7-b4e1-4484-9c9a-ab08cd3832a0', siengeContract: '433', brokerSienge: null, descricao: 'sem corretor — Watson Slonski' },
]

// Encontrar Watson Slonski (e Felipe pra confirmar)
const watson = (await supa.from('usuarios').select('id, nome, sienge_broker_id').ilike('nome', '%watson%slonski%').limit(1).maybeSingle()).data
if (!watson) { console.error('Watson Slonski nao achado'); process.exit(1) }
console.log('Watson Slonski:', watson)

for (const c of correcoes) {
  // resolve broker
  let novoCorretor
  if (c.brokerSienge === 111) novoCorretor = await getCorretorPorBroker(111)
  else if (c.brokerSienge === null) novoCorretor = watson
  if (!novoCorretor) { console.error(`Nao resolvido: ${c.descricao}`); continue }

  // antes
  const { data: antes } = await supa.from('vendas').select('id, corretor_id, corretor_id_origem').eq('id', c.vendaId).maybeSingle()
  if (!antes) { console.log(`  venda ${c.vendaId} nao encontrada — skip`); continue }
  if (antes.corretor_id === novoCorretor.id && antes.corretor_id_origem === 'manual') {
    console.log(`  contract ${c.siengeContract}: ja corrigido — skip`)
    continue
  }

  const { data: depois, error } = await supa
    .from('vendas')
    .update({ corretor_id: novoCorretor.id, corretor_id_origem: 'manual' })
    .eq('id', c.vendaId)
    .select('id, corretor_id, corretor_id_origem')
    .maybeSingle()
  if (error) { console.error(`erro ${c.siengeContract}:`, error); continue }
  console.log(`  contract ${c.siengeContract}: ${antes.corretor_id || 'NULL'} -> ${novoCorretor.nome} (${novoCorretor.id})  ✓`)
}

console.log('\nOK — 5 correcoes processadas. Pagamentos preservados.')
