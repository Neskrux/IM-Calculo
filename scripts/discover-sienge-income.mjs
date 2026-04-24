// Discovery do /bulk-data/v1/income (contas a receber — cliente paga IM)
// NÃO TOCA O BANCO. Só coleta o universo de dados pra desenhar o backend saudável.
// ver .claude/rules/sincronizacao-sienge.md
//
// Uso:
//   node scripts/discover-sienge-income.mjs
//
// Env opcionais (.env):
//   DISCOVERY_START_DATE=2020-01-01   (default)
//   DISCOVERY_END_DATE=2026-12-31     (default hoje)
//   DISCOVERY_COMPANY_ID=5            (default)
//   DISCOVERY_SELECTION_TYPE=D        (D=dueDate → universo total; P=paymentDate → só pagos)
//   DISCOVERY_PAGE_SIZE=200           (default)
//   DISCOVERY_MAX_PAGES=9999          (circuit breaker; default 9999)

import { writeFileSync, mkdirSync } from 'node:fs'
import { siengeGet, extractRows, collectKeys, env } from './_sienge-http.mjs'

const START_DATE = env.DISCOVERY_START_DATE || '2020-01-01'
const END_DATE = env.DISCOVERY_END_DATE || new Date().toISOString().slice(0, 10)
const COMPANY_ID = Number(env.DISCOVERY_COMPANY_ID || 5)
const SELECTION_TYPE = env.DISCOVERY_SELECTION_TYPE || 'D'
const PAGE_SIZE = Number(env.DISCOVERY_PAGE_SIZE || 200)
const MAX_PAGES = Number(env.DISCOVERY_MAX_PAGES || 9999)
const FLUSH_EVERY = 10
const SAMPLES_PER_TYPE = 3

mkdirSync('docs', { recursive: true })
const OUT_PATH = `docs/sienge-income-discovery-${SELECTION_TYPE}.json`

console.log('==================================================================')
console.log('DISCOVERY: /bulk-data/v1/income')
console.log('==================================================================')
console.log(`startDate:     ${START_DATE}`)
console.log(`endDate:       ${END_DATE}`)
console.log(`companyId:     ${COMPANY_ID}`)
console.log(`selectionType: ${SELECTION_TYPE}  (D=universo total | P=só pagos)`)
console.log(`pageSize:      ${PAGE_SIZE}`)
console.log(`maxPages:      ${MAX_PAGES}`)
console.log(`output:        ${OUT_PATH}`)
console.log('------------------------------------------------------------------')

const state = {
  runStartedAt: new Date().toISOString(),
  runFinishedAt: null,
  params: { startDate: START_DATE, endDate: END_DATE, companyId: COMPANY_ID, selectionType: SELECTION_TYPE, pageSize: PAGE_SIZE },
  firstPageShape: null,
  totalPages: 0,
  totalRows: 0,
  totalRowsWithPaymentDate: 0,
  totalRowsWithReceipts: 0,
  conditionTypeCounts: {},
  conditionTypeNames: {},
  topLevelKeys: [],
  receiptKeys: [],
  installmentKeys: [],
  statusFields: {},   // { fieldName: { valor: count } } — campos que parecem status/situation
  sampleByType: {},
  httpErrors: [],
}

const topLevelKeysSet = new Set()
const receiptKeysSet = new Set()
const installmentKeysSet = new Set()
const statusFieldCandidates = ['situation', 'status', 'reconciled', 'confirmed', 'settled', 'canceled', 'cancelled', 'active', 'paid', 'paymentStatus', 'billStatus', 'installmentStatus']

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

function recordPaymentTerm(row) {
  const conds = Array.isArray(row.paymentTerms) ? row.paymentTerms
    : Array.isArray(row.paymentConditions) ? row.paymentConditions
    : []
  for (const c of conds) {
    const id = c?.conditionTypeId || c?.paymentTermId || c?.id
    if (id == null) continue
    const key = String(id).toUpperCase()
    state.conditionTypeCounts[key] = (state.conditionTypeCounts[key] || 0) + 1
    if (c.conditionTypeName && !state.conditionTypeNames[key]) {
      state.conditionTypeNames[key] = c.conditionTypeName
    }
  }
  // Também tenta pegar o tipo direto na raiz (alguns endpoints da Sienge põem lá)
  const directType = row.paymentTerm || row.conditionType || row.paymentTermId
  if (directType) {
    const key = String(directType?.id ?? directType).toUpperCase()
    if (key && key !== 'OBJECT OBJECT') {
      state.conditionTypeCounts[key] = (state.conditionTypeCounts[key] || 0) + 1
      if (directType?.name) state.conditionTypeNames[key] = directType.name
    }
  }
}

function recordSample(row) {
  // Captura amostra por cada conditionType encontrado
  const candidates = []
  const conds = Array.isArray(row.paymentTerms) ? row.paymentTerms
    : Array.isArray(row.paymentConditions) ? row.paymentConditions
    : []
  for (const c of conds) {
    const id = String(c?.conditionTypeId || c?.paymentTermId || c?.id || '').toUpperCase()
    if (id) candidates.push(id)
  }
  const direct = row.paymentTerm?.id || row.conditionType || row.paymentTermId
  if (direct) candidates.push(String(direct?.id ?? direct).toUpperCase())

  for (const id of candidates) {
    if (!state.sampleByType[id]) state.sampleByType[id] = []
    if (state.sampleByType[id].length < SAMPLES_PER_TYPE) {
      state.sampleByType[id].push(row)
    }
  }
  // Garante pelo menos 1 amostra geral mesmo se não detectou tipo
  if (candidates.length === 0) {
    state.sampleByType['__UNKNOWN__'] = state.sampleByType['__UNKNOWN__'] || []
    if (state.sampleByType['__UNKNOWN__'].length < SAMPLES_PER_TYPE) {
      state.sampleByType['__UNKNOWN__'].push(row)
    }
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
        path: '/bulk-data/v1/income',
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
      if (row.paymentDate || (Array.isArray(row.receipts) && row.receipts.length > 0 && row.receipts.some((r) => r?.paymentDate))) {
        state.totalRowsWithPaymentDate++
      }
      if (Array.isArray(row.receipts) && row.receipts.length > 0) {
        state.totalRowsWithReceipts++
        for (const r of row.receipts) collectKeys(r, receiptKeysSet)
      }
      if (Array.isArray(row.installments)) {
        for (const inst of row.installments) collectKeys(inst, installmentKeysSet)
      }
      updateStatusFields(row)
      recordPaymentTerm(row)
      recordSample(row)
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
console.log('DISCOVERY COMPLETA')
console.log('==================================================================')
console.log(`Total de páginas:              ${state.totalPages}`)
console.log(`Total de linhas:               ${state.totalRows}`)
console.log(`Linhas com paymentDate:        ${state.totalRowsWithPaymentDate}`)
console.log(`Linhas com receipts[]:         ${state.totalRowsWithReceipts}`)
console.log(`Tipos de condição distintos:   ${Object.keys(state.conditionTypeCounts).length}`)
console.log(`Chaves top-level distintas:    ${state.topLevelKeys.length}`)
console.log(`Chaves em receipts[]:          ${state.receiptKeys.length}`)
console.log(`Chaves em installments[]:      ${state.installmentKeys.length}`)
console.log(`Campos status/situation vistos:${Object.keys(state.statusFields).length}`)
console.log(`HTTP errors:                   ${state.httpErrors.length}`)
console.log(`Output:                        ${OUT_PATH}`)
console.log('------------------------------------------------------------------')
console.log('conditionTypeCounts:')
for (const [k, v] of Object.entries(state.conditionTypeCounts).sort((a, b) => b[1] - a[1])) {
  const name = state.conditionTypeNames[k] ? ` (${state.conditionTypeNames[k]})` : ''
  console.log(`  ${k.padEnd(10)} ${String(v).padStart(6)}${name}`)
}
console.log('------------------------------------------------------------------')
console.log('statusFields (candidatos a "é pago?"):')
for (const [field, dist] of Object.entries(state.statusFields)) {
  console.log(`  ${field}:`)
  for (const [val, count] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${val.padEnd(20)} ${count}`)
  }
}
