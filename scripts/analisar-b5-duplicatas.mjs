// Etapa 5B.5 — analise de series duplicadas de parcela_entrada.
// ver .claude/rules/sincronizacao-sienge.md
//
// Bug do gerador antigo: 12 vendas tem 2 series completas de PM (parcela_entrada)
// geradas pra mesma venda. O backfill do income deu match duplo, inflando pagos.
//
// Heuristica de eleicao da linha vigente por seq colidido:
//   1. menor |data_prevista_local - dueDate_sienge|  (match mais justo ao Sienge)
//   2. tiebreaker: data_pagamento mais recente (pago mais novo vence)
//   3. tiebreaker final: menor created_at (linha original do banco, nao a duplicata)
//
// Perdedora = status='cancelado' (preserva data_pagamento; NAO reverte pago->pendente).
//
// Inputs:
//   docs/b5-colididos.json        (query SQL: todas linhas colididas com contexto)
//   docs/fase5-universo-dueDate-RAW.json (bulk D Sienge)
//
// Output: docs/analise-b5-duplicatas.json

import { readFileSync, writeFileSync } from 'node:fs'

const colididos = JSON.parse(readFileSync('docs/b5-colididos.json', 'utf8'))
const raw = JSON.parse(readFileSync('docs/fase5-universo-dueDate-RAW.json', 'utf8'))

// Index Sienge PM por (billId, seq)
const siengePM = new Map() // billId -> Map(seq -> [{due, installmentId, inst}])
for (const r of raw.data || []) {
  if (r.paymentTerm?.id !== 'PM') continue
  const [n] = String(r.installmentNumber || '').split('/')
  const seq = parseInt(n, 10)
  if (!Number.isFinite(seq)) continue
  if (!siengePM.has(r.billId)) siengePM.set(r.billId, new Map())
  const m = siengePM.get(r.billId)
  if (!m.has(seq)) m.set(seq, [])
  m.get(seq).push({ due: r.dueDate, installmentId: r.installmentId, inst: r.installmentNumber })
}

// Agrupar colididos por (venda_id, seq)
const grupos = new Map()
for (const r of colididos) {
  const k = `${r.venda_id}|${r.numero_parcela}`
  if (!grupos.has(k)) grupos.set(k, { rows: [], billId: r.sienge_receivable_bill_id, venda_id: r.venda_id, seq: r.numero_parcela, contract: r.sienge_contract_id })
  grupos.get(k).rows.push(r)
}

console.log(`Grupos (venda_id, seq) colididos: ${grupos.size}\n`)

const decisoes = []
const semSiengeMatch = []
const semPMnoBill = []
const tiebreakDatap = []
const tiebreakCreated = []

for (const [k, g] of grupos) {
  const pmBill = siengePM.get(g.billId)
  if (!pmBill) { semPMnoBill.push(g); continue }
  const cand = pmBill.get(g.seq)
  if (!cand || cand.length === 0) { semSiengeMatch.push(g); continue }

  // Escolhe a linha Sienge com maior installmentId (serie vigente, consistente com B.4)
  const siengeVig = cand.sort((a, b) => (b.installmentId || 0) - (a.installmentId || 0))[0]
  const dueSi = siengeVig.due

  // Ranking local
  const scored = g.rows.map(r => {
    const d1 = r.data_prevista ? Math.abs((new Date(r.data_prevista) - new Date(dueSi)) / (1000*60*60*24)) : 99999
    return {
      ...r,
      dist_dias: Math.round(d1),
      pago_ts: r.data_pagamento ? new Date(r.data_pagamento).getTime() : 0,
      created_ts: r.created_at ? new Date(r.created_at).getTime() : Number.MAX_SAFE_INTEGER,
    }
  })
  scored.sort((a, b) => {
    if (a.dist_dias !== b.dist_dias) return a.dist_dias - b.dist_dias
    if (a.pago_ts !== b.pago_ts) return b.pago_ts - a.pago_ts      // pagamento mais recente vence
    return a.created_ts - b.created_ts                              // created_at mais antigo vence
  })
  const vencedor = scored[0]
  const perdedores = scored.slice(1)

  // Detectar qual tiebreaker foi usado
  const allSameDist = scored.every(s => s.dist_dias === vencedor.dist_dias)
  const tb1 = allSameDist && perdedores.some(p => p.pago_ts !== vencedor.pago_ts)
  const tb2 = allSameDist && !tb1

  if (tb1) tiebreakDatap.push(k)
  if (tb2) tiebreakCreated.push(k)

  decisoes.push({
    venda_id: g.venda_id,
    contract: g.contract,
    billId: g.billId,
    seq: g.seq,
    sienge: { due: dueSi, installmentId: siengeVig.installmentId, inst: siengeVig.inst },
    vencedor: {
      id: vencedor.id,
      status: vencedor.status,
      data_prevista: vencedor.data_prevista,
      data_pagamento: vencedor.data_pagamento,
      valor: vencedor.valor,
      created_at: vencedor.created_at,
      dist_dias: vencedor.dist_dias,
    },
    perdedores: perdedores.map(p => ({
      id: p.id,
      status: p.status,
      data_prevista: p.data_prevista,
      data_pagamento: p.data_pagamento,
      valor: p.valor,
      created_at: p.created_at,
      dist_dias: p.dist_dias,
      acao: p.status === 'cancelado' ? 'ja_cancelado_skip' : 'cancelar',
    })),
    tiebreakerUsado: tb1 ? 'data_pagamento' : (tb2 ? 'created_at' : null),
  })
}

// Contagens
const totalGrupos = decisoes.length
let totalCancelar = 0
let totalSkipJaCancelado = 0
const porStatusVencedor = {}
const porStatusPerdedor = {}
const vencedorMaisNovo = [] // caso problematico: vencedor criado DEPOIS do perdedor

for (const d of decisoes) {
  porStatusVencedor[d.vencedor.status] = (porStatusVencedor[d.vencedor.status] || 0) + 1
  for (const p of d.perdedores) {
    porStatusPerdedor[p.status] = (porStatusPerdedor[p.status] || 0) + 1
    if (p.acao === 'cancelar') totalCancelar++
    else totalSkipJaCancelado++
    // Vencedor foi criado DEPOIS do perdedor? Sinal de alerta.
    if (new Date(d.vencedor.created_at) > new Date(p.created_at)) {
      vencedorMaisNovo.push({ venda: d.contract, seq: d.seq, vencedor_created: d.vencedor.created_at, perdedor_created: p.created_at, tiebreaker: d.tiebreakerUsado })
    }
  }
}

console.log('=== RESUMO DA DECISAO ===')
console.log(`grupos analisados:            ${totalGrupos}`)
console.log(`vencedor por status:          ${JSON.stringify(porStatusVencedor)}`)
console.log(`perdedor por status:          ${JSON.stringify(porStatusPerdedor)}`)
console.log(`a cancelar:                   ${totalCancelar}`)
console.log(`ja cancelado (skip):          ${totalSkipJaCancelado}`)
console.log(`tiebreaker data_pagamento:    ${tiebreakDatap.length}`)
console.log(`tiebreaker created_at:        ${tiebreakCreated.length}`)
console.log(`sem PM no billId Sienge:      ${semPMnoBill.length}`)
console.log(`sem match seq no Sienge:      ${semSiengeMatch.length}`)
console.log(`\n*** VENCEDOR criado DEPOIS do perdedor (alerta): ${vencedorMaisNovo.length} ***`)
for (const v of vencedorMaisNovo.slice(0, 10)) {
  console.log(`  venda=${v.venda} seq=${v.seq}  vencedor=${v.vencedor_created}  perdedor=${v.perdedor_created}  (tb=${v.tiebreaker})`)
}

// Amostra
console.log('\n=== AMOSTRA VALIDACAO (primeiras 10 decisoes) ===')
for (const d of decisoes.slice(0, 10)) {
  console.log(`\nvenda=${d.contract} bill=${d.billId} seq=${d.seq}  Sienge: due=${d.sienge.due} inst=${d.sienge.inst}`)
  console.log(`  VENCEDOR  id=${d.vencedor.id.slice(0,8)}  status=${d.vencedor.status}  dp=${d.vencedor.data_prevista}  dpag=${d.vencedor.data_pagamento}  dist=${d.vencedor.dist_dias}d  created=${d.vencedor.created_at?.slice(0,10)}`)
  for (const p of d.perdedores) {
    console.log(`  perdedor  id=${p.id.slice(0,8)}  status=${p.status}  dp=${p.data_prevista}  dpag=${p.data_pagamento}  dist=${p.dist_dias}d  created=${p.created_at?.slice(0,10)}  [${p.acao}]`)
  }
}

writeFileSync('docs/analise-b5-duplicatas.json', JSON.stringify({
  meta: {
    geradoEm: new Date().toISOString(),
    heuristica: 'vencedor = menor |data_prevista - dueDate Sienge|; tb1=data_pagamento recente; tb2=created_at antigo',
    grupos: totalGrupos,
    aCancelar: totalCancelar,
    jaCancelado: totalSkipJaCancelado,
    tiebreakDatap: tiebreakDatap.length,
    tiebreakCreated: tiebreakCreated.length,
    semPMnoBill: semPMnoBill.length,
    semMatchSeq: semSiengeMatch.length,
    vencedorMaisNovo: vencedorMaisNovo.length,
  },
  decisoes,
  alertas: { vencedorMaisNovo, semPMnoBill, semMatchSeq: semSiengeMatch },
}, null, 2))

console.log('\nOutput: docs/analise-b5-duplicatas.json')
