// Validação A — match rate entre billId do income e receivableBillId do banco.
// ver .claude/rules/sincronizacao-sienge.md
//
// Zero request Sienge. Lê docs/fase0-universo-pagos-futuro.json (3721 parcelas)
// e cruza com lista de 299 receivableBillIds dos sales-contracts no banco
// (obtida via MCP, hardcoded abaixo como "anchor").
//
// Pergunta: dos N billIds únicos do income, quantos estão no banco?
// Meta: >=95% match primário pra decidir sobre Option A (coluna extra) vs B (JOIN inline).
//
// Saída: docs/validacao-A-match-billid.json

import { readFileSync, writeFileSync } from 'node:fs'

// Fonte: MCP query em sienge_raw.objects entity=sales-contracts
const BANCO_BILL_IDS = [
  1,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,23,24,25,26,27,28,29,30,31,34,
  135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,
  154,155,156,157,158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,
  173,174,175,176,177,178,179,180,181,182,183,184,185,186,188,189,190,191,192,
  193,194,195,196,197,198,199,200,201,202,203,204,205,206,207,208,209,210,211,
  212,213,214,215,216,217,218,219,220,221,222,223,224,225,226,227,228,229,230,
  231,232,233,234,235,236,237,238,239,240,241,242,243,244,245,246,247,248,249,
  250,251,252,253,254,255,256,257,258,259,260,261,262,263,264,265,266,267,268,
  269,270,271,272,273,274,275,276,277,278,279,280,281,282,283,284,285,286,287,
  288,289,290,291,292,293,294,295,296,297,298,299,300,301,302,303,304,305,306,
  307,308,309,310,311,312,313,314,315,316,317,318,319,320,321,
  367,368,369,370,371,372,373,374,375,376,377,380,381,382,383,384,385,386,
  398,399,400,401,402,404,406,408,410,411,413,414,415,416,417,418,419,422,425,
  426,427,428,429,430,
  444,445,448,449,450,451,452,453,454,455,456,457,461,462,463,465,466,467,468,
  469,470,471,476,477,479,481,482,483,484,489,491,492,495,496,497,499,500,501,
  502,505,507,508,509,
]

const bancoSet = new Set(BANCO_BILL_IDS)
if (bancoSet.size !== 299) {
  console.error(`ERRO: esperado 299 billIds no banco, veio ${bancoSet.size}`)
  process.exit(1)
}

console.log('================================================================')
console.log('VALIDAÇÃO A — match billId income ↔ receivableBillId banco')
console.log('================================================================')
console.log(`billIds no banco (RAW sales-contracts): ${bancoSet.size}`)

const raw = JSON.parse(readFileSync('docs/fase0-universo-pagos-futuro.json', 'utf8'))
const rows = raw.rows || []
console.log(`Parcelas no income JSON:                ${rows.length}`)

const incomePorBill = new Map()  // billId → {parcelas, valorTotal, pagoTotal, numerosParcelas}
let semBillId = 0
for (const row of rows) {
  const bid = row.billId
  if (bid == null) { semBillId++; continue }
  if (!incomePorBill.has(bid)) {
    incomePorBill.set(bid, {
      parcelas: 0,
      valorOriginal: 0,
      pago: 0,
      numeros: [],
    })
  }
  const agg = incomePorBill.get(bid)
  agg.parcelas++
  agg.valorOriginal += Number(row.originalAmount || 0)
  const receipts = Array.isArray(row.receipts) ? row.receipts : []
  for (const rc of receipts) agg.pago += Number(rc.netAmount || 0)
  agg.numeros.push(row.installmentNumber || '?')
}

console.log(`Linhas sem billId:                      ${semBillId}`)
console.log(`billIds distintos no income:            ${incomePorBill.size}`)
console.log('')

// Cruzamento
const matched = []
const orfaos = []        // billId no income mas NÃO no banco
for (const [bid, agg] of incomePorBill.entries()) {
  if (bancoSet.has(bid)) matched.push({ billId: bid, ...agg })
  else orfaos.push({ billId: bid, ...agg })
}

const fantasmas = []     // billId no banco mas SEM registros no income (bill sem pagamento nenhum)
for (const bid of bancoSet) {
  if (!incomePorBill.has(bid)) fantasmas.push(bid)
}

const totalIncomeBillIds = incomePorBill.size
const matchRate = totalIncomeBillIds > 0 ? (matched.length / totalIncomeBillIds * 100) : 0

console.log('----------------------------------------------------------------')
console.log(`billIds no income QUE ESTÃO no banco:   ${matched.length}  (match rate ${matchRate.toFixed(2)}%)`)
console.log(`billIds no income QUE NÃO estão:        ${orfaos.length}  (órfãos)`)
console.log(`billIds no banco SEM registro income:   ${fantasmas.length}  (fantasmas — bill sem pagamento)`)
console.log('')

// Quantas parcelas estão cobertas pelos matched?
const parcelasMatched = matched.reduce((a, m) => a + m.parcelas, 0)
const parcelasOrfas = orfaos.reduce((a, m) => a + m.parcelas, 0)
const valorMatched = matched.reduce((a, m) => a + m.valorOriginal, 0)
const valorOrfao = orfaos.reduce((a, m) => a + m.valorOriginal, 0)
const pagoMatched = matched.reduce((a, m) => a + m.pago, 0)
const pagoOrfao = orfaos.reduce((a, m) => a + m.pago, 0)

console.log(`Parcelas income cobertas (matched):     ${parcelasMatched}  (${(parcelasMatched/rows.length*100).toFixed(2)}%)`)
console.log(`Parcelas income órfãs:                  ${parcelasOrfas}  (${(parcelasOrfas/rows.length*100).toFixed(2)}%)`)
console.log('')
console.log(`Valor original coberto:      R$ ${valorMatched.toFixed(2)}`)
console.log(`Valor original órfão:        R$ ${valorOrfao.toFixed(2)}`)
console.log(`Pago coberto:                R$ ${pagoMatched.toFixed(2)}`)
console.log(`Pago órfão:                  R$ ${pagoOrfao.toFixed(2)}`)
console.log('')

// Amostra dos órfãos pra entender o que são
if (orfaos.length > 0) {
  console.log('Top 10 billIds órfãos (ordenados por parcelas):')
  const top = [...orfaos].sort((a, b) => b.parcelas - a.parcelas).slice(0, 10)
  for (const o of top) {
    console.log(`  billId=${String(o.billId).padStart(5)}  parcelas=${String(o.parcelas).padStart(3)}  valor=R$ ${o.valorOriginal.toFixed(2).padStart(12)}  pago=R$ ${o.pago.toFixed(2).padStart(12)}`)
  }
  console.log('')
}

if (fantasmas.length > 0) {
  console.log(`Amostra de fantasmas (primeiros 10): ${fantasmas.slice(0, 10).join(', ')}${fantasmas.length > 10 ? '...' : ''}`)
  console.log('')
}

// Salva output completo
writeFileSync('docs/validacao-A-match-billid.json', JSON.stringify({
  meta: {
    bancoBillIds: bancoSet.size,
    incomeRows: rows.length,
    incomeBillIds: totalIncomeBillIds,
    matched: matched.length,
    orfaos: orfaos.length,
    fantasmas: fantasmas.length,
    matchRatePct: Number(matchRate.toFixed(2)),
    parcelasMatched,
    parcelasOrfas,
    valorMatched: Number(valorMatched.toFixed(2)),
    valorOrfao: Number(valorOrfao.toFixed(2)),
    pagoMatched: Number(pagoMatched.toFixed(2)),
    pagoOrfao: Number(pagoOrfao.toFixed(2)),
  },
  orfaos: orfaos.sort((a, b) => b.parcelas - a.parcelas),
  fantasmas,
}, null, 2))

console.log('----------------------------------------------------------------')
if (matchRate >= 95) {
  console.log('>> VEREDITO: match primário viável. Fallback não necessário. <<')
} else if (matchRate >= 80) {
  console.log(`>> VEREDITO: match primário ${matchRate.toFixed(1)}% — fallback necessário pra cobrir órfãos. <<`)
} else {
  console.log(`>> VEREDITO: match primário fraco (${matchRate.toFixed(1)}%) — investigar premissa billId↔receivableBillId. <<`)
}
console.log('Output: docs/validacao-A-match-billid.json')
