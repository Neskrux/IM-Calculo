// Cruza os 79 aditivos (remade-installments) com os bills do INCOME de Figueira (companyId 5),
// que é o universo Figueira fresco — definitivo p/ saber quantos aditivos são REALMENTE Figueira.
// READ-ONLY (income via cache de 1h, 0 bulk se recente).
import { readFileSync } from 'node:fs'
import { siengeGet, extractRows } from './_sienge-http.mjs'

const aditivos = JSON.parse(readFileSync('docs/auditorias/2026-06-03-aditivos/remade-installments-raw.json', 'utf8')).results || []
const r = await siengeGet({ path: '/bulk-data/v1/income', query: { startDate: '2023-01-01', endDate: '2031-12-31', selectionType: 'D', companyId: 5 } })
const income = extractRows(r.data)
const billsFig = new Map()
for (const i of income) { if (i.billId != null && !billsFig.has(Number(i.billId))) billsFig.set(Number(i.billId), i.mainUnit) }

let fig = 0, fora = 0
const figList = [], foraList = []
for (const a of aditivos) {
  const b = Number(a.receivableBillId)
  if (billsFig.has(b)) { fig++; figList.push({ bill: b, unidade: billsFig.get(b), cliente: a.customerDescription, data: a.remadeDate }) }
  else { fora++; foraList.push(a.customerDescription) }
}
console.log(`income Figueira: ${income.length} linhas, ${billsFig.size} bills distintos`)
console.log(`\naditivos total: ${aditivos.length}`)
console.log(`  ADITIVOS DE FIGUEIRA (bill no income cId5): ${fig}`)
console.log(`  fora de Figueira: ${fora}`)
console.log(`\n=== aditivos Figueira ===`)
for (const x of figList) console.log(`  bill ${x.bill} ${x.unidade} | ${x.data} | ${x.cliente}`)
