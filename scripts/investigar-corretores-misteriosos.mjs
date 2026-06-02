// Investiga UUIDs que aparecem como corretor_id em vendas mas nao foram
// retornados pelo filtro tipo=corretor + sienge_broker_id is not null.
//
// E quem sao os brokers Sienge sem cadastro local (358, 461, 352).

import { siengeGet } from './_sienge-http.mjs'
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

const UUIDS = [
  '8f1cfe8b-3ac7-4adb-a90d-a7f293fca237',
  '9b1f5c90-defa-4b6c-b011-ffb496a14349',
  '48a6d002-2203-471a-ad9a-f8226cfa509e',
]
console.log('=== UUIDs misteriosos (corretor_id em vendas, ausentes do filtro de corretor) ===')
for (const id of UUIDS) {
  const { data: u } = await supa.from('usuarios').select('*').eq('id', id).maybeSingle()
  if (!u) {
    console.log(`\n  ${id}: NAO EXISTE em usuarios`)
    continue
  }
  console.log(`\n  ${id}:`)
  console.log(`    nome: ${u.nome}`)
  console.log(`    email: ${u.email}`)
  console.log(`    tipo: ${u.tipo}  tipo_corretor: ${u.tipo_corretor}`)
  console.log(`    sienge_broker_id: ${u.sienge_broker_id}`)
  console.log(`    ativo: ${u.ativo}`)
  console.log(`    origem: ${u.origem}`)
}

console.log('\n\n=== BROKERS SIENGE SEM CADASTRO LOCAL (358, 461, 352) ===')
// Cada um nao tem cadastro em usuarios. Vou perguntar ao Sienge quem sao.
// Sienge nao tem endpoint /brokers/{id} de forma documentada, mas posso
// olhar o nome via /sales-contracts onde aparecem.
for (const id of [358, 461, 352]) {
  // tenta endpoint direto
  let nome = null
  try {
    const resp = await siengeGet({ path: `/creditors/${id}` })
    nome = resp.data?.name || resp.data?.tradeName || null
  } catch { /* nao eh creditor */ }
  console.log(`\n  broker ${id}: ${nome || '(nome nao recuperado via /creditors)'}`)
}
