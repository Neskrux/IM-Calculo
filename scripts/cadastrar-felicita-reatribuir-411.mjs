// Cadastra Felicita Imobiliaria (broker Sienge 358) e reatribui o contract 411.
// Dados do Sienge: CNPJ 42.172.021/0004-87, Balneario Camboriu.
//
// Padrao: email corretor.{brokerId}@sync.local, origem='sienge',
// tipo_corretor='externo'. Mesmo padrao usado pra Gabriel Luz e Paulo Chaves.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

const BROKER_ID = '358'
const NOME = 'FELICITA IMOBILIARIA LTDA'
const EMAIL = 'corretor.358@sync.local'
const CNPJ = '42172021000487'
const CIDADE = 'Balneário Camboriú'
const CONTRACT_411_VENDA_ID = 'c3650d6d-f1e8-4afe-ad0f-f8ee30c19a16'

// 1. cadastra (idempotente)
console.log('=== 1. Cadastrar Felicita Imobiliaria ===')
const { data: existente } = await supa.from('usuarios').select('id, nome').eq('sienge_broker_id', BROKER_ID).maybeSingle()
let felicitaId
if (existente) {
  felicitaId = existente.id
  console.log(`  ja existe: ${existente.nome} (${existente.id})`)
} else {
  const row = {
    email: EMAIL,
    nome: NOME,
    tipo: 'corretor',
    tipo_corretor: 'externo',
    ativo: true,
    sienge_broker_id: BROKER_ID,
    origem: 'sienge',
    cidade: CIDADE,
    cnpj: CNPJ,
  }
  const { data, error } = await supa.from('usuarios').insert(row).select('id, nome').maybeSingle()
  if (error) { console.error('erro insert:', error); process.exit(1) }
  felicitaId = data.id
  console.log(`  criado: ${data.nome} (${data.id})`)
}

// 2. reatribuir contract 411
console.log('\n=== 2. Reatribuir contract 411 ===')
const { data: vAntes } = await supa.from('vendas').select('id, sienge_contract_id, corretor_id, corretor_id_origem').eq('id', CONTRACT_411_VENDA_ID).maybeSingle()
console.log('antes:', vAntes)
if (vAntes?.corretor_id === felicitaId && vAntes?.corretor_id_origem === 'manual') {
  console.log('  ja corrigido — skip')
} else {
  const { data: vDepois, error } = await supa
    .from('vendas')
    .update({ corretor_id: felicitaId, corretor_id_origem: 'manual' })
    .eq('id', CONTRACT_411_VENDA_ID)
    .select('id, corretor_id, corretor_id_origem')
    .maybeSingle()
  if (error) { console.error('erro:', error); process.exit(1) }
  console.log('depois:', vDepois)
}

console.log('\nOK.')
