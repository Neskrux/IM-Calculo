// Fase 0 — Validação da inadimplência Sienge (06/mar/2026) + universo total de pagos.
// ver .claude/rules/sincronizacao-sienge.md
//
// Gasta EXATAMENTE 2 tokens bulk. Sem retry, sem paginação (bulk não pagina).
//
// R1: /bulk-data/v1/income selectionType=D  startDate=2020-01-01 endDate=2026-03-06  companyId=5
//     → universo total vencido até 06/mar, pagos e pendentes
//     → calcula: total_a_receber, total_pago_ate_data, inadimplencia%
//
// R2: /bulk-data/v1/income selectionType=P  startDate=2020-01-01 endDate=2026-04-23  companyId=5
//     → universo de parcelas JÁ PAGAS no histórico todo da Figueira
//
// Saída: docs/fase0-inadimplencia-0603.json + docs/fase0-universo-pagos.json

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

function loadEnv() {
  const raw = readFileSync('.env', 'utf8')
  const env = {}
  for (const line of raw.split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue
    const idx = line.indexOf('=')
    const k = line.slice(0, idx).trim()
    const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    env[k] = v
  }
  return { ...process.env, ...env }
}
const env = loadEnv()
const AUTH = 'Basic ' + Buffer.from(`${env.SIENGE_USERNAME}:${env.SIENGE_PASSWORD}`).toString('base64')
const BULK_BASE = `https://api.sienge.com.br/${env.SIENGE_SUBDOMAIN}/public/api`
const TIMEOUT_MS = 90_000

async function rawGet({ label, query }) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const url = `${BULK_BASE}/bulk-data/v1/income?${params.toString()}`
  console.log(`\n[${label}] GET ${url}`)
  const t0 = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: AUTH, Accept: 'application/json' },
      signal: ctrl.signal,
    })
    const elapsedMs = Date.now() - t0
    const rateLimit = res.headers.get('X-Rate-Limit-Remaining') || res.headers.get('RateLimit-Remaining')
    const bodyText = await res.text()
    let body
    try { body = JSON.parse(bodyText) } catch { body = bodyText.slice(0, 2000) }
    console.log(`[${label}] status=${res.status}  elapsed=${elapsedMs}ms  X-Rate-Limit-Remaining=${rateLimit}`)
    return { label, url, status: res.status, elapsedMs, rateLimit, body, bodyBytes: bodyText.length }
  } finally {
    clearTimeout(timer)
  }
}

function extractRows(data) {
  if (!data) return []
  if (Array.isArray(data)) return data
  for (const k of ['results', 'data', 'income', 'bills']) {
    if (Array.isArray(data[k])) return data[k]
  }
  if (data.data && Array.isArray(data.data.results)) return data.data.results
  return []
}

const DATA_CORTE = '2026-03-06'
const HOJE = '2026-04-23'

mkdirSync('docs', { recursive: true })

console.log('================================================================')
console.log('FASE 0 — Inadimplência Figueira em 06/mar/2026')
console.log('================================================================')
console.log(`companyId=5 (IM FIGUEIRA GARCIA SPE LTDA)`)
console.log(`Data de corte inadimplência: ${DATA_CORTE}`)
console.log(`Gasto: 2 tokens bulk`)

// =====================================================================
// R1 — universo vencido até 06/mar (selectionType=D)
// =====================================================================
const r1 = await rawGet({
  label: 'R1_inadimplencia_0603',
  query: {
    startDate: '2020-01-01',
    endDate: DATA_CORTE,
    selectionType: 'D',
    companyId: 5,
  },
})

if (r1.status !== 200) {
  console.error(`R1 falhou: status=${r1.status}`)
  console.error(JSON.stringify(r1.body).slice(0, 500))
  writeFileSync('docs/fase0-inadimplencia-0603.json', JSON.stringify(r1, null, 2))
  process.exit(1)
}

const rowsR1 = extractRows(r1.body)
writeFileSync('docs/fase0-inadimplencia-0603.json', JSON.stringify({
  meta: { startDate: '2020-01-01', endDate: DATA_CORTE, selectionType: 'D', companyId: 5, elapsedMs: r1.elapsedMs, rateLimit: r1.rateLimit, bytes: r1.bodyBytes, rows: rowsR1.length },
  rows: rowsR1,
}, null, 2))
console.log(`[R1] rows=${rowsR1.length}  bytes=${(r1.bodyBytes/1024).toFixed(0)}KB  → docs/fase0-inadimplencia-0603.json`)

// ---- Cálculo inadimplência ----
// Universo = soma de originalAmount de todas as parcelas vencidas até 06/mar
// Pago até 06/mar = soma de receipts[].netAmount onde receipt.paymentDate <= 06/mar
// Em aberto = universo - pago_ate_data
// Inadimplência% = em_aberto / universo * 100

let totalOriginal = 0
let totalPagoAteCorte = 0
let totalPagoTotal = 0          // inclui recebimentos APÓS o corte (só pra contraste)
let parcelasTotais = 0
let parcelasComReceipt = 0
let parcelasComReceiptAteCorte = 0
let parcelasSemReceipt = 0

for (const row of rowsR1) {
  parcelasTotais++
  totalOriginal += Number(row.originalAmount || 0)
  const receipts = Array.isArray(row.receipts) ? row.receipts : []
  if (receipts.length === 0) {
    parcelasSemReceipt++
    continue
  }
  parcelasComReceipt++
  let pagoNaLinha = 0
  let pagoNaLinhaAteCorte = 0
  for (const rc of receipts) {
    const net = Number(rc.netAmount || 0)
    pagoNaLinha += net
    if (rc.paymentDate && rc.paymentDate <= DATA_CORTE) {
      pagoNaLinhaAteCorte += net
    }
  }
  totalPagoTotal += pagoNaLinha
  totalPagoAteCorte += pagoNaLinhaAteCorte
  if (pagoNaLinhaAteCorte > 0) parcelasComReceiptAteCorte++
}

const emAberto = totalOriginal - totalPagoAteCorte
const inadimplenciaPct = totalOriginal > 0 ? (emAberto / totalOriginal) * 100 : 0

console.log('\n----------------------------------------------------------------')
console.log('INADIMPLÊNCIA em 06/mar/2026 (a partir de /bulk-data/v1/income)')
console.log('----------------------------------------------------------------')
console.log(`Parcelas vencidas até ${DATA_CORTE}:        ${parcelasTotais}`)
console.log(`  com receipts[] (algum recebimento):       ${parcelasComReceipt}`)
console.log(`  com receipts[] até ${DATA_CORTE}:          ${parcelasComReceiptAteCorte}`)
console.log(`  SEM receipts[] (nunca pagas):             ${parcelasSemReceipt}`)
console.log('')
console.log(`Total originalAmount (universo):          R$ ${totalOriginal.toFixed(2)}`)
console.log(`Total pago até ${DATA_CORTE}:              R$ ${totalPagoAteCorte.toFixed(2)}`)
console.log(`Total pago TOTAL (inclui pós-corte):      R$ ${totalPagoTotal.toFixed(2)}`)
console.log(`Em aberto em ${DATA_CORTE}:                R$ ${emAberto.toFixed(2)}`)
console.log(`>> INADIMPLÊNCIA: ${inadimplenciaPct.toFixed(2)}%  <<`)

// =====================================================================
// R2 — universo total de parcelas JÁ PAGAS (histórico completo)
// =====================================================================
const r2 = await rawGet({
  label: 'R2_universo_pagos',
  query: {
    startDate: '2020-01-01',
    endDate: HOJE,
    selectionType: 'P',
    companyId: 5,
  },
})

if (r2.status !== 200) {
  console.error(`R2 falhou: status=${r2.status}`)
  console.error(JSON.stringify(r2.body).slice(0, 500))
  writeFileSync('docs/fase0-universo-pagos.json', JSON.stringify(r2, null, 2))
  process.exit(1)
}

const rowsR2 = extractRows(r2.body)
writeFileSync('docs/fase0-universo-pagos.json', JSON.stringify({
  meta: { startDate: '2020-01-01', endDate: HOJE, selectionType: 'P', companyId: 5, elapsedMs: r2.elapsedMs, rateLimit: r2.rateLimit, bytes: r2.bodyBytes, rows: rowsR2.length },
  rows: rowsR2,
}, null, 2))
console.log(`\n[R2] rows=${rowsR2.length}  bytes=${(r2.bodyBytes/1024).toFixed(0)}KB  → docs/fase0-universo-pagos.json`)

// Distribuição de paymentTerm (tipos de parcela)
const paymentTermCount = {}
let pagoTotalR2 = 0
for (const row of rowsR2) {
  const id = String(row.paymentTerm?.id || 'UNKNOWN').trim()
  paymentTermCount[id] = (paymentTermCount[id] || 0) + 1
  const receipts = Array.isArray(row.receipts) ? row.receipts : []
  for (const rc of receipts) pagoTotalR2 += Number(rc.netAmount || 0)
}

console.log('\n----------------------------------------------------------------')
console.log('UNIVERSO TOTAL DE PAGOS (selectionType=P, 2020-01-01 → hoje)')
console.log('----------------------------------------------------------------')
console.log(`Parcelas pagas no Sienge:                 ${rowsR2.length}`)
console.log(`Total recebido (sum netAmount):           R$ ${pagoTotalR2.toFixed(2)}`)
console.log('')
console.log('Distribuição por paymentTerm:')
for (const [id, n] of Object.entries(paymentTermCount).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${id.padEnd(10)} ${String(n).padStart(6)}`)
}

console.log('\n================================================================')
console.log('FIM — 2 tokens bulk gastos')
console.log(`Tokens restantes (última leitura):  ${r2.rateLimit}`)
console.log('================================================================')
