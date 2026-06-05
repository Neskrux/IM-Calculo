// Detecta possíveis CESSÕES DE DIREITOS via bulk income (sem webhook, sem quota):
// compara o clientId que o income (Sienge) traz por bill com o cliente_id da nossa venda.
// Divergência = o titular do título mudou no Sienge → provável cessão (ou correção de cliente).
// READ-ONLY. ver memory/termos-contratuais-sienge.md
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('.env', 'utf8')
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))[1].trim()
const supa = createClient(get('VITE_SUPABASE_URL'), get('VITE_SUPABASE_ANON_KEY'))
const FIG = '0d7d01f4-c398-4d9a-a280-13f44c957279'

// income (bulk já baixado): billId -> { clientIds:Set, name }
const raw = JSON.parse(readFileSync('docs/auditorias/fase0/income-D-raw-2026-06-02.json', 'utf8'))
const incByBill = new Map()
for (const r of raw.rows || []) {
  if (r.billId == null) continue
  if (!incByBill.has(r.billId)) incByBill.set(r.billId, { ids: new Set(), name: r.clientName })
  if (r.clientId != null) incByBill.get(r.billId).ids.add(String(r.clientId))
}

const vendas = []
for (let f = 0; ; f += 1000) {
  const { data } = await supa.from('vendas')
    .select('sienge_contract_id,unidade,sienge_receivable_bill_id,cliente_id,nome_cliente,excluido,situacao_contrato')
    .eq('empreendimento_id', FIG).not('sienge_receivable_bill_id', 'is', null).range(f, f + 999)
  if (!data?.length) break; vendas.push(...data); if (data.length < 1000) break
}
const cids = [...new Set(vendas.map((v) => v.cliente_id).filter(Boolean))]
const cli = new Map()
for (let i = 0; i < cids.length; i += 50) {
  const { data } = await supa.from('clientes').select('id,sienge_customer_id,nome_completo').in('id', cids.slice(i, i + 50))
  for (const c of data || []) cli.set(c.id, c)
}

const div = []
let conferidas = 0
for (const v of vendas) {
  const inc = incByBill.get(Number(v.sienge_receivable_bill_id))
  if (!inc || !inc.ids.size) continue
  const c = cli.get(v.cliente_id)
  const localId = c?.sienge_customer_id ? String(c.sienge_customer_id) : null
  if (!localId) continue
  conferidas++
  if (!inc.ids.has(localId)) {
    div.push({ contrato: v.sienge_contract_id, unidade: v.unidade, bill: v.sienge_receivable_bill_id,
      local: `${localId} ${c?.nome_completo || v.nome_cliente || ''}`.trim(),
      income: `${[...inc.ids].join(',')} ${inc.name || ''}`.trim() })
  }
}
console.log(`bills no income-D (vencidas em aberto): ${incByBill.size}`)
console.log(`vendas com bill + cliente conferíveis: ${conferidas}`)
console.log(`\nDIVERGÊNCIAS cliente local x income (possível cessão/correção): ${div.length}`)
for (const d of div) console.log(`  c${d.contrato} ${d.unidade} bill ${d.bill}\n     local : ${d.local}\n     income: ${d.income}`)
