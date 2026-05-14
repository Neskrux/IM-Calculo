// Cancela parcelas PENDENTES que sao duplicata pura de uma parcela PAGA da
// mesma venda — mesmo (tipo, numero_parcela, valor, data_prevista).
//
// Origem: gestora reportou em 2026-05-14 a venda LEANDRO (908 A) com "Parcela 5"
// aparecendo 2x (uma paga, uma pendente, identicas). Sintoma das duplicatas de
// numero_parcela ja mapeadas na rodada b7.
//
// Criterio CONSERVADOR e inequivoco:
//   - so cancela status='pendente'
//   - so quando existe na mesma venda uma parcela status='pago' com
//     MESMO tipo, MESMO numero_parcela, MESMO valor e MESMA data_prevista
//   - se a pendente difere em valor ou data da paga -> NAO toca (ambiguo, vai pra b7)
//   - grupos so com pagas, ou cancelada+ativa -> NAO toca
//
// Seguro: cancelar pendente nao tem trava (trigger 017 so protege pago). A
// pendente cancelada e matematicamente redundante — zero perda financeira.
//
// Idempotente: WHERE status=eq.pendente.
//
// Uso:
//   node scripts/cancelar-pendentes-redundantes.mjs          (dry-run)
//   node scripts/cancelar-pendentes-redundantes.mjs --apply

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const DRY = !process.argv.includes('--apply')
console.log(`Modo: ${DRY ? 'dry-run' : 'apply'}\n`)

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

// 1. carregar todos os pagamentos
console.log('=== Carregando pagamentos_prosoluto ===')
const pagamentos = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supa
    .from('pagamentos_prosoluto')
    .select('id, venda_id, numero_parcela, tipo, valor, data_prevista, data_pagamento, status')
    .range(from, from + 999)
  if (error) { console.error('erro:', error); process.exit(1) }
  if (!data?.length) break
  pagamentos.push(...data)
  if (data.length < 1000) break
}
console.log(`  ${pagamentos.length} pagamentos`)

// 2. agrupar por (venda_id, tipo, numero_parcela)
const grupos = new Map()
for (const p of pagamentos) {
  if (p.numero_parcela == null) continue
  const k = `${p.venda_id}__${p.tipo}__${p.numero_parcela}`
  if (!grupos.has(k)) grupos.set(k, [])
  grupos.get(k).push(p)
}

// 3. identificar pendentes redundantes
const alvos = []
const norm = (v) => Number(v).toFixed(2)
for (const [k, arr] of grupos.entries()) {
  if (arr.length < 2) continue
  const pagas = arr.filter((p) => p.status === 'pago')
  const pendentes = arr.filter((p) => p.status === 'pendente')
  if (pagas.length === 0 || pendentes.length === 0) continue
  for (const pend of pendentes) {
    // existe uma paga identica (valor + data_prevista)?
    const gemea = pagas.find(
      (pg) => norm(pg.valor) === norm(pend.valor) && pg.data_prevista === pend.data_prevista,
    )
    if (gemea) {
      alvos.push({
        pendente_id: pend.id,
        venda_id: pend.venda_id,
        tipo: pend.tipo,
        numero_parcela: pend.numero_parcela,
        valor: pend.valor,
        data_prevista: pend.data_prevista,
        paga_gemea_id: gemea.id,
        paga_gemea_data_pagamento: gemea.data_pagamento,
      })
    }
  }
}

console.log(`\n=== Pendentes redundantes (gemeas identicas de uma paga) ===`)
console.log(`  total: ${alvos.length}`)
// agrupar por venda pra exibir
const porVenda = new Map()
for (const a of alvos) {
  if (!porVenda.has(a.venda_id)) porVenda.set(a.venda_id, [])
  porVenda.get(a.venda_id).push(a)
}
console.log(`  vendas afetadas: ${porVenda.size}`)

// enriquecer com nome do cliente / contrato pra exibir
for (const [vid, lista] of porVenda.entries()) {
  const { data: v } = await supa.from('vendas').select('sienge_contract_id, unidade, cliente_id').eq('id', vid).single()
  const { data: cli } = v?.cliente_id
    ? await supa.from('clientes').select('nome_completo').eq('id', v.cliente_id).maybeSingle()
    : { data: null }
  console.log(`  ${cli?.nome_completo || '?'} (${v?.unidade || '-'}, contrato ${v?.sienge_contract_id || '-'}): ${lista.length} pendente(s) redundante(s)`)
  for (const a of lista) {
    console.log(`     parc ${a.numero_parcela} (${a.tipo}) R$ ${a.valor} venc ${a.data_prevista} — paga gemea pagou em ${a.paga_gemea_data_pagamento}`)
  }
}

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    spec_ref: '.claude/rules/sincronizacao-sienge.md, .claude/rules/rodadas-b.md',
    script: 'scripts/cancelar-pendentes-redundantes.mjs',
    modo: DRY ? 'dry-run' : 'apply',
    criterio: 'pendente com mesmo (venda, tipo, numero_parcela, valor, data_prevista) que uma parcela paga -> cancelar pendente',
  },
  counts: { matched: alvos.length, updated: 0, skipped: 0, errors: 0 },
  drift: [],
  errors: [],
}

if (DRY) {
  console.log('\nDry-run apenas. Pra aplicar: --apply')
  process.exit(0)
}

// APPLY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
let updated = 0, skipped = 0, errors = 0
for (const a of alvos) {
  const url = `${URL}/rest/v1/pagamentos_prosoluto?id=eq.${a.pendente_id}&status=eq.pendente`
  const body = JSON.stringify({ status: 'cancelado', updated_at: new Date().toISOString() })
  try {
    const res = await fetch(url, { method: 'PATCH', headers: H, body })
    if (!res.ok) {
      const txt = await res.text()
      report.errors.push({ id: a.pendente_id, msg: `HTTP ${res.status}: ${txt.slice(0, 120)}` })
      errors++
      continue
    }
    const arr = await res.json()
    if (arr.length > 0) {
      updated++
      report.drift.push({
        id: a.pendente_id, campo: 'status', antes: 'pendente', depois: 'cancelado',
        motivo: `duplicata pura: existe parcela paga identica (id ${a.paga_gemea_id}) — mesmo tipo/numero/valor/data_prevista`,
      })
    } else {
      skipped++
    }
  } catch (e) {
    report.errors.push({ id: a.pendente_id, msg: String(e).slice(0, 150) })
    errors++
  }
}
report.counts.updated = updated
report.counts.skipped_idempotent = skipped
report.counts.errors = errors

const out = `docs/aplicacao-pendentes-redundantes-${new Date().toISOString().slice(0, 10)}.json`
writeFileSync(out, JSON.stringify(report, null, 2))
console.log(`\n=== Aplicacao ===`)
console.log(`  alvo: ${alvos.length} | updated: ${updated} | skipped: ${skipped} | errors: ${errors}`)
console.log(`Report: ${out}`)
