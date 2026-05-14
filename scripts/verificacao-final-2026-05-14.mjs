// Verificacao final consolidada apos as correcoes de 2026-05-13/14.
// Health-check: duplicidades de parcela, vendas duplicadas, invariantes.
// READ-ONLY.

import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

const PAGE = 1000
async function loadAll(table, select, extra = (q) => q) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    let q = supa.from(table).select(select).range(from, from + PAGE - 1)
    q = extra(q)
    const { data, error } = await q
    if (error) { console.error(`erro ${table}:`, error.message); process.exit(1) }
    if (!data?.length) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

console.log('=== Carregando dados ===')
const vendas = await loadAll('vendas', 'id, sienge_contract_id, unidade, cliente_id, excluido, tipo_corretor')
const ativasVendas = vendas.filter((v) => v.excluido !== true)
const pagamentos = await loadAll(
  'pagamentos_prosoluto',
  'id, venda_id, numero_parcela, tipo, valor, data_prevista, data_pagamento, status',
)
console.log(`  vendas: ${vendas.length} (${ativasVendas.length} ativas)`)
console.log(`  pagamentos: ${pagamentos.length}`)

const vendaAtivaIds = new Set(ativasVendas.map((v) => v.id))
let problemas = 0
const check = (nome, lista, mostrar = 8) => {
  if (lista.length === 0) {
    console.log(`  OK  ${nome}`)
  } else {
    problemas += lista.length
    console.log(`  !!  ${nome}: ${lista.length}`)
    for (const x of lista.slice(0, mostrar)) console.log(`        ${x}`)
    if (lista.length > mostrar) console.log(`        ... +${lista.length - mostrar}`)
  }
}

// mapa venda -> info
const vMap = new Map(vendas.map((v) => [v.id, v]))
// nomes de cliente (so dos que aparecem em problemas — busca sob demanda no fim)

console.log('\n=== 1. Duplicidade de numero_parcela (em vendas ATIVAS) ===')
const porVenda = new Map()
for (const p of pagamentos) {
  if (!vendaAtivaIds.has(p.venda_id)) continue
  if (p.numero_parcela == null) continue
  const k = `${p.venda_id}__${p.tipo}__${p.numero_parcela}`
  if (!porVenda.has(k)) porVenda.set(k, [])
  porVenda.get(k).push(p)
}
const dupCancAtivo = []
const dupMultiPaga = []
const dupPendenteRedundante = []
const dupOutros = []
const norm = (v) => Number(v).toFixed(2)
for (const [k, arr] of porVenda.entries()) {
  if (arr.length < 2) continue
  const pagas = arr.filter((p) => p.status === 'pago')
  const pendentes = arr.filter((p) => p.status === 'pendente')
  const v = vMap.get(arr[0].venda_id)
  const tag = `${v?.unidade || '-'} contrato ${v?.sienge_contract_id || '-'} ${arr[0].tipo} #${arr[0].numero_parcela} [${arr.map((p) => p.status).join('+')}]`
  // multiplas pagas no mesmo numero?
  if (pagas.length > 1) { dupMultiPaga.push(tag); continue }
  // pendente redundante (gemea de paga)?
  let temRedundante = false
  for (const pend of pendentes) {
    if (pagas.some((pg) => norm(pg.valor) === norm(pend.valor) && pg.data_prevista === pend.data_prevista)) {
      temRedundante = true
    }
  }
  if (temRedundante) { dupPendenteRedundante.push(tag); continue }
  // cancelado + ativo (estado consistente — cancelado ja esta cancelado)
  const temCanc = arr.some((p) => p.status === 'cancelado')
  const temAtivo = arr.some((p) => p.status !== 'cancelado')
  if (temCanc && temAtivo && arr.filter((p) => p.status !== 'cancelado').length === 1) {
    dupCancAtivo.push(tag)
    continue
  }
  dupOutros.push(tag)
}
check('numero_parcela com MULTIPLAS PAGAS (precisa Sienge+revisao)', dupMultiPaga)
check('numero_parcela com PENDENTE REDUNDANTE (deveria ter sido cancelada!)', dupPendenteRedundante)
check('numero_parcela cancelado+1ativo (estado consistente, so ruido visual)', dupCancAtivo, 4)
check('numero_parcela outros padroes (revisar)', dupOutros)

console.log('\n=== 2. Vendas duplicadas (mesmo cliente + unidade, ambas ativas) ===')
const porClienteUnidade = new Map()
for (const v of ativasVendas) {
  if (!v.cliente_id || !v.unidade) continue
  const k = `${v.cliente_id}__${(v.unidade || '').trim().toUpperCase()}`
  if (!porClienteUnidade.has(k)) porClienteUnidade.set(k, [])
  porClienteUnidade.get(k).push(v)
}
const vendasDup = []
for (const [k, arr] of porClienteUnidade.entries()) {
  if (arr.length > 1) {
    vendasDup.push(`cliente ${arr[0].cliente_id?.slice(0, 8)} unidade ${arr[0].unidade}: ${arr.length} vendas (contratos ${arr.map((v) => v.sienge_contract_id || 'manual').join(', ')})`)
  }
}
check('vendas ativas duplicadas (mesmo cliente+unidade)', vendasDup)

// mesmo sienge_contract_id em 2 vendas ativas
const porContrato = new Map()
for (const v of ativasVendas) {
  if (!v.sienge_contract_id) continue
  if (!porContrato.has(v.sienge_contract_id)) porContrato.set(v.sienge_contract_id, [])
  porContrato.get(v.sienge_contract_id).push(v)
}
const contratoDup = []
for (const [c, arr] of porContrato.entries()) {
  if (arr.length > 1) contratoDup.push(`sienge_contract_id ${c}: ${arr.length} vendas ativas`)
}
check('sienge_contract_id repetido em vendas ativas', contratoDup)

console.log('\n=== 3. Invariantes de pagamentos ===')
const anoAbsurdo = (d) => d && (Number(String(d).slice(0, 4)) < 2020 || Number(String(d).slice(0, 4)) > 2035)
check(
  'status=pago sem data_pagamento',
  pagamentos.filter((p) => p.status === 'pago' && !p.data_pagamento).map((p) => p.id),
)
check(
  'status=pendente COM data_pagamento',
  pagamentos.filter((p) => p.status === 'pendente' && p.data_pagamento).map((p) => p.id),
)
check(
  'ano absurdo em data_pagamento',
  pagamentos.filter((p) => anoAbsurdo(p.data_pagamento)).map((p) => `${p.id} ${p.data_pagamento}`),
)
check(
  'ano absurdo em data_prevista',
  pagamentos.filter((p) => anoAbsurdo(p.data_prevista)).map((p) => `${p.id} ${p.data_prevista}`),
)
check(
  'valor <= 0',
  pagamentos.filter((p) => !(Number(p.valor) > 0)).map((p) => `${p.id} valor=${p.valor}`),
)

console.log('\n' + '='.repeat(50))
if (problemas === 0) {
  console.log('RESULTADO: nenhuma pendencia ou duplicidade critica.')
} else {
  // dupCancAtivo e ruido visual conhecido (cancelado fica no banco pra auditoria) — nao e "critico"
  const criticos = problemas - dupCancAtivo.length
  if (criticos === 0) {
    console.log(`RESULTADO: OK. ${dupCancAtivo.length} grupos cancelado+ativo (ruido visual esperado — cancelado fica pra auditoria, nao entra em totais).`)
  } else {
    console.log(`RESULTADO: ${criticos} item(ns) que merecem atencao (+ ${dupCancAtivo.length} cancelado+ativo, esperado).`)
  }
}
