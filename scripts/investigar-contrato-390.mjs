// Investiga o contrato Sienge 390 — reemissao do contrato 236 (CLAUDIO MARTIRE).
// Gestora confirmou em 2026-05-14: contrato foi reemitido, unidade correta e
// 1008 C, cliente em dia, nenhuma parcela devolvida.
//
// Objetivo: confirmar dados do 390 + montar plano de re-amarracao da venda
// local (hoje apontando pro contrato morto 236).
//
// READ-ONLY. Spec: .claude/rules/sincronizacao-sienge.md

import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { siengeGet } from './_sienge-http.mjs'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

const CONTRACT_NOVO = 390
const CONTRACT_VELHO = 236

console.log('=== 1. SIENGE REST — detalhe do contrato 390 ===')
let c390 = null
try {
  const r = await siengeGet({ path: `/sales-contracts/${CONTRACT_NOVO}` })
  c390 = r.data
  console.log(`  number: ${c390.number}`)
  console.log(`  contractDate/date: ${c390.contractDate || c390.date}`)
  console.log(`  situation: ${c390.situation} | contractStatus: ${c390.contractStatus} | status: ${c390.status}`)
  console.log(`  cancellationDate: ${c390.cancellationDate}`)
  console.log(`  value: ${c390.value || c390.totalSellingValue}`)
  console.log(`  enterpriseId: ${c390.enterpriseId}`)
  console.log(`  receivableBillId: ${c390.receivableBillId}`)
  const unidades = (c390.salesContractUnits || []).map((u) => `${u.blockName || '-'}/${u.unitName || u.unitId} (id=${u.unitId})`).join(', ')
  console.log(`  unidades: ${unidades}`)
  const cli = (c390.salesContractCustomers || [])[0]
  console.log(`  cliente: ${cli ? `${cli.name || cli.fullName} (id=${cli.id})` : '-'}`)
  console.log(`  brokers: ${(c390.brokers || []).map((b) => `${b.name || '?'}(id=${b.id})`).join(', ')}`)
  console.log(`  paymentConditions: ${(c390.paymentConditions || []).length}`)
  for (const cond of c390.paymentConditions || []) {
    console.log(
      `    ${cond.conditionTypeId || cond.id}: ${cond.installmentsNumber}x de ${cond.installmentValue} ` +
        `total=${cond.totalValue} firstDue=${cond.firstPaymentDate} lastDue=${cond.lastPaymentDate}`,
    )
  }
} catch (e) {
  console.log(`  ERRO: ${String(e).slice(0, 250)}`)
  console.log(`  (se for 429, a quota REST v1 esgotou — tentar amanha)`)
  process.exit(1)
}

console.log('\n=== 2. BANCO LOCAL — venda atual (sienge_contract_id=236) ===')
const { data: vendas } = await supa.from('vendas').select('*').eq('sienge_contract_id', String(CONTRACT_VELHO))
const venda = vendas?.[0]
if (!venda) {
  console.log('  venda 236 nao encontrada — abortando')
  process.exit(1)
}
console.log(`  id: ${venda.id}`)
console.log(`  sienge_contract_id: ${venda.sienge_contract_id}  -> deveria ser ${CONTRACT_NOVO}`)
console.log(`  numero_contrato: ${venda.numero_contrato}`)
console.log(`  unidade: ${venda.unidade}  -> gestora disse 1008 C`)
console.log(`  sienge_unit_id: ${venda.sienge_unit_id}`)
console.log(`  sienge_receivable_bill_id: ${venda.sienge_receivable_bill_id}  -> deveria ser ${c390.receivableBillId}`)
console.log(`  sienge_customer_id: ${venda.sienge_customer_id}`)
console.log(`  valor_venda: ${venda.valor_venda}  | Sienge 390: ${c390.value || c390.totalSellingValue}`)
console.log(`  valor_pro_soluto: ${venda.valor_pro_soluto}`)
console.log(`  status: ${venda.status} | excluido: ${venda.excluido}`)
console.log(`  corretor_id: ${venda.corretor_id} | corretor_id_origem: ${venda.corretor_id_origem}`)
console.log(`  cliente_id: ${venda.cliente_id} | cliente_id_origem: ${venda.cliente_id_origem}`)

console.log('\n=== 3. BANCO LOCAL — pagamentos da venda ===')
const { data: pags } = await supa
  .from('pagamentos_prosoluto')
  .select('id, numero_parcela, tipo, valor, data_prevista, data_pagamento, status, comissao_gerada')
  .eq('venda_id', venda.id)
  .order('numero_parcela', { ascending: true, nullsFirst: true })
const pagos = (pags || []).filter((p) => p.status === 'pago')
const pendentes = (pags || []).filter((p) => p.status === 'pendente')
const cancelados = (pags || []).filter((p) => p.status === 'cancelado')
console.log(`  total: ${pags?.length || 0} (pagos=${pagos.length}, pendentes=${pendentes.length}, cancelados=${cancelados.length})`)
console.log('  PAGAS:')
for (const p of pagos) {
  console.log(`    parc ${p.numero_parcela} (${p.tipo}) venc=${p.data_prevista} pago=${p.data_pagamento} valor=${p.valor} comissao=${p.comissao_gerada}`)
}

console.log('\n=== 4. SIENGE — income do bill do contrato 390 ===')
if (c390.receivableBillId) {
  try {
    // tentar via bulk-data filtrando — mas bulk-data esgotou. Tenta REST de installments.
    const ri = await siengeGet({
      path: `/accounts-receivable/receivable-bills/${c390.receivableBillId}/installments`,
    })
    const installments = ri.data?.results || ri.data || []
    console.log(`  installments do bill ${c390.receivableBillId}: ${Array.isArray(installments) ? installments.length : '?'}`)
    if (Array.isArray(installments)) {
      for (const inst of installments.slice(0, 12)) {
        console.log(
          `    #${inst.installmentNumber || inst.number} due=${inst.dueDate} valor=${inst.amount || inst.originalValue} ` +
            `status=${inst.situation || inst.status}`,
        )
      }
      if (installments.length > 12) console.log(`    ... +${installments.length - 12}`)
    }
  } catch (e) {
    console.log(`  ERRO ao buscar installments: ${String(e).slice(0, 200)}`)
  }
}

console.log('\n=== RESUMO — campos a corrigir na venda ===')
console.log(JSON.stringify({
  venda_id: venda.id,
  sienge_contract_id: { atual: venda.sienge_contract_id, correto: String(CONTRACT_NOVO) },
  sienge_receivable_bill_id: { atual: venda.sienge_receivable_bill_id, correto: c390.receivableBillId },
  unidade: { atual: venda.unidade, correto_sienge: (c390.salesContractUnits || [])[0] },
  valor_venda: { atual: venda.valor_venda, sienge_390: c390.value || c390.totalSellingValue },
}, null, 2))
