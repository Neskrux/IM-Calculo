// Investiga as vendas da MARIANE (contrato 165) e ANDRESSA (contrato 8) —
// usuario informou em 2026-05-14 que tiveram renegociacao.
//
// Objetivo: descobrir se o padrao e' igual ao CLAUDIO (contrato reemitido com
// novo id => venda duplicada no banco) OU se e' o mesmo contrato com cronograma
// alterado. A acao corretiva muda conforme o caso.
//
// READ-ONLY. Spec: .claude/rules/sincronizacao-sienge.md, migration 016 (renegociacoes)

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { siengeGet } from './_sienge-http.mjs'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

// cache income pra checar bills
const cacheDir = resolve(process.cwd(), '.sienge-cache')
let income = []
for (const f of readdirSync(cacheDir).filter((x) => x.endsWith('.json'))) {
  try {
    const c = JSON.parse(readFileSync(resolve(cacheDir, f), 'utf8'))
    if (!c.url?.includes('/bulk-data/v1/income')) continue
    const rows = c.data?.results || c.data?.income || c.data?.data || (Array.isArray(c.data) ? c.data : [])
    if (rows.length) { income = rows; break }
  } catch { /* skip */ }
}
const billsNoIncome = new Set(income.map((i) => Number(i.billId)))

const CASOS = [
  { nome: 'MARIANE GOES DA SILVA GOMES', contrato: 165, unidade: '1606 A' },
  { nome: 'ANDRESSA THAYS MELO', contrato: 8, unidade: '404 A' },
]

for (const caso of CASOS) {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`CASO: ${caso.nome} — contrato Sienge ${caso.contrato} — ${caso.unidade}`)
  console.log('='.repeat(70))

  // 1. venda local
  const { data: vendas } = await supa.from('vendas').select('*').eq('sienge_contract_id', String(caso.contrato))
  const venda = vendas?.[0]
  if (!venda) {
    console.log('  venda local nao encontrada')
    continue
  }
  console.log(`  [LOCAL] venda_id=${venda.id}`)
  console.log(`  [LOCAL] numero_contrato=${venda.numero_contrato} unidade=${venda.unidade} bill_id=${venda.sienge_receivable_bill_id}`)
  console.log(`  [LOCAL] valor_venda=${venda.valor_venda} pro_soluto=${venda.valor_pro_soluto} status=${venda.status} excluido=${venda.excluido}`)

  // pagamentos
  const { data: pags } = await supa
    .from('pagamentos_prosoluto')
    .select('numero_parcela, tipo, valor, data_prevista, data_pagamento, status')
    .eq('venda_id', venda.id)
    .order('numero_parcela', { nullsFirst: true })
  const pagos = (pags || []).filter((p) => p.status === 'pago')
  console.log(`  [LOCAL] pagamentos: ${pags?.length || 0} (pagos=${pagos.length})`)
  for (const p of pagos) {
    console.log(`    parc ${p.numero_parcela} venc=${p.data_prevista} pago=${p.data_pagamento} valor=${p.valor}`)
  }

  // bill no income?
  const billLocal = Number(venda.sienge_receivable_bill_id)
  console.log(`  [INCOME] bill ${billLocal} esta no cache? ${billsNoIncome.has(billLocal) ? 'SIM' : 'NAO'}`)
  if (billsNoIncome.has(billLocal)) {
    const linhas = income.filter((i) => Number(i.billId) === billLocal && i.paymentTerm?.id === 'PM')
    const pagasIncome = linhas.filter((i) => (i.receipts || []).length > 0)
    console.log(`  [INCOME] bill ${billLocal}: ${linhas.length} PM, ${pagasIncome.length} com recebimento`)
  }

  // 2. contrato no Sienge REST
  try {
    const r = await siengeGet({ path: `/sales-contracts/${caso.contrato}` })
    const c = r.data
    console.log(`  [SIENGE] number=${c.number} situation=${c.situation} value=${c.value || c.totalSellingValue}`)
    console.log(`  [SIENGE] receivableBillId=${c.receivableBillId} (local tem ${venda.sienge_receivable_bill_id})`)
    console.log(`  [SIENGE] cancellationDate=${c.cancellationDate}`)
    const cli = (c.salesContractCustomers || [])[0]
    console.log(`  [SIENGE] cliente=${cli?.name || cli?.fullName || '-'}`)
    console.log(`  [SIENGE] paymentConditions:`)
    for (const cond of c.paymentConditions || []) {
      console.log(`    ${cond.conditionTypeId || cond.id}: ${cond.installmentsNumber}x total=${cond.totalValue}`)
    }
    // bill do Sienge bate com local?
    if (c.receivableBillId && Number(c.receivableBillId) !== billLocal) {
      console.log(`  ⚠️ DIVERGENCIA: bill Sienge (${c.receivableBillId}) != bill local (${billLocal})`)
      console.log(`     -> indica contrato reemitido OU bill atualizado pos-renegociacao`)
      console.log(`  [INCOME] bill Sienge ${c.receivableBillId} no cache? ${billsNoIncome.has(Number(c.receivableBillId)) ? 'SIM' : 'NAO'}`)
    }
  } catch (e) {
    console.log(`  [SIENGE] ERRO: ${String(e).slice(0, 200)}`)
    if (String(e).includes('404')) console.log(`     -> contrato ${caso.contrato} NAO existe mais no Sienge (reemitido, igual CLAUDIO)`)
  }

  // 3. existe OUTRA venda local pro mesmo cliente/unidade?
  const { data: mesmaUnidade } = await supa
    .from('vendas')
    .select('id, sienge_contract_id, numero_contrato, unidade, status')
    .ilike('unidade', caso.unidade)
  console.log(`  [LOCAL] vendas na unidade ${caso.unidade}: ${mesmaUnidade?.length || 0}`)
  for (const v of mesmaUnidade || []) {
    console.log(`    venda ${v.id.slice(0, 8)} contract=${v.sienge_contract_id} num=${v.numero_contrato} status=${v.status}`)
  }
}

console.log('\n--- consumo ---')
