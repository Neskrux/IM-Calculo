// Discovery do /bulk-data/v1/outcome (contas a pagar — IM paga corretores/fornecedores)
// NÃO TOCA O BANCO. Só coleta o universo pra entender se / como usar no backend.
// ver .claude/rules/sincronizacao-sienge.md
//
// Uso:
//   node scripts/discover-sienge-outcome.mjs
//
// Env opcionais (.env):
//   DISCOVERY_START_DATE, DISCOVERY_END_DATE, DISCOVERY_COMPANY_ID
//   DISCOVERY_OUTCOME_PATH (default /bulk-data/v1/outcome — se 404, tentamos fallbacks)
//   DISCOVERY_SELECTION_TYPE=D
//   DISCOVERY_PAGE_SIZE=200
//   DISCOVERY_MAX_PAGES=9999

import { writeFileSync, mkdirSync } from 'node:fs'
import { siengeGet, extractRows, collectKeys, env } from './_sienge-http.mjs'

const START_DATE = env.DISCOVERY_START_DATE || '2020-01-01'
const END_DATE = env.DISCOVERY_END_DATE || new Date().toISOString().slice(0, 10)
const COMPANY_ID = Number(env.DISCOVERY_COMPANY_ID || 5)
const SELECTION_TYPE = env.DISCOVERY_SELECTION_TYPE || 'D'
const PAGE_SIZE = Number(env.DISCOVERY_PAGE_SIZE || 200)
const MAX_PAGES = Number(env.DISCOVERY_MAX_PAGES || 9999)
const FLUSH_EVERY = 10
const SAMPLES_PER_SUPPLIER = 2

// O nome exato varia entre versões Sienge — tentamos estes paths em ordem
const OUTCOME_PATH_CANDIDATES = [
  env.DISCOVERY_OUTCOME_PATH,
  '/bulk-data/v1/outcome',
  '/bulk-data/v1/expenses',
  '/bulk-data/v1/bills',
  '/bulk-data/v1/payable',
].filter(Boolean)

mkdirSync('docs', { recursive: true })
const OUT_PATH = `docs/sienge-outcome-discovery-${SELECTION_TYPE}.json`

console.log('==================================================================')
console.log('DISCOVERY: /bulk-data/v1/outcome (contas a pagar)')
console.log('==================================================================')
console.log(`startDate:     ${START_DATE}`)
console.log(`endDate:       ${END_DATE}`)
console.log(`companyId:     ${COMPANY_ID}`)
console.log(`selectionType: ${SELECTION_TYPE}`)
console.log(`pageSize:      ${PAGE_SIZE}`)
console.log(`candidatos:    ${OUTCOME_PATH_CANDIDATES.join(' → ')}`)
console.log(`output:        ${OUT_PATH}`)
console.log('------------------------------------------------------------------')

// Descobre qual path responde (algum precisa dar 200 com rows ou vazio válido)
let chosenPath = null
for (const candidate of OUTCOME_PATH_CANDIDATES) {
  try {
    const res = await siengeGet({
      path: candidate,
      query: { startDate: START_DATE, endDate: END_DATE, selectionType: SELECTION_TYPE, companyId: COMPANY_ID, limit: 1, offset: 0 },
    })
    console.log(`  [probe] ${candidate} → status=${res.status}, shape=${Array.isArray(res.data) ? 'array' : 'object'}`)
    chosenPath = candidate
    break
  } catch (err) {
    console.warn(`  [probe] ${candidate} → FALHA: ${String(err).slice(0, 150)}`)
  }
}

if (!chosenPath) {
  console.error('ERRO: nenhum path de outcome respondeu. Ajuste DISCOVERY_OUTCOME_PATH no .env com o path correto.')
  process.exit(1)
}

console.log(`\n✓ path escolhido: ${chosenPath}`)
console.log('------------------------------------------------------------------\n')

const state = {
  runStartedAt: new Date().toISOString(),
  runFinishedAt: null,
  params: { startDate: START_DATE, endDate: END_DATE, companyId: COMPANY_ID, selectionType: SELECTION_TYPE, pageSize: PAGE_SIZE, pathUsed: chosenPath },
  firstPageShape: null,
  totalPages: 0,
  totalRows: 0,
  totalRowsWithPaymentDate: 0,
  totalRowsWithReceipts: 0,
  totalRowsWithBrokerRef: 0,     // referências a corretor/broker — é o que interessa pro repasse
  totalRowsWithContractRef: 0,   // referência a salesContract — liga ao fluxo de comissão
  supplierCounts: {},            // { creditorId/supplierId: count }
  documentTypeCounts: {},        // tipo de documento (nota, título, etc.)
  topLevelKeys: [],
  receiptKeys: [],
  installmentKeys: [],
  statusFields: {},
  linkFields: {},                // campos que parecem "elo" com sales-contract / broker / receivable
  sampleBySupplier: {},
  httpErrors: [],
}

const topLevelKeysSet = new Set()
const receiptKeysSet = new Set()
const installmentKeysSet = new Set()
const statusFieldCandidates = ['situation', 'status', 'paid', 'settled', 'canceled', 'cancelled', 'active', 'paymentStatus', 'billStatus']
const linkFieldCandidates = ['salesContractId', 'contractId', 'receivableBillId', 'brokerId', 'creditorId', 'supplierId', 'payeeId', 'beneficiaryId', 'referenceId', 'originId', 'referenceDocument']

function updateStatusFields(row) {
  for (const field of statusFieldCandidates) {
    if (field in row) {
      const val = row[field]
      const key = typeof val === 'boolean' ? String(val) : String(val ?? 'null')
      state.statusFields[field] = state.statusFields[field] || {}
      state.statusFields[field][key] = (state.statusFields[field][key] || 0) + 1
    }
  }
}

function updateLinkFields(row) {
  for (const field of linkFieldCandidates) {
    if (field in row && row[field] != null) {
      state.linkFields[field] = (state.linkFields[field] || 0) + 1
    }
  }
  if (row.brokerId || row.broker?.id || row.salesBrokerId) state.totalRowsWithBrokerRef++
  if (row.salesContractId || row.contractId) state.totalRowsWithContractRef++
}

function recordSupplier(row) {
  const supplierId = row.creditorId || row.supplierId || row.payeeId || row.beneficiaryId || row.creditor?.id
  if (supplierId != null) {
    const key = String(supplierId)
    state.supplierCounts[key] = (state.supplierCounts[key] || 0) + 1
    if (!state.sampleBySupplier[key]) state.sampleBySupplier[key] = []
    if (state.sampleBySupplier[key].length < SAMPLES_PER_SUPPLIER) state.sampleBySupplier[key].push(row)
  }
  const docType = row.documentTypeId || row.documentType?.id || row.billType
  if (docType != null) {
    const key = String(docType)
    state.documentTypeCounts[key] = (state.documentTypeCounts[key] || 0) + 1
  }
}

function flush() {
  state.topLevelKeys = [...topLevelKeysSet].sort()
  state.receiptKeys = [...receiptKeysSet].sort()
  state.installmentKeys = [...installmentKeysSet].sort()
  writeFileSync(OUT_PATH, JSON.stringify(state, null, 2))
}

let offset = 0
let page = 0
try {
  while (page < MAX_PAGES) {
    page++
    let res
    try {
      res = await siengeGet({
        path: chosenPath,
        query: {
          startDate: START_DATE,
          endDate: END_DATE,
          selectionType: SELECTION_TYPE,
          companyId: COMPANY_ID,
          limit: PAGE_SIZE,
          offset,
        },
      })
    } catch (err) {
      state.httpErrors.push({ page, offset, err: String(err) })
      console.error(`[p=${page} offset=${offset}] FALHA: ${String(err).slice(0, 200)}`)
      break
    }

    const rows = extractRows(res.data)
    if (page === 1) {
      state.firstPageShape = {
        url: res.url,
        status: res.status,
        type: Array.isArray(res.data) ? 'array' : 'object',
        topLevelKeys: Array.isArray(res.data) ? ['<array>'] : Object.keys(res.data || {}),
        firstRowKeys: rows[0] ? Object.keys(rows[0]) : [],
        firstRowSample: rows[0] || null,
      }
    }

    console.log(`[p=${page} offset=${offset}] rows=${rows.length}  cumTotal=${state.totalRows + rows.length}`)

    if (rows.length === 0) break

    for (const row of rows) {
      state.totalRows++
      collectKeys(row, topLevelKeysSet)
      if (row.paymentDate) state.totalRowsWithPaymentDate++
      if (Array.isArray(row.receipts) && row.receipts.length > 0) {
        state.totalRowsWithReceipts++
        for (const r of row.receipts) collectKeys(r, receiptKeysSet)
      }
      if (Array.isArray(row.installments)) {
        for (const inst of row.installments) collectKeys(inst, installmentKeysSet)
      }
      updateStatusFields(row)
      updateLinkFields(row)
      recordSupplier(row)
    }

    state.totalPages = page
    if (page % FLUSH_EVERY === 0) {
      flush()
      console.log(`   ↳ flush → ${OUT_PATH}`)
    }

    if (rows.length < PAGE_SIZE) break
    offset += rows.length
  }
} finally {
  state.runFinishedAt = new Date().toISOString()
  flush()
}

console.log('==================================================================')
console.log('DISCOVERY COMPLETA — OUTCOME')
console.log('==================================================================')
console.log(`Total de páginas:              ${state.totalPages}`)
console.log(`Total de linhas:               ${state.totalRows}`)
console.log(`Linhas com paymentDate:        ${state.totalRowsWithPaymentDate}`)
console.log(`Linhas com receipts[]:         ${state.totalRowsWithReceipts}`)
console.log(`Linhas c/ ref a corretor:      ${state.totalRowsWithBrokerRef}`)
console.log(`Linhas c/ ref a salesContract: ${state.totalRowsWithContractRef}`)
console.log(`Fornecedores distintos:        ${Object.keys(state.supplierCounts).length}`)
console.log(`Tipos de documento:            ${Object.keys(state.documentTypeCounts).length}`)
console.log(`Chaves top-level:              ${state.topLevelKeys.length}`)
console.log(`Campos de link detectados:     ${Object.keys(state.linkFields).length}`)
console.log(`HTTP errors:                   ${state.httpErrors.length}`)
console.log(`Output:                        ${OUT_PATH}`)
console.log('------------------------------------------------------------------')
console.log('linkFields (elos com fluxo de comissão):')
for (const [field, count] of Object.entries(state.linkFields).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${field.padEnd(25)} ${count}`)
}
console.log('------------------------------------------------------------------')
console.log('documentTypeCounts:')
for (const [k, v] of Object.entries(state.documentTypeCounts).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${k.padEnd(10)} ${v}`)
}
console.log('------------------------------------------------------------------')
console.log('Top 15 fornecedores:')
for (const [k, v] of Object.entries(state.supplierCounts).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  supplier=${k.padEnd(12)} ${v} linhas`)
}
console.log('------------------------------------------------------------------')
console.log('statusFields:')
for (const [field, dist] of Object.entries(state.statusFields)) {
  console.log(`  ${field}:`)
  for (const [val, count] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${val.padEnd(20)} ${count}`)
  }
}
