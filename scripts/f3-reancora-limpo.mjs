// F3 — Re-match dos achados do SEGMENTO LIMPO (North Star #3, fase F3).
//
// Le os achados do limpo da F1 v2 (installment-nao-pago / valor-diverge / data-diverge)
// e, pra cada um, busca no MESMO bill o installment de VALOR EXATO + DATA EXATA que o
// pagamento da parcela. Em contrato LIMPO cada installment e unico => o match e
// DETERMINISTICO. Separa em:
//   - re_ancoravel : existe 1 installment exato e LIVRE  -> trocar sienge_installment_id (so metadado)
//   - ambiguo      : existe match exato mas OCUPADO por outra parcela, ou 2+ candidatos -> rodada-b
//   - over_pay_real: nenhum installment do bill bate valor+data -> Excluir Baixa
//
// READ-ONLY. ver docs/contexto/2026-06-10-north-star-3-ancora-correta.md (D2, F3)
// Uso: node scripts/f3-reancora-limpo.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
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

// 1. achados do limpo (F1 v2)
const f1 = JSON.parse(readFileSync('docs/auditorias/2026-06-10-ancora/f1-validacao-ancora-v2.json', 'utf8'))
const achados = [
  ...(f1.LIMPO_installment_nao_pago || []).map((x) => ({ ...x, origem: 'nao_pago' })),
  ...(f1.LIMPO_valor_diverge || []).map((x) => ({ ...x, origem: 'valor_diverge' })),
  ...(f1.LIMPO_data_diverge || []).map((x) => ({ ...x, origem: 'data_diverge' })),
]
console.log(`Achados do limpo a re-matchar: ${achados.length}`)

// 2. income -> installments por bill
const r = await siengeGet({ path: '/bulk-data/v1/income', query: { startDate: '2023-01-01', endDate: '2031-12-31', selectionType: 'D', companyId: 5 } })
const incPorBill = new Map()
for (const i of extractRows(r.data)) {
  const bill = Number(i.billId); if (!bill || i.installmentId == null) continue
  if (!incPorBill.has(bill)) incPorBill.set(bill, [])
  incPorBill.get(bill).push({ inst: String(i.installmentId), paymentDate: d10(pagDate(i)), originalAmount: round2(i.originalAmount) })
}

// 3. ocupacao: (bill__inst) -> parcela_id (parcelas nao-canceladas com ancora)
console.log('Carregando ocupacao das ancoras...')
const { data: vRows } = await supa.from('vendas').select('id').eq('empreendimento_id', FIGUEIRA).eq('excluido', false)
const vIds = (vRows || []).map((v) => v.id)
const ocup = new Map()
for (let i = 0; i < vIds.length; i += 50) {
  const chunk = vIds.slice(i, i + 50)
  for (let f = 0; ; f += PAGE) {
    const { data } = await supa.from('pagamentos_prosoluto')
      .select('id, sienge_bill_id, sienge_installment_id, status').in('venda_id', chunk)
      .not('sienge_installment_id', 'is', null).neq('status', 'cancelado').order('id').range(f, f + PAGE - 1)
    if (!data?.length) break
    for (const p of data) ocup.set(`${Number(p.sienge_bill_id)}__${p.sienge_installment_id}`, p.id)
    if (data.length < PAGE) break
  }
}

// 4. re-match deterministico (valor EXATO + data EXATA)
const B = { re_ancoravel: [], ambiguo: [], over_pay_real: [] }
for (const a of achados) {
  const bill = Number(a.bill)
  const cands = (incPorBill.get(bill) || []).filter((j) =>
    j.inst !== String(a.inst) &&
    Math.abs(round2(a.valor) - j.originalAmount) <= 0.01 &&     // valor EXATO
    j.paymentDate === a.data_pagamento_local                    // data EXATA
  ).map((j) => ({ ...j, ocupado_por: ocup.get(`${bill}__${j.inst}`) || null }))
  const livres = cands.filter((c) => !c.ocupado_por || c.ocupado_por === a.parcela_id)

  if (cands.length === 0) {
    B.over_pay_real.push({ ...a, veredito: 'nenhum installment do bill bate valor+data -> Excluir Baixa' })
  } else if (livres.length === 1) {
    B.re_ancoravel.push({ ...a, installment_correto: livres[0].inst,
      veredito: 'match unico e livre -> re-ancorar (so sienge_installment_id)' })
  } else {
    B.ambiguo.push({ ...a, candidatos: cands.map((c) => ({ inst: c.inst, ocupado_por: c.ocupado_por })),
      veredito: cands.length > 1 ? '2+ candidatos exatos' : 'unico candidato mas OCUPADO -> rodada-b' })
  }
}

const sc = (arr) => round2(arr.reduce((s, x) => s + (x.comissao_gerada || 0), 0))
const out = {
  meta: { geradoEm: new Date().toISOString(), spec_ref: '.claude/rules/sincronizacao-sienge.md',
    doc_ref: 'docs/contexto/2026-06-10-north-star-3-ancora-correta.md (F3)',
    script: 'scripts/f3-reancora-limpo.mjs', modo: 'read-only',
    regra: 'match valor EXATO + data EXATA no mesmo bill (segmento limpo = installment unico)' },
  counts: { achados: achados.length, re_ancoravel: B.re_ancoravel.length, ambiguo: B.ambiguo.length, over_pay_real: B.over_pay_real.length },
  comissao: { re_ancoravel: sc(B.re_ancoravel), ambiguo: sc(B.ambiguo), over_pay_real: sc(B.over_pay_real) },
  re_ancoravel: B.re_ancoravel.sort((a, b) => b.comissao_gerada - a.comissao_gerada),
  over_pay_real: B.over_pay_real.sort((a, b) => b.comissao_gerada - a.comissao_gerada),
  ambiguo: B.ambiguo,
}
console.log('\n============ F3: RE-MATCH DO LIMPO ============')
console.log(`  achados: ${achados.length}`)
console.log(`  🟢 RE-ANCORAVEL (match unico+livre):  ${B.re_ancoravel.length}  -> R$ ${out.comissao.re_ancoravel}  (so troca installment_id, nao mexe financeiro)`)
console.log(`  🟡 AMBIGUO (alvo ocupado / 2+):       ${B.ambiguo.length}  -> R$ ${out.comissao.ambiguo}  (rodada-b)`)
console.log(`  🔴 OVER-PAY REAL (nada bate):         ${B.over_pay_real.length}  -> R$ ${out.comissao.over_pay_real}  (Excluir Baixa)`)
writeFileSync('docs/auditorias/2026-06-10-ancora/f3-reancora-limpo.json', JSON.stringify(out, null, 2))
console.log(`\nSalvo: docs/auditorias/2026-06-10-ancora/f3-reancora-limpo.json`)
