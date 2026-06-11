// F4 — Materializar os ADITIVOS (reparcelamentos) no banco (North Star #3, fase F4).
//
// Mecânica do aditivo no Sienge (validada no income, ex. bill 20 / c63):
//   - as parcelas RENEGOCIADAS ganham baixa com paymentDate == remadeDate
//     ("baixa de renegociação" — dinheiro NÃO recebido, rolou pra grade nova; igual distrato)
//   - a grade GERADA entra como installments novos (numeração alta, ex. 62..64), pendentes
//
// Pra cada um dos eventos do /remade-installments com venda Figueira local:
//   1. renegociacoes: upsert do evento (venda_id + data) com parcelas originais/novas
//   2. grade RENEGOCIADA no banco:
//        pago com data_pagamento >= remadeDate -> baixa falsa -> two-step Excluir Baixa ->
//          cancelado + motivo='aditivo_renegociado' + renegociacao_id
//        pendente -> cancelado + motivo + renegociacao_id
//        pago ANTES do remadeDate -> flag (não esperado), preserva
//   3. grade GERADA:
//        já ancorada (bill,inst) -> só liga renegociacao_id  [cobre débito c150/c351 de maio]
//        row sem âncora com numero==inst e valor exato -> ancora + liga
//        senão -> INSERT pendente ancorado (valor/dueDate do income, snapshot de fator da venda)
//        NUNCA insere já pago (spec) — o cron Q1 marca pago pelo income, agora que tem âncora.
//
// Juros de aditivo NÃO comissionam (decidido 2026-06-05) — Figueira: juros=0 em todos.
// READ-ONLY por default. ver .claude/rules/sincronizacao-sienge.md +
// docs/contexto/2026-06-10-north-star-3-ancora-correta.md (F4)
//
// Uso: node scripts/f4-materializar-aditivos.mjs          # dry-run
//      node scripts/f4-materializar-aditivos.mjs --apply  # ESCREVE (gated)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { siengeGet, extractRows } from './_sienge-http.mjs'

const APPLY = process.argv.includes('--apply')
const FIGUEIRA = '0d7d01f4-c398-4d9a-a280-13f44c957279'
const PAGE = 1000
const env = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const get = (k) => process.env[k] || env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const supa = createClient(get('VITE_SUPABASE_URL'), get('VITE_SUPABASE_ANON_KEY'))
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const d10 = (x) => (x ? String(x).slice(0, 10) : null)
const pagDate = (i) => i.paymentDate || (Array.isArray(i.receipts) && i.receipts[0]?.paymentDate) || null
const parseNums = (s) => String(s || '').split(/[,/]/).map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n))

// 1. eventos de aditivo (regenerado hoje via extrair-aditivos-remade.mjs)
const eventos = JSON.parse(readFileSync('docs/auditorias/2026-06-03-aditivos/aditivos-cruzados.json', 'utf8'))

// 2. vendas Figueira por bill
const { data: vendasAll, error: eV } = await supa.from('vendas')
  .select('id, sienge_contract_id, sienge_receivable_bill_id, unidade, tipo_corretor, fator_comissao, valor_pro_soluto')
  .eq('empreendimento_id', FIGUEIRA).eq('excluido', false).not('sienge_receivable_bill_id', 'is', null)
if (eV) { console.error(eV); process.exit(1) }
const vendaPorBill = new Map(vendasAll.map((v) => [Number(v.sienge_receivable_bill_id), v]))

const meus = eventos.filter((e) => vendaPorBill.has(Number(e.bill)))
  .sort((a, b) => (a.bill - b.bill) || String(a.data).localeCompare(String(b.data)))
console.log(`eventos de aditivo com venda Figueira: ${meus.length} (de ${eventos.length} totais)`)

// 3. income -> index (bill, inst)
const r = await siengeGet({ path: '/bulk-data/v1/income', query: { startDate: '2023-01-01', endDate: '2031-12-31', selectionType: 'D', companyId: 5 } })
const incIdx = new Map()
for (const i of extractRows(r.data)) {
  const bill = Number(i.billId); if (!bill || i.installmentId == null) continue
  incIdx.set(`${bill}__${i.installmentId}`, { dueDate: d10(i.dueDate), originalAmount: round2(i.originalAmount), paymentDate: d10(pagDate(i)), term: i.paymentTerm?.id })
}
if (r.stale) console.log(`  (income do cache, ${r.staleAgeMin}min — ok: grades de aditivo são de jan-mai/26)`)

// 4. parcelas das vendas com aditivo
const vendaIds = [...new Set(meus.map((e) => vendaPorBill.get(Number(e.bill)).id))]
const parcelasPorVenda = new Map()
for (const vid of vendaIds) {
  const rows = []
  for (let f = 0; ; f += PAGE) {
    const { data } = await supa.from('pagamentos_prosoluto')
      .select('id, numero_parcela, tipo, valor, comissao_gerada, status, data_pagamento, data_prevista, sienge_bill_id, sienge_installment_id, renegociacao_id, motivo_cancelamento_parcela')
      .eq('venda_id', vid).order('id').range(f, f + PAGE - 1)
    if (!data?.length) break
    rows.push(...data); if (data.length < PAGE) break
  }
  parcelasPorVenda.set(vid, rows)
}

// 5. renegociacoes existentes dessas vendas
const { data: renegExist } = await supa.from('renegociacoes')
  .select('id, venda_id, data_renegociacao, parcelas_originais, parcelas_novas').in('venda_id', vendaIds)
const renegKey = (vid, dataISO) => `${vid}__${dataISO}`
const renegMap = new Map((renegExist || []).map((x) => [renegKey(x.venda_id, d10(x.data_renegociacao)), x]))

// 6. montar plano
const PCT = (tipo) => (tipo === 'interno' ? 6.5 : 7)
const plano = []
const flags = []
for (const ev of meus) {
  const bill = Number(ev.bill)
  const venda = vendaPorBill.get(bill)
  const parcelas = parcelasPorVenda.get(venda.id) || []
  const dataEv = d10(ev.data)
  const renegociadas = parseNums(ev.renegociadas)
  const geradas = parseNums(ev.geradas)
  const acoes = { cancelar_baixa_falsa: [], cancelar_pendente: [], link_existente: [], ancorar_existente: [], inserir: [] }

  // grade RENEGOCIADA — matcher income-driven: a numeração do Sienge mistura PM e balões
  // na mesma sequência (banco numera separado), então casar por numero_parcela é errado.
  // Regra: âncora (bill,inst) vence; senão valor EXATO do income + (data_prevista==dueDate
  // OU baixa exatamente no remadeDate).
  const usadosIds = new Set()
  for (const rnum of renegociadas) {
    const inc = incIdx.get(`${bill}__${rnum}`)
    const porAncora = parcelas.filter((p) => Number(p.sienge_bill_id) === bill && String(p.sienge_installment_id) === String(rnum))
    let cand = porAncora
    if (!cand.length) {
      if (!inc) { flags.push({ bill, contrato: venda.sienge_contract_id, ev: dataEv, tipo: 'renegociada_sem_income', inst: rnum, nota: 'installment renegociado não está no income' }); continue }
      // SÓ valor exato + data_prevista == dueDate. O fallback "pago na data do aditivo" foi
      // removido: ele morde gêmeos mis-matched (c312 np3 = B3/2028 não-pago carregando a baixa
      // do B1 — over-pay de âncora errada, não renegociada). Falso-negativo vira flag; nunca
      // cancelar por palpite.
      cand = parcelas.filter((p) => !p.sienge_installment_id && p.status !== 'cancelado' && !usadosIds.has(p.id) &&
        Math.abs(round2(p.valor) - inc.originalAmount) <= 0.01 && d10(p.data_prevista) === inc.dueDate)
    }
    if (cand.length === 0) { flags.push({ bill, contrato: venda.sienge_contract_id, ev: dataEv, tipo: 'renegociada_sem_row', inst: rnum, nota: 'sem linha no banco (ex. grade de aditivo anterior não materializada) — nada a cancelar' }); continue }
    if (cand.length > 1) { flags.push({ bill, contrato: venda.sienge_contract_id, ev: dataEv, tipo: 'renegociada_ambigua', inst: rnum, n: cand.length, nota: 'múltiplas linhas casam — rodada-b' }); continue }
    const p = cand[0]
    usadosIds.add(p.id)
    if (p.status === 'cancelado') { acoes.link_existente.push({ id: p.id, inst: rnum, nota: 'já cancelada' }); continue }
    if (p.status === 'pago') {
      if (d10(p.data_pagamento) >= dataEv) acoes.cancelar_baixa_falsa.push({ id: p.id, inst: rnum, valor: p.valor, comissao: round2(p.comissao_gerada), data_pagamento: d10(p.data_pagamento) })
      else flags.push({ bill, contrato: venda.sienge_contract_id, ev: dataEv, tipo: 'renegociada_paga_antes', inst: rnum, nota: `paga ${d10(p.data_pagamento)} ANTES do aditivo ${dataEv} — preservada, conferir` })
    } else acoes.cancelar_pendente.push({ id: p.id, inst: rnum, valor: p.valor })
  }

  // grade GERADA
  for (const g of geradas) {
    const inc = incIdx.get(`${bill}__${g}`)
    if (!inc) { flags.push({ bill, contrato: venda.sienge_contract_id, ev: dataEv, tipo: 'gerada_sem_income', inst: g, nota: 'installment gerado não está no income — investigar' }); continue }
    const jaAncorada = parcelas.find((p) => Number(p.sienge_bill_id) === bill && String(p.sienge_installment_id) === String(g))
    if (jaAncorada) { acoes.link_existente.push({ id: jaAncorada.id, inst: g, nota: `já ancorada (status ${jaAncorada.status})` }); continue }
    // existente sem âncora: por numero+valor exato, ou por valor+dueDate exatos (único)
    let semAncora = parcelas.filter((p) => !p.sienge_installment_id && p.numero_parcela === g && p.status !== 'cancelado' &&
      Math.abs(round2(p.valor) - inc.originalAmount) <= 0.01)
    if (!semAncora.length) semAncora = parcelas.filter((p) => !p.sienge_installment_id && p.status !== 'cancelado' && !usadosIds.has(p.id) &&
      Math.abs(round2(p.valor) - inc.originalAmount) <= 0.01 && d10(p.data_prevista) === inc.dueDate)
    if (semAncora.length === 1) {
      usadosIds.add(semAncora[0].id)
      acoes.ancorar_existente.push({ id: semAncora[0].id, inst: g, valor: inc.originalAmount })
    } else if (semAncora.length > 1) {
      flags.push({ bill, contrato: venda.sienge_contract_id, ev: dataEv, tipo: 'gerada_conflito_numero', inst: g, nota: `${semAncora.length} linhas sem âncora casam com o installment gerado — rodada-b` })
    } else {
      const fator = Number(venda.fator_comissao || 0)
      if (!(fator > 0)) { flags.push({ bill, contrato: venda.sienge_contract_id, ev: dataEv, tipo: 'venda_sem_fator', inst: g, nota: 'fator_comissao da venda ausente — não insere' }); continue }
      acoes.inserir.push({ inst: g, valor: inc.originalAmount, data_prevista: inc.dueDate, term: inc.term,
        comissao_gerada: round2(inc.originalAmount * fator), fator, pct: PCT(venda.tipo_corretor) })
    }
  }

  plano.push({ bill, contrato: venda.sienge_contract_id, unidade: venda.unidade, venda_id: venda.id,
    data_aditivo: dataEv, renegociadas, geradas, reneg_existente: renegMap.get(renegKey(venda.id, dataEv))?.id || null, acoes })
}

// 7. resumo
const tot = (k) => plano.reduce((s, x) => s + x.acoes[k].length, 0)
const comissaoFalsa = round2(plano.reduce((s, x) => s + x.acoes.cancelar_baixa_falsa.reduce((a, p) => a + (p.comissao || 0), 0), 0))
console.log('\n============ F4: MATERIALIZAR ADITIVOS ============')
console.log(`  eventos: ${plano.length}  |  contratos: ${new Set(plano.map((x) => x.contrato)).size}`)
console.log(`  🔴 baixa de renegociação falsa a cancelar: ${tot('cancelar_baixa_falsa')}  -> R$ ${comissaoFalsa} comissão falsa`)
console.log(`  🟡 pendente renegociada a cancelar:        ${tot('cancelar_pendente')}`)
console.log(`  🟢 inserir grade nova (pendente+ancorada): ${tot('inserir')}`)
console.log(`  🔗 ancorar existente:                      ${tot('ancorar_existente')}  |  já ok (só link): ${tot('link_existente')}`)
console.log(`  ⚠️ flags (revisão): ${flags.length}`)
for (const x of plano) console.log(`    c${x.contrato} ${(x.unidade || '').padEnd(7)} aditivo ${x.data_aditivo} | reneg ${x.renegociadas.join(',')} -> ger ${x.geradas.length}x | cancelar ${x.acoes.cancelar_baixa_falsa.length}+${x.acoes.cancelar_pendente.length} | inserir ${x.acoes.inserir.length} | link/ancora ${x.acoes.link_existente.length}/${x.acoes.ancorar_existente.length}`)
if (flags.length) { console.log('\n  flags:'); for (const f of flags) console.log(`    c${f.contrato} bill ${f.bill} inst ${f.inst}: [${f.tipo}] ${f.nota}`) }

const out = {
  meta: { geradoEm: new Date().toISOString(), spec_ref: '.claude/rules/sincronizacao-sienge.md',
    doc_ref: 'docs/contexto/2026-06-10-north-star-3-ancora-correta.md (F4)', script: 'scripts/f4-materializar-aditivos.mjs',
    modo: APPLY ? 'apply' : 'dry-run' },
  counts: { eventos: plano.length, cancelar_baixa_falsa: tot('cancelar_baixa_falsa'), cancelar_pendente: tot('cancelar_pendente'),
    inserir: tot('inserir'), ancorar_existente: tot('ancorar_existente'), link_existente: tot('link_existente'),
    flags: flags.length, inserted: 0, updated: 0, reneg_inseridas: 0, errors: 0 },
  comissao_falsa_a_remover: comissaoFalsa,
  plano, flags, errors: [],
}

// 8. APPLY
if (APPLY) {
  console.log('\nAplicando...')
  for (const x of plano) {
    // 8a. renegociacoes upsert
    let renegId = x.reneg_existente
    if (!renegId) {
      const { data, error } = await supa.from('renegociacoes').insert({
        venda_id: x.venda_id, data_renegociacao: x.data_aditivo, motivo: 'aditivo Sienge (remade-installments)',
        parcelas_originais: x.renegociadas, parcelas_novas: x.geradas, diferenca_valor: 0, diferenca_comissao: 0,
      }).select('id').single()
      if (error) { out.counts.errors++; out.errors.push({ bill: x.bill, passo: 'reneg', msg: error.message }); continue }
      renegId = data.id; out.counts.reneg_inseridas++
    }
    // 8b. baixas falsas: two-step
    for (const a of x.acoes.cancelar_baixa_falsa) {
      const e1 = await supa.from('pagamentos_prosoluto').update({ status: 'pendente', data_pagamento: null }).eq('id', a.id).eq('status', 'pago')
      if (e1.error) { out.counts.errors++; out.errors.push({ id: a.id, passo: 'excluir_baixa', msg: e1.error.message }); continue }
      const e2 = await supa.from('pagamentos_prosoluto').update({ status: 'cancelado', motivo_cancelamento_parcela: 'aditivo_renegociado', renegociacao_id: renegId }).eq('id', a.id)
      if (e2.error) { out.counts.errors++; out.errors.push({ id: a.id, passo: 'cancelar', msg: e2.error.message }) } else out.counts.updated++
    }
    // 8c. pendentes renegociadas
    for (const a of x.acoes.cancelar_pendente) {
      const { error } = await supa.from('pagamentos_prosoluto').update({ status: 'cancelado', motivo_cancelamento_parcela: 'aditivo_renegociado', renegociacao_id: renegId }).eq('id', a.id).eq('status', 'pendente')
      if (error) { out.counts.errors++; out.errors.push({ id: a.id, passo: 'cancelar_pendente', msg: error.message }) } else out.counts.updated++
    }
    // 8d. link/ancora existentes
    for (const a of x.acoes.link_existente) {
      const { error } = await supa.from('pagamentos_prosoluto').update({ renegociacao_id: renegId }).eq('id', a.id).is('renegociacao_id', null)
      if (!error) out.counts.updated++
    }
    for (const a of x.acoes.ancorar_existente) {
      const { error } = await supa.from('pagamentos_prosoluto').update({ sienge_bill_id: x.bill, sienge_installment_id: String(a.inst), renegociacao_id: renegId }).eq('id', a.id)
      if (error) { out.counts.errors++; out.errors.push({ id: a.id, passo: 'ancorar', msg: error.message }) } else out.counts.updated++
    }
    // 8e. inserts da grade nova (sempre pendente — spec)
    for (const a of x.acoes.inserir) {
      const { error } = await supa.from('pagamentos_prosoluto').insert({
        venda_id: x.venda_id, tipo: 'parcela_entrada', numero_parcela: a.inst, valor: a.valor,
        data_prevista: a.data_prevista, status: 'pendente', comissao_gerada: a.comissao_gerada,
        fator_comissao_aplicado: a.fator, percentual_comissao_total: a.pct,
        sienge_bill_id: x.bill, sienge_installment_id: String(a.inst), renegociacao_id: renegId,
      })
      if (error) { out.counts.errors++; out.errors.push({ bill: x.bill, inst: a.inst, passo: 'insert', msg: error.message }) } else out.counts.inserted++
    }
  }
  console.log(`  reneg_inseridas=${out.counts.reneg_inseridas} updated=${out.counts.updated} inserted=${out.counts.inserted} errors=${out.counts.errors}`)
}

mkdirSync('docs/auditorias/2026-06-10-aditivo', { recursive: true })
const f = `docs/auditorias/2026-06-10-aditivo/f4-materializar-${APPLY ? 'apply' : 'dryrun'}.json`
writeFileSync(f, JSON.stringify(out, null, 2))
console.log(`\nSalvo: ${f}`)
