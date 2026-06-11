// F1 v2 — Validar a ANCORA contra o Sienge, SEGMENTADO por termo (North Star #3).
//
// Decisao de engenharia (gestora, 2026-06-10): a regra de valor/data depende de o
// contrato ter TERMO ou nao.
//   - Contrato LIMPO (sem distrato/aditivo): a ancora certa exige VALOR EXATO e DATA
//     EXATA com o installment. Sem tolerancia (tolerancia cega = falso-negativo).
//   - Contrato COM TERMO: divergencia de valor/data e ESPERADA (aditivo re-parcela,
//     distrato baixa tudo) -> nao se julga pela regua do limpo; trata pelo termo.
//
// Segmentacao:
//   distrato  = vendas.situacao_contrato='3'
//   aditivo   = |soma do income pro-soluto do bill - valor_pro_soluto| > R$1  (assinatura
//               S2 do reconciliador: income mistura grade antiga+nova)
//   limpo     = o resto
//
// READ-ONLY. So mede. ver docs/contexto/2026-06-10-north-star-3-ancora-correta.md
// Uso: node scripts/validar-ancora-vs-sienge.mjs

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
const PROSOLUTO = new Set(['PM', 'SN', 'AT', 'BA', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'])

// 1. vendas (+ valor_pro_soluto e bill pra detectar aditivo)
console.log('Carregando vendas...')
const vendas = []
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supa.from('vendas')
    .select('id, sienge_contract_id, unidade, cliente_id, tipo_corretor, situacao_contrato, data_distrato, valor_pro_soluto, sienge_receivable_bill_id')
    .eq('empreendimento_id', FIGUEIRA).eq('excluido', false).range(from, from + PAGE - 1)
  if (error) { console.error(error); process.exit(1) }
  if (!data?.length) break
  vendas.push(...data); if (data.length < PAGE) break
}
const vById = new Map(vendas.map((v) => [v.id, v]))
console.log(`  ${vendas.length} vendas ativas`)

// 2. parcelas
console.log('Carregando parcelas...')
const ids = vendas.map((v) => v.id)
const parcelas = []
for (let i = 0; i < ids.length; i += 50) {
  const chunk = ids.slice(i, i + 50)
  for (let f = 0; ; f += PAGE) {
    const { data } = await supa.from('pagamentos_prosoluto')
      .select('id, venda_id, numero_parcela, tipo, valor, comissao_gerada, data_pagamento, status, sienge_bill_id, sienge_installment_id')
      .in('venda_id', chunk).order('id').range(f, f + PAGE - 1)
    if (!data?.length) break
    parcelas.push(...data); if (data.length < PAGE) break
  }
}
console.log(`  ${parcelas.length} parcelas`)

// 3. income
console.log('Baixando income do Sienge (bulk-data)...')
const r = await siengeGet({ path: '/bulk-data/v1/income', query: { startDate: '2023-01-01', endDate: '2031-12-31', selectionType: 'D', companyId: 5 } })
const income = extractRows(r.data)
const incIdx = new Map()       // bill__inst -> {paymentDate, originalAmount}
const sumProPorBill = new Map() // bill -> soma originalAmount dos tipos pro-soluto
for (const i of income) {
  const bill = Number(i.billId); const inst = i.installmentId
  if (!bill || inst == null) continue
  incIdx.set(`${bill}__${inst}`, { paymentDate: pagDate(i), originalAmount: Number(i.originalAmount || 0) })
  if (PROSOLUTO.has(i.paymentTerm?.id)) sumProPorBill.set(bill, round2((sumProPorBill.get(bill) || 0) + Number(i.originalAmount || 0)))
}
console.log(`  ${income.length} linhas income`)

// 3b. classificar TERMO por venda
const termoVenda = new Map() // venda_id -> 'distrato'|'aditivo'|'limpo'
for (const v of vendas) {
  if (v.situacao_contrato === '3' && v.data_distrato) { termoVenda.set(v.id, 'distrato'); continue }
  const bill = Number(v.sienge_receivable_bill_id)
  const somaInc = sumProPorBill.get(bill)
  const pro = round2(v.valor_pro_soluto)
  if (somaInc != null && pro > 0 && Math.abs(somaInc - pro) > 1) { termoVenda.set(v.id, 'aditivo'); continue }
  termoVenda.set(v.id, 'limpo')
}

// 4. clientes
const cliIds = [...new Set(vendas.map((v) => v.cliente_id).filter(Boolean))]
const cliMap = new Map()
for (let i = 0; i < cliIds.length; i += 200) {
  const { data } = await supa.from('clientes').select('id, nome_completo').in('id', cliIds.slice(i, i + 200))
  for (const c of data || []) cliMap.set(c.id, c.nome_completo)
}

// 5. classificar cada PAGA
const B = {
  limpo_valida: 0, limpo_nao_pago: [], limpo_valor_diverge: [], limpo_data_diverge: [], limpo_orfa: [],
  termo_distrato: 0, termo_aditivo: 0, sem_ancora: 0,
}
let limpoValidaComissao = 0
for (const p of parcelas) {
  if (p.status !== 'pago') continue
  const v = vById.get(p.venda_id)
  const termo = termoVenda.get(p.venda_id) || 'limpo'
  if (!p.sienge_bill_id || p.sienge_installment_id == null) { B.sem_ancora++; continue }

  // com-termo: NAO se julga pela regua do limpo (vai pro trilho do termo, F2/F4)
  if (termo === 'distrato') { B.termo_distrato++; continue }
  if (termo === 'aditivo') { B.termo_aditivo++; continue }

  // LIMPO: valor exato + data exata + installment pago
  const i = incIdx.get(`${Number(p.sienge_bill_id)}__${p.sienge_installment_id}`)
  const base = {
    contrato: v?.sienge_contract_id, unidade: v?.unidade, cliente: cliMap.get(v?.cliente_id), np: p.numero_parcela,
    tipo: p.tipo, valor: round2(p.valor), comissao_gerada: round2(p.comissao_gerada),
    data_pagamento_local: d10(p.data_pagamento), bill: p.sienge_bill_id, inst: p.sienge_installment_id, parcela_id: p.id,
  }
  if (!i) { B.limpo_orfa.push({ ...base, motivo: 'installment ancorado nao existe no income' }); continue }
  const iPag = d10(i.paymentDate)
  if (!iPag) { B.limpo_nao_pago.push({ ...base, motivo: 'installment ancorado NAO pago no Sienge' }); continue }
  const valorOk = Math.abs(round2(p.valor) - round2(i.originalAmount)) <= 0.01
  if (!valorOk) { B.limpo_valor_diverge.push({ ...base, valor_sienge: round2(i.originalAmount) }); continue }
  const dataOk = d10(p.data_pagamento) === iPag
  if (!dataOk) { B.limpo_data_diverge.push({ ...base, data_sienge: iPag }); continue }
  B.limpo_valida++; limpoValidaComissao += round2(p.comissao_gerada)
}

// 6. metrica
const sc = (arr) => round2(arr.reduce((s, x) => s + (x.comissao_gerada || 0), 0))
const limpoPagasAncoradas = B.limpo_valida + B.limpo_nao_pago.length + B.limpo_valor_diverge.length + B.limpo_data_diverge.length + B.limpo_orfa.length
const pct = limpoPagasAncoradas > 0 ? round2((100 * B.limpo_valida) / limpoPagasAncoradas) : 0
const metric = {
  meta: { geradoEm: new Date().toISOString(), spec_ref: '.claude/rules/sincronizacao-sienge.md',
    doc_ref: 'docs/contexto/2026-06-10-north-star-3-ancora-correta.md', script: 'scripts/validar-ancora-vs-sienge.mjs',
    modo: 'read-only (F1 v2 segmentado)', regra: 'LIMPO=valor+data EXATOS; COM-TERMO=trilho do termo',
    nota_income: r.stale ? `income stale (${r.staleAgeMin}min) — ok pro segmento LIMPO (contratos velhos estaveis)` : 'income fresco' },
  termometro_LIMPO: {
    pct_ancora_correta: pct,
    pagas_ancoradas_limpas: limpoPagasAncoradas, validas: B.limpo_valida,
  },
  counts: {
    LIMPO_valida: B.limpo_valida,
    LIMPO_installment_nao_pago: B.limpo_nao_pago.length,
    LIMPO_valor_diverge: B.limpo_valor_diverge.length,
    LIMPO_data_diverge: B.limpo_data_diverge.length,
    LIMPO_orfa: B.limpo_orfa.length,
    TERMO_distrato: B.termo_distrato,
    TERMO_aditivo: B.termo_aditivo,
    sem_ancora: B.sem_ancora,
  },
  segmentacao_vendas: {
    limpo: [...termoVenda.values()].filter((t) => t === 'limpo').length,
    distrato: [...termoVenda.values()].filter((t) => t === 'distrato').length,
    aditivo: [...termoVenda.values()].filter((t) => t === 'aditivo').length,
  },
  // achados do segmento LIMPO (o que precisa olhar — erro de ancora REAL, sem termo pra explicar)
  LIMPO_installment_nao_pago: B.limpo_nao_pago.sort((a, b) => b.comissao_gerada - a.comissao_gerada),
  LIMPO_valor_diverge: B.limpo_valor_diverge,
  LIMPO_data_diverge: B.limpo_data_diverge.slice(0, 60),
  LIMPO_orfa: B.limpo_orfa,
}

console.log('\n============ F1 v2: ANCORA SEGMENTADA ============')
console.log(`  vendas: limpo=${metric.segmentacao_vendas.limpo}  distrato=${metric.segmentacao_vendas.distrato}  aditivo=${metric.segmentacao_vendas.aditivo}`)
console.log(`\n  >>> % ANCORA CORRETA (SEGMENTO LIMPO): ${pct}%  (${B.limpo_valida}/${limpoPagasAncoradas})`)
console.log(`  ✅ LIMPO valida (valor+data exatos):  ${B.limpo_valida}`)
console.log(`  🔴 LIMPO installment NAO pago:        ${B.limpo_nao_pago.length}  -> R$ ${sc(B.limpo_nao_pago)}  (ancora errada ou over-pay real)`)
console.log(`  🟡 LIMPO valor diverge:               ${B.limpo_valor_diverge.length}  -> R$ ${sc(B.limpo_valor_diverge)}`)
console.log(`  🟡 LIMPO data diverge:                ${B.limpo_data_diverge.length}  -> R$ ${sc(B.limpo_data_diverge)}  (drift ou ancora errada)`)
console.log(`  ⚪ LIMPO orfa:                        ${B.limpo_orfa.length}`)
console.log(`  --- com-termo (trilho proprio, F2/F4) ---`)
console.log(`  🟠 distrato: ${B.termo_distrato} pagas   |   aditivo: ${B.termo_aditivo} pagas`)
console.log(`  ⚫ sem ancora (ponto cego): ${B.sem_ancora}`)

mkdirSync('docs/auditorias/2026-06-10-ancora', { recursive: true })
const out = 'docs/auditorias/2026-06-10-ancora/f1-validacao-ancora-v2.json'
writeFileSync(out, JSON.stringify(metric, null, 2))
console.log(`\nSalvo: ${out}`)
