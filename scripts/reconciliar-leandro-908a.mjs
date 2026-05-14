// Reconcilia a venda do LEANDRO (908 A, bill 381) com o Sienge real.
// Piloto da rodada b7 — usa /bulk-data/v1/income como fonte da verdade.
//
// Para cada parcela PM do Sienge, match por (valor, data_prevista) com o banco:
//   - match com ATIVA  -> popula sienge_installment_id; se Sienge pago e banco
//                         pendente, marca pago com a data do Sienge
//   - match so com CANCELADA -> reativa (cancelado->pago se Sienge pago, senao
//                         ->pendente) + sienge_installment_id
//   - sem match no banco -> CRIA a parcela (status conforme Sienge)
//   - parcela ATIVA no banco sem match no Sienge -> NAO mexe, so loga
//
// Trigger 017: nao bloqueia cancelado->pago/pendente (so transicoes DE pago).
// sienge_installment_id/sienge_bill_id (migration 023) nao sao protegidos.
//
// Comissao das parcelas criadas: formula canonica (.claude/rules/fator-comissao.md)
//   fator = (valor_venda * pct/100) / pro_soluto ; comissao = valor * fator
//   LEANDRO e tipo_corretor=externo -> pct=7 (confirmado: fator atual 0.35 confere).
//
// Uso:
//   node scripts/reconciliar-leandro-908a.mjs          (dry-run)
//   node scripts/reconciliar-leandro-908a.mjs --apply

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

const BILL = 381
const norm = (x) => Number(x).toFixed(2)

// 1. venda + parcelas
const { data: vs } = await supa.from('vendas').select('*').ilike('unidade', '908 A')
const v = vs[0]
const PCT = v.tipo_corretor === 'interno' ? 6.5 : 7
const fatorCanonico = (Number(v.valor_venda) * (PCT / 100)) / Number(v.valor_pro_soluto)
console.log(`Venda ${v.id} | tipo=${v.tipo_corretor} pct=${PCT} fator=${fatorCanonico.toFixed(6)}`)

const { data: pags } = await supa
  .from('pagamentos_prosoluto')
  .select('id, numero_parcela, tipo, valor, data_prevista, data_pagamento, status')
  .eq('venda_id', v.id)

// 2. income Sienge do bill
const r = await siengeGet({
  path: '/bulk-data/v1/income',
  query: { startDate: '2023-01-01', endDate: '2031-12-31', selectionType: 'D', companyId: 5 },
})
const incomePM = extractRows(r.data).filter((i) => Number(i.billId) === BILL && i.paymentTerm?.id === 'PM')
console.log(`Sienge: ${incomePM.length} parcelas PM no bill ${BILL}`)

// indices do banco por (valor, data_prevista)
const bancoPorChave = new Map()
for (const p of pags) {
  if (p.tipo !== 'parcela_entrada') continue
  const k = `${norm(p.valor)}__${p.data_prevista}`
  if (!bancoPorChave.has(k)) bancoPorChave.set(k, [])
  bancoPorChave.get(k).push(p)
}

let maxNumero = Math.max(0, ...pags.filter((p) => p.numero_parcela != null).map((p) => Number(p.numero_parcela)))

const acoes = { popular: [], reativar: [], criar: [], marcar_pago: [] }
const usados = new Set()

for (const inc of incomePM) {
  const valor = Number(inc.originalAmount || 0)
  const due = inc.dueDate
  const paymentDate = inc.paymentDate || (inc.receipts?.[0]?.paymentDate) || null
  const recebido = (inc.receipts || []).reduce((s, x) => s + Number(x.netAmount || 0), 0)
  const siengePago = !!paymentDate && recebido > 0
  const instId = String(inc.installmentId ?? inc.installmentNumber ?? '')
  const k = `${norm(valor)}__${due}`
  const candidatos = (bancoPorChave.get(k) || []).filter((p) => !usados.has(p.id))

  // prefere ativa; senao cancelada
  const ativa = candidatos.find((p) => p.status !== 'cancelado')
  const cancelada = candidatos.find((p) => p.status === 'cancelado')

  if (ativa) {
    usados.add(ativa.id)
    if (siengePago && ativa.status === 'pendente') {
      acoes.marcar_pago.push({ id: ativa.id, data_pagamento: paymentDate, sienge_installment_id: instId, valor, due })
    } else {
      acoes.popular.push({ id: ativa.id, sienge_installment_id: instId, valor, due, status: ativa.status })
    }
  } else if (cancelada) {
    usados.add(cancelada.id)
    acoes.reativar.push({
      id: cancelada.id, valor, due,
      novo_status: siengePago ? 'pago' : 'pendente',
      data_pagamento: siengePago ? paymentDate : null,
      sienge_installment_id: instId,
    })
  } else {
    maxNumero++
    acoes.criar.push({
      numero_parcela: maxNumero, tipo: 'parcela_entrada', valor,
      data_prevista: due,
      status: siengePago ? 'pago' : 'pendente',
      data_pagamento: siengePago ? paymentDate : null,
      comissao_gerada: Number((valor * fatorCanonico).toFixed(2)),
      fator_comissao_aplicado: Number(fatorCanonico.toFixed(6)),
      percentual_comissao_total: PCT,
      venda_id: v.id,
      sienge_installment_id: instId,
      sienge_bill_id: BILL,
    })
  }
}

// parcelas ativas no banco sem match no Sienge
const semMatchSienge = pags.filter(
  (p) => p.tipo === 'parcela_entrada' && p.status !== 'cancelado' && !usados.has(p.id),
)

console.log(`\n=== PLANO ===`)
console.log(`  popular sienge_installment_id (parcela ja ok):   ${acoes.popular.length}`)
console.log(`  marcar pago (pendente -> pago, Sienge confirma):  ${acoes.marcar_pago.length}`)
for (const a of acoes.marcar_pago) console.log(`     R$ ${a.valor} venc ${a.due} -> pago em ${a.data_pagamento}`)
console.log(`  reativar cancelada:                              ${acoes.reativar.length}`)
for (const a of acoes.reativar) console.log(`     R$ ${a.valor} venc ${a.due} cancelado -> ${a.novo_status}${a.data_pagamento ? ' (' + a.data_pagamento + ')' : ''}`)
console.log(`  criar parcela nova:                              ${acoes.criar.length}`)
for (const a of acoes.criar) console.log(`     #${a.numero_parcela} R$ ${a.valor} venc ${a.data_prevista} status=${a.status}${a.data_pagamento ? ' (' + a.data_pagamento + ')' : ''} com=${a.comissao_gerada}`)
console.log(`  ativas no banco SEM match no Sienge (nao mexer):  ${semMatchSienge.length}`)
for (const p of semMatchSienge) console.log(`     ! num=${p.numero_parcela} R$ ${p.valor} venc ${p.data_prevista} status=${p.status}`)

if (DRY) {
  console.log('\nDry-run apenas. Pra aplicar: --apply')
  process.exit(0)
}

// ---------- APPLY ----------
const report = { meta: { geradoEm: new Date().toISOString(), venda_id: v.id, bill: BILL, modo: 'apply' }, counts: {}, drift: [], errors: [] }
let okPop = 0, okMarc = 0, okReat = 0, okCriar = 0, err = 0

// popular sienge_installment_id
for (const a of acoes.popular) {
  const res = await fetch(`${URL}/rest/v1/pagamentos_prosoluto?id=eq.${a.id}`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({ sienge_installment_id: a.sienge_installment_id, sienge_bill_id: BILL, updated_at: new Date().toISOString() }),
  })
  if (res.ok) okPop++; else { err++; report.errors.push({ acao: 'popular', id: a.id, msg: `HTTP ${res.status}` }) }
}
// marcar pago
for (const a of acoes.marcar_pago) {
  const res = await fetch(`${URL}/rest/v1/pagamentos_prosoluto?id=eq.${a.id}&status=eq.pendente`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({ status: 'pago', data_pagamento: a.data_pagamento, sienge_installment_id: a.sienge_installment_id, sienge_bill_id: BILL, updated_at: new Date().toISOString() }),
  })
  if (res.ok) { okMarc++; report.drift.push({ id: a.id, campo: 'status', antes: 'pendente', depois: 'pago', motivo: `Sienge confirma pagamento em ${a.data_pagamento}` }) }
  else { err++; report.errors.push({ acao: 'marcar_pago', id: a.id, msg: `HTTP ${res.status}` }) }
}
// reativar cancelada
for (const a of acoes.reativar) {
  const patch = { status: a.novo_status, sienge_installment_id: a.sienge_installment_id, sienge_bill_id: BILL, updated_at: new Date().toISOString() }
  if (a.data_pagamento) patch.data_pagamento = a.data_pagamento
  const res = await fetch(`${URL}/rest/v1/pagamentos_prosoluto?id=eq.${a.id}&status=eq.cancelado`, {
    method: 'PATCH', headers: H, body: JSON.stringify(patch),
  })
  if (res.ok) { okReat++; report.drift.push({ id: a.id, campo: 'status', antes: 'cancelado', depois: a.novo_status, motivo: `Sienge tem essa parcela como valida (bill ${BILL})` }) }
  else { err++; report.errors.push({ acao: 'reativar', id: a.id, msg: `HTTP ${res.status}` }) }
}
// criar
for (const a of acoes.criar) {
  const res = await fetch(`${URL}/rest/v1/pagamentos_prosoluto`, {
    method: 'POST', headers: H, body: JSON.stringify({ ...a, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  })
  if (res.ok) { okCriar++; report.drift.push({ acao: 'criar', valor: a.valor, due: a.data_prevista, status: a.status }) }
  else { const t = await res.text(); err++; report.errors.push({ acao: 'criar', valor: a.valor, msg: `HTTP ${res.status}: ${t.slice(0,150)}` }) }
}

report.counts = { popular: okPop, marcar_pago: okMarc, reativar: okReat, criar: okCriar, errors: err }
const out = `docs/reconciliacao-leandro-908a-${new Date().toISOString().slice(0, 10)}.json`
writeFileSync(out, JSON.stringify(report, null, 2))
console.log(`\n=== Aplicado ===`)
console.log(`  populados: ${okPop} | marcados pago: ${okMarc} | reativados: ${okReat} | criados: ${okCriar} | erros: ${err}`)
console.log(`Report: ${out}`)
