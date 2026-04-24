// Analisador focado: baloes com |delta_dias| > 365d no plano drift.
// Objetivo: classificar os 143 casos em (a)/(b)/(c) conforme discutido:
//   (a) drift real — Sienge moveu balao para outro ano (renegociacao) → manter local ou aceitar novo?
//   (b) shift de nivel de serie — local em B2/2024, Sienge em B3/2025 (numero da serie subiu 1)
//   (c) match errado — local caiu num B# que nao existe no Sienge pra esse billId
//
// Inputs:
//   docs/fase5-plano-drift-data-prevista-v2.json (filtra tipo=balao, |delta|>365)
//   docs/fase5-universo-dueDate-RAW.json (universo Sienge pra cross-lookup)
//
// Output: docs/analise-baloes-365.json + sumario stdout

import { readFileSync, writeFileSync } from 'node:fs'

const plano = JSON.parse(readFileSync('docs/fase5-plano-drift-data-prevista-v2.json', 'utf8'))
const raw = JSON.parse(readFileSync('docs/fase5-universo-dueDate-RAW.json', 'utf8'))
const rows = raw.data || []

// Index Sienge por billId → lista de baloes com seq normalizada
const PT_MAP = {
  B1: 1, B2: 2, B3: 3, B4: 4, B5: 5, B6: 6, B7: 7, B8: 8, B9: 9,
}
const siengeBillBaloes = new Map() // billId → [{seq, due, ptId, inst}]
for (const r of rows) {
  const pt = r.paymentTerm?.id
  let seq
  if (PT_MAP[pt]) {
    seq = PT_MAP[pt]
  } else if (pt === 'BA') {
    const [n] = String(r.installmentNumber || '').split('/')
    seq = parseInt(n, 10)
    if (!Number.isFinite(seq)) continue
  } else {
    continue
  }
  if (!siengeBillBaloes.has(r.billId)) siengeBillBaloes.set(r.billId, [])
  siengeBillBaloes.get(r.billId).push({
    seq, due: r.dueDate, ptId: pt, inst: r.installmentNumber,
  })
}
for (const arr of siengeBillBaloes.values()) {
  arr.sort((a,b)=> a.seq - b.seq || String(a.due).localeCompare(String(b.due)))
}

// Filtrar plano: baloes com |delta| > 365
const baloes365 = plano.rows.filter(r =>
  r.tipo === 'balao' && Math.abs(r.delta_dias) > 365
)

console.log(`Baloes >365d no plano: ${baloes365.length}`)
console.log(`Delta range: ${Math.min(...baloes365.map(r=>r.delta_dias))} a ${Math.max(...baloes365.map(r=>r.delta_dias))}`)
console.log(`Vendas distintas: ${new Set(baloes365.map(r=>r.venda_id)).size}\n`)

// Classificar cada caso
const classificacoes = {
  shift_exato_1ano: [],     // (b1) delta ~ +/-365d exatos
  shift_multiplo_ano: [],   // (b2) delta ~ +/-(365*N) — N inteiro
  drift_real_livre: [],     // (a) delta >365d mas nao multiplo de ano
  baloes_sem_match_sienge: [], // (c) billId nao tem balao no Sienge com a mesma seq
}

for (const r of baloes365) {
  const billId = r.sienge_receivable_bill_id
  const seqLocal = r.numero_parcela
  const siengeList = siengeBillBaloes.get(billId) || []

  // Procurar no Sienge: tem balao com seq == seqLocal?
  const matchSeq = siengeList.filter(s => s.seq === seqLocal)

  // Tem balao cuja dueDate === data_prevista_sienge do plano (match que o analisador v2 fez)?
  const matchData = siengeList.filter(s => s.due === r.data_prevista_sienge)

  const deltaAnos = r.delta_dias / 365
  const shiftInteiro = Math.abs(deltaAnos - Math.round(deltaAnos)) < 0.05 // +/- 18d de 365

  const registro = {
    pagamento_id: r.pagamento_id,
    venda_id: r.venda_id,
    sienge_contract_id: r.sienge_contract_id,
    billId,
    seq_local: seqLocal,
    data_prevista_local: r.data_prevista_local,
    data_prevista_sienge: r.data_prevista_sienge,
    delta_dias: r.delta_dias,
    delta_anos_aprox: Math.round(deltaAnos * 100) / 100,
    sienge_baloes_completos: siengeList.map(s => `seq${s.seq}@${s.due}`).join(', '),
    match_seq_encontrada: matchSeq.length > 0,
    match_seq_detail: matchSeq.map(s => `seq${s.seq}@${s.due}(${s.ptId})`),
  }

  if (matchSeq.length === 0) {
    classificacoes.baloes_sem_match_sienge.push(registro)
  } else if (shiftInteiro && Math.round(deltaAnos) !== 0) {
    const N = Math.round(deltaAnos)
    if (Math.abs(N) === 1) classificacoes.shift_exato_1ano.push(registro)
    else classificacoes.shift_multiplo_ano.push({...registro, shift_anos: N})
  } else {
    classificacoes.drift_real_livre.push(registro)
  }
}

console.log('=== Classificacao ===')
console.log(`(b1) shift exato 1 ano      (|delta| ~365d):  ${classificacoes.shift_exato_1ano.length}`)
console.log(`(b2) shift multiplo ano     (|delta| ~N*365): ${classificacoes.shift_multiplo_ano.length}`)
console.log(`(a)  drift real livre       (outros >365d):    ${classificacoes.drift_real_livre.length}`)
console.log(`(c)  baloes sem match seq   (orfao no Sienge): ${classificacoes.baloes_sem_match_sienge.length}`)

// Distribuicao shift_multiplo_ano por N
console.log('\n=== (b2) shift por N anos ===')
const byN = new Map()
for (const r of classificacoes.shift_multiplo_ano) {
  byN.set(r.shift_anos, (byN.get(r.shift_anos) || 0) + 1)
}
for (const [n, c] of [...byN.entries()].sort((a,b)=>a[0]-b[0])) {
  console.log(`  shift ${n} anos: ${c} casos`)
}

// Samples
console.log('\n=== Samples ===')
console.log('\n(b1) shift exato 1 ano — sample 3:')
for (const r of classificacoes.shift_exato_1ano.slice(0, 3)) {
  console.log(`  venda=${r.sienge_contract_id} seq=${r.seq_local}  local=${r.data_prevista_local} sienge=${r.data_prevista_sienge} delta=${r.delta_dias}d`)
  console.log(`    sienge_baloes: ${r.sienge_baloes_completos}`)
}
console.log('\n(b2) shift multiplo ano — sample 3:')
for (const r of classificacoes.shift_multiplo_ano.slice(0, 3)) {
  console.log(`  venda=${r.sienge_contract_id} seq=${r.seq_local}  local=${r.data_prevista_local} sienge=${r.data_prevista_sienge} delta=${r.delta_dias}d (${r.shift_anos}a)`)
  console.log(`    sienge_baloes: ${r.sienge_baloes_completos}`)
}
console.log('\n(a) drift real livre — sample 3:')
for (const r of classificacoes.drift_real_livre.slice(0, 3)) {
  console.log(`  venda=${r.sienge_contract_id} seq=${r.seq_local}  local=${r.data_prevista_local} sienge=${r.data_prevista_sienge} delta=${r.delta_dias}d`)
  console.log(`    sienge_baloes: ${r.sienge_baloes_completos}`)
}
console.log('\n(c) baloes sem match seq — sample 5:')
for (const r of classificacoes.baloes_sem_match_sienge.slice(0, 5)) {
  console.log(`  venda=${r.sienge_contract_id} seq=${r.seq_local}  local=${r.data_prevista_local} sienge=${r.data_prevista_sienge} delta=${r.delta_dias}d`)
  console.log(`    sienge_baloes: ${r.sienge_baloes_completos || '(nenhum balao no Sienge pra esse billId)'}`)
}

writeFileSync('docs/analise-baloes-365.json', JSON.stringify({
  meta: {
    geradoEm: new Date().toISOString(),
    totalInput: baloes365.length,
    vendasDistintas: new Set(baloes365.map(r=>r.venda_id)).size,
    deltaMin: Math.min(...baloes365.map(r=>r.delta_dias)),
    deltaMax: Math.max(...baloes365.map(r=>r.delta_dias)),
  },
  sumario: {
    shift_exato_1ano: classificacoes.shift_exato_1ano.length,
    shift_multiplo_ano: classificacoes.shift_multiplo_ano.length,
    drift_real_livre: classificacoes.drift_real_livre.length,
    baloes_sem_match_sienge: classificacoes.baloes_sem_match_sienge.length,
  },
  classificacoes,
}, null, 2))

console.log('\nOutput: docs/analise-baloes-365.json')
