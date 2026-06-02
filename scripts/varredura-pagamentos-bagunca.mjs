// Varredura de pagamentos_prosoluto buscando 3 sintomas que apareceram
// na investigacao da venda 803 D (RONAL RESMINI BALENA, contract 275):
//
//   SINTOMA 1 — numero_parcela duplicado dentro da mesma venda (cancelado
//               + pago/pendente apontando pra mesma sequencia logica).
//   SINTOMA 2 — drift > 30 dias entre data_prevista e data_pagamento em
//               linhas status='pago' (pagamento amarrado em data errada).
//   SINTOMA 3 — venda sem sienge_receivable_bill_id (nao reconciliada
//               com income Sienge na coluna ponte de vendas).
//
// Spec: .claude/rules/sincronizacao-sienge.md, .claude/rules/rodadas-b.md
// Saida: relatorio com top vendas afetadas + contagens globais. Nao escreve nada no banco.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=')
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)
const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

const DRIFT_LIMITE_DIAS = 30

console.log('=== Carregando pagamentos_prosoluto (paginado) ===')
const pagamentos = []
const PAGE = 1000
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supa
    .from('pagamentos_prosoluto')
    .select('id, venda_id, numero_parcela, tipo, valor, data_prevista, data_pagamento, status')
    .range(from, from + PAGE - 1)
  if (error) {
    console.error('  erro paginacao:', error)
    process.exit(1)
  }
  if (!data?.length) break
  pagamentos.push(...data)
  process.stdout.write(`  carregadas ${pagamentos.length}...\r`)
  if (data.length < PAGE) break
}
console.log(`\n  total pagamentos carregados: ${pagamentos.length}`)

// agrupar por venda_id
const porVenda = new Map()
for (const p of pagamentos) {
  if (!porVenda.has(p.venda_id)) porVenda.set(p.venda_id, [])
  porVenda.get(p.venda_id).push(p)
}
console.log(`  vendas distintas com pagamentos: ${porVenda.size}`)

const diasEntre = (a, b) => {
  if (!a || !b) return null
  return Math.round((new Date(b) - new Date(a)) / 86400000)
}

const linhas = []
let totalDup = 0
let totalDrift = 0
let totalSemBill = 0
let totalDriftPag = 0

for (const [venda_id, ps] of porVenda.entries()) {
  // SINTOMA 1: numero_parcela duplicado por tipo (parcela_entrada). Conta apenas
  // pares (cancelado + nao-cancelado) com mesma sequencia logica.
  const buckets = new Map()
  for (const p of ps) {
    if (p.numero_parcela == null) continue
    const k = `${p.tipo}__${p.numero_parcela}`
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(p)
  }
  let dupCancAtivo = 0
  for (const arr of buckets.values()) {
    if (arr.length <= 1) continue
    const temCanc = arr.some((x) => x.status === 'cancelado')
    const temAtivo = arr.some((x) => x.status !== 'cancelado')
    if (temCanc && temAtivo) dupCancAtivo += arr.length - 1
  }

  // SINTOMA 2: drift > 30d em pago
  const driftRows = ps.filter((p) => {
    if (p.status !== 'pago' || !p.data_prevista || !p.data_pagamento) return false
    const d = Math.abs(diasEntre(p.data_prevista, p.data_pagamento))
    return d > DRIFT_LIMITE_DIAS
  })

  // SINTOMA 3: vai ser preenchido depois (vem da tabela vendas.sienge_receivable_bill_id)
  const semBill = null  // placeholder — completa apos puxar meta

  const totalPags = ps.length
  const totalPagos = ps.filter((p) => p.status === 'pago').length
  const totalPend = ps.filter((p) => p.status === 'pendente').length
  const totalCanc = ps.filter((p) => p.status === 'cancelado').length

  if (dupCancAtivo > 0) totalDup++
  if (driftRows.length > 0) totalDrift++
  totalDriftPag += driftRows.length

  // semBill sera computado depois (depende de meta). por enquanto so dup+drift.
  const score = (dupCancAtivo > 0 ? 1 : 0) + (driftRows.length > 0 ? 1 : 0)
  if (score === 0) continue

  linhas.push({
    venda_id,
    total: totalPags,
    pagos: totalPagos,
    pend: totalPend,
    canc: totalCanc,
    dup: dupCancAtivo,
    drift: driftRows.length,
    semBill,
    score,
  })
}

// puxar metadata das vendas afetadas
const idsAfetados = linhas.map((l) => l.venda_id)
console.log(`\n  vendas com pelo menos 1 sintoma: ${idsAfetados.length}`)
const meta = new Map()
for (let i = 0; i < idsAfetados.length; i += 200) {
  const chunk = idsAfetados.slice(i, i + 200)
  const { data: vs } = await supa
    .from('vendas')
    .select(
      'id, sienge_contract_id, numero_contrato, unidade, valor_venda, cliente_id, corretor_id, excluido, data_venda, sienge_receivable_bill_id',
    )
    .in('id', chunk)
  for (const v of vs || []) meta.set(v.id, v)
}

// agora aplica SINTOMA 3 (sem bill_id) cruzando linhas com meta
for (const l of linhas) {
  const v = meta.get(l.venda_id)
  l.semBill = !v?.sienge_receivable_bill_id
  if (l.semBill) totalSemBill++
  if (l.semBill) l.score += 1
}

// puxar clientes/corretores
const clienteIds = new Set()
const corretorIds = new Set()
for (const v of meta.values()) {
  if (v.cliente_id) clienteIds.add(v.cliente_id)
  if (v.corretor_id) corretorIds.add(v.corretor_id)
}
const clientes = new Map()
{
  const arr = [...clienteIds]
  for (let i = 0; i < arr.length; i += 200) {
    const { data } = await supa.from('clientes').select('id, nome').in('id', arr.slice(i, i + 200))
    for (const c of data || []) clientes.set(c.id, c.nome)
  }
}
const corretores = new Map()
{
  const arr = [...corretorIds]
  for (let i = 0; i < arr.length; i += 200) {
    const { data } = await supa.from('corretores').select('id, nome').in('id', arr.slice(i, i + 200))
    for (const c of data || []) corretores.set(c.id, c.nome)
  }
}

console.log('\n=== Resumo global ===')
console.log(`  vendas com numero_parcela duplicado (cancelado+ativo): ${totalDup}`)
console.log(`  vendas com drift > ${DRIFT_LIMITE_DIAS}d em pago:       ${totalDrift}`)
console.log(`  vendas SEM nenhum sienge_bill_id (nao reconciliadas):   ${totalSemBill}`)
console.log(`  total linhas de drift > ${DRIFT_LIMITE_DIAS}d em pago:  ${totalDriftPag}`)

linhas.sort((a, b) => b.score - a.score || b.drift - a.drift || b.dup - a.dup)

console.log('\n=== Top 30 vendas mais afetadas (score 3 = todos 3 sintomas) ===')
console.log('score | dup | drift | semBill | pagos/total | excl | contract | unidade  | cliente / corretor')
console.log('------+-----+-------+---------+-------------+------+----------+----------+-------------------')
for (const l of linhas.slice(0, 30)) {
  const v = meta.get(l.venda_id) || {}
  const cliente = clientes.get(v.cliente_id) || v.cliente_id?.slice(0, 8) || '-'
  const corretor = corretores.get(v.corretor_id) || v.corretor_id?.slice(0, 8) || '-'
  console.log(
    `  ${l.score}   | ${String(l.dup).padStart(3)} | ${String(l.drift).padStart(5)} | ${String(l.semBill ? 'sim' : 'nao').padStart(7)} | ` +
      `${String(l.pagos).padStart(5)}/${String(l.total).padStart(5)} | ${(v.excluido ? 'sim' : 'nao').padStart(4)} | ` +
      `${String(v.sienge_contract_id || '-').padStart(8)} | ${(v.unidade || '-').padEnd(8)} | ${cliente} / ${corretor}`,
  )
}

// distribuicao por score
const distScore = new Map()
for (const l of linhas) distScore.set(l.score, (distScore.get(l.score) || 0) + 1)
console.log('\n=== Distribuicao por score (sintomas combinados) ===')
for (const [s, n] of [...distScore.entries()].sort((a, b) => b[0] - a[0])) {
  console.log(`  score ${s}: ${n} vendas`)
}

// salvar dump JSON pra rodada b
const dump = linhas.map((l) => {
  const v = meta.get(l.venda_id) || {}
  return {
    venda_id: l.venda_id,
    sienge_contract_id: v.sienge_contract_id,
    numero_contrato: v.numero_contrato,
    unidade: v.unidade,
    cliente: clientes.get(v.cliente_id) || null,
    cliente_id: v.cliente_id,
    corretor: corretores.get(v.corretor_id) || null,
    excluido: v.excluido,
    sintomas: {
      numero_parcela_duplicado: l.dup,
      drift_pago_30d: l.drift,
      sem_sienge_bill_id: l.semBill,
    },
    contagens: { total: l.total, pagos: l.pagos, pendentes: l.pend, cancelados: l.canc },
    score: l.score,
  }
})
const outFile = `docs/varredura-pagamentos-bagunca-${new Date().toISOString().slice(0, 10)}.json`
;(await import('node:fs')).writeFileSync(
  outFile,
  JSON.stringify({ meta: { geradoEm: new Date().toISOString(), total: dump.length, criterios: { DRIFT_LIMITE_DIAS } }, vendas: dump }, null, 2),
)
console.log(`\nSalvo: ${outFile}`)
