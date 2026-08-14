// Ancora parcelas ORFAS pelo caminho inverso: parcela -> bill da propria venda -> installments LIVRES.
//
// Motivacao (2026-08-11): o reconciliador parqueia a venda INTEIRA quando acha ambiguidade (S2/S4).
// Com isso, parcelas perfeitamente casaveis da mesma venda nunca sao tentadas. Este script ataca
// parcela a parcela, isolando a ambiguidade em vez de propagar pra venda toda.
//
// Criterio de match (o mesmo fallback que a spec ja autoriza quando nao ha ancora):
//   (tipo, valor, data_prevista) EXATOS contra os installments do bill que ainda nao estao
//   ancorados em nenhuma outra parcela. So grava quando ha EXATAMENTE 1 candidato.
//
// ESCREVE APENAS: sienge_installment_id (+ sienge_bill_id se nulo).
// NUNCA toca: valor, comissao_gerada, status, data_prevista, data_pagamento, tipo.
//
// ver .claude/rules/sincronizacao-sienge.md · .claude/rules/numeracao-parcelas-sienge.md
// Uso: node scripts/ancorar-parcelas-orfas.mjs            # dry-run
//      node scripts/ancorar-parcelas-orfas.mjs --apply    # ESCREVE
//      node scripts/ancorar-parcelas-orfas.mjs --rollback # desfaz (volta ancora ao valor anterior)

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { siengeGet, extractRows } from './_sienge-http.mjs'

const APPLY = process.argv.includes('--apply')
const ROLLBACK = process.argv.includes('--rollback')
const OUT = 'docs/auditorias/rollbacks/2026-08-11-ancorar-orfas-rollback.json'
const REL = 'docs/auditorias/medicoes/ancorar-orfas-2026-08-11.json'

// Credenciais: process.env primeiro (CI), .env como fallback local. No runner NÃO existe .env —
// ler direto quebrava o passo do cron com ENOENT (pego na validação por workflow_dispatch, 2026-08-13).
// Mesmo padrão de reconciliar-todas-vendas.mjs.
const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const g = (k) => process.env[k] || fromFile(k)
const sb = createClient(g('VITE_SUPABASE_URL'), g('VITE_SUPABASE_ANON_KEY'))
const all = async (b) => { const o = []; let f = 0; for (;;) { const { data, error } = await b(f, f + 999); if (error) throw error; o.push(...data); if (data.length < 1000) break; f += 1000 } return o }
const d10 = x => x ? String(x).slice(0, 10) : null

const m = { meta: { geradoEm: new Date().toISOString(), spec_ref: '.claude/rules/sincronizacao-sienge.md',
  script: 'scripts/ancorar-parcelas-orfas.mjs', modo: ROLLBACK ? 'rollback' : APPLY ? 'apply' : 'dry-run' },
  counts: { matched: 0, updated: 0, skipped_idempotent: 0, ambiguo: 0, sem_candidato: 0, sem_bill: 0, errors: 0 },
  drift: [], humano_pendente: [], errors: [] }

if (ROLLBACK) {
  if (!existsSync(OUT)) { console.error(`sem snapshot em ${OUT}`); process.exit(1) }
  const snap = JSON.parse(readFileSync(OUT, 'utf8'))
  for (const r of snap.drift) {
    const { error } = await sb.from('pagamentos_prosoluto')
      .update({ sienge_installment_id: r.antes }).eq('id', r.id)
    if (error) { m.counts.errors++; m.errors.push({ id: r.id, msg: error.message }) } else m.counts.updated++
  }
  console.log(`rollback: ${m.counts.updated} revertidas, ${m.counts.errors} erros`)
  process.exit(0)
}

// --- income por bill (mesma query do reconciliador -> mesma entrada de cache, zero quota extra) ---
const r = await siengeGet({
  path: '/bulk-data/v1/income',
  query: { startDate: '2023-01-01', endDate: '2031-12-31', selectionType: 'D', companyId: 5 },
})
const income = extractRows(r.data)
const porBill = new Map()
for (const r of income) { const b = Number(r.billId); if (!porBill.has(b)) porBill.set(b, []); porBill.get(b).push(r) }

// mapa paymentTerm -> tipo interno (mesmo do reconciliador, + os que faltavam: B9, 10, BN, CH)
const MAPA = { PM: 'parcela_entrada', SN: 'sinal', AT: 'sinal',
  BA: 'balao', B1: 'balao', B2: 'balao', B3: 'balao', B4: 'balao', B5: 'balao',
  B6: 'balao', B7: 'balao', B8: 'balao', B9: 'balao', '10': 'balao', BN: 'balao', CH: 'balao' }
const tipoDe = r => MAPA[r.paymentTerm?.id] || null

const vendas = await all((a, b) => sb.from('vendas')
  .select('id,unidade,status,excluido,sienge_receivable_bill_id').order('id').range(a, b))
const pags = await all((a, b) => sb.from('pagamentos_prosoluto')
  .select('id,venda_id,status,valor,data_prevista,sienge_installment_id,sienge_bill_id,tipo,numero_parcela')
  .order('id').range(a, b))
const vById = new Map(vendas.map(v => [v.id, v]))
const ativa = v => v && !v.excluido && v.status !== 'distrato'
const at = pags.filter(p => ativa(vById.get(p.venda_id)) && p.status !== 'cancelado')

const porVenda = new Map()
for (const p of at) { if (!porVenda.has(p.venda_id)) porVenda.set(p.venda_id, []); porVenda.get(p.venda_id).push(p) }

const plano = []
for (const [vid, ps] of porVenda) {
  const v = vById.get(vid)
  const orfas = ps.filter(p => !p.sienge_installment_id)
  if (!orfas.length) continue
  const bill = Number(v.sienge_receivable_bill_id)
  if (!bill) { m.counts.sem_bill += orfas.length
    m.humano_pendente.push({ unidade: v.unidade, motivo: 'venda sem sienge_receivable_bill_id', n: orfas.length, ref_b: 'b14' }); continue }
  const inc = porBill.get(bill)
  if (!inc) { m.counts.sem_bill += orfas.length
    m.humano_pendente.push({ unidade: v.unidade, motivo: 'bill nao aparece no income', n: orfas.length, ref_b: 'b14' }); continue }
  // installments ja usados por OUTRA parcela desta venda
  const usados = new Set(ps.filter(p => p.sienge_installment_id).map(p => String(p.sienge_installment_id)))
  const livres = inc.filter(r => !usados.has(String(r.installmentId)))
  for (const p of orfas) {
    const cand = livres.filter(r =>
      Math.abs(Number(r.originalAmount || 0) - Number(p.valor)) <= 0.01 &&
      d10(r.dueDate) === d10(p.data_prevista) &&
      (tipoDe(r) === null || tipoDe(r) === p.tipo))
    if (cand.length === 1) {
      m.counts.matched++
      plano.push({ id: p.id, unidade: v.unidade, np: p.numero_parcela, tipo: p.tipo,
        valor: Number(p.valor), data: d10(p.data_prevista), bill, inst: Number(cand[0].installmentId) })
      usados.add(String(cand[0].installmentId))  // nao reutiliza o mesmo installment
    } else if (cand.length > 1) {
      m.counts.ambiguo++
      m.humano_pendente.push({ unidade: v.unidade, np: p.numero_parcela, motivo: `${cand.length} installments identicos (tipo,valor,data)`, ref_b: 'b14' })
    } else {
      m.counts.sem_candidato++
      m.humano_pendente.push({ unidade: v.unidade, np: p.numero_parcela, tipo: p.tipo, valor: Number(p.valor), data: d10(p.data_prevista),
        motivo: 'nenhum installment do bill casa (tipo,valor,data) — candidata a parcela fantasma', ref_b: 'b14' })
    }
  }
}

console.log(`orfas com match UNICO: ${m.counts.matched}`)
console.log(`  ambiguas: ${m.counts.ambiguo} | sem candidato: ${m.counts.sem_candidato} | sem bill: ${m.counts.sem_bill}`)
const porU = {}; for (const x of plano) porU[x.unidade] = (porU[x.unidade] || 0) + 1
console.log('\npor unidade:'); for (const [u, n] of Object.entries(porU).sort((a, b) => b[1] - a[1])) console.log(`  ${u.padEnd(8)} ${n}`)

if (APPLY) {
  for (const x of plano) {
    const upd = { sienge_installment_id: x.inst }
    const row = pags.find(p => p.id === x.id)
    if (!row.sienge_bill_id) upd.sienge_bill_id = x.bill
    const { error } = await sb.from('pagamentos_prosoluto').update(upd)
      .eq('id', x.id).is('sienge_installment_id', null)   // idempotente: so grava se ainda nula
    if (error) { m.counts.errors++; m.errors.push({ id: x.id, unidade: x.unidade, msg: error.message }) }
    else { m.counts.updated++; m.drift.push({ id: x.id, unidade: x.unidade, campo: 'sienge_installment_id',
      antes: null, depois: x.inst, motivo: `match unico (tipo,valor,data) no bill ${x.bill}` }) }
  }
  mkdirSync('docs/auditorias/rollbacks', { recursive: true })
  writeFileSync(OUT, JSON.stringify(m, null, 1))
}
mkdirSync('docs/auditorias/medicoes', { recursive: true })
writeFileSync(REL, JSON.stringify({ ...m, plano }, null, 1))
console.log(`\n${JSON.stringify(m.counts)}`)
console.log(APPLY ? `aplicado. rollback em ${OUT}` : 'DRY-RUN — nada escrito. Use --apply.')
