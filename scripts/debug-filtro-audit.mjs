import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

for (const broker of ['156', '144']) {
  const { data } = await supa.from('usuarios').select('id, nome, email, tipo, tipo_corretor, ativo, sienge_broker_id').eq('sienge_broker_id', broker).maybeSingle()
  console.log(`broker ${broker}:`, data)
}

// Por que audit nao pegou: minha query foi
//   eq('tipo', 'corretor').not('sienge_broker_id', 'is', null)
// E retornou 66. Vou repetir e checar se 156 e 144 estao.
const { data: full } = await supa
  .from('usuarios')
  .select('id, nome, sienge_broker_id')
  .eq('tipo', 'corretor')
  .not('sienge_broker_id', 'is', null)
const tem156 = full.find(c => c.sienge_broker_id === '156')
const tem144 = full.find(c => c.sienge_broker_id === '144')
console.log(`\ntotal retornados pelo filtro audit: ${full.length}`)
console.log(`156 esta na lista? ${tem156 ? 'SIM' : 'NAO'}`)
console.log(`144 esta na lista? ${tem144 ? 'SIM' : 'NAO'}`)
