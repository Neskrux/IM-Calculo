import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

console.log('=== 3 VENDAS SEM CORRETOR_ID (remanescentes) ===')
const { data: semCorr } = await supa.from('vendas').select('id, sienge_contract_id, valor_venda, data_venda, corretor_id_origem').is('corretor_id', null).or('excluido.eq.false,excluido.is.null')
for (const v of semCorr || []) console.log(`  ${v.id} | contract=${v.sienge_contract_id} | R$ ${v.valor_venda} | ${v.data_venda} | origem=${v.corretor_id_origem}`)

console.log('\n=== 26 PAGAMENTOS SEM data_prevista ===')
const { data: semPrev } = await supa.from('pagamentos_prosoluto').select('id, venda_id, tipo, status, valor, data_pagamento').is('data_prevista', null).limit(30)
const porStatus = (semPrev || []).reduce((a,p)=>{a[p.status]=(a[p.status]||0)+1;return a},{})
const porTipo = (semPrev || []).reduce((a,p)=>{a[p.tipo]=(a[p.tipo]||0)+1;return a},{})
console.log(`  por status: ${JSON.stringify(porStatus)}`)
console.log(`  por tipo: ${JSON.stringify(porTipo)}`)
console.log('  exemplos:')
for (const p of (semPrev || []).slice(0,10)) console.log(`    ${p.id} venda=${p.venda_id?.slice(0,8)} tipo=${p.tipo} status=${p.status} valor=${p.valor} data_pagamento=${p.data_pagamento}`)

console.log('\n=== MAICON IAROCH local — verificar se eh o Maicom 461 do Sienge ===')
const { data: maicon } = await supa.from('usuarios').select('id, nome, email, cpf, cidade, sienge_broker_id, origem').eq('id', '8f1cfe8b-3ac7-4adb-a90d-a7f293fca237').maybeSingle()
console.log(`  ${maicon?.nome}`)
console.log(`  cpf local: ${maicon?.cpf || '(vazio)'}  cpf Sienge 461: 031.620.719-50`)
console.log(`  cidade local: ${maicon?.cidade}`)
console.log(`  origem local: ${maicon?.origem}`)
console.log(`  sienge_broker_id local: ${maicon?.sienge_broker_id || '(NULL)'}`)

console.log('\n=== ERICA FAERBER local — verificar se eh a 352 do Sienge ===')
const { data: vEntrega } = await supa.from('vendas').select('corretor_id').eq('sienge_contract_id','390').maybeSingle()
if (vEntrega?.corretor_id) {
  const { data: erica } = await supa.from('usuarios').select('id, nome, cpf, cidade, sienge_broker_id, origem').eq('id', vEntrega.corretor_id).maybeSingle()
  console.log(`  ${erica?.nome}`)
  console.log(`  cpf local: ${erica?.cpf || '(vazio)'}  cpf Sienge 352: 630.525.479-68`)
  console.log(`  cidade local: ${erica?.cidade}`)
  console.log(`  origem local: ${erica?.origem}`)
  console.log(`  sienge_broker_id local: ${erica?.sienge_broker_id || '(NULL)'}`)
}

console.log('\n=== VERIFICAR SE AS 10 VENDAS COM ORIGEM=MANUAL ESTAO PROTEGIDAS ===')
const { data: manuais } = await supa.from('vendas').select('id, sienge_contract_id, corretor_id_origem').eq('corretor_id_origem','manual')
console.log(`  total: ${manuais.length}`)
for (const v of manuais) console.log(`    contract=${v.sienge_contract_id} origem=${v.corretor_id_origem}`)
