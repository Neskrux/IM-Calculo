import { readFileSync } from 'node:fs'
const an = JSON.parse(readFileSync('docs/analise-b5-duplicatas.json', 'utf8'))

const perdedoresPagos = []
for (const d of an.decisoes) {
  for (const p of d.perdedores) {
    if (p.status === 'pago') {
      perdedoresPagos.push({
        contract: d.contract, seq: d.seq, billId: d.billId,
        sienge_due: d.sienge.due,
        vencedor_status: d.vencedor.status,
        vencedor_dp: d.vencedor.data_prevista, vencedor_dpag: d.vencedor.data_pagamento, vencedor_dist: d.vencedor.dist_dias,
        perdedor_dp: p.data_prevista, perdedor_dpag: p.data_pagamento, perdedor_dist: p.dist_dias,
        perdedor_id: p.id,
      })
    }
  }
}

// Classificar
const grupos = {
  duplicata_limpa: [],      // vencedor pago+dist=0, perdedor pago+dist=0 (mesmo pagamento duplicado)
  perdedor_outro_periodo: [], // vencedor pendente/pago dist=0, perdedor pago com dist>>0 (pagamento antigo talvez pertenca a outra seq)
  vencedor_nao_bate_sienge: [], // vencedor tambem nao bate com Sienge (raro)
}
for (const r of perdedoresPagos) {
  if (r.vencedor_dist === 0 && r.perdedor_dist === 0) grupos.duplicata_limpa.push(r)
  else if (r.vencedor_dist === 0 && r.perdedor_dist > 30) grupos.perdedor_outro_periodo.push(r)
  else grupos.vencedor_nao_bate_sienge.push(r)
}

console.log(`Total perdedores pagos: ${perdedoresPagos.length}`)
console.log(`  duplicata limpa (venc e perd em dp Sienge): ${grupos.duplicata_limpa.length}`)
console.log(`  perdedor em outro periodo (dist > 30d):     ${grupos.perdedor_outro_periodo.length}`)
console.log(`  vencedor tambem nao bate Sienge:            ${grupos.vencedor_nao_bate_sienge.length}`)

console.log('\n=== DUPLICATA LIMPA (cancelar perdedor = seguro) ===')
for (const r of grupos.duplicata_limpa.slice(0, 5)) {
  console.log(`  venda=${r.contract} seq=${r.seq}  Sienge=${r.sienge_due}  venc dpag=${r.vencedor_dpag}  perd dpag=${r.perdedor_dpag}`)
}

console.log('\n=== PERDEDOR EM OUTRO PERIODO (pagamento real de outra seq?) ===')
for (const r of grupos.perdedor_outro_periodo) {
  console.log(`  venda=${r.contract} seq=${r.seq}  Sienge=${r.sienge_due}  venc=${r.vencedor_status} dp=${r.vencedor_dp} dpag=${r.vencedor_dpag}  | perd dp=${r.perdedor_dp} dpag=${r.perdedor_dpag} dist=${r.perdedor_dist}d`)
}

console.log('\n=== VENCEDOR TAMBEM NAO BATE (revisao humana) ===')
for (const r of grupos.vencedor_nao_bate_sienge) {
  console.log(`  venda=${r.contract} seq=${r.seq}  Sienge=${r.sienge_due}  venc dp=${r.vencedor_dp} dpag=${r.vencedor_dpag} dist=${r.vencedor_dist}d  perd dp=${r.perdedor_dp} dpag=${r.perdedor_dpag} dist=${r.perdedor_dist}d`)
}
