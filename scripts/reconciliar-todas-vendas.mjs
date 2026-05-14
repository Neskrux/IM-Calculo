// Reconciliacao GERAL: todas as vendas FIGUEIRA com sienge_receivable_bill_id
// contra o /bulk-data/v1/income do Sienge. Generaliza o piloto do LEANDRO.
//
// Cobre TODOS os tipos do pro-soluto (nao so PM):
//   PM            -> parcela_entrada
//   SN, AT        -> sinal
//   BA, B1..B8    -> balao
//   (CA = financiamento, BN/PU/PA/CV ignorados — nao entram no pro-soluto)
//
// Por venda, match por (tipo_interno, valor, data_prevista):
//   - ativa casa     -> popula sienge_installment_id; Sienge pago + banco
//                       pendente -> marca pago
//   - so cancelada   -> reativa (pago se Sienge pago, senao pendente)
//   - Sienge sem match-> CRIA a parcela
//   - banco ativa sem match -> loga (NAO mexe)
//
// SALVAGUARDAS — pula a venda (revisao humana) se:
//   S1. bill sem parcelas relevantes no income
//   S2. soma income relevante difere do valor_pro_soluto em > R$ 1
//   S3. chave (tipo,valor,data) com 2+ no Sienge (ambiguo)
//   S4. chave (tipo,valor,data) com 2+ ATIVAS no banco (ambiguo)
//   S5. > 3 parcelas ativas no banco sem match no Sienge
//
// Trigger 017: cancelado->pago/pendente e pendente->pago permitidos. NUNCA
// DELETE nem reverte pago. Comissao das criadas: formula canonica.
//
// Uso: node scripts/reconciliar-todas-vendas.mjs [--apply]

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { siengeGet, extractRows } from './_sienge-http.mjs'

const DRY = !process.argv.includes('--apply')
console.log(`Modo: ${DRY ? 'dry-run' : 'apply'}\n`)

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
const FIGUEIRA = '0d7d01f4-c398-4d9a-a280-13f44c957279'
const norm = (x) => Number(x).toFixed(2)
const PAGE = 1000

// mapa tipo Sienge -> tipo interno
const MAPA_TIPO = {
  PM: 'parcela_entrada',
  SN: 'sinal', AT: 'sinal',
  BA: 'balao', B1: 'balao', B2: 'balao', B3: 'balao', B4: 'balao', B5: 'balao', B6: 'balao', B7: 'balao', B8: 'balao',
}
const tipoInterno = (i) => MAPA_TIPO[i.paymentTerm?.id] || null

// 1. vendas
console.log('Carregando vendas...')
const vendas = []
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supa
    .from('vendas')
    .select('id, sienge_contract_id, sienge_receivable_bill_id, unidade, cliente_id, valor_venda, valor_pro_soluto, tipo_corretor, excluido, empreendimento_id')
    .eq('empreendimento_id', FIGUEIRA).not('sienge_receivable_bill_id', 'is', null).eq('excluido', false)
    .range(from, from + PAGE - 1)
  if (error) { console.error(error); process.exit(1) }
  if (!data?.length) break
  vendas.push(...data)
  if (data.length < PAGE) break
}
console.log(`  ${vendas.length} vendas FIGUEIRA com bill_id`)

// 2. pagamentos
console.log('Carregando pagamentos...')
const vendaIds = vendas.map((v) => v.id)
const pagamentos = []
for (let i = 0; i < vendaIds.length; i += 50) {
  const chunk = vendaIds.slice(i, i + 50)
  for (let f = 0; ; f += PAGE) {
    const { data } = await supa
      .from('pagamentos_prosoluto')
      .select('id, venda_id, numero_parcela, tipo, valor, data_prevista, data_pagamento, status, sienge_installment_id')
      .in('venda_id', chunk).order('id').range(f, f + PAGE - 1)
    if (!data?.length) break
    pagamentos.push(...data)
    if (data.length < PAGE) break
  }
}
console.log(`  ${pagamentos.length} pagamentos`)
const pagsPorVenda = new Map()
for (const p of pagamentos) {
  if (!pagsPorVenda.has(p.venda_id)) pagsPorVenda.set(p.venda_id, [])
  pagsPorVenda.get(p.venda_id).push(p)
}

// 3. income Sienge
console.log('Baixando income do Sienge (bulk-data)...')
const r = await siengeGet({
  path: '/bulk-data/v1/income',
  query: { startDate: '2023-01-01', endDate: '2031-12-31', selectionType: 'D', companyId: 5 },
})
const income = extractRows(r.data)
console.log(`  ${income.length} linhas income`)
const incomePorBill = new Map()
for (const i of income) {
  const ti = tipoInterno(i)
  if (!ti) continue // CA / BN / PU / PA / CV — fora do pro-soluto
  const bill = Number(i.billId)
  if (!bill) continue
  if (!incomePorBill.has(bill)) incomePorBill.set(bill, [])
  incomePorBill.get(bill).push({ ...i, _tipoInterno: ti })
}

// 4. processar
const resultado = {
  meta: { geradoEm: new Date().toISOString(), modo: DRY ? 'dry-run' : 'apply', total_vendas: vendas.length },
  processadas: [], revisao_humana: [],
  totais: { popular: 0, marcar_pago: 0, reativar: 0, criar: 0, sem_match_banco: 0 },
}

for (const v of vendas) {
  const bill = Number(v.sienge_receivable_bill_id)
  const inc = incomePorBill.get(bill) || []
  const pags = pagsPorVenda.get(v.id) || []

  // S1
  if (inc.length === 0) { resultado.revisao_humana.push({ venda_id: v.id, unidade: v.unidade, contrato: v.sienge_contract_id, motivo: 'bill sem parcelas relevantes no income' }); continue }
  // S2 — soma de tudo que compoe pro-soluto
  const somaInc = inc.reduce((s, i) => s + Number(i.originalAmount || 0), 0)
  if (Math.abs(somaInc - Number(v.valor_pro_soluto || 0)) > 1) {
    resultado.revisao_humana.push({ venda_id: v.id, unidade: v.unidade, contrato: v.sienge_contract_id, motivo: `soma income (${somaInc.toFixed(2)}) != pro_soluto (${v.valor_pro_soluto})` }); continue
  }
  // S3 — chave duplicada no Sienge
  const chave = (tipo, valor, data) => `${tipo}__${norm(valor)}__${data}`
  const siengePorChave = new Map()
  for (const i of inc) {
    const k = chave(i._tipoInterno, i.originalAmount, i.dueDate)
    if (!siengePorChave.has(k)) siengePorChave.set(k, [])
    siengePorChave.get(k).push(i)
  }
  if ([...siengePorChave.values()].some((a) => a.length > 1)) {
    resultado.revisao_humana.push({ venda_id: v.id, unidade: v.unidade, contrato: v.sienge_contract_id, motivo: 'Sienge tem parcelas com mesmo (tipo,valor,data) — ambiguo' }); continue
  }
  // S4 — chave duplicada ATIVA no banco
  const ativos = pags.filter((p) => p.status !== 'cancelado')
  const bancoPorChave = new Map()
  for (const p of ativos) {
    const k = chave(p.tipo, p.valor, p.data_prevista)
    if (!bancoPorChave.has(k)) bancoPorChave.set(k, [])
    bancoPorChave.get(k).push(p)
  }
  if ([...bancoPorChave.values()].some((a) => a.length > 1)) {
    resultado.revisao_humana.push({ venda_id: v.id, unidade: v.unidade, contrato: v.sienge_contract_id, motivo: 'banco tem parcelas ATIVAS com mesmo (tipo,valor,data) — ambiguo' }); continue
  }

  // classificar
  const PCT = v.tipo_corretor === 'interno' ? 6.5 : 7
  const fator = Number(v.valor_pro_soluto) > 0 ? (Number(v.valor_venda) * (PCT / 100)) / Number(v.valor_pro_soluto) : 0
  const usados = new Set()
  const acoes = { popular: [], marcar_pago: [], reativar: [], criar: [] }
  let maxNum = Math.max(0, ...pags.filter((p) => p.numero_parcela != null).map((p) => Number(p.numero_parcela)))

  for (const i of inc) {
    const valor = Number(i.originalAmount || 0)
    const due = i.dueDate
    const pd = i.paymentDate || i.receipts?.[0]?.paymentDate || null
    const recebido = (i.receipts || []).reduce((s, x) => s + Number(x.netAmount || 0), 0)
    const siengePago = !!pd && recebido > 0
    const instId = String(i.installmentId ?? i.installmentNumber ?? '')
    const k = chave(i._tipoInterno, valor, due)
    const cand = pags.filter((p) => !usados.has(p.id) && chave(p.tipo, p.valor, p.data_prevista) === k)
    const ativa = cand.find((p) => p.status !== 'cancelado')
    const cancelada = cand.find((p) => p.status === 'cancelado')

    if (ativa) {
      usados.add(ativa.id)
      if (siengePago && ativa.status === 'pendente') acoes.marcar_pago.push({ id: ativa.id, data_pagamento: pd, instId })
      else if (ativa.sienge_installment_id !== instId) acoes.popular.push({ id: ativa.id, instId })
    } else if (cancelada) {
      usados.add(cancelada.id)
      acoes.reativar.push({ id: cancelada.id, novo_status: siengePago ? 'pago' : 'pendente', data_pagamento: siengePago ? pd : null, instId })
    } else {
      maxNum++
      acoes.criar.push({
        venda_id: v.id, numero_parcela: maxNum, tipo: i._tipoInterno, valor,
        data_prevista: due, status: siengePago ? 'pago' : 'pendente',
        data_pagamento: siengePago ? pd : null,
        comissao_gerada: Number((valor * fator).toFixed(2)),
        fator_comissao_aplicado: Number(fator.toFixed(6)),
        percentual_comissao_total: PCT,
        sienge_installment_id: instId, sienge_bill_id: bill,
      })
    }
  }
  const semMatch = ativos.filter((p) => !usados.has(p.id))
  // S5
  if (semMatch.length > 3) {
    resultado.revisao_humana.push({ venda_id: v.id, unidade: v.unidade, contrato: v.sienge_contract_id, motivo: `${semMatch.length} parcelas ativas no banco sem match no Sienge` }); continue
  }

  resultado.processadas.push({
    venda_id: v.id, unidade: v.unidade, contrato: v.sienge_contract_id, bill, acoes,
    semMatch: semMatch.map((p) => ({ id: p.id, tipo: p.tipo, valor: p.valor, data_prevista: p.data_prevista, status: p.status })),
  })
  resultado.totais.popular += acoes.popular.length
  resultado.totais.marcar_pago += acoes.marcar_pago.length
  resultado.totais.reativar += acoes.reativar.length
  resultado.totais.criar += acoes.criar.length
  resultado.totais.sem_match_banco += semMatch.length
}

console.log(`\n=== ESCOPO ===`)
console.log(`  vendas processaveis (match limpo): ${resultado.processadas.length}`)
console.log(`  vendas pra revisao humana:         ${resultado.revisao_humana.length}`)
console.log(`  --- acoes nas processaveis ---`)
console.log(`  popular sienge_installment_id: ${resultado.totais.popular}`)
console.log(`  marcar pago (Sienge confirma): ${resultado.totais.marcar_pago}`)
console.log(`  reativar cancelada:            ${resultado.totais.reativar}`)
console.log(`  criar parcela faltante:        ${resultado.totais.criar}`)
console.log(`  ativas no banco sem match (so loga): ${resultado.totais.sem_match_banco}`)
const comMudanca = resultado.processadas.filter((p) => p.acoes.marcar_pago.length || p.acoes.reativar.length || p.acoes.criar.length)
console.log(`  vendas com correcao real (marcar/reativar/criar): ${comMudanca.length}`)
console.log(`\n  motivos de revisao humana:`)
const motivos = {}
for (const rh of resultado.revisao_humana) { const m = rh.motivo.split('(')[0].trim(); motivos[m] = (motivos[m] || 0) + 1 }
for (const [m, n] of Object.entries(motivos)) console.log(`    ${m}: ${n}`)

const dataRef = new Date().toISOString().slice(0, 10)
writeFileSync(`docs/reconciliacao-geral-${dataRef}-${DRY ? 'dryrun' : 'aplicado'}.json`, JSON.stringify(resultado, null, 2))
console.log(`\nSalvo: docs/reconciliacao-geral-${dataRef}-${DRY ? 'dryrun' : 'aplicado'}.json`)

if (DRY) { console.log('\nDry-run apenas. Pra aplicar: --apply'); process.exit(0) }

// ---------- APPLY ----------
console.log('\nAplicando...')
let okPop = 0, okMarc = 0, okReat = 0, okCriar = 0, err = 0
const errosDetalhe = []
for (const venda of resultado.processadas) {
  for (const a of venda.acoes.popular) {
    const res = await fetch(`${URL}/rest/v1/pagamentos_prosoluto?id=eq.${a.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ sienge_installment_id: a.instId, sienge_bill_id: venda.bill, updated_at: new Date().toISOString() }) })
    if (res.ok) okPop++; else { err++; errosDetalhe.push({ acao: 'popular', id: a.id, status: res.status }) }
  }
  for (const a of venda.acoes.marcar_pago) {
    const res = await fetch(`${URL}/rest/v1/pagamentos_prosoluto?id=eq.${a.id}&status=eq.pendente`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'pago', data_pagamento: a.data_pagamento, sienge_installment_id: a.instId, sienge_bill_id: venda.bill, updated_at: new Date().toISOString() }) })
    if (res.ok) okMarc++; else { err++; errosDetalhe.push({ acao: 'marcar_pago', id: a.id, status: res.status }) }
  }
  for (const a of venda.acoes.reativar) {
    const patch = { status: a.novo_status, sienge_installment_id: a.instId, sienge_bill_id: venda.bill, updated_at: new Date().toISOString() }
    if (a.data_pagamento) patch.data_pagamento = a.data_pagamento
    const res = await fetch(`${URL}/rest/v1/pagamentos_prosoluto?id=eq.${a.id}&status=eq.cancelado`, { method: 'PATCH', headers: H, body: JSON.stringify(patch) })
    if (res.ok) okReat++; else { err++; errosDetalhe.push({ acao: 'reativar', id: a.id, status: res.status }) }
  }
  for (const a of venda.acoes.criar) {
    const res = await fetch(`${URL}/rest/v1/pagamentos_prosoluto`, { method: 'POST', headers: H, body: JSON.stringify({ ...a, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }) })
    if (res.ok) okCriar++; else { const t = await res.text(); err++; errosDetalhe.push({ acao: 'criar', venda: venda.venda_id, status: res.status, msg: t.slice(0, 120) }) }
  }
}
console.log(`\n=== APLICADO ===`)
console.log(`  populados: ${okPop} | marcados pago: ${okMarc} | reativados: ${okReat} | criados: ${okCriar} | erros: ${err}`)
if (errosDetalhe.length) for (const e of errosDetalhe.slice(0, 10)) console.log(`    ERRO ${JSON.stringify(e)}`)
resultado.aplicacao = { okPop, okMarc, okReat, okCriar, err, errosDetalhe }
writeFileSync(`docs/reconciliacao-geral-${dataRef}-aplicado.json`, JSON.stringify(resultado, null, 2))
