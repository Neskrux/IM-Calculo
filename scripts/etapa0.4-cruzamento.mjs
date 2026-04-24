// Cruzamento: divergencias 0.4 vs casos ja conhecidos (B.5 + B.6)
// Pergunta: das 4 categorias da 0.4, quantas ja estao mapeadas em B.5/B.6
// e quantas sao novidade que precisa virar plano?

import { readFileSync, writeFileSync } from 'node:fs'

const diff = JSON.parse(readFileSync('docs/etapa0.4-diff-financeiro.json', 'utf8'))
const b5 = JSON.parse(readFileSync('docs/b5-revisao-humana.json', 'utf8'))

// b6-texto-para-usuaria.md lista 3 grupos por contrato:
// Grupo 1 (pendentes extras): 195, 243, 83, 127
// Grupo 2 (balao contrato 38)
// Grupo 3 (contrato 144 inteiro — SEM par no Sienge, 3 pagos + 57 pendentes)
const B6_CONTRATOS_G1 = new Set(['195', '243', '83', '127'])
const B6_CONTRATO_G2 = '38'
const B6_CONTRATO_G3 = '144'

// Pagamentos citados na B.5 (perdedores + vencedores) — indexados por id
const b5PagamentoIds = new Set()
const b5Contratos = new Set()
const b5PagamentoIdsDeletaveis = new Set()
for (const c of b5.casos) {
  b5Contratos.add(c.sienge_contract_id)
  b5PagamentoIds.add(c.vencedor.id)
  for (const p of c.perdedores) {
    b5PagamentoIds.add(p.id)
    if (p.acao === 'cancelar') b5PagamentoIdsDeletaveis.add(p.id)
  }
}

function cruzar(arr, rotulo) {
  const classificado = {
    ja_b5: [], // pagamento citado na B.5 diretamente
    ja_b6_g1_cancelavel: [], // contrato 195/243/83/127 — Grupo 1 ja autorizado
    ja_b6_g2_aguarda: [], // contrato 38 — Grupo 2 aguarda decisao
    ja_b6_g3_bloqueado: [], // contrato 144 — Grupo 3 bloqueado
    novidade: [],
  }
  for (const x of arr) {
    const localId = x.banco?.id
    const contrato = x.sienge_contract_id
    if (localId && b5PagamentoIds.has(localId)) { classificado.ja_b5.push(x); continue }
    if (B6_CONTRATOS_G1.has(contrato)) { classificado.ja_b6_g1_cancelavel.push(x); continue }
    if (contrato === B6_CONTRATO_G2) { classificado.ja_b6_g2_aguarda.push(x); continue }
    if (contrato === B6_CONTRATO_G3) { classificado.ja_b6_g3_bloqueado.push(x); continue }
    classificado.novidade.push(x)
  }
  console.log(`\n=== ${rotulo} (total ${arr.length}) ===`)
  console.log(`  ja_b5 (sobrep duplicata):        ${classificado.ja_b5.length}`)
  console.log(`  ja_b6_g1 cancelavel:             ${classificado.ja_b6_g1_cancelavel.length}`)
  console.log(`  ja_b6_g2 aguarda decisao:        ${classificado.ja_b6_g2_aguarda.length}`)
  console.log(`  ja_b6_g3 contrato 144 bloqueado: ${classificado.ja_b6_g3_bloqueado.length}`)
  console.log(`  NOVIDADE (precisa plano novo):   ${classificado.novidade.length}`)
  return classificado
}

const cat1 = cruzar(diff.valor_divergente.filter(x => Math.abs(x.diff) > 1), 'CAT 1 valor_divergente (>R$1 real)')
const cat2 = cruzar(diff.data_pagamento_divergente, 'CAT 2 data_pagamento_divergente')
const cat3 = cruzar(diff.pago_local_pendente_sienge, 'CAT 3 pago_local / pendente_sienge')
const cat4 = cruzar(diff.pendente_local_pago_sienge, 'CAT 4 pendente_local / pago_sienge')

// Resumo de novidades por contrato (o que eh realmente novo?)
function topContratosNovidade(classif, rotulo) {
  const m = {}
  for (const x of classif.novidade) m[x.sienge_contract_id] = (m[x.sienge_contract_id] || 0) + 1
  const top = Object.entries(m).sort((a,b) => b[1]-a[1]).slice(0, 10)
  if (top.length === 0) return
  console.log(`\n  novidades ${rotulo} — top contratos:`)
  for (const [c,n] of top) console.log(`    contrato=${c}: ${n}`)
}
topContratosNovidade(cat1, 'CAT 1')
topContratosNovidade(cat3, 'CAT 3')
topContratosNovidade(cat4, 'CAT 4')

// impacto $
const impactoCat1Novidade = cat1.novidade.reduce((acc,x) => acc + Math.abs(x.diff || 0), 0)
const impactoCat4Novidade = cat4.novidade.reduce((acc,x) => acc + (x.banco?.valor || 0), 0)

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    fonte: {
      diff_0_4: 'docs/etapa0.4-diff-financeiro.json',
      b5_delicados: 'docs/b5-revisao-humana.json (34 casos)',
      b6_orfaos: 'docs/b6-texto-para-usuaria.md (84 parcelas, 3 grupos)',
    },
    b5_ids_conhecidos: b5PagamentoIds.size,
    b5_contratos_tocados: [...b5Contratos].sort(),
  },
  cat1_valor_divergente: cat1,
  cat2_data_pagamento_divergente: cat2,
  cat3_pago_local_pendente_sienge: cat3,
  cat4_pendente_local_pago_sienge: cat4,
  impacto_financeiro: {
    cat1_novidade_abs: Number(impactoCat1Novidade.toFixed(2)),
    cat4_novidade_abs: Number(impactoCat4Novidade.toFixed(2)),
  },
}
writeFileSync('docs/etapa0.4-cruzamento.json', JSON.stringify(report, null, 2))
console.log('\nOutput: docs/etapa0.4-cruzamento.json')
console.log(`  CAT 1 novidade impacto abs: R$ ${impactoCat1Novidade.toFixed(2)}`)
console.log(`  CAT 4 novidade impacto abs: R$ ${impactoCat4Novidade.toFixed(2)}`)
