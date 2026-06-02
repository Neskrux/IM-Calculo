// Caso A: existe um cadastro local "MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS"
// com tipo_corretor='interno' e sienge_broker_id=null. No Sienge, broker
// 118 tem o mesmo nome. Sao a mesma pessoa? Vou olhar:
//  - email/CPF/CNPJ do local
//  - dados do broker 118 no Sienge
//  - vendas atribuidas ao UUID local vs ao broker 118

import { siengeGet } from './_sienge-http.mjs'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

const UUID_LOCAL = '9b1f5c90-defa-4b6c-b011-ffb496a14349'
console.log('=== CADASTRO LOCAL ===')
const { data: u } = await supa.from('usuarios').select('*').eq('id', UUID_LOCAL).maybeSingle()
for (const [k,v] of Object.entries(u || {})) {
  if (v != null && v !== '' && v !== false) console.log(`  ${k}: ${JSON.stringify(v)}`)
}

console.log('\n=== BROKER 118 NO SIENGE ===')
try {
  const r = await siengeGet({ path: '/creditors/118' })
  const c = r.data
  console.log(`  name: ${c?.name}`)
  console.log(`  tradeName: ${c?.tradeName}`)
  console.log(`  cpf: ${c?.cpf}`)
  console.log(`  cnpj: ${c?.cnpj}`)
  console.log(`  email: ${c?.email}`)
  console.log(`  city: ${c?.city || c?.address?.cityName}`)
} catch (err) {
  console.log(`  erro: ${err.message.slice(0,150)}`)
}

console.log('\n=== VENDAS ATRIBUIDAS AO UUID LOCAL ===')
const { data: vendasLocal } = await supa.from('vendas').select('sienge_contract_id, valor_venda, data_venda, excluido').eq('corretor_id', UUID_LOCAL).or('excluido.eq.false,excluido.is.null')
console.log(`  total: ${vendasLocal.length}`)
for (const v of vendasLocal) console.log(`    contract=${v.sienge_contract_id} valor=${v.valor_venda} data=${v.data_venda}`)
