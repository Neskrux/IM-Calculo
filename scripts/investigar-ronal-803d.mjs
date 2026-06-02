// Investiga divergencia entre UI/banco local e Sienge na venda
// RONAL RESMINI BALENA — Unidade 803 D — FIGUEIRA GARCIA — corretor SAMUEL MUELLER LEMOS.
// Sintomas reportados pelo usuario (2026-05-13):
//   - Parcela 2 (10/11/2025, R$ 2.650,00) PENDENTE
//   - Parcela 3 (10/07/2027, R$ 1.500,00) PAGO
//   - Ordem PAGO->PENDENTE invertida + parcela 3 com vencimento futuro ja paga
// Spec: .claude/rules/sincronizacao-sienge.md

import { siengeGet, extractRows } from './_sienge-http.mjs'
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

// Atalho: venda ja localizada na execucao anterior (803 D contract 275)
const VENDA_ID_DIRETO = '1d7772d4'

// 1. Achar a venda no banco local — primeiro tenta varias variacoes de nome
console.log('=== 1. BANCO LOCAL — buscar cliente ===')
const patterns = ['%RONAL%RESMINI%', '%RESMINI%BALENA%', '%RONAL%BALENA%', '%RONALD%', '%RESMINI%']
let clientes = []
for (const pat of patterns) {
  const { data } = await supa.from('clientes').select('id, nome, cpf').ilike('nome', pat).limit(20)
  if (data?.length) {
    console.log(`  match com pattern "${pat}": ${data.length}`)
    for (const c of data) console.log(`    ${c.id} | ${c.nome} | ${c.cpf || '-'}`)
    clientes = data
    break
  }
}
if (!clientes.length) {
  // fallback: pela unidade
  console.log('\n  cliente nao achado por nome — buscando venda pela unidade 803 D')
  const { data: vendasUnidade } = await supa
    .from('vendas')
    .select('id, cliente_id, unidade, bloco, sienge_contract_id, numero_contrato, valor_venda')
    .or('unidade.ilike.%803%D%,unidade.ilike.803 D,unidade.eq.803,numero_contrato.ilike.%803%')
    .limit(30)
  console.log(`  vendas por unidade: ${vendasUnidade?.length || 0}`)
  for (const v of vendasUnidade || []) {
    console.log(
      `    ${v.id.slice(0, 8)}... contract=${v.sienge_contract_id} num=${v.numero_contrato} unidade=${v.unidade}/${v.bloco} cliente_id=${v.cliente_id}`,
    )
  }
  if (vendasUnidade?.length) {
    // pega cliente_ids e busca clientes
    const ids = [...new Set(vendasUnidade.map((v) => v.cliente_id).filter(Boolean))]
    const { data: cs } = await supa.from('clientes').select('id, nome, cpf').in('id', ids)
    console.log(`  clientes correspondentes: ${cs?.length || 0}`)
    for (const c of cs || []) console.log(`    ${c.id} | ${c.nome} | ${c.cpf || '-'}`)
    clientes = cs || []
  }
}
// fallback final: re-busca por unidade 803 D com SELECT *
console.log(`\n  re-buscando venda pela unidade 803 D...`)
const { data: vDireto, error: errDireto } = await supa.from('vendas').select('*').ilike('unidade', '803 D')
if (errDireto) console.error('  erro:', errDireto)
const venda = (vDireto || []).find((v) => v.sienge_contract_id) || vDireto?.[0]
if (!venda) {
  console.error('  desisti — venda nao achada. abortando.')
  process.exit(1)
}

console.log('\n--- venda escolhida ---')
console.log(JSON.stringify(venda, null, 2))

// 2. Pagamentos no banco local
console.log('\n=== 2. BANCO LOCAL — pagamentos_prosoluto ===')
const { data: pagsLocal, error: errPags } = await supa
  .from('pagamentos_prosoluto')
  .select('*')
  .eq('venda_id', venda.id)
  .order('data_prevista', { ascending: true })
if (errPags) console.error('  erro pagamentos:', errPags)
console.log(`  pagamentos: ${pagsLocal?.length || 0}`)
console.log('  num | tipo            | venc       | pago       | status   | valor       | comissao   | bill_id | inst_id')
console.log('  ----+-----------------+------------+------------+----------+-------------+------------+---------+--------')
for (const p of pagsLocal || []) {
  console.log(
    `  ${String(p.numero_parcela).padEnd(3)} | ${(p.tipo || '').padEnd(15)} | ${p.data_prevista || '-         '} | ` +
      `${p.data_pagamento || '-         '} | ${(p.status || '').padEnd(8)} | ${String(p.valor).padStart(11)} | ` +
      `${String(p.comissao_gerada || 0).padStart(10)} | ${p.sienge_bill_id || '-'} | ${p.sienge_installment_id || '-'}`,
  )
}

// 3. Sienge — sales-contract detalhe
console.log('\n=== 3. SIENGE — sales-contract detalhe ===')
const contratoId = venda.sienge_contract_id
console.log(`  sienge_contract_id local: ${contratoId}`)
if (!contratoId) {
  console.error('  venda sem sienge_contract_id — abortando consulta Sienge')
  process.exit(1)
}
const r = await siengeGet({ path: `/sales-contracts/${contratoId}` })
const c = r.data
console.log(`  number=${c.number} date=${c.contractDate || c.date} status=${c.situation || c.contractStatus}`)
console.log(`  value=${c.value || c.totalSellingValue} enterpriseId=${c.enterpriseId}`)
const unidades = (c.salesContractUnits || []).map((u) => `${u.blockName || '-'}/${u.unitName || u.unitId}`).join(', ')
console.log(`  unidades: ${unidades}`)
const cli = (c.salesContractCustomers || [])[0]
console.log(`  cliente Sienge: ${cli ? `${cli.name || cli.fullName} (id=${cli.id})` : '-'}`)
console.log(`  brokers: ${(c.brokers || []).map((b) => `${b.name}(${b.id})`).join(', ')}`)
console.log(`  paymentConditions: ${(c.paymentConditions || []).length} condicao(oes)`)
for (const cond of c.paymentConditions || []) {
  console.log(
    `    cond ${cond.conditionTypeId || cond.id}: ${cond.installmentsNumber || '-'}x de ${
      cond.installmentValue || '-'
    } total=${cond.totalValue} firstDue=${cond.firstPaymentDate}`,
  )
}

// 4. Sienge — bulk-data/income filtrando por contractId
console.log('\n=== 4. SIENGE — bulk-data/income (parcelas pagas/lancadas) ===')
// Bulk-data exige range de data. Vou puxar de 2023 ate fim de 2030 (a venda
// tem parcelas ate 2027 pelo screenshot).
const startDate = '2023-01-01'
const endDate = '2030-12-31'
const incomes = []
let offset = 0
const limit = 200
while (true) {
  const ri = await siengeGet({
    path: '/bulk-data/v1/income',
    query: {
      startDate,
      endDate,
      selectionType: 'D', // D = por data de vencimento (pega todas, paga e pendente)
      companyId: 5,
      limit,
      offset,
    },
  })
  const rows = extractRows(ri.data)
  if (!rows.length) break
  for (const row of rows) {
    if (Number(row.contractId) === Number(contratoId)) incomes.push(row)
  }
  if (rows.length < limit) break
  offset += limit
  if (offset > 200000) break // safety
}
console.log(`  parcelas Sienge para contract ${contratoId}: ${incomes.length}`)
console.log('  bill | inst | due        | pago       | valor       | recebido  | tipo            | situation')
console.log('  -----+------+------------+------------+-------------+-----------+-----------------+----------')
for (const i of incomes.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))) {
  const recebido = (i.receipts || []).reduce((s, r) => s + Number(r.netAmount || r.paidAmount || 0), 0)
  const dataPago =
    i.paymentDate ||
    (i.receipts && i.receipts[0] && (i.receipts[0].paymentDate || i.receipts[0].date)) ||
    '-'
  console.log(
    `  ${String(i.billId || i.documentId || '-').padEnd(4)} | ${String(i.installmentNumber || i.installmentId || '-').padStart(4)} | ` +
      `${i.dueDate || '-         '} | ${String(dataPago).padEnd(10)} | ${String(i.installmentValue || i.originalAmount || '-').padStart(11)} | ` +
      `${String(recebido).padStart(9)} | ${(i.installmentTypeName || i.documentType || '-').padEnd(15)} | ${i.installmentSituation || i.situation || '-'}`,
  )
}

// 5. Cruzamento — bater pagamento local com Sienge
console.log('\n=== 5. CRUZAMENTO ===')
const byBillInst = new Map()
for (const i of incomes) {
  const k = `${i.billId || i.documentId}_${i.installmentNumber || i.installmentId}`
  byBillInst.set(k, i)
}
for (const p of pagsLocal || []) {
  const k = `${p.sienge_bill_id}_${p.sienge_installment_id}`
  const match = byBillInst.get(k)
  if (!match) {
    console.log(
      `  ! local parcela=${p.numero_parcela} (${p.tipo}) venc=${p.data_prevista} status=${p.status} SEM match no Sienge`,
    )
    continue
  }
  const recebidoSienge = (match.receipts || []).reduce((s, r) => s + Number(r.netAmount || r.paidAmount || 0), 0)
  const pagoSienge = match.paymentDate || (match.receipts?.[0] && (match.receipts[0].paymentDate || match.receipts[0].date))
  const localPago = !!p.data_pagamento
  const siengePago = !!pagoSienge && Number(recebidoSienge) > 0
  let nota = ''
  if (localPago && !siengePago) nota = '⚠️ LOCAL=pago, SIENGE=nao-pago'
  else if (!localPago && siengePago) nota = '⚠️ LOCAL=pendente, SIENGE=PAGO'
  else if (localPago && siengePago && p.data_pagamento !== pagoSienge) nota = `⚠️ datas pagamento diferentes: local=${p.data_pagamento} sienge=${pagoSienge}`
  else if (p.data_prevista !== match.dueDate) nota = `⚠️ data prevista diferente: local=${p.data_prevista} sienge=${match.dueDate}`
  else if (Number(p.valor).toFixed(2) !== Number(match.installmentValue || match.originalAmount || 0).toFixed(2)) {
    nota = `⚠️ valor diferente: local=${p.valor} sienge=${match.installmentValue || match.originalAmount}`
  } else nota = 'ok'
  console.log(`  parc=${p.numero_parcela} bill=${p.sienge_bill_id} inst=${p.sienge_installment_id} | ${nota}`)
}
