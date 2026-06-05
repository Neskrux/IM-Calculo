// Extrai TODOS os aditivos (reparcelamentos) do /remade-installments (REST v1, 1 request)
// e cruza com as vendas locais via receivableBillId. READ-ONLY.
// ver docs/contexto/2026-06-03-north-star-2-distrato-aditivo-cessao.md
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const l of readFileSync('.env', 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}
const AUTH = 'Basic ' + Buffer.from(`${env.SIENGE_USERNAME}:${env.SIENGE_PASSWORD}`).toString('base64')
const BASE = `https://api.sienge.com.br/${env.SIENGE_SUBDOMAIN}/public/api/v1`
const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

// 1 request — traz todos
const res = await fetch(`${BASE}/remade-installments?limit=1000`, { headers: { Authorization: AUTH, Accept: 'application/json' } })
const body = await res.json()
const aditivos = body.results || body.data || []
console.log(`status=${res.status}  aditivos=${aditivos.length}  rateLimit=${res.headers.get('X-Rate-Limit-Remaining')}`)

mkdirSync('docs/auditorias/2026-06-03-aditivos', { recursive: true })
writeFileSync('docs/auditorias/2026-06-03-aditivos/remade-installments-raw.json', JSON.stringify(body, null, 2))

// vendas por receivableBillId
const bills = [...new Set(aditivos.map((a) => a.receivableBillId).filter((x) => x != null))]
const vById = new Map()
for (let i = 0; i < bills.length; i += 100) {
  const { data } = await supa.from('vendas')
    .select('sienge_receivable_bill_id,sienge_contract_id,unidade,nome_cliente,excluido,situacao_contrato')
    .in('sienge_receivable_bill_id', bills.slice(i, i + 100))
  for (const v of data || []) vById.set(Number(v.sienge_receivable_bill_id), v)
}

let comJuros = 0, semJuros = 0, semVenda = 0
let totalRemade = 0, totalGerado = 0
const linhas = []
for (const a of aditivos) {
  const juros = Number(a.generatedValue || 0) - Number(a.remadeValue || 0)
  totalRemade += Number(a.remadeValue || 0); totalGerado += Number(a.generatedValue || 0)
  if (Math.abs(juros) > 0.5) comJuros++; else semJuros++
  const v = vById.get(Number(a.receivableBillId))
  if (!v) semVenda++
  linhas.push({ bill: a.receivableBillId, data: a.remadeDate, contrato: v?.sienge_contract_id ?? '?',
    unidade: v?.unidade ?? '(sem venda local)', cliente: (a.customerDescription || '').split(' - ')[1] || a.customerDescription,
    renegociadas: a.remadeInstallmentsDescription, geradas: a.generatedInstallmentsDescription,
    remadeValue: a.remadeValue, generatedValue: a.generatedValue, juros: Number(juros.toFixed(2)) })
}

console.log(`\n=== RESUMO ===`)
console.log(`Total aditivos: ${aditivos.length}`)
console.log(`  com juros (generated>remade): ${comJuros}`)
console.log(`  sem juros (igual): ${semJuros}`)
console.log(`  sem venda local (bill nao casou): ${semVenda}`)
console.log(`  valor renegociado total: R$ ${totalRemade.toFixed(2)} | gerado: R$ ${totalGerado.toFixed(2)} | juros: R$ ${(totalGerado-totalRemade).toFixed(2)}`)
console.log(`\n=== bills distintos: ${bills.length} (vendas casadas: ${vById.size}) ===`)
console.log('\nAmostra (10 primeiros):')
for (const l of linhas.slice(0, 10)) console.log(`  bill ${l.bill} c${l.contrato} ${l.unidade} | ${l.data} | parc ${l.renegociadas}->${l.geradas} | R$${l.remadeValue}->${l.generatedValue} (juros ${l.juros})`)

writeFileSync('docs/auditorias/2026-06-03-aditivos/aditivos-cruzados.json', JSON.stringify(linhas, null, 2))
console.log('\nSalvo: docs/auditorias/2026-06-03-aditivos/{remade-installments-raw,aditivos-cruzados}.json')
