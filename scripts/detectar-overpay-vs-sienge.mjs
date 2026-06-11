// Detector de OVER-PAY contra o Sienge — o lado INVERSO do reconciliador.
//
//   reconciliar-todas-vendas.mjs garante:  "Sienge pago  => banco pago"  (sub-registro)
//   ESTE script garante:                   "banco pago  => Sienge pago"  (over-pay)
//
// Pra cada parcela PAGA e ANCORADA (sienge_bill_id + sienge_installment_id), checa se
// o installment correspondente esta de fato pago no income do Sienge. Se nao estiver
// (ou se for baixa de distrato pos-data_distrato), e uma DIVERGENCIA de over-pay:
// o banco conta como recebido algo que o Sienge nao confirma.
//
// READ-ONLY: so detecta e gera a lista. NAO corrige — "Excluir Baixa" e decisao
// humana / rodada-b (regra de seguranca: nunca reverter pago automaticamente).
// ver .claude/rules/sincronizacao-sienge.md + .claude/rules/rodadas-b.md
//
// Hoje roda como FOTO (1x, baseline). Depois pode virar passo diario do cron (FILME).
//
// Uso: node scripts/detectar-overpay-vs-sienge.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { siengeGet, extractRows } from './_sienge-http.mjs'

const FIGUEIRA = '0d7d01f4-c398-4d9a-a280-13f44c957279'
const PAGE = 1000
const env = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const get = (k) => process.env[k] || env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const supa = createClient(get('VITE_SUPABASE_URL'), get('VITE_SUPABASE_ANON_KEY'))
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const d10 = (x) => (x ? String(x).slice(0, 10) : null)
const pagDate = (i) => i.paymentDate || (Array.isArray(i.receipts) && i.receipts[0]?.paymentDate) || null

// 1. vendas Figueira ativas (inclui distratadas — precisamos da data_distrato)
console.log('Carregando vendas...')
const vendas = []
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supa.from('vendas')
    .select('id, sienge_contract_id, unidade, cliente_id, corretor_id, tipo_corretor, situacao_contrato, data_distrato, excluido')
    .eq('empreendimento_id', FIGUEIRA).eq('excluido', false).range(from, from + PAGE - 1)
  if (error) { console.error(error); process.exit(1) }
  if (!data?.length) break
  vendas.push(...data)
  if (data.length < PAGE) break
}
const vById = new Map(vendas.map((v) => [v.id, v]))
console.log(`  ${vendas.length} vendas ativas`)

// 2. parcelas PAGAS dessas vendas
console.log('Carregando parcelas pagas...')
const ids = vendas.map((v) => v.id)
const pagas = []
for (let i = 0; i < ids.length; i += 50) {
  const chunk = ids.slice(i, i + 50)
  for (let f = 0; ; f += PAGE) {
    const { data } = await supa.from('pagamentos_prosoluto')
      .select('id, venda_id, numero_parcela, tipo, valor, comissao_gerada, data_pagamento, sienge_bill_id, sienge_installment_id, motivo_cancelamento_parcela')
      .in('venda_id', chunk).eq('status', 'pago').order('id').range(f, f + PAGE - 1)
    if (!data?.length) break
    pagas.push(...data)
    if (data.length < PAGE) break
  }
}
console.log(`  ${pagas.length} parcelas pagas`)

// 3. income Sienge (cache 1h, sem quota) -> index (bill__installment) -> pago?
console.log('Baixando income do Sienge (bulk-data)...')
const r = await siengeGet({ path: '/bulk-data/v1/income', query: { startDate: '2023-01-01', endDate: '2031-12-31', selectionType: 'D', companyId: 5 } })
const income = extractRows(r.data)
console.log(`  ${income.length} linhas income`)
const incIdx = new Map() // `${billId}__${installmentId}` -> { paymentDate }
for (const i of income) {
  const bill = Number(i.billId); const inst = i.installmentId
  if (!bill || inst == null) continue
  incIdx.set(`${bill}__${inst}`, { paymentDate: pagDate(i), originalAmount: Number(i.originalAmount || 0) })
}

// 4. clientes pra enriquecer a lista
const cliIds = [...new Set(vendas.map((v) => v.cliente_id).filter(Boolean))]
const cliMap = new Map()
for (let i = 0; i < cliIds.length; i += 200) {
  const { data } = await supa.from('clientes').select('id, nome_completo').in('id', cliIds.slice(i, i + 200))
  for (const c of data || []) cliMap.set(c.id, c.nome_completo)
}

// 5. classificar cada parcela paga
const buckets = { ok: 0, overpay: [], distrato_baixa: [], sem_ancora: [], ancora_orfa: [] }
for (const p of pagas) {
  const v = vById.get(p.venda_id)
  const distratado = v?.situacao_contrato === '3' && v?.data_distrato
  const dataDistrato = distratado ? d10(v.data_distrato) : null
  const dpg = d10(p.data_pagamento)
  const base = {
    contrato: v?.sienge_contract_id, unidade: v?.unidade, cliente: cliMap.get(v?.cliente_id),
    tipo_corretor: v?.tipo_corretor, np: p.numero_parcela, tipo: p.tipo, valor: round2(p.valor),
    comissao_gerada: round2(p.comissao_gerada), data_pagamento_local: dpg,
    bill: p.sienge_bill_id, installment: p.sienge_installment_id, parcela_id: p.id,
  }

  // (a) baixa de distrato: paga pos-data_distrato numa venda distratada = falso pago
  if (distratado && dpg && dpg >= dataDistrato) {
    buckets.distrato_baixa.push({ ...base, data_distrato: dataDistrato, classe: 'baixa pos-distrato (falso pago)' })
    continue
  }

  // (b) sem ancora: nao da pra verificar 1:1 — fica como ponto cego ate ancorar
  if (!p.sienge_bill_id || p.sienge_installment_id == null) {
    buckets.sem_ancora.push(base)
    continue
  }

  // (c) ancorada: o installment existe no income?
  const inc = incIdx.get(`${Number(p.sienge_bill_id)}__${p.sienge_installment_id}`)
  if (!inc) { buckets.ancora_orfa.push({ ...base, classe: 'installment ancorado nao existe no income Sienge' }); continue }

  // Sienge confirma pago? (e se distratado, a baixa pos-distrato NAO conta como real)
  const siengePagoData = inc.paymentDate ? d10(inc.paymentDate) : null
  const baixaDistrato = distratado && siengePagoData && siengePagoData >= dataDistrato
  const siengePagoReal = !!siengePagoData && !baixaDistrato

  if (siengePagoReal) { buckets.ok++; continue }

  // banco pago, Sienge NAO confirma => OVER-PAY
  buckets.overpay.push({ ...base, sienge_payment_date: siengePagoData, classe: siengePagoData ? 'Sienge tem baixa de distrato, nao pagamento real' : 'Sienge nao tem pagamento nesse installment' })
}

// 6. metrica + resumo
const somaComissao = (arr) => round2(arr.reduce((s, x) => s + (x.comissao_gerada || 0), 0))
const metric = {
  meta: { geradoEm: new Date().toISOString(), spec_ref: '.claude/rules/sincronizacao-sienge.md',
    script: 'scripts/detectar-overpay-vs-sienge.mjs', modo: 'read-only (foto/baseline)',
    pergunta: 'banco diz PAGO => o Sienge confirma o installment ancorado como pago?' },
  counts: {
    pagas_total: pagas.length,
    ok_espelho_correto: buckets.ok,
    overpay: buckets.overpay.length,
    distrato_baixa: buckets.distrato_baixa.length,
    sem_ancora_nao_verificavel: buckets.sem_ancora.length,
    ancora_orfa: buckets.ancora_orfa.length,
  },
  comissao_em_risco: {
    overpay: somaComissao(buckets.overpay),
    distrato_baixa: somaComissao(buckets.distrato_baixa),
    total: round2(somaComissao(buckets.overpay) + somaComissao(buckets.distrato_baixa)),
  },
  overpay: buckets.overpay.sort((a, b) => b.comissao_gerada - a.comissao_gerada),
  distrato_baixa: buckets.distrato_baixa.sort((a, b) => b.comissao_gerada - a.comissao_gerada),
  ancora_orfa: buckets.ancora_orfa,
  sem_ancora_amostra: buckets.sem_ancora.slice(0, 50),
}

console.log('\n================ FOTO: banco PAGO vs Sienge ================')
console.log(`  pagas analisadas:            ${metric.counts.pagas_total}`)
console.log(`  ✅ espelho correto (Sienge confirma): ${metric.counts.ok_espelho_correto}`)
console.log(`  🔴 OVER-PAY (banco pago, Sienge nao): ${metric.counts.overpay}  -> R$ ${metric.comissao_em_risco.overpay} comissao`)
console.log(`  🟠 baixa de distrato (falso pago):    ${metric.counts.distrato_baixa}  -> R$ ${metric.comissao_em_risco.distrato_baixa}`)
console.log(`  ⚪ ancora orfa (installment sumiu):   ${metric.counts.ancora_orfa}`)
console.log(`  ⚫ sem ancora (nao verificavel 1:1):  ${metric.counts.sem_ancora_nao_verificavel}`)
console.log(`  >>> comissao total em risco: R$ ${metric.comissao_em_risco.total}`)

mkdirSync('docs/auditorias/2026-06-10-overpay', { recursive: true })
const out = 'docs/auditorias/2026-06-10-overpay/foto-overpay-vs-sienge.json'
writeFileSync(out, JSON.stringify(metric, null, 2))
console.log(`\nSalvo: ${out}`)
