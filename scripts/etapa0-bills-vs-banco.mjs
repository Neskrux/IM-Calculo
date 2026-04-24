// Etapa 0.2 — bills Sienge vs banco.
// ver .claude/rules/sincronizacao-sienge.md
//
// Pergunta: o banco conhece todos os receivable-bills que o Sienge tem pra Figueira (2104)?
//
// Fontes (offline):
//   docs/fase5-universo-dueDate-RAW.json  — bulk /v1/income completo
//   pagamentos_prosoluto via Supabase REST — DISTINCT bill_id
//
// Output: docs/etapa0-bills-faltantes.json

import { readFileSync, writeFileSync } from 'node:fs'

const SUPABASE_URL = 'https://jdkkusrxullttyeakwib.supabase.co'
const env = readFileSync('.env', 'utf8')
const KEY = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim()

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

console.log('[1/4] Carregando bulk D Sienge (RAW)...')
const raw = JSON.parse(readFileSync('docs/fase5-universo-dueDate-RAW.json', 'utf8'))
const bulkRows = raw.data || []
console.log(`  bulk rows: ${bulkRows.length}`)

const siengeBills = new Map() // billId -> { parcelas:n, docType, clientName, originalAmount }
for (const r of bulkRows) {
  const bid = r.billId
  if (bid == null) continue
  if (!siengeBills.has(bid)) {
    siengeBills.set(bid, {
      billId: bid,
      docType: (r.documentIdentificationId || '').trim(),
      docTypeName: r.documentIdentificationName,
      clientName: r.clientName,
      companyId: r.companyId,
      parcelas: 0,
      totalOriginalAmount: 0,
    })
  }
  const b = siengeBills.get(bid)
  b.parcelas++
  b.totalOriginalAmount += Number(r.originalAmount || 0)
}
console.log(`  billIds distintos no Sienge: ${siengeBills.size}`)

console.log('\n[2/4] Consultando sienge_receivable_bill_id distintos em vendas...')
// bill_id mora em vendas.sienge_receivable_bill_id (nao em pagamentos_prosoluto)
const localBills = new Set()
const vendaPorBill = new Map() // billId -> { vendaId, contractId }
let offset = 0
const PAGE = 1000
while (true) {
  const url = `${SUPABASE_URL}/rest/v1/vendas?select=id,sienge_contract_id,sienge_receivable_bill_id&sienge_receivable_bill_id=not.is.null&limit=${PAGE}&offset=${offset}`
  const r = await fetch(url, { headers: H })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  const arr = await r.json()
  if (arr.length === 0) break
  for (const row of arr) {
    const bid = Number(row.sienge_receivable_bill_id)
    localBills.add(bid)
    vendaPorBill.set(bid, { venda_id: row.id, sienge_contract_id: row.sienge_contract_id })
  }
  offset += arr.length
  process.stdout.write(`  lidos ${offset}\r`)
  if (arr.length < PAGE) break
}
process.stdout.write('\n')
console.log(`  billIds distintos em vendas: ${localBills.size}`)

console.log('\n[3/4] Cruzando...')
const faltantes = [] // Sienge tem, banco nao
const extras = []   // banco tem, Sienge nao (= universo B.6 + bills fora de Figueira)
for (const [bid, info] of siengeBills) {
  if (!localBills.has(bid)) faltantes.push(info)
}
for (const bid of localBills) {
  if (!siengeBills.has(bid)) extras.push(bid)
}
console.log(`  bills no Sienge mas NAO no banco: ${faltantes.length}`)
console.log(`  bills no banco mas NAO no Sienge: ${extras.length}`)

// Classificar faltantes por tipo de documento
const faltantesPorTipo = {}
for (const f of faltantes) {
  faltantesPorTipo[f.docType] = (faltantesPorTipo[f.docType] || 0) + 1
}

// Contratos de venda Sienge (apenas CT)
const siengeContratos = [...siengeBills.values()].filter(b => b.docType === 'CT')
const faltantesContrato = faltantes.filter(f => f.docType === 'CT')

console.log(`\n  Dos ${faltantes.length} faltantes, por tipo de documento:`)
for (const [t, n] of Object.entries(faltantesPorTipo)) {
  console.log(`    ${t} = ${n}`)
}
console.log(`\n  Bills Sienge tipo CT (contrato de venda): ${siengeContratos.length}`)
console.log(`  Contratos CT faltantes no banco:          ${faltantesContrato.length}`)

console.log('\n[4/4] Amostra de faltantes (ate 10):')
for (const f of faltantes.slice(0, 10)) {
  console.log(`  billId=${f.billId}  doc=${f.docType}  cliente=${f.clientName}  parcelas=${f.parcelas}  total=R$${f.totalOriginalAmount.toFixed(2)}`)
}

writeFileSync('docs/etapa0-bills-faltantes.json', JSON.stringify({
  meta: {
    geradoEm: new Date().toISOString(),
    fonteSienge: 'docs/fase5-universo-dueDate-RAW.json (bulk /v1/income, Figueira 2104)',
    siengeBillsTotal: siengeBills.size,
    siengeBillsContratoCT: siengeContratos.length,
    bancoBillsTotal: localBills.size,
    faltantesTotal: faltantes.length,
    faltantesContratoCT: faltantesContrato.length,
    extrasTotal: extras.length,
    faltantesPorTipo,
    regra: 'faltante = billId no Sienge sem par no banco; CT = contrato de venda (unico tipo que deveria estar em vendas); PRV/ADC/MUT = receivables administrativos fora de escopo',
    conclusao: faltantesContrato.length === 0
      ? 'OK: banco tem 100% dos contratos de venda (CT) que o Sienge tem para Figueira'
      : `ATENCAO: ${faltantesContrato.length} contratos de venda existem no Sienge mas nao no banco`,
  },
  faltantes,
  extras_sample: extras.slice(0, 50),
}, null, 2))

console.log('\nOutput: docs/etapa0-bills-faltantes.json')
