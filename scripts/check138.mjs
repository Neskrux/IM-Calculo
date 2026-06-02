import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const { data: pags } = await supa.from('pagamentos_prosoluto').select('status, tipo, valor, comissao_gerada, data_pagamento').eq('venda_id', '45ea6703-2e75-4c9a-a572-27710936f03b')
const pagos = pags.filter(p=>p.status==='pago')
const pendentes = pags.filter(p=>p.status==='pendente')
console.log(`pagamentos venda 138: ${pags.length} (pagos=${pagos.length} pendentes=${pendentes.length})`)
console.log(`soma comissao gerada total: R$ ${pags.reduce((s,p)=>s+(+p.comissao_gerada||0),0).toFixed(2)}`)
console.log(`soma comissao ja paga: R$ ${pagos.reduce((s,p)=>s+(+p.comissao_gerada||0),0).toFixed(2)}`)
console.log('\npagos:')
for (const p of pagos) console.log(`  ${p.tipo} valor=${p.valor} comissao=${p.comissao_gerada} data=${p.data_pagamento}`)
