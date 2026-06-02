// Investiga o contrato Sienge 236 (Unidade 1007 C) — venda inteira sem nenhum
// match no /bulk-data/v1/income (bill_id=261 ausente do cache 304-bills).
//
// Hipoteses:
//   A) Contrato cancelado no Sienge — bill nao retorna em selectionType=D
//   B) Contrato reemitido com outro number — bill_id local desatualizado
//   C) billId local 261 errado — talvez aponte pra outro contrato
//   D) Sienge tem mas em status especial (companyId diferente, baixado/exibido)
//
// READ-ONLY. Spec: .claude/rules/sincronizacao-sienge.md

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { siengeGet, extractRows } from './_sienge-http.mjs'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

const CONTRACT_SIENGE = 236
const BILL_ID = 261

console.log('=== 1. BANCO LOCAL — venda do contrato Sienge 236 ===')
const { data: vendas } = await supa
  .from('vendas')
  .select('*')
  .eq('sienge_contract_id', String(CONTRACT_SIENGE))
console.log(`  vendas encontradas: ${vendas?.length || 0}`)
const venda = vendas?.[0]
if (!venda) {
  console.error('  venda nao encontrada — abortando')
  process.exit(1)
}
console.log(`  id: ${venda.id}`)
console.log(`  numero_contrato: ${venda.numero_contrato}`)
console.log(`  unidade: ${venda.unidade}/${venda.bloco}`)
console.log(`  data_venda: ${venda.data_venda}`)
console.log(`  valor_venda: ${venda.valor_venda}`)
console.log(`  valor_pro_soluto: ${venda.valor_pro_soluto}`)
console.log(`  status: ${venda.status}`)
console.log(`  excluido: ${venda.excluido}`)
console.log(`  data_distrato: ${venda.data_distrato}`)
console.log(`  data_cancelamento: ${venda.data_cancelamento}`)
console.log(`  motivo_cancelamento: ${venda.motivo_cancelamento}`)
console.log(`  situacao_contrato: ${venda.situacao_contrato}`)
console.log(`  sienge_receivable_bill_id: ${venda.sienge_receivable_bill_id}`)
console.log(`  cliente_id: ${venda.cliente_id}`)
console.log(`  corretor_id: ${venda.corretor_id}`)

// cliente / corretor
const { data: cli } = venda.cliente_id
  ? await supa.from('clientes').select('nome_completo, cpf, telefone').eq('id', venda.cliente_id).maybeSingle()
  : { data: null }
console.log(`  cliente: ${cli?.nome_completo || '-'} (CPF ${cli?.cpf || '-'}, tel ${cli?.telefone || '-'})`)

console.log('\n=== 2. PAGAMENTOS LOCAIS ===')
const { data: pags } = await supa
  .from('pagamentos_prosoluto')
  .select('id, numero_parcela, tipo, valor, data_prevista, data_pagamento, status, comissao_gerada')
  .eq('venda_id', venda.id)
  .order('data_prevista', { ascending: true, nullsFirst: true })
const total = pags?.length || 0
const pagos = (pags || []).filter((p) => p.status === 'pago').length
const pendentes = (pags || []).filter((p) => p.status === 'pendente').length
const cancelados = (pags || []).filter((p) => p.status === 'cancelado').length
console.log(`  total: ${total} (pagos=${pagos}, pendentes=${pendentes}, cancelados=${cancelados})`)
if (pagos > 0) {
  console.log('\n  ⚠️ PAGAS encontradas:')
  for (const p of (pags || []).filter((x) => x.status === 'pago')) {
    console.log(`    num=${p.numero_parcela} (${p.tipo}) venc=${p.data_prevista} pago=${p.data_pagamento} valor=${p.valor} comissao=${p.comissao_gerada}`)
  }
}

console.log('\n=== 3. INCOME CACHEADO — bill_id 261 ===')
const cacheDir = resolve(process.cwd(), '.sienge-cache')
const cacheFiles = readdirSync(cacheDir).filter((f) => f.endsWith('.json'))
let income = []
for (const f of cacheFiles) {
  try {
    const c = JSON.parse(readFileSync(resolve(cacheDir, f), 'utf8'))
    if (!c.url?.includes('/bulk-data/v1/income')) continue
    const rows = c.data?.results || c.data?.income || c.data?.data || (Array.isArray(c.data) ? c.data : [])
    if (rows.length > 0) { income = rows; break }
  } catch { /* skip */ }
}
const incomeBill261 = income.filter((i) => Number(i.billId) === BILL_ID)
console.log(`  bill_id ${BILL_ID} no income cacheado: ${incomeBill261.length} linhas`)
if (incomeBill261.length > 0) {
  console.log('  (Esperado zero — mas achou. Listando primeiros 5):')
  for (const i of incomeBill261.slice(0, 5)) {
    console.log(`    bill=${i.billId} inst=${i.installmentNumber} due=${i.dueDate} valor=${i.installmentValue}`)
  }
}

// Verificar tambem se contractId 236 aparece sob OUTRO billId
const incomeContract = income.filter((i) => Number(i.contractId) === CONTRACT_SIENGE)
console.log(`  contractId ${CONTRACT_SIENGE} no income cacheado: ${incomeContract.length} linhas`)
if (incomeContract.length > 0) {
  console.log('  (sob outro billId? listando primeiros 5):')
  for (const i of incomeContract.slice(0, 5)) {
    console.log(`    bill=${i.billId} contract=${i.contractId} inst=${i.installmentNumber} due=${i.dueDate} situation=${i.situation}`)
  }
}

console.log('\n=== 4. SIENGE REST — detalhe do sales-contract 236 ===')
try {
  const r = await siengeGet({ path: `/sales-contracts/${CONTRACT_SIENGE}` })
  const c = r.data
  console.log(`  number=${c.number} date=${c.contractDate || c.date}`)
  console.log(`  situation=${c.situation} contractStatus=${c.contractStatus} status=${c.status}`)
  console.log(`  cancellationDate=${c.cancellationDate}`)
  console.log(`  cancellationReason=${c.cancellationReason}`)
  console.log(`  receivableBillId=${c.receivableBillId}`)
  console.log(`  value=${c.value || c.totalSellingValue}`)
  const unidades = (c.salesContractUnits || []).map((u) => `${u.blockName || '-'}/${u.unitName || u.unitId}`).join(', ')
  console.log(`  unidades: ${unidades}`)
  console.log(`  paymentConditions: ${(c.paymentConditions || []).length}`)
  for (const cond of c.paymentConditions || []) {
    console.log(`    ${cond.conditionTypeId || cond.id}: ${cond.installmentsNumber}x ${cond.installmentValue} total=${cond.totalValue} firstDue=${cond.firstPaymentDate} lastDue=${cond.lastPaymentDate}`)
  }
} catch (e) {
  console.log(`  ERRO consulta REST: ${String(e).slice(0, 200)}`)
}
