// Varredura COMPLETA de cessões de direitos em FIGUEIRA: baixa o income completo (1 bulk),
// compara o titular (clientId) de cada bill no Sienge com o cliente_id local. Divergência = cessão
// (ou correção de cliente). READ-ONLY. ver memory/termos-contratuais-sienge.md
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { siengeGet, extractRows } from './_sienge-http.mjs'

const env = {}
for (const l of readFileSync('.env', 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}
const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const FIG = '0d7d01f4-c398-4d9a-a280-13f44c957279'

// 1. income completo (bulk, Figueira = companyId 5)
const r = await siengeGet({ path: '/bulk-data/v1/income', query: { startDate: '2023-01-01', endDate: '2031-12-31', selectionType: 'D', companyId: 5 } })
const income = extractRows(r.data)
console.log(`income linhas: ${income.length}`)
const byBill = new Map()
for (const i of income) {
  if (i.billId == null) continue
  if (!byBill.has(i.billId)) byBill.set(i.billId, { ids: new Set(), name: i.clientName })
  if (i.clientId != null) byBill.get(i.billId).ids.add(String(i.clientId))
}

// 2. vendas Figueira com bill + cliente
const vendas = []
for (let f = 0; ; f += 1000) {
  const { data } = await supa.from('vendas')
    .select('sienge_contract_id,unidade,sienge_receivable_bill_id,cliente_id,nome_cliente,excluido,situacao_contrato')
    .eq('empreendimento_id', FIG).not('sienge_receivable_bill_id', 'is', null).range(f, f + 999)
  if (!data?.length) break; vendas.push(...data); if (data.length < 1000) break
}
const cids = [...new Set(vendas.map((v) => v.cliente_id).filter(Boolean))]
const cli = new Map()
for (let i = 0; i < cids.length; i += 100) {
  const { data } = await supa.from('clientes').select('id,sienge_customer_id,nome_completo').in('id', cids.slice(i, i + 100))
  for (const c of data || []) cli.set(c.id, c)
}

// 3. comparar
const cessoes = []
let conferidas = 0
for (const v of vendas) {
  const inc = byBill.get(Number(v.sienge_receivable_bill_id))
  if (!inc || !inc.ids.size) continue
  const c = cli.get(v.cliente_id)
  const localId = c?.sienge_customer_id ? String(c.sienge_customer_id) : null
  if (!localId) continue
  conferidas++
  if (!inc.ids.has(localId)) {
    cessoes.push({ contrato: v.sienge_contract_id, unidade: v.unidade, bill: v.sienge_receivable_bill_id,
      excluido: v.excluido, distrato: v.situacao_contrato === '3',
      cliente_local: `${localId} ${c?.nome_completo || ''}`.trim(),
      cliente_sienge: `${[...inc.ids].join(',')} ${inc.name || ''}`.trim() })
  }
}

console.log(`\nvendas Figueira com bill+cliente conferidas: ${conferidas}`)
console.log(`CESSÕES detectadas (titular Sienge ≠ local): ${cessoes.length}`)
console.log('')
for (const x of cessoes) console.log(`  c${x.contrato} ${x.unidade} bill ${x.bill}${x.distrato ? ' [DISTRATO]' : ''}${x.excluido ? ' [excluida]' : ''}\n     local : ${x.cliente_local}\n     sienge: ${x.cliente_sienge}`)

mkdirSync('docs/auditorias/2026-06-03-cessao', { recursive: true })
writeFileSync('docs/auditorias/2026-06-03-cessao/cessoes-figueira.json', JSON.stringify(cessoes, null, 2))
console.log(`\nSalvo: docs/auditorias/2026-06-03-cessao/cessoes-figueira.json`)
