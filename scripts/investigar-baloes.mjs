// Investigacao: B1-B9 vs BA — hipotese do usuario:
//   "B1 = 2023, B2 = 2024, ..." (um balao por ano, numero = seq anual)
//   "BA" = balao generico com installmentNumber marcando a seq
//
// Objetivo: validar pelos dados crus do Sienge (docs/fase5-universo-dueDate-RAW.json).
// Amostras a extrair por paymentTerm.id:
//   - contagem total
//   - installmentNumber distintos (B1-B9 geralmente "1/1"? BA geralmente "1/N, 2/N..."?)
//   - dueDate range por billId (um B1 por contrato? dois B1 no mesmo contrato?)
//   - mesmo billId tem quais PTs simultaneamente?
//
// Saida: docs/investigacao-baloes.json + sumario no stdout.

import { readFileSync, writeFileSync } from 'node:fs'

const raw = JSON.parse(readFileSync('docs/fase5-universo-dueDate-RAW.json', 'utf8'))
const rows = raw.data || []
console.log(`total rows bulk D: ${rows.length}\n`)

const PT_BALAO = new Set(['B1','B2','B3','B4','B5','B6','B7','B8','B9','BA'])

// 1. Contagem por PT
const byPT = new Map()
for (const r of rows) {
  const pt = r.paymentTerm?.id || 'NULL'
  if (!byPT.has(pt)) byPT.set(pt, [])
  byPT.get(pt).push(r)
}

console.log('=== Contagem por paymentTerm.id ===')
const ptOrdered = [...byPT.entries()].sort((a,b)=>b[1].length - a[1].length)
for (const [pt, arr] of ptOrdered) {
  const marker = PT_BALAO.has(pt) ? '*' : ' '
  console.log(`${marker} ${pt.padEnd(6)} ${String(arr.length).padStart(5)}  ${arr[0]?.paymentTerm?.descrition || ''}`)
}

console.log('\n=== Detalhe dos balões (B1-B9 + BA) ===')
const detail = {}
for (const pt of [...PT_BALAO]) {
  const arr = byPT.get(pt) || []
  if (arr.length === 0) continue

  // installmentNumber distintos
  const instCount = new Map()
  for (const r of arr) {
    const inst = String(r.installmentNumber || '')
    instCount.set(inst, (instCount.get(inst) || 0) + 1)
  }

  // billIds distintos + quantos PTs por billId
  const billIds = new Set(arr.map(r => r.billId))

  // dueDate range
  const datas = arr.map(r => r.dueDate).filter(Boolean).sort()
  const minD = datas[0]
  const maxD = datas[datas.length - 1]

  // Exemplos
  const sample = arr.slice(0, 3).map(r => ({
    billId: r.billId,
    installmentNumber: r.installmentNumber,
    dueDate: r.dueDate,
    originalValue: r.originalValue,
  }))

  detail[pt] = {
    total: arr.length,
    billIdsDistintos: billIds.size,
    installmentNumbersDistintos: instCount.size,
    topInstallmentNumbers: [...instCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5),
    dueDateMin: minD,
    dueDateMax: maxD,
    sample,
  }

  console.log(`\n[${pt}] ${arr.length} rows | ${billIds.size} billIds | dueDate ${minD} → ${maxD}`)
  console.log(`  installmentNumbers distintos: ${instCount.size}`)
  console.log(`  top: ${[...instCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>`${k}(${v})`).join(', ')}`)
  console.log(`  sample:`)
  for (const s of sample) {
    console.log(`    billId=${s.billId}  inst=${s.installmentNumber}  due=${s.dueDate}  valor=${s.originalValue}`)
  }
}

// 2. Cruzamento: billIds que tem B1 E B2 E B3... (confirma "um balao por ano")
console.log('\n=== Cruzamento: quais PTs de balao um mesmo billId tem? ===')
const billPts = new Map()
for (const r of rows) {
  const pt = r.paymentTerm?.id
  if (!PT_BALAO.has(pt)) continue
  if (!billPts.has(r.billId)) billPts.set(r.billId, new Set())
  billPts.get(r.billId).add(pt)
}
const comboCount = new Map()
for (const [bid, pts] of billPts) {
  const combo = [...pts].sort().join('+')
  comboCount.set(combo, (comboCount.get(combo) || 0) + 1)
}
console.log(`billIds com balao: ${billPts.size}`)
const comboOrdered = [...comboCount.entries()].sort((a,b)=>b[1]-a[1])
for (const [combo, n] of comboOrdered) {
  console.log(`  ${combo.padEnd(40)} ${n} billIds`)
}

// 3. Padrao anual? Pegar um billId com B1+B2+B3 e ver as datas
console.log('\n=== Validacao hipotese "um balao por ano" ===')
const comBMultiplos = [...billPts.entries()].filter(([_, pts]) => {
  const arr = [...pts]
  const numerados = arr.filter(p => /^B[1-9]$/.test(p))
  return numerados.length >= 2
}).slice(0, 5)

for (const [bid, pts] of comBMultiplos) {
  const ptsOrd = [...pts].sort()
  console.log(`\nbillId=${bid}  PTs=${ptsOrd.join(',')}`)
  for (const pt of ptsOrd) {
    if (!/^B[1-9]$/.test(pt) && pt !== 'BA') continue
    const linhas = rows.filter(r => r.billId === bid && r.paymentTerm?.id === pt)
    for (const l of linhas) {
      console.log(`  ${pt}  inst=${l.installmentNumber}  due=${l.dueDate}  valor=${l.originalValue}`)
    }
  }
}

// 4. BA com multiplos installmentNumber (valida hipotese "BA = todos os baloes em uma serie")
console.log('\n=== Validacao hipotese "BA = serie completa com installmentNumber N/M" ===')
const billsBA = new Map()
for (const r of rows) {
  if (r.paymentTerm?.id !== 'BA') continue
  if (!billsBA.has(r.billId)) billsBA.set(r.billId, [])
  billsBA.get(r.billId).push(r)
}
console.log(`billIds com BA: ${billsBA.size}`)
const baSample = [...billsBA.entries()].sort((a,b)=>b[1].length - a[1].length).slice(0, 3)
for (const [bid, arr] of baSample) {
  console.log(`\nbillId=${bid}  ${arr.length} BAs:`)
  for (const r of arr.slice(0, 10)) {
    console.log(`  inst=${r.installmentNumber}  due=${r.dueDate}  valor=${r.originalValue}`)
  }
  if (arr.length > 10) console.log(`  ... +${arr.length-10} mais`)
}

writeFileSync('docs/investigacao-baloes.json', JSON.stringify({
  contagemPorPT: Object.fromEntries(ptOrdered.map(([k,v])=>[k,v.length])),
  detalheBaloes: detail,
  combosBalaoPorBillId: Object.fromEntries(comboOrdered),
  exemploBAMultiplos: baSample.map(([bid, arr]) => ({
    billId: bid,
    total: arr.length,
    parcelas: arr.map(r => ({ inst: r.installmentNumber, due: r.dueDate, valor: r.originalValue })),
  })),
}, null, 2))

console.log('\nOutput: docs/investigacao-baloes.json')
