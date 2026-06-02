// Verifica que a reconciliacao geral aplicada hoje fechou — re-baixa o
// income do Sienge e compara contra o estado atual do banco. Pra cada
// venda processada, valida que:
//   1. soma das parcelas ativas (pago + pendente) bate com soma do Sienge
//   2. cada parcela ativa do banco tem correspondente no Sienge (tipo,valor,data)
//   3. cada parcela do Sienge tem correspondente ativa no banco
//
// Spot-check: mostra detalhe da venda do LUCAS ANTONIO LAMIM (904 C, 59
// parcelas marcadas pago — caso de maior impacto).

import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { siengeGet, extractRows } from './_sienge-http.mjs'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)
const norm = (x) => Number(x).toFixed(2)
const MAPA = { PM: 'parcela_entrada', SN: 'sinal', AT: 'sinal', BA: 'balao', B1: 'balao', B2: 'balao', B3: 'balao', B4: 'balao', B5: 'balao', B6: 'balao', B7: 'balao', B8: 'balao' }

// 1. lista de vendas processadas (do report de hoje)
const rec = JSON.parse(readFileSync('docs/reconciliacao-geral-2026-05-14-dryrun.json', 'utf8'))
const vendaIds = rec.processadas.map((p) => p.venda_id)
console.log(`Verificando ${vendaIds.length} vendas que foram reconciliadas hoje...`)

// 2. income atual do Sienge
console.log('Baixando income do Sienge...')
const r = await siengeGet({
  path: '/bulk-data/v1/income',
  query: { startDate: '2023-01-01', endDate: '2031-12-31', selectionType: 'D', companyId: 5 },
})
const incomePorBill = new Map()
for (const i of extractRows(r.data)) {
  const ti = MAPA[i.paymentTerm?.id]; if (!ti) continue
  const bill = Number(i.billId); if (!bill) continue
  if (!incomePorBill.has(bill)) incomePorBill.set(bill, [])
  incomePorBill.get(bill).push({ ...i, _ti: ti })
}

// 3. dados do banco
console.log('Lendo banco...')
const vendas = []
for (let i = 0; i < vendaIds.length; i += 100) {
  const { data } = await supa.from('vendas').select('id, sienge_contract_id, sienge_receivable_bill_id, unidade, valor_pro_soluto, cliente_id').in('id', vendaIds.slice(i, i + 100))
  vendas.push(...(data || []))
}
const pagamentos = []
for (let i = 0; i < vendaIds.length; i += 50) {
  for (let f = 0; ; f += 1000) {
    const { data } = await supa.from('pagamentos_prosoluto').select('venda_id, tipo, valor, data_prevista, data_pagamento, status, sienge_installment_id').in('venda_id', vendaIds.slice(i, i + 50)).order('id').range(f, f + 999)
    if (!data?.length) break
    pagamentos.push(...data)
    if (data.length < 1000) break
  }
}
const pagsPorVenda = new Map()
for (const p of pagamentos) {
  if (!pagsPorVenda.has(p.venda_id)) pagsPorVenda.set(p.venda_id, [])
  pagsPorVenda.get(p.venda_id).push(p)
}

// 4. verificar cada venda
let match100 = 0
const divergentes = []
let totalAncoradas = 0
let totalSemAncora = 0
let totalPagasSiengeMasNaoLocal = 0

for (const v of vendas) {
  const bill = Number(v.sienge_receivable_bill_id)
  const inc = incomePorBill.get(bill) || []
  const pags = pagsPorVenda.get(v.id) || []
  const ativos = pags.filter((p) => p.status !== 'cancelado')

  const somaBancoAtivos = ativos.reduce((s, p) => s + Number(p.valor || 0), 0)
  const somaSienge = inc.reduce((s, i) => s + Number(i.originalAmount || 0), 0)

  const chave = (t, v, d) => `${t}__${norm(v)}__${d}`
  const siengeMap = new Map(inc.map((i) => [chave(i._ti, i.originalAmount, i.dueDate), i]))
  const bancoChaves = new Set(ativos.map((p) => chave(p.tipo, p.valor, p.data_prevista)))

  const semMatchBanco = ativos.filter((p) => !siengeMap.has(chave(p.tipo, p.valor, p.data_prevista)))
  const semMatchSienge = inc.filter((i) => !bancoChaves.has(chave(i._ti, i.originalAmount, i.dueDate)))

  for (const p of ativos) {
    if (p.sienge_installment_id) totalAncoradas++; else totalSemAncora++
  }

  // pagas no Sienge mas nao no banco
  for (const i of inc) {
    const recebido = (i.receipts || []).reduce((s, x) => s + Number(x.netAmount || 0), 0)
    if (recebido > 0) {
      const k = chave(i._ti, i.originalAmount, i.dueDate)
      const pBanco = ativos.find((p) => chave(p.tipo, p.valor, p.data_prevista) === k)
      if (!pBanco || pBanco.status !== 'pago') totalPagasSiengeMasNaoLocal++
    }
  }

  const diff = Math.abs(somaBancoAtivos - somaSienge)
  if (diff < 0.01 && semMatchBanco.length === 0 && semMatchSienge.length === 0) match100++
  else divergentes.push({
    venda_id: v.id, unidade: v.unidade, contrato: v.sienge_contract_id,
    somaBanco: somaBancoAtivos.toFixed(2), somaSienge: somaSienge.toFixed(2), diff: diff.toFixed(2),
    semMatchBanco: semMatchBanco.length, semMatchSienge: semMatchSienge.length,
  })
}

console.log(`\n=== Resultado das ${vendas.length} vendas reconciliadas ===`)
console.log(`  match 100% (soma bate + sem divergencia de parcela): ${match100}`)
console.log(`  com alguma divergencia: ${divergentes.length}`)
console.log(`  parcelas ativas ancoradas no Sienge (sienge_installment_id): ${totalAncoradas}`)
console.log(`  parcelas ativas SEM ancora: ${totalSemAncora}`)
console.log(`  parcelas pagas no Sienge mas nao no banco: ${totalPagasSiengeMasNaoLocal}`)

if (divergentes.length > 0) {
  console.log(`\nDivergentes:`)
  for (const d of divergentes.slice(0, 10)) console.log(`  ${d.unidade} contrato ${d.contrato}: banco ${d.somaBanco} vs Sienge ${d.somaSienge} (diff ${d.diff}, ${d.semMatchBanco} banco-orfas, ${d.semMatchSienge} Sienge-orfas)`)
  if (divergentes.length > 10) console.log(`  ... +${divergentes.length - 10}`)
}

// 5. spot-check do LUCAS ANTONIO LAMIM
console.log(`\n=== Spot-check: LUCAS ANTONIO LAMIM (904 C, 59 marcadas pago) ===`)
const { data: lucas } = await supa.from('vendas').select('id, sienge_receivable_bill_id, valor_pro_soluto').ilike('unidade', '904 C')
const vL = lucas[0]
const pL = pagamentos.filter((p) => p.venda_id === vL.id)
const ativosL = pL.filter((p) => p.status !== 'cancelado')
const pagosL = pL.filter((p) => p.status === 'pago')
const ancoradasL = ativosL.filter((p) => p.sienge_installment_id).length
const incL = incomePorBill.get(Number(vL.sienge_receivable_bill_id)) || []
const pagasSiengeL = incL.filter((i) => (i.receipts || []).reduce((s, x) => s + Number(x.netAmount || 0), 0) > 0).length
console.log(`  banco: ${pL.length} total | ${ativosL.length} ativas | ${pagosL.length} PAGAS | ${ancoradasL} ancoradas com Sienge`)
console.log(`  Sienge: ${incL.length} parcelas no bill ${vL.sienge_receivable_bill_id} | ${pagasSiengeL} PAGAS`)
console.log(`  pro_soluto venda: ${vL.valor_pro_soluto} | soma banco ativas: ${ativosL.reduce((s, p) => s + Number(p.valor), 0).toFixed(2)} | soma Sienge: ${incL.reduce((s, i) => s + Number(i.originalAmount), 0).toFixed(2)}`)
console.log(`  banco-pagas == Sienge-pagas? ${pagosL.length === pagasSiengeL ? 'SIM ✓' : `NAO (${pagosL.length} vs ${pagasSiengeL})`}`)
