// Checagens de integridade do banco. Roda invariantes da spec sincronizacao-sienge.md
// e captura a foto atual dos dados.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

async function count(table, modifier) {
  let q = supa.from(table).select('*', { count: 'exact', head: true })
  if (modifier) q = modifier(q)
  const { count, error } = await q
  if (error) return `ERRO: ${error.message}`
  return count
}

console.log('=== TOTAIS ===')
console.log(`vendas (todas): ${await count('vendas')}`)
console.log(`vendas (ativas excluido!=true): ${await count('vendas', q => q.or('excluido.eq.false,excluido.is.null'))}`)
console.log(`vendas (excluido=true): ${await count('vendas', q => q.eq('excluido', true))}`)
console.log(`pagamentos_prosoluto (todos): ${await count('pagamentos_prosoluto')}`)
console.log(`usuarios (corretor): ${await count('usuarios', q => q.eq('tipo','corretor'))}`)
console.log(`empreendimentos: ${await count('empreendimentos')}`)
console.log(`clientes: ${await count('clientes')}`)

console.log('\n=== INVARIANTES (devem ser zero) ===')
const pagSemData = await count('pagamentos_prosoluto', q => q.eq('status','pago').is('data_pagamento', null))
console.log(`pagamentos status=pago SEM data_pagamento: ${pagSemData}  ${pagSemData === 0 ? '✓' : '⚠️'}`)
const pendComData = await count('pagamentos_prosoluto', q => q.eq('status','pendente').not('data_pagamento','is',null))
console.log(`pagamentos status=pendente COM data_pagamento: ${pendComData}  ${pendComData === 0 ? '✓' : '⚠️'}`)
const pagSemPrev = await count('pagamentos_prosoluto', q => q.is('data_prevista', null))
console.log(`pagamentos SEM data_prevista: ${pagSemPrev}  ${pagSemPrev === 0 ? '✓' : '⚠️'}`)

console.log('\n=== DISTRIBUICAO DE PAGAMENTOS POR STATUS ===')
const statuses = ['pago', 'pendente', 'cancelado']
const total = await count('pagamentos_prosoluto')
for (const s of statuses) {
  const c = await count('pagamentos_prosoluto', q => q.eq('status', s))
  const pct = total > 0 ? ((c / total) * 100).toFixed(1) : '0.0'
  console.log(`  ${s}: ${c} (${pct}%)`)
}

console.log('\n=== ORIGEM CORRETOR_ID (proteção contra sync) ===')
for (const o of ['sync', 'manual', 'api_commissions']) {
  const c = await count('vendas', q => q.eq('corretor_id_origem', o))
  console.log(`  ${o}: ${c}`)
}

console.log('\n=== VENDAS SEM CORRETOR_ID (banco) ===')
const semCorr = await count('vendas', q => q.is('corretor_id', null).or('excluido.eq.false,excluido.is.null'))
console.log(`  ${semCorr}`)

console.log('\n=== SNAPSHOT vendas.comissao_total VS soma viva ===')
// Carrega vendas e pagamentos, compara
const { data: vendas } = await supa.from('vendas').select('id, comissao_total, valor_pro_soluto').or('excluido.eq.false,excluido.is.null')
let pagamentos = []
let page = 0
while (true) {
  const { data } = await supa.from('pagamentos_prosoluto').select('venda_id, comissao_gerada').range(page*1000, (page+1)*1000-1)
  if (!data || data.length === 0) break
  pagamentos = pagamentos.concat(data)
  if (data.length < 1000) break
  page++
}
const somaViva = new Map()
for (const p of pagamentos) {
  if (!p.venda_id) continue
  somaViva.set(p.venda_id, (somaViva.get(p.venda_id) || 0) + (parseFloat(p.comissao_gerada) || 0))
}
let divergentes = 0
let somaErroAbs = 0
for (const v of vendas) {
  const snap = parseFloat(v.comissao_total) || 0
  const viva = somaViva.get(v.id) || 0
  if (Math.abs(snap - viva) > 0.01) {
    divergentes++
    somaErroAbs += Math.abs(snap - viva)
  }
}
console.log(`  vendas com snapshot != soma viva: ${divergentes} de ${vendas.length}  (${((divergentes/vendas.length)*100).toFixed(1)}%)`)
console.log(`  soma absoluta de erro: R$ ${somaErroAbs.toFixed(2)}`)

console.log('\n=== RUNS RECENTES (10) ===')
const { data: runs } = await supa.from('runs').select('id, started_at, finished_at, status, params').order('started_at',{ascending:false}).limit(10)
for (const r of runs || []) {
  const params = typeof r.params === 'string' ? JSON.parse(r.params) : r.params
  const ents = (params?.entities || []).join(',')
  console.log(`  ${r.started_at}  status=${r.status}  entities=${ents}`)
}
