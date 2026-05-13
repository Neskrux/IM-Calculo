// Cadastra Gabriel Luz Imoveis (broker 156) e Paulo Chaves Jr (broker 144)
// como corretores externos, depois reatribui as 4 vendas que estavam
// atribuidas erroneamente.
//
// Dados vem do Sienge /creditors/{id}. Padrao de email igual ao da Carolina
// (corretor.{brokerId}@sync.local). origem='sienge'.
//
// Reatribuicoes:
//   contracts 224, 238, 264 -> Gabriel Luz Imoveis (broker 156)
//   contract  232           -> Paulo Sergio Chaves Jr (broker 144)
//
// Todas marcam corretor_id_origem='manual' pra proteger contra sync sobrescrever.

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

const novosCorretores = [
  {
    sienge_broker_id: '156',
    nome: 'GABRIEL LUZ IMOVEIS LTDA',
    email: 'corretor.156@sync.local',
    cnpj: '23100102000184',
    cpf: null,
    cidade: 'Itajaí',
  },
  {
    sienge_broker_id: '144',
    nome: 'PAULO SERGIO CHAVES JUNIOR',
    email: 'corretor.144@sync.local',
    cnpj: null,
    cpf: '01969283971',
    cidade: 'Itajaí',
  },
]

const reatribuicoes = [
  { vendaId: '5aac2bfc-6f68-45a8-872d-f3b5c3e0cc20', siengeContract: '224', brokerSienge: '156' },
  { vendaId: '20f053e6-2484-49d1-b290-e9e8fe73b3cf', siengeContract: '238', brokerSienge: '156' },
  { vendaId: '35b3be9c-d5e7-4a47-9e2e-85bac001dae0', siengeContract: '264', brokerSienge: '156' },
  { vendaId: '720346d5-c932-4710-81cd-92f3777c0c9b', siengeContract: '232', brokerSienge: '144' },
]

// 1. cadastra (idempotente — se ja existir com mesmo sienge_broker_id, pula)
console.log('=== 1. CADASTRAR CORRETORES ===')
for (const c of novosCorretores) {
  const { data: existente } = await supa.from('usuarios').select('id, nome').eq('sienge_broker_id', c.sienge_broker_id).maybeSingle()
  if (existente) {
    console.log(`  broker ${c.sienge_broker_id}: ja existe — ${existente.nome} (${existente.id})`)
    continue
  }
  // tenta os campos basicos primeiro; ajusta se DB rejeitar
  const row = {
    email: c.email,
    nome: c.nome,
    tipo: 'corretor',
    tipo_corretor: 'externo',
    ativo: true,
    sienge_broker_id: c.sienge_broker_id,
    origem: 'sienge',
    cidade: c.cidade,
    cpf: c.cpf,
  }
  // tenta com cnpj separado se houver
  if (c.cnpj) row.cnpj = c.cnpj

  const { data, error } = await supa.from('usuarios').insert(row).select('id, nome').maybeSingle()
  if (error) {
    // tenta sem cnpj se a coluna nao existir
    if (error.message?.includes('cnpj')) {
      delete row.cnpj
      const r2 = await supa.from('usuarios').insert(row).select('id, nome').maybeSingle()
      if (r2.error) { console.error(`  erro insert ${c.nome}:`, r2.error.message); continue }
      console.log(`  broker ${c.sienge_broker_id}: criado ${r2.data.nome} (${r2.data.id}) — sem cnpj`)
    } else {
      console.error(`  erro insert ${c.nome}:`, error.message)
      continue
    }
  } else {
    console.log(`  broker ${c.sienge_broker_id}: criado ${data.nome} (${data.id})`)
  }
}

// 2. reatribui vendas
console.log('\n=== 2. REATRIBUIR VENDAS ===')
async function getCorretorPorBroker(brokerId) {
  const { data } = await supa.from('usuarios').select('id, nome').eq('sienge_broker_id', String(brokerId)).maybeSingle()
  return data
}

for (const r of reatribuicoes) {
  const novo = await getCorretorPorBroker(r.brokerSienge)
  if (!novo) { console.error(`  broker ${r.brokerSienge} nao achado em usuarios — skip`); continue }
  const { data: antes } = await supa.from('vendas').select('corretor_id, corretor_id_origem').eq('id', r.vendaId).maybeSingle()
  if (!antes) { console.log(`  venda ${r.vendaId} nao encontrada`); continue }
  if (antes.corretor_id === novo.id && antes.corretor_id_origem === 'manual') {
    console.log(`  contract ${r.siengeContract}: ja corrigido`); continue
  }
  const { error } = await supa.from('vendas').update({ corretor_id: novo.id, corretor_id_origem: 'manual' }).eq('id', r.vendaId)
  if (error) { console.error(`  contract ${r.siengeContract}: erro`, error.message); continue }
  console.log(`  contract ${r.siengeContract}: ${antes.corretor_id} -> ${novo.nome} (${novo.id})  ✓`)
}

console.log('\nOK')
