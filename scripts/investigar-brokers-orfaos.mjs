// Brokers Sienge (358 Felicita, 461 Maicom Iaroch, 352 Erica Faerber) que tem
// contratos em FIGUEIRA mas nao tem cadastro local com sienge_broker_id.
// Pra cada um, ver:
//  - dados completos no Sienge (/creditors/{id})
//  - contratos no Sienge atribuidos a eles
//  - se essas vendas estao no banco local, sob qual corretor

import { siengeGet, extractRows } from './_sienge-http.mjs'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

const BROKERS = [358, 461, 352]

// 1. dados do Sienge
for (const id of BROKERS) {
  console.log(`\n=== BROKER ${id} ===`)
  try {
    const r = await siengeGet({ path: `/creditors/${id}` })
    const c = r.data
    console.log(`  name: ${c?.name}`)
    console.log(`  cpf: ${c?.cpf}  cnpj: ${c?.cnpj}`)
    console.log(`  city: ${c?.city || c?.address?.cityName}`)
  } catch (err) {
    console.log(`  erro: ${err.message.slice(0,150)}`)
  }
}

// 2. paginar Figueira e listar contratos que tem esses brokers
console.log('\n=== CONTRATOS FIGUEIRA COM ESSES BROKERS ===')
let offset = 0
const limit = 200
const achados = []
while (true) {
  const resp = await siengeGet({ path: '/sales-contracts', query: { enterpriseId: 2104, limit, offset } })
  const rows = extractRows(resp.data)
  if (rows.length === 0) break
  for (const r of rows) {
    const brokers = Array.isArray(r.brokers) ? r.brokers : []
    const main = brokers.find(b => b.main) ?? brokers[0]
    if (main && BROKERS.includes(Number(main.id))) {
      achados.push({ brokerId: main.id, contractId: r.id, contractNumber: r.number, value: r.value, date: r.contractDate })
    }
  }
  if (rows.length < limit) break
  offset += limit
}
for (const a of achados) console.log(`  broker ${a.brokerId} -> contract ${a.contractId} (num=${a.contractNumber}, R$ ${a.value}, ${a.date})`)

// 3. Pra cada contrato, ver onde foi parar no banco
console.log('\n=== ONDE ESSES CONTRATOS FORAM PARAR NO BANCO ===')
for (const a of achados) {
  const { data: v } = await supa.from('vendas').select('id, corretor_id, corretor_id_origem, excluido').eq('sienge_contract_id', String(a.contractId)).maybeSingle()
  if (!v) { console.log(`  contract ${a.contractId} (broker ${a.brokerId}): NAO NO BANCO`); continue }
  const { data: u } = v.corretor_id ? await supa.from('usuarios').select('nome, sienge_broker_id').eq('id', v.corretor_id).maybeSingle() : { data: null }
  console.log(`  contract ${a.contractId} (broker ${a.brokerId} Sienge): banco=${u?.nome || '(NULL)'} (sienge_broker_id=${u?.sienge_broker_id || '-'}) origem=${v.corretor_id_origem} excluido=${v.excluido}`)
}
