// Varredura AMPLA — TODAS as vendas FIGUEIRA com sienge_receivable_bill_id,
// nao apenas as 99 da varredura-pagamentos-bagunca. Cobre todos os sintomas
// num so passe:
//   1. drift data_prevista (local vs Sienge dueDate)
//   2. sem-match (parcela local sem par no Sienge income)
//   3. duplicatas numero_parcela (cancelado + ativo)
//
// Reutiliza cache local .sienge-cache/. Zero quota.
// Spec: .claude/rules/sincronizacao-sienge.md
//
// Saidas:
//   docs/varredura-ampla-{date}.json — universo completo
//   docs/plano-correcao-data-prevista-ampla-{date}.json — plano corrigivel
//   docs/casos-ampliados-{date}.md — resumo humano

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { siengeGet, extractRows } from './_sienge-http.mjs'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

// 1. Carrega income (cache ou API)
console.log('=== 1. Income Sienge (cache ou API) ===')
const cacheDir = resolve(process.cwd(), '.sienge-cache')
let income = []
if (existsSync(cacheDir)) {
  for (const f of readdirSync(cacheDir).filter((f) => f.endsWith('.json'))) {
    try {
      const c = JSON.parse(readFileSync(resolve(cacheDir, f), 'utf8'))
      if (!c.url?.includes('/bulk-data/v1/income')) continue
      const rows = c.data?.results || c.data?.income || c.data?.data || (Array.isArray(c.data) ? c.data : [])
      if (rows.length > 0) {
        income = rows
        console.log(`  cache: ${f} | ${rows.length} linhas`)
        break
      }
    } catch { /* skip */ }
  }
}
if (!income.length) {
  console.log('  cache vazio — baixando /bulk-data/v1/income...')
  const res = await siengeGet({
    path: '/bulk-data/v1/income',
    query: { startDate: '2023-01-01', endDate: '2030-12-31', selectionType: 'D', companyId: 5 },
  })
  income = extractRows(res.data)
  console.log(`  API: ${income.length} linhas`)
}

// 2. Indexar income por (billId, numero_parcela)
const incomeIdx = new Map()
const incomePorBill = new Map()
for (const i of income) {
  const billId = Number(i.billId)
  if (!billId) continue
  const numero = Number(String(i.installmentNumber || '').split('/')[0])
  if (!Number.isFinite(numero) || numero <= 0) continue
  const k = `${billId}__${numero}`
  if (!incomeIdx.has(k)) incomeIdx.set(k, [])
  incomeIdx.get(k).push({
    billId,
    numero,
    installmentId: i.installmentId,
    dueDate: i.dueDate,
    paymentDate: i.paymentDate || (Array.isArray(i.receipts) && i.receipts[0] ? i.receipts[0].paymentDate || i.receipts[0].date : null),
    valorOriginal: Number(i.originalAmount || i.installmentValue || 0),
    paymentTermId: i.paymentTerm?.id || null,
  })
  if (!incomePorBill.has(billId)) incomePorBill.set(billId, [])
  incomePorBill.get(billId).push({ numero, paymentTermId: i.paymentTerm?.id, dueDate: i.dueDate })
}
console.log(`  income indexado: ${incomeIdx.size} (billId, parc) | ${incomePorBill.size} billIds distintos`)

// 3. Carregar TODAS vendas FIGUEIRA com sienge_receivable_bill_id
console.log('\n=== 2. Carregando TODAS vendas FIGUEIRA com bill_id ===')
const FIGUEIRA = '0d7d01f4-c398-4d9a-a280-13f44c957279'
const vendas = []
let from = 0
const PAGE = 1000
while (true) {
  const { data, error } = await supa
    .from('vendas')
    .select('id, sienge_contract_id, sienge_receivable_bill_id, numero_contrato, unidade, valor_venda, cliente_id, excluido, empreendimento_id')
    .eq('empreendimento_id', FIGUEIRA)
    .not('sienge_receivable_bill_id', 'is', null)
    .eq('excluido', false)
    .range(from, from + PAGE - 1)
  if (error) { console.error('  erro:', error); break }
  if (!data?.length) break
  vendas.push(...data)
  if (data.length < PAGE) break
  from += PAGE
}
console.log(`  vendas FIGUEIRA com bill_id: ${vendas.length}`)
const vendaMap = new Map(vendas.map((v) => [v.id, v]))

// 4. Carregar TODOS pagamentos das vendas
console.log('\n=== 3. Carregando pagamentos ===')
const pagamentos = []
const vendaIds = vendas.map((v) => v.id)
const CHUNK_V = 50
for (let i = 0; i < vendaIds.length; i += CHUNK_V) {
  const chunk = vendaIds.slice(i, i + CHUNK_V)
  for (let f = 0; ; f += PAGE) {
    const { data } = await supa
      .from('pagamentos_prosoluto')
      .select('id, venda_id, numero_parcela, tipo, valor, data_prevista, data_pagamento, status')
      .in('venda_id', chunk)
      .order('id', { ascending: true })
      .range(f, f + PAGE - 1)
    if (!data?.length) break
    pagamentos.push(...data)
    process.stdout.write(`  pagamentos: ${pagamentos.length}\r`)
    if (data.length < PAGE) break
  }
}
console.log(`\n  total pagamentos: ${pagamentos.length}`)

// 5. Cruzamento + sintomas
console.log('\n=== 4. Cruzando local vs Sienge ===')
const diffDias = (a, b) => (!a || !b ? null : Math.round((new Date(b) - new Date(a)) / 86400000))

const aplicaveis = []
const drift_grande = []
const sem_match = []
const ja_ok = []
const duplicatasPorVenda = new Map()

const porVenda = new Map()
for (const p of pagamentos) {
  if (!porVenda.has(p.venda_id)) porVenda.set(p.venda_id, [])
  porVenda.get(p.venda_id).push(p)
}

// pra cada venda, identificar duplicatas
for (const [vid, ps] of porVenda.entries()) {
  const buckets = new Map()
  for (const p of ps) {
    if (p.numero_parcela == null) continue
    const k = `${p.tipo}__${p.numero_parcela}`
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(p)
  }
  let dups = 0
  for (const arr of buckets.values()) {
    if (arr.length > 1 && arr.some((x) => x.status === 'cancelado') && arr.some((x) => x.status !== 'cancelado')) {
      dups += arr.length - 1
    }
  }
  if (dups > 0) duplicatasPorVenda.set(vid, dups)
}

// pra cada parcela_entrada, comparar com Sienge
for (const p of pagamentos) {
  if (p.numero_parcela == null) continue
  if (p.tipo !== 'parcela_entrada') continue
  if (p.status === 'cancelado') continue
  const v = vendaMap.get(p.venda_id)
  if (!v?.sienge_receivable_bill_id) continue

  const k = `${v.sienge_receivable_bill_id}__${p.numero_parcela}`
  const matches = (incomeIdx.get(k) || []).filter((m) => m.paymentTermId === 'PM')
  if (matches.length === 0) {
    sem_match.push({
      pagamento_id: p.id,
      venda_id: p.venda_id,
      contract: v.sienge_contract_id,
      unidade: v.unidade,
      bill_id: v.sienge_receivable_bill_id,
      numero_parcela: p.numero_parcela,
      data_prevista_local: p.data_prevista,
      status: p.status,
      valor_local: p.valor,
    })
    continue
  }
  // escolhe match mais proximo em valor
  let escolhido = matches[0]
  if (matches.length > 1) {
    escolhido = [...matches].sort((a, b) => Math.abs(a.valorOriginal - Number(p.valor || 0)) - Math.abs(b.valorOriginal - Number(p.valor || 0)))[0]
  }
  const dDias = diffDias(p.data_prevista, escolhido.dueDate)
  if (dDias === null) continue
  if (Math.abs(dDias) <= 1) {
    ja_ok.push({ pagamento_id: p.id })
    continue
  }
  const entry = {
    pagamento_id: p.id,
    venda_id: p.venda_id,
    contract: v.sienge_contract_id,
    unidade: v.unidade,
    bill_id: v.sienge_receivable_bill_id,
    installment_id_sienge: escolhido.installmentId,
    numero_parcela: p.numero_parcela,
    status: p.status,
    valor_local: Number(p.valor || 0),
    valor_sienge: escolhido.valorOriginal,
    data_prevista_atual: p.data_prevista,
    data_prevista_correta: escolhido.dueDate,
    drift_dias: dDias,
  }
  if (Math.abs(dDias) > 365) drift_grande.push(entry)
  else aplicaveis.push(entry)
}

console.log(`  aplicaveis (drift 2-365d):       ${aplicaveis.length}`)
console.log(`  drift > 365d (humano):           ${drift_grande.length}`)
console.log(`  sem match no Sienge income:      ${sem_match.length}`)
console.log(`  ja ok (drift <= 1d):             ${ja_ok.length}`)
console.log(`  vendas com duplicata (status):    ${duplicatasPorVenda.size}`)

// Agrupar sem_match por venda
const semMatchPorVenda = new Map()
for (const s of sem_match) {
  if (!semMatchPorVenda.has(s.venda_id)) semMatchPorVenda.set(s.venda_id, [])
  semMatchPorVenda.get(s.venda_id).push(s)
}
console.log(`  sem-match agrupado por venda:    ${semMatchPorVenda.size} vendas`)

// Agrupar drift_grande
const driftGrandePorVenda = new Map()
for (const d of drift_grande) {
  if (!driftGrandePorVenda.has(d.venda_id)) driftGrandePorVenda.set(d.venda_id, [])
  driftGrandePorVenda.get(d.venda_id).push(d)
}
console.log(`  drift>365d agrupado por venda:   ${driftGrandePorVenda.size} vendas`)

const data = new Date().toISOString().slice(0, 10)

// Salvar plano de aplicacao ampla
const planoAmplo = {
  meta: {
    geradoEm: new Date().toISOString(),
    spec_ref: '.claude/rules/sincronizacao-sienge.md',
    script: 'scripts/varredura-ampla.mjs',
    modo: 'dry-run',
    fonte: '.sienge-cache/ /bulk-data/v1/income',
    escopo: 'TODAS vendas FIGUEIRA com sienge_receivable_bill_id (nao excluidas)',
  },
  counts: {
    vendas_analisadas: vendas.length,
    pagamentos_analisados: pagamentos.length,
    aplicaveis: aplicaveis.length,
    drift_grande: drift_grande.length,
    sem_match: sem_match.length,
    ja_ok: ja_ok.length,
    vendas_com_duplicata: duplicatasPorVenda.size,
    vendas_com_sem_match: semMatchPorVenda.size,
    vendas_com_drift_grande: driftGrandePorVenda.size,
  },
  plano: aplicaveis,
  drift_grande_amostras: drift_grande,
  sem_match_amostras: sem_match,
  duplicatas_por_venda: [...duplicatasPorVenda.entries()].map(([vid, n]) => ({ venda_id: vid, dups: n })),
}
writeFileSync(`docs/plano-correcao-data-prevista-ampla-${data}.json`, JSON.stringify(planoAmplo, null, 2))
console.log(`\nSalvo: docs/plano-correcao-data-prevista-ampla-${data}.json (${(JSON.stringify(planoAmplo).length / 1024).toFixed(0)} KB)`)

// Comparar com o plano anterior pra ver casos NOVOS
const planoAntigo = existsSync(`docs/plano-correcao-data-prevista-2026-05-13.json`)
  ? JSON.parse(readFileSync(`docs/plano-correcao-data-prevista-2026-05-13.json`, 'utf8'))
  : null

const idsAntigos = new Set([
  ...(planoAntigo?.plano || []).map((p) => p.pagamento_id),
  ...(planoAntigo?.drift_grande_amostras || []).map((p) => p.pagamento_id),
  ...(planoAntigo?.sem_match_amostras || []).map((p) => p.pagamento_id),
])
const novos_aplicaveis = aplicaveis.filter((p) => !idsAntigos.has(p.pagamento_id))
const novos_drift_grande = drift_grande.filter((p) => !idsAntigos.has(p.pagamento_id))
const novos_sem_match = sem_match.filter((p) => !idsAntigos.has(p.pagamento_id))

console.log(`\n=== Novos casos (nao estavam no plano anterior) ===`)
console.log(`  aplicaveis novos:     ${novos_aplicaveis.length}`)
console.log(`  drift>365d novos:     ${novos_drift_grande.length}`)
console.log(`  sem-match novos:      ${novos_sem_match.length}`)

// Vendas distintas NOVAS por tipo
const vidsNovasSemMatch = new Set(novos_sem_match.map((p) => p.venda_id))
const vidsNovasDriftG = new Set(novos_drift_grande.map((p) => p.venda_id))
const vidsNovasAplic = new Set(novos_aplicaveis.map((p) => p.venda_id))

console.log(`  vendas novas (sem-match):   ${vidsNovasSemMatch.size}`)
console.log(`  vendas novas (drift>365):   ${vidsNovasDriftG.size}`)
console.log(`  vendas novas (aplicaveis):  ${vidsNovasAplic.size}`)
