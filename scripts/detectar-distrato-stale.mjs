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
const ativas = vendas.filter((v) => v.situacao_contrato !== '3' && !v.data_distrato)
const vById = new Map(ativas.map((v) => [v.id, v]))

// 2. parcelas dessas vendas
const ids = ativas.map((v) => v.id)
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
  const a = agg.get(p.venda_id) || { tot: 0, pago: 0, pend: 0, pagoFuturo: 0, comissaoPago: 0, datas: new Set() }
  a.tot++
  if (p.status === 'pago') {
    a.pago++
    a.comissaoPago += +p.comissao_gerada || 0
    if (p.data_pagamento) a.datas.add(p.data_pagamento)
    if (p.data_prevista && p.data_prevista > HOJE) a.pagoFuturo++
  } else if (p.status === 'pendente') a.pend++
  agg.set(p.venda_id, a)
}

// 4. classifica
const suspeitos = []
for (const [vid, a] of agg) {
  const v = vById.get(vid)
  if (!v || a.pagoFuturo < 3) continue // <3 futuras pagas: ruido (antecipacao real acontece)
  suspeitos.push({
    unidade: v.unidade, cliente: v.nome_cliente, venda_id: vid, contrato: v.sienge_contract_id,
    total: a.tot, pago: a.pago, pendente: a.pend, pagoFuturo: a.pagoFuturo,
    datasDeBaixa: a.datas.size,
    baixaEmMassa: a.pago >= 10 && a.datas.size > 0 && a.pago / a.datas.size >= 4,
    comissaoEmJogo: +a.comissaoPago.toFixed(2),
  })
}
suspeitos.sort((x, y) => y.pagoFuturo - x.pagoFuturo)

console.log(`\n=== DETECTOR DE DISTRATO-STALE (${HOJE}) ===`)
console.log(`vendas ativas no banco: ${ativas.length} | suspeitas: ${suspeitos.length}`)
if (suspeitos.length) {
  console.log(`\nunidade  contrato  tot pago pend futPg  nDatas massa   comissao em jogo`)
  for (const s of suspeitos) {
    console.log(
      `${(s.unidade || '?').padEnd(8)} ${String(s.contrato || '?').padEnd(9)}` +
      `${String(s.total).padStart(4)}${String(s.pago).padStart(5)}${String(s.pendente).padStart(5)}` +
      `${String(s.pagoFuturo).padStart(6)}${String(s.datasDeBaixa).padStart(8)}  ${s.baixaEmMassa ? 'SIM' : '-  '}   R$ ${R(s.comissaoEmJogo)}`,
    )
  }
  const tot = suspeitos.reduce((s, x) => s + x.comissaoEmJogo, 0)
  console.log(`\n>>> comissao TOTAL nas suspeitas: R$ ${R(tot)}`)
  console.log('>>> (teto do fantasma — a cura preserva o pago REAL anterior a data do distrato)')
  console.log('>>> PROXIMO PASSO: confirmar cada uma no Sienge REST (/sales-contracts/{id}:')
  console.log('>>> situation="Cancelado" + cancellationDate) ANTES de curar. Decisao humana.')
} else {
  console.log('nenhuma venda ativa com >=3 parcelas futuras marcadas pagas.')
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
