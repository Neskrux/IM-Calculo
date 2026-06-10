// Mede a inadimplência REAL da carteira Figueira via Sienge — 1 ÚNICA chamada bulk.
// ver .claude/rules/sincronizacao-sienge.md
//
// Endpoint: GET /bulk-data/v1/income — MESMO que já usamos no snapshot de pagos,
//   trocando apenas selectionType de "P" (pagamento) para "D" (vencimento).
//   Params alinhados com docs/auditorias/fase0/fase0-universo-pagos-futuro.json:
//     companyId=5 (IM FIGUEIRA GARCIA SPE), sem enterpriseId.
//   Janela: startDate=2018-01-01 .. endDate=HOJE  → todas as parcelas VENCIDAS.
//
// Uma só chamada traz pagas + não pagas vencidas:
//   - matured        = dueDate <= hoje
//   - inadimplente   = matured com balanceAmount > 0 (saldo em aberto)
//   - aging          = (hoje - dueDate) calculado local
// Sanity-check: nº de pagas-vencidas aqui ≈ snapshot local selectionType=P.
//
// Saída: docs/auditorias/fase0/inadimplencia-sienge-<hoje>.json (raw + métrica).
// Custa exatamente 1 chamada bulk (sem quota diária; limite 20 req/min).

import { siengeGet, extractRows } from './_sienge-http.mjs'
import { readFileSync, writeFileSync } from 'node:fs'

const HOJE = new Date().toISOString().slice(0, 10)
const START = '2018-01-01'
const COMPANY_ID = 5
const PAID_SNAPSHOT = 'docs/auditorias/fase0/fase0-universo-pagos-futuro.json'

const diasEntre = (d) => Math.floor((Date.parse(HOJE) - Date.parse(d)) / 86400000)

async function main() {
  console.log(`income selectionType=D (companyId=${COMPANY_ID}, ${START}..${HOJE})...`)
  const resp = await siengeGet({
    path: '/bulk-data/v1/income',
    query: { startDate: START, endDate: HOJE, selectionType: 'D', companyId: COMPANY_ID },
    noCache: true, // chamada real de validação — não servir cache
  })
  const rows = extractRows(resp.data)
  console.log(`parcelas retornadas (vencidas no período): ${rows.length}`)

  let maturedCount = 0, maturedOriginal = 0
  let pagasCount = 0, pagasValor = 0
  let inadCount = 0, inadSaldo = 0, inadOriginal = 0
  const aging = { '1-30': 0, '31-90': 0, '91-180': 0, '181-365': 0, '365+': 0 }
  const clientesInad = new Set()
  const porTermo = new Map() // paymentTerm -> {matured, inad, saldo}

  for (const r of rows) {
    if (!r.dueDate || r.dueDate > HOJE) continue // só vencidas
    maturedCount++
    const orig = Number(r.originalAmount || 0)
    maturedOriginal += orig
    const saldo = Number(r.balanceAmount || 0)
    const term = r.paymentTerm?.id || '?'
    if (!porTermo.has(term)) porTermo.set(term, { matured: 0, inad: 0, saldo: 0 })
    const pt = porTermo.get(term)
    pt.matured++

    if (saldo > 0.005) {
      inadCount++
      inadSaldo += saldo
      inadOriginal += orig
      if (r.clientId != null) clientesInad.add(r.clientId)
      pt.inad++
      pt.saldo += saldo
      const d = diasEntre(r.dueDate)
      if (d <= 30) aging['1-30']++
      else if (d <= 90) aging['31-90']++
      else if (d <= 180) aging['91-180']++
      else if (d <= 365) aging['181-365']++
      else aging['365+']++
    } else {
      pagasCount++
      const rec = Array.isArray(r.receipts) ? r.receipts : []
      for (const rc of rec) pagasValor += Number(rc.netAmount || 0)
    }
  }

  // sanity-check contra snapshot local de pagos
  let pagasLocalVencidas = null
  try {
    const paid = JSON.parse(readFileSync(PAID_SNAPSHOT, 'utf8')).rows || []
    pagasLocalVencidas = paid.filter((r) => r.dueDate && r.dueDate <= HOJE).length
  } catch { /* opcional */ }

  const pctParcelas = maturedCount > 0 ? (inadCount / maturedCount * 100) : 0
  const pctValor = maturedOriginal > 0 ? (inadOriginal / maturedOriginal * 100) : 0

  const out = {
    meta: {
      geradoEm: new Date().toISOString(),
      spec_ref: '.claude/rules/sincronizacao-sienge.md',
      script: 'scripts/medir-inadimplencia-sienge.mjs',
      endpoint: '/bulk-data/v1/income',
      params: { startDate: START, endDate: HOJE, selectionType: 'D', companyId: COMPANY_ID },
    },
    universo: {
      parcelasVencidas: maturedCount,
      valorOriginalVencido: Number(maturedOriginal.toFixed(2)),
      pagasVencidas: pagasCount,
      valorPagasVencidas: Number(pagasValor.toFixed(2)),
    },
    inadimplencia: {
      clientesInadimplentes: clientesInad.size,
      parcelasEmAtraso: inadCount,
      saldoEmAberto: Number(inadSaldo.toFixed(2)),
      valorOriginalEmAtraso: Number(inadOriginal.toFixed(2)),
      aging,
    },
    taxa: {
      inadimplenciaPctParcelas: Number(pctParcelas.toFixed(2)),
      inadimplenciaPctValor: Number(pctValor.toFixed(2)),
    },
    sanityCheck: { pagasVencidasLocalSnapshot: pagasLocalVencidas, pagasVencidasSiengeD: pagasCount },
    porPaymentTerm: [...porTermo.entries()].map(([id, v]) => ({
      id, matured: v.matured, inad: v.inad, saldo: Number(v.saldo.toFixed(2)),
    })).sort((a, b) => b.inad - a.inad),
  }

  const outPath = `docs/auditorias/fase0/inadimplencia-sienge-${HOJE}.json`
  writeFileSync(outPath, JSON.stringify(out, null, 2))

  // Sidecar com as linhas cruas (billId+installmentId+balanceAmount+dueDate+
  // receipts) pra reconciliação OFFLINE da cauda — sem gastar bulk extra.
  // ver scripts/reconciliar-cauda-inadimplencia.mjs
  const rawPath = `docs/auditorias/fase0/income-D-raw-${HOJE}.json`
  writeFileSync(rawPath, JSON.stringify({
    meta: { ...out.meta, totalRows: rows.length },
    rows: rows.map((r) => ({
      billId: r.billId,
      installmentId: r.installmentId,
      installmentNumber: r.installmentNumber,
      clientId: r.clientId,
      clientName: r.clientName,
      mainUnit: r.mainUnit,
      dueDate: r.dueDate,
      originalAmount: r.originalAmount,
      balanceAmount: r.balanceAmount,
      paymentTerm: r.paymentTerm,
      receipts: Array.isArray(r.receipts)
        ? r.receipts.map((rc) => ({ paymentDate: rc.paymentDate, netAmount: rc.netAmount }))
        : [],
    })),
  }, null, 2))
  console.log(`Raw sidecar: ${rawPath}`)

  console.log('================ INADIMPLÊNCIA REAL (Sienge income/D) ================')
  console.log(`parcelas vencidas (matured):  ${maturedCount}  | R$ orig ${maturedOriginal.toFixed(2)}`)
  console.log(`  pagas vencidas:             ${pagasCount}`)
  console.log(`  EM ATRASO:                  ${inadCount}  (${clientesInad.size} clientes)`)
  console.log(`saldo em aberto vencido:      R$ ${inadSaldo.toFixed(2)}`)
  console.log(`aging (dias de atraso):`, aging)
  console.log(`sanity pagas-vencidas: localP=${pagasLocalVencidas} vs siengeD=${pagasCount}`)
  console.log(`>> INADIMPLÊNCIA: ${pctParcelas.toFixed(2)}% das parcelas vencidas | ${pctValor.toFixed(2)}% do valor vencido`)
  console.log(`Output: ${outPath}`)
}

main().catch((e) => { console.error('FALHOU:', e); process.exit(1) })
