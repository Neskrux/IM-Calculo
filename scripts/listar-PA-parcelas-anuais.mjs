// Lista as 2 parcelas PA (PARCELAS ANUAIS) com identificadores que a usuária
// do Sienge consegue buscar no sistema: billId, installmentId, installmentNumber,
// contractId, clientName, dueDate, paymentDate, originalAmount.
//
// Zero request Sienge. Lê docs/fase0-universo-pagos-futuro.json.

import { readFileSync } from 'node:fs'

const raw = JSON.parse(readFileSync('docs/fase0-universo-pagos-futuro.json', 'utf8'))
const rows = raw.rows || []

const alvo = rows.filter(r => String(r.paymentTerm?.id || '').trim() === 'PA')

console.log('================================================================')
console.log('PA — PARCELAS ANUAIS — registros para busca no Sienge')
console.log('================================================================')
console.log(`Encontrados: ${alvo.length} registros`)
console.log('')

for (const [i, r] of alvo.entries()) {
  const receipts = Array.isArray(r.receipts) ? r.receipts : []
  const paymentDate = receipts.map(x => x.paymentDate).filter(Boolean).sort().pop() || '-'
  const pago = receipts.reduce((a, x) => a + Number(x.netAmount || 0), 0)
  console.log(`--- Registro ${i + 1} ---`)
  console.log(`  billId (Título):        ${r.billId}`)
  console.log(`  installmentId:          ${r.installmentId}`)
  console.log(`  installmentNumber:      ${r.installmentNumber}`)
  console.log(`  paymentTerm:            ${r.paymentTerm?.id} — ${r.paymentTerm?.descrition || r.paymentTerm?.description || ''}`)
  console.log(`  contractId (Contrato):  ${r.contractId ?? '-'}`)
  console.log(`  clientId:               ${r.clientId ?? '-'}`)
  console.log(`  clientName:             ${r.clientName ?? '-'}`)
  console.log(`  documentIdentification: ${r.documentIdentification ?? '-'}`)
  console.log(`  documentNumber:         ${r.documentNumber ?? '-'}`)
  console.log(`  issueDate:              ${r.issueDate ?? '-'}`)
  console.log(`  dueDate (vencimento):   ${r.dueDate ?? '-'}`)
  console.log(`  paymentDate:            ${paymentDate}`)
  console.log(`  originalAmount:         R$ ${Number(r.originalAmount || 0).toFixed(2)}`)
  console.log(`  valor pago (receipts):  R$ ${pago.toFixed(2)}`)
  console.log(`  enterpriseId:           ${r.enterpriseId ?? '-'}`)
  console.log(`  companyId:              ${r.companyId ?? '-'}`)
  console.log(`  bearerId:               ${r.bearerId ?? '-'}`)
  console.log('')
}

console.log('----------------------------------------------------------------')
console.log('Como a usuária localiza no Sienge:')
console.log('  1. Contas a Receber → Pesquisar Título → usar billId como nº do título')
console.log('  2. Ou pesquisar por CPF/CNPJ em documentIdentification')
console.log('  3. Ou pesquisar pelo nome do cliente (clientName)')
console.log('----------------------------------------------------------------')
