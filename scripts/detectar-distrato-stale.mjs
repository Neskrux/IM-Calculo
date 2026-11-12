// DETECTOR de distrato-stale (READ-ONLY — nao escreve no banco).
//
// O QUE E: contrato cancelado no Sienge que o nosso banco ainda mostra ATIVO
// (`situacao_contrato != '3'` e `data_distrato` vazio). Enquanto o banco nao sabe,
// as baixas em massa do distrato contam como pagamento e viram COMISSAO FANTASMA
// no relatorio do corretor.
//
// FINGERPRINT (regra do usuario): "distrato = a venda vem com TODAS as parcelas pagas".
// Venda viva tem mix pago(passado) + pendente(futuro). Distrato-stale tem parcela com
// `data_prevista` NO FUTURO marcada `pago` — impossivel numa venda viva. Reforco:
// baixa concentrada em poucas datas (impressao de baixa-em-massa).
//
// POR QUE ISSO RODA NO CRON (2026-08-05): em julho, 710 A (c63) e 404 A (c8) foram
// canceladas no Sienge (07 e 08/07) e o banco nao soube. As 110 baixas do distrato
// entraram como comissao — R$ 41.764,02, que chegou ao relatorio do Carlos Bruno e
// so foi descoberto porque ELE reclamou. Este detector teria pego no dia seguinte.
//
// Exit code 0 sempre: e um AVISO no log do cron, nunca quebra o job. A decisao de
// curar e humana (confirmar no Sienge REST antes — ver curar-distrato-*.mjs).
//
// ver .claude/rules/sincronizacao-sienge.md + .claude/rules/edge-cases-externos.md

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const supa = createClient(
  process.env.VITE_SUPABASE_URL || g('VITE_SUPABASE_URL'),
  process.env.VITE_SUPABASE_ANON_KEY || g('VITE_SUPABASE_ANON_KEY'),
)

const FIG = '0d7d01f4-c398-4d9a-a280-13f44c957279'
const PAGE = 1000
// HOJE dinamico. (Na versao anterior isto era uma string fixa — com data velha o
// detector encolhe sozinho: parcela "futura" vira passada e para de acender.)
const HOJE = new Date().toISOString().slice(0, 10)
const R = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

// 1. vendas que o BANCO considera ativas
const vendas = []
for (let f = 0; ; f += PAGE) {
  const { data, error } = await supa.from('vendas')
    .select('id,unidade,nome_cliente,corretor_id,tipo_corretor,valor_venda,situacao_contrato,data_distrato,sienge_contract_id')
    .eq('empreendimento_id', FIG).eq('excluido', false).range(f, f + PAGE - 1)
  if (error) { console.error('erro lendo vendas:', error.message); process.exit(0) }
  if (!data?.length) break
  vendas.push(...data)
  if (data.length < PAGE) break
}
// DOIS grupos, dois defeitos diferentes — a versao anterior so via o primeiro:
//   A) STALE: o banco acha que a venda esta viva, mas o Sienge cancelou.
//   B) NAO-CURADA: o banco JA sabe do distrato (situacao='3'), mas as baixas em massa
//      continuam como `pago`. Nao aparece no relatorio do corretor (o filtro de distrato
//      pega), mas contamina totais do admin e conferencia com a controladoria.
// (B) foi descoberto em 07/08 com 1204 B (53 baixas / R$25.676,35) e 401 B (4 / R$5.600,04):
// as duas ja estavam marcadas como distrato havia semanas e passaram batido justamente
// porque o detector so varria as ativas.
const ativas = vendas.filter((v) => v.situacao_contrato !== '3' && !v.data_distrato)
const distratadas = vendas.filter((v) => v.situacao_contrato === '3' && v.data_distrato)
const vById = new Map([...ativas, ...distratadas].map((v) => [v.id, v]))

// 2. parcelas dos dois grupos
const ids = [...ativas, ...distratadas].map((v) => v.id)
const pags = []
for (let i = 0; i < ids.length; i += 200) {
  const chunk = ids.slice(i, i + 200)
  for (let f = 0; ; f += PAGE) {
    const { data, error } = await supa.from('pagamentos_prosoluto')
      .select('venda_id,status,valor,comissao_gerada,data_prevista,data_pagamento')
      .in('venda_id', chunk).range(f, f + PAGE - 1)
    if (error) { console.error('erro lendo parcelas:', error.message); process.exit(0) }
    if (!data?.length) break
    pags.push(...data)
    if (data.length < PAGE) break
  }
}

// 3. agrega por venda
const agg = new Map()
for (const p of pags) {
  const a = agg.get(p.venda_id) || { tot: 0, pago: 0, pend: 0, pagoFuturo: 0, comissaoPago: 0, datas: new Set(), posDistrato: 0, comissaoPosDistrato: 0 }
  a.tot++
  if (p.status === 'pago') {
    a.pago++
    a.comissaoPago += +p.comissao_gerada || 0
    if (p.data_pagamento) a.datas.add(p.data_pagamento)
    if (p.data_prevista && p.data_prevista > HOJE) a.pagoFuturo++
    // grupo B: baixa na data do distrato ou depois = baixa de encerramento, nao pagamento
    const dd = vById.get(p.venda_id)?.data_distrato
    if (dd && p.data_pagamento && String(p.data_pagamento).slice(0, 10) >= String(dd).slice(0, 10)) {
      a.posDistrato++
      a.comissaoPosDistrato += +p.comissao_gerada || 0
    }
  } else if (p.status === 'pendente') a.pend++
  agg.set(p.venda_id, a)
}

// 4. classifica
const suspeitos = []
for (const [vid, a] of agg) {
  const v = vById.get(vid)
  if (!v) continue
  // A: banco nao sabe do distrato. Exige as DUAS marcas juntas — parcela futura paga E
  // baixa concentrada em poucas datas. So a primeira produz falso positivo em cliente que
  // antecipa: 905 B (c340) tem 3 futuras pagas em 8 datas distintas e esta `Emitido` no
  // Sienge (verificado 07/08). Distrato baixa TUDO num dia; antecipacao espalha no tempo.
  const ehStale = !v.data_distrato && a.pagoFuturo >= 3 &&
    a.pago >= 10 && a.datas.size > 0 && a.pago / a.datas.size >= 4
  const ehNaoCurada = !!v.data_distrato && a.posDistrato > 0    // B: banco sabe, baixas nao curadas
  if (!ehStale && !ehNaoCurada) continue
  suspeitos.push({
    tipo: ehStale ? 'STALE (banco nao sabe do distrato)' : 'NAO-CURADA (baixas do distrato ainda pagas)',
    unidade: v.unidade, cliente: v.nome_cliente, venda_id: vid, contrato: v.sienge_contract_id,
    data_distrato: v.data_distrato ?? null,
    total: a.tot, pago: a.pago, pendente: a.pend, pagoFuturo: a.pagoFuturo,
    pagasPosDistrato: a.posDistrato,
    datasDeBaixa: a.datas.size,
    baixaEmMassa: a.pago >= 10 && a.datas.size > 0 && a.pago / a.datas.size >= 4,
    // no grupo B o fantasma é medido com precisão (as pagas >= data_distrato);
    // no grupo A é o teto, porque a data do distrato ainda é desconhecida.
    comissaoEmJogo: +(ehNaoCurada ? a.comissaoPosDistrato : a.comissaoPago).toFixed(2),
  })
}
suspeitos.sort((x, y) => y.comissaoEmJogo - x.comissaoEmJogo)

const stale = suspeitos.filter((s) => s.tipo.startsWith('STALE'))
const naoCurada = suspeitos.filter((s) => s.tipo.startsWith('NAO-CURADA'))

console.log(`\n=== DETECTOR DE DISTRATO (${HOJE}) ===`)
console.log(`escopo: ${ativas.length} ativas + ${distratadas.length} distratadas`)
console.log(`suspeitas: ${suspeitos.length}  (stale: ${stale.length} | nao-curadas: ${naoCurada.length})`)

if (stale.length) {
  console.log(`\n--- A) STALE — banco acha viva, provavel cancelada no Sienge ---`)
  console.log(`unidade  contrato  tot pago pend futPg nDatas massa  comissao (TETO)`)
  for (const s of stale) {
    console.log(
      `${(s.unidade || '?').padEnd(8)} ${String(s.contrato || '?').padEnd(9)}` +
      `${String(s.total).padStart(4)}${String(s.pago).padStart(5)}${String(s.pendente).padStart(5)}` +
      `${String(s.pagoFuturo).padStart(6)}${String(s.datasDeBaixa).padStart(7)}  ${s.baixaEmMassa ? 'SIM' : '-  '}   R$ ${R(s.comissaoEmJogo)}`,
    )
  }
  console.log('>>> CONFIRMAR no Sienge REST (/sales-contracts/{id}: situation + cancellationDate) ANTES de curar.')
}

if (naoCurada.length) {
  console.log(`\n--- B) NAO-CURADA — distrato ja marcado, baixas ainda como PAGO ---`)
  console.log(`unidade  contrato  distrato    pagas>=distrato   comissao FANTASMA`)
  for (const s of naoCurada) {
    console.log(
      `${(s.unidade || '?').padEnd(8)} ${String(s.contrato || '?').padEnd(9)} ${String(s.data_distrato).padEnd(11)}` +
      `${String(s.pagasPosDistrato).padStart(9)}          R$ ${R(s.comissaoEmJogo)}`,
    )
  }
  console.log('>>> Aqui a data do distrato JA e conhecida: o valor acima e o fantasma medido, nao teto.')
  console.log('>>> Nao aparece no relatorio do corretor (filtro de distrato), mas suja totais do admin.')
}

if (suspeitos.length) {
  const tot = suspeitos.reduce((s, x) => s + x.comissaoEmJogo, 0)
  console.log(`\n>>> comissao total em jogo: R$ ${R(tot)}`)
} else {
  console.log('nada a reportar: nenhuma venda com fingerprint de distrato pendente.')
}

mkdirSync('docs/auditorias', { recursive: true })
const out = `docs/auditorias/distrato-stale-${HOJE}.json`
writeFileSync(out, JSON.stringify({
  meta: {
    geradoEm: new Date().toISOString(),
    regra: 'parcela com data_prevista > hoje marcada pago = impossivel em venda viva; fingerprint de baixa-em-massa de distrato',
    spec_ref: '.claude/rules/sincronizacao-sienge.md',
    total: suspeitos.length,
  },
  suspeitos,
}, null, 2))
console.log(`\nrelatorio: ${out}`)
