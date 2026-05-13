// Vincula sienge_broker_id=118 no cadastro local do Matheus Pires.
// Duplicata confirmada via CNPJ idêntico 60.509.941/0001-87.
//
// Nao mexe em tipo_corretor (esta como 'interno' localmente — decisao de
// controladoria se mantem ou muda). Apenas vincula broker_id pra que o
// proximo sync nao crie outro cadastro nem deixe vendas dele orfas.
//
// Tambem marca corretor_id_origem='manual' na venda 176 — protecao
// transicional ate o fix do sync (sales-contracts.ts) ser deployado.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

const MATHEUS_ID = '9b1f5c90-defa-4b6c-b011-ffb496a14349'
const VENDA_176_ID = '62d4b34f-232f-4251-8ab1-9be0b87128e2'

// 1. vincular broker_id no cadastro
console.log('=== 1. Vincular sienge_broker_id=118 no Matheus Pires ===')
const { data: antes } = await supa.from('usuarios').select('id, nome, sienge_broker_id, tipo_corretor').eq('id', MATHEUS_ID).maybeSingle()
console.log('antes:', antes)
if (antes?.sienge_broker_id) {
  console.log('  ja vinculado — skip')
} else {
  const { data: depois, error } = await supa
    .from('usuarios')
    .update({ sienge_broker_id: '118' })
    .eq('id', MATHEUS_ID)
    .select('id, nome, sienge_broker_id, tipo_corretor')
    .maybeSingle()
  if (error) { console.error('erro:', error); process.exit(1) }
  console.log('depois:', depois)
}

// 2. marcar origem='manual' na venda 176
console.log('\n=== 2. Proteger venda 176 (corretor_id_origem=manual) ===')
const { data: vAntes } = await supa.from('vendas').select('id, sienge_contract_id, corretor_id, corretor_id_origem').eq('id', VENDA_176_ID).maybeSingle()
console.log('antes:', vAntes)
if (vAntes?.corretor_id_origem === 'manual') {
  console.log('  ja protegida — skip')
} else {
  const { data: vDepois, error } = await supa
    .from('vendas')
    .update({ corretor_id_origem: 'manual' })
    .eq('id', VENDA_176_ID)
    .select('id, corretor_id, corretor_id_origem')
    .maybeSingle()
  if (error) { console.error('erro:', error); process.exit(1) }
  console.log('depois:', vDepois)
}

console.log('\nOK. Matheus Pires vinculado ao broker 118 + venda 176 protegida.')
console.log('Observacao: tipo_corretor permanece "interno" no banco — controladoria decide se reclassifica pra externo.')
