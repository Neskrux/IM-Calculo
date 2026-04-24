// Etapa 5B.4 — analise de colisoes no bulk D Sienge.
// ver .claude/rules/sincronizacao-sienge.md
//
// Objetivo:
//   1. Detectar chaves (billId, tipo, seq) com 2+ linhas no Sienge (re-parcelamento na fonte)
//   2. Para cada colisao, eleger "serie vigente" pela heuristica: maior dueDate
//   3. Cruzar com plano drift pra identificar rows locais afetadas
//   4. Emitir amostra pra validacao humana + plano executavel
//
// NAO executa PATCH — so analise.
//
// Inputs:
//   docs/fase5-universo-dueDate-RAW.json
//   docs/fase5-plano-drift-data-prevista-v2.json (pos-renumeracao)
//
// Outputs:
//   docs/analise-b4-colisoes.json   (decisoes por chave colidida)
//   docs/plano-b4.json              (rows locais que seriam atualizadas)

import { readFileSync, writeFileSync } from 'node:fs'

const PT_MAP = {
  PM: { tipo: 'parcela_entrada', seqFromInstallment: true },
  SN: { tipo: 'sinal', seq: 1 },
  AT: { tipo: 'sinal', seq: 1 },
  B1: { tipo: 'balao', seq: 1 }, B2: { tipo: 'balao', seq: 2 }, B3: { tipo: 'balao', seq: 3 },
  B4: { tipo: 'balao', seq: 4 }, B5: { tipo: 'balao', seq: 5 }, B6: { tipo: 'balao', seq: 6 },
  B7: { tipo: 'balao', seq: 7 }, B8: { tipo: 'balao', seq: 8 }, B9: { tipo: 'balao', seq: 9 },
  BA: { tipo: 'balao', seqFromInstallment: true },
}

function mapRow(r) {
  const ptId = r.paymentTerm?.id
  const m = PT_MAP[ptId]
  if (!m) return null
  let seq = m.seq
  if (m.seqFromInstallment) {
    const [n] = String(r.installmentNumber || '').split('/')
    seq = parseInt(n, 10)
    if (!Number.isFinite(seq)) return null
  }
  return { key: `${r.billId}|${m.tipo}|${seq}`, tipo: m.tipo, seq, ptId, due: r.dueDate, installmentId: r.installmentId, inst: r.installmentNumber, billId: r.billId, valor: r.originalValue }
}

console.log('[1/4] Lendo bulk D Sienge...')
const raw = JSON.parse(readFileSync('docs/fase5-universo-dueDate-RAW.json', 'utf8'))
const bulkRows = (raw.data || []).map(mapRow).filter(Boolean)
console.log(`  bulk mapeado: ${bulkRows.length}\n`)

console.log('[2/4] Agrupando por chave e detectando colisoes...')
const byKey = new Map()
for (const r of bulkRows) {
  if (!byKey.has(r.key)) byKey.set(r.key, [])
  byKey.get(r.key).push(r)
}
const colisoes = new Map()
for (const [k, arr] of byKey) if (arr.length > 1) colisoes.set(k, arr)
console.log(`  chaves distintas:   ${byKey.size}`)
console.log(`  colisoes detectadas:${colisoes.size}\n`)

// Por tipo
const porTipoColisao = {}
for (const [k, arr] of colisoes) {
  porTipoColisao[arr[0].tipo] = (porTipoColisao[arr[0].tipo] || 0) + 1
}
console.log(`  por tipo: ${JSON.stringify(porTipoColisao)}\n`)

console.log('[3/4] Elegendo serie vigente por heuristica "maior dueDate"...')
const decisoes = new Map() // key -> { vencedor, perdedores, tiebreaker? }
for (const [k, arr] of colisoes) {
  // Ordena desc por due; se empate, preserva installmentId maior (mais recente)
  const sorted = [...arr].sort((a, b) => {
    if (a.due && b.due && a.due !== b.due) return String(b.due).localeCompare(String(a.due))
    return (b.installmentId || 0) - (a.installmentId || 0)
  })
  const vencedor = sorted[0]
  const perdedores = sorted.slice(1)
  // Detect empate de due
  const tiebreakerUsado = perdedores.some(p => p.due === vencedor.due)
  decisoes.set(k, { vencedor, perdedores, tiebreakerUsado })
}

// Estatistica: range de "distancia em anos" entre vencedor e perdedor
const distAnos = []
for (const [k, d] of decisoes) {
  for (const p of d.perdedores) {
    if (!p.due || !d.vencedor.due) continue
    const dias = (new Date(d.vencedor.due) - new Date(p.due)) / (1000*60*60*24)
    distAnos.push(Math.round(dias / 365 * 10) / 10)
  }
}
distAnos.sort((a,b)=>a-b)
console.log(`  distancia vencedor vs perdedor (anos):`)
console.log(`    min=${distAnos[0]}  mediana=${distAnos[Math.floor(distAnos.length/2)]}  max=${distAnos[distAnos.length-1]}`)
console.log(`  colisoes com tiebreaker (mesmo due): ${[...decisoes.values()].filter(d=>d.tiebreakerUsado).length}\n`)

console.log('[4/4] Cruzando com plano drift pra identificar rows locais afetadas...')
const plano = JSON.parse(readFileSync('docs/fase5-plano-drift-data-prevista-v2.json', 'utf8'))
const planoDriftByKey = new Map() // key local -> plano row
const afetadas = []
const semMatchNoPlano = []
for (const r of plano.rows) {
  const key = `${r.sienge_receivable_bill_id}|${r.tipo}|${r.numero_parcela}`
  if (colisoes.has(key)) {
    const d = decisoes.get(key)
    const novaData = d.vencedor.due
    // Se local ja esta na data do vencedor, nao atualizar
    const jaCerto = r.data_prevista_atual === novaData
    afetadas.push({
      pagamento_id: r.pagamento_id,
      venda_id: r.venda_id,
      sienge_receivable_bill_id: r.sienge_receivable_bill_id,
      tipo: r.tipo,
      numero_parcela: r.numero_parcela,
      status: r.status,
      data_prevista_atual: r.data_prevista_atual,
      data_prevista_nova: novaData,
      data_prevista_anterior_sienge: d.perdedores.map(p => p.due),
      jaCerto,
      colisaoQtd: colisoes.get(key).length,
      ptId: d.vencedor.ptId,
    })
  } else {
    semMatchNoPlano.push(r) // nao entra em B4, entra em outra etapa ou ja foi resolvida
  }
}

const toUpdate = afetadas.filter(r => !r.jaCerto)
const jaCertos = afetadas.filter(r => r.jaCerto)
console.log(`  rows do plano dentro de colisao:  ${afetadas.length}`)
console.log(`  a atualizar (data difere vencedor):${toUpdate.length}`)
console.log(`  ja na data do vencedor:            ${jaCertos.length}`)
console.log(`  por status a atualizar:            ${JSON.stringify(toUpdate.reduce((a,r)=>{a[r.status]=(a[r.status]||0)+1;return a},{}))}`)
console.log(`  por tipo a atualizar:              ${JSON.stringify(toUpdate.reduce((a,r)=>{a[r.tipo]=(a[r.tipo]||0)+1;return a},{}))}`)

// Sample pra validacao humana
console.log('\n=== AMOSTRA PRA VALIDACAO HUMANA (15 casos) ===\n')
const sample = toUpdate.slice(0, 15)
for (const r of sample) {
  console.log(`billId=${r.sienge_receivable_bill_id}  ${r.tipo}  seq=${r.numero_parcela}  status=${r.status}`)
  console.log(`  local agora:       ${r.data_prevista_atual}`)
  console.log(`  vai virar:         ${r.data_prevista_nova}  <-- vencedor (maior dueDate)`)
  console.log(`  Sienge perdedores: ${r.data_prevista_anterior_sienge.join(', ')}`)
  console.log(`  colisao Sienge:    ${r.colisaoQtd} linhas / ${r.ptId}\n`)
}

// Output files
writeFileSync('docs/analise-b4-colisoes.json', JSON.stringify({
  meta: {
    geradoEm: new Date().toISOString(),
    colisoesDetectadas: colisoes.size,
    porTipoColisao,
    tiebreakersUsados: [...decisoes.values()].filter(d=>d.tiebreakerUsado).length,
    distanciaAnosMin: distAnos[0],
    distanciaAnosMedia: distAnos[Math.floor(distAnos.length/2)],
    distanciaAnosMax: distAnos[distAnos.length-1],
  },
  decisoesAmostra: [...decisoes.entries()].slice(0, 20).map(([k, d]) => ({
    key: k,
    vencedor: { due: d.vencedor.due, ptId: d.vencedor.ptId, inst: d.vencedor.inst, installmentId: d.vencedor.installmentId },
    perdedores: d.perdedores.map(p => ({ due: p.due, ptId: p.ptId, inst: p.inst, installmentId: p.installmentId })),
    tiebreakerUsado: d.tiebreakerUsado,
  })),
}, null, 2))

writeFileSync('docs/plano-b4.json', JSON.stringify({
  meta: {
    geradoEm: new Date().toISOString(),
    heuristica: 'vencedor = linha Sienge com maior dueDate; tiebreaker = installmentId maior',
    totalAfetadas: afetadas.length,
    aAtualizar: toUpdate.length,
    jaCertos: jaCertos.length,
    porStatus: toUpdate.reduce((a,r)=>{a[r.status]=(a[r.status]||0)+1;return a},{}),
    porTipo: toUpdate.reduce((a,r)=>{a[r.tipo]=(a[r.tipo]||0)+1;return a},{}),
  },
  rows: toUpdate,
}, null, 2))

console.log('\nOutputs:')
console.log('  docs/analise-b4-colisoes.json')
console.log('  docs/plano-b4.json')
