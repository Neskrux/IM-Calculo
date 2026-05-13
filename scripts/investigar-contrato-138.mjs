// Investiga por que o sales-contract Sienge 138 (Carolina, FIGUEIRA) nao
// veio pro banco local. Hipoteses:
//  - veio mas tah com excluido=true e outro corretor_id
//  - tah em RAW mas nao foi normalizado
//  - veio sob outro broker do sales-team

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
const CONTRACT_ID = 138

// 1. detalhe do contrato no Sienge
console.log('=== 1. SIENGE — detalhe do sales-contract 138 ===')
const resp = await siengeGet({ path: '/sales-contracts/138' })
const c = resp.data
console.log(`  number: ${c.number}`)
console.log(`  date: ${c.contractDate || c.date}`)
console.log(`  status: ${c.situation || c.contractStatus || c.status}`)
console.log(`  cancellationDate: ${c.cancellationDate}`)
console.log(`  cancellationReason: ${c.cancellationReason}`)
console.log(`  value: ${c.value || c.totalSellingValue}`)
console.log(`  enterpriseId: ${c.enterpriseId}`)
const unidades = (c.salesContractUnits || []).map(u => `${u.blockName || '-'}/${u.unitName || u.unitId}`).join(', ')
console.log(`  unidades: ${unidades}`)
const cliente = (c.salesContractCustomers || [])[0]
console.log(`  cliente: ${cliente ? `${cliente.name || cliente.fullName} (id=${cliente.id})` : 'sem cliente'}`)
const brokers = c.brokers || []
console.log(`  brokers:`)
for (const b of brokers) console.log(`    id=${b.id} name=${b.name} main=${b.main} commission=${b.commission}`)

// 2. existe alguma venda local com sienge_contract_id=138 (qualquer estado)?
console.log('\n=== 2. BANCO LOCAL — vendas com sienge_contract_id=138 ===')
const { data: vLocal } = await supa
  .from('vendas')
  .select('id, sienge_contract_id, corretor_id, excluido, status, data_venda, valor_venda')
  .eq('sienge_contract_id', '138')
console.log(`  registros: ${vLocal?.length || 0}`)
for (const v of vLocal || []) {
  console.log(`    ${v.id} corretor_id=${v.corretor_id} excluido=${v.excluido} status=${v.status} data=${v.data_venda} valor=${v.valor_venda}`)
}

// 3. tah em RAW (tabela sienge_raw_sales_contracts ou parecida)?
console.log('\n=== 3. RAW — tabelas que armazenam payloads ===')
const tabelas = ['sienge_raw_sales_contracts', 'sales_contracts_raw', 'raw_sales_contracts', 'sienge_raw']
for (const t of tabelas) {
  const { data, error } = await supa.from(t).select('*').limit(1)
  if (error) continue
  // se aceitou, tenta filtrar por contract id
  const { data: hit, error: errHit } = await supa.from(t).select('*').eq('id', 138).limit(1)
  if (!errHit && hit?.length) {
    console.log(`  ${t}: encontrado por id=138`)
    console.log(`    ${JSON.stringify(hit[0]).slice(0, 300)}...`)
    continue
  }
  // tenta payload->>id
  const { data: hit2, error: e2 } = await supa.from(t).select('*').filter('payload->>id', 'eq', '138').limit(1)
  if (!e2 && hit2?.length) {
    console.log(`  ${t}: encontrado via payload->>id`)
    console.log(`    ${JSON.stringify(hit2[0]).slice(0, 300)}...`)
  } else {
    console.log(`  ${t}: tabela existe mas contrato 138 NAO encontrado`)
  }
}
