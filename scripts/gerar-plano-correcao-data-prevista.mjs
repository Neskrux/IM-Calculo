// Gera plano de correcao de data_prevista usando dados cacheados do Sienge
// (.sienge-cache/) — zero quota consumida. Sienge eh fonte da verdade temporal
// (ver .claude/rules/sincronizacao-sienge.md).
//
// Estrategia:
//   1. Le um dos arquivos cache de /bulk-data/v1/income (todos tem o mesmo
//      resultset completo de 17491 linhas, range 2025-04 a 2030-12).
//   2. Indexa por (billId, numero_parcela) — numero_parcela = parte antes da
//      "/" em installmentNumber.
//   3. Pra cada venda em docs/varredura-pagamentos-bagunca-2026-05-13.json,
//      acha sienge_receivable_bill_id em vendas, cruza com income.
//   4. Compara data_prevista local vs dueDate Sienge.
//   5. Gera plano JSON com (pagamento_id, atual, correto, dDias). NAO APLICA.
//
// Saida: docs/plano-correcao-data-prevista-{date}.json
// Schema: schema canonico de metrica (.claude/rules/sincronizacao-sienge.md)

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { siengeGet, extractRows } from './_sienge-http.mjs'

// Env: tenta .env primeiro (dev local), cai pra process.env (CI runner).
const envLocal = existsSync('.env')
  ? Object.fromEntries(
      readFileSync('.env', 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => {
          const idx = l.indexOf('=')
          return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')]
        }),
    )
  : {}
const env = { ...process.env, ...envLocal }
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
  console.error('faltando VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY (.env ou env vars)')
  process.exit(1)
}
const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

// 1. Tentar cache local primeiro; se vazio, baixar via API (zero quota — bulk-data).
console.log('=== 1. Income Sienge (cache ou API) ===')
const cacheDir = resolve(process.cwd(), '.sienge-cache')
let income = []
if (existsSync(cacheDir)) {
  const cacheFiles = readdirSync(cacheDir).filter((f) => f.endsWith('.json'))
  for (const f of cacheFiles) {
    try {
      const c = JSON.parse(readFileSync(resolve(cacheDir, f), 'utf8'))
      if (!c.url?.includes('/bulk-data/v1/income')) continue
      const rows = c.data?.results || c.data?.income || c.data?.data || (Array.isArray(c.data) ? c.data : [])
      if (rows.length > 0) {
        income = rows
        console.log(`  cache: ${f} | ${rows.length} linhas`)
        break
      }
    } catch { /* ignora */ }
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
if (!income.length) {
  console.error('  sem income (cache nem API) — abortando')
  process.exit(1)
}

// 2. Indexar por (billId, numero_parcela)
const incomeIdx = new Map()
for (const i of income) {
  const billId = Number(i.billId)
  if (!billId) continue
  const instNum = String(i.installmentNumber || '').split('/')[0]
  const numero = Number(instNum)
  if (!Number.isFinite(numero) || numero <= 0) continue
  const k = `${billId}__${numero}`
  if (!incomeIdx.has(k)) incomeIdx.set(k, [])
  incomeIdx.get(k).push({
    billId,
    numero,
    installmentId: i.installmentId,
    dueDate: i.dueDate,
    paymentDate:
      i.paymentDate ||
      (Array.isArray(i.receipts) && i.receipts[0] ? i.receipts[0].paymentDate || i.receipts[0].date : null),
    valorOriginal: Number(i.originalAmount || i.installmentValue || 0),
    paymentTermId: i.paymentTerm?.id || null,
  })
}
console.log(`  income indexado: ${incomeIdx.size} chaves (billId, numero)`)

// 3. Carregar vendas afetadas
console.log('\n=== 2. Carregando vendas afetadas ===')
const varredura = JSON.parse(readFileSync('docs/varredura-pagamentos-bagunca-2026-05-13.json', 'utf8'))
const vendasIds = varredura.vendas.map((v) => v.venda_id)
console.log(`  vendas afetadas: ${vendasIds.length}`)

const vendasMeta = new Map()
for (let i = 0; i < vendasIds.length; i += 200) {
  const chunk = vendasIds.slice(i, i + 200)
  const { data } = await supa
    .from('vendas')
    .select('id, sienge_contract_id, sienge_receivable_bill_id, numero_contrato, unidade')
    .in('id', chunk)
  for (const v of data || []) vendasMeta.set(v.id, v)
}
const semBillId = []
for (const vid of vendasIds) {
  const v = vendasMeta.get(vid)
  if (!v?.sienge_receivable_bill_id) semBillId.push(vid)
}
console.log(`  vendas sem sienge_receivable_bill_id (ignoradas): ${semBillId.length}`)

// 4. Carregar pagamentos das vendas afetadas (paginar dentro do chunk —
//    PostgREST cap=1000 por request).
console.log('\n=== 3. Carregando pagamentos das vendas afetadas ===')
const pagamentos = []
const CHUNK_VENDAS = 50
const PAGE = 1000
for (let i = 0; i < vendasIds.length; i += CHUNK_VENDAS) {
  const chunk = vendasIds.slice(i, i + CHUNK_VENDAS)
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa
      .from('pagamentos_prosoluto')
      .select('id, venda_id, numero_parcela, tipo, valor, data_prevista, data_pagamento, status')
      .in('venda_id', chunk)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('  erro paginacao:', error)
      break
    }
    if (!data?.length) break
    pagamentos.push(...data)
    process.stdout.write(`  pagamentos: ${pagamentos.length}\r`)
    if (data.length < PAGE) break
  }
}
console.log(`\n  total pagamentos: ${pagamentos.length}`)

// 5. Cruzar — pra cada pagamento, encontrar (dueDate Sienge) e calcular drift
console.log('\n=== 4. Cruzando local vs Sienge cache ===')
const TIPOS_SIENGE_PM = ['PM']
const TIPOS_LOCAL_PM = ['parcela_entrada']

const diffDias = (a, b) => {
  if (!a || !b) return null
  return Math.round((new Date(b) - new Date(a)) / 86400000)
}

const planoUpdate = []
const sem_match = []
const ja_ok = []
const drift_grande = [] // > 365d — suspeito
const aplicaveis = []

for (const p of pagamentos) {
  if (p.numero_parcela == null) continue // sinal e similares — pula
  if (!TIPOS_LOCAL_PM.includes(p.tipo)) continue // foco em parcela_entrada
  if (p.status === 'cancelado') continue
  const v = vendasMeta.get(p.venda_id)
  if (!v?.sienge_receivable_bill_id) continue

  const k = `${v.sienge_receivable_bill_id}__${p.numero_parcela}`
  const matches = incomeIdx.get(k) || []
  // filtrar so PM
  const pmMatches = matches.filter((m) => TIPOS_SIENGE_PM.includes(m.paymentTermId))
  if (pmMatches.length === 0) {
    sem_match.push({
      pagamento_id: p.id,
      venda_id: p.venda_id,
      contract: v.sienge_contract_id,
      bill_id: v.sienge_receivable_bill_id,
      numero_parcela: p.numero_parcela,
      data_prevista_local: p.data_prevista,
      total_matches_nao_pm: matches.length,
    })
    continue
  }

  // Estrategia: se ha 1 match PM unico → usar. Se varios, tentar achar
  // o que bate mais perto em valor (ja que pode ter dois PMs em lotes).
  let escolhido = pmMatches[0]
  if (pmMatches.length > 1) {
    const valorLocal = Number(p.valor || 0)
    const ordenadoPorValor = [...pmMatches].sort(
      (a, b) => Math.abs(a.valorOriginal - valorLocal) - Math.abs(b.valorOriginal - valorLocal),
    )
    escolhido = ordenadoPorValor[0]
  }

  const dDias = diffDias(p.data_prevista, escolhido.dueDate)
  if (dDias === null) continue
  if (Math.abs(dDias) <= 1) {
    ja_ok.push({ pagamento_id: p.id, data_prevista: p.data_prevista, dueDate: escolhido.dueDate })
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
    paymentDate_sienge: escolhido.paymentDate,
    data_pagamento_local: p.data_pagamento,
  }

  if (Math.abs(dDias) > 365) {
    drift_grande.push(entry) // suspeito — vai pra revisao humana
  } else {
    planoUpdate.push(entry)
    aplicaveis.push(entry)
  }
}

// Agrupar por venda pra resumir
const porVenda = new Map()
for (const e of aplicaveis) {
  if (!porVenda.has(e.venda_id)) porVenda.set(e.venda_id, [])
  porVenda.get(e.venda_id).push(e)
}

console.log(`  pagamentos com drift corrigivel (< 365d):    ${aplicaveis.length}`)
console.log(`  pagamentos com drift > 365d (revisao humana): ${drift_grande.length}`)
console.log(`  pagamentos sem match no Sienge income:        ${sem_match.length}`)
console.log(`  pagamentos ja ok (drift <= 1d):               ${ja_ok.length}`)
console.log(`  vendas afetadas pelo plano:                   ${porVenda.size}`)

const data = new Date().toISOString().slice(0, 10)
const outFile = `docs/plano-correcao-data-prevista-${data}.json`
const out = {
  meta: {
    geradoEm: new Date().toISOString(),
    spec_ref: '.claude/rules/sincronizacao-sienge.md',
    script: 'scripts/gerar-plano-correcao-data-prevista.mjs',
    modo: 'dry-run',
    fonte_dados: '.sienge-cache/ (/bulk-data/v1/income, range 2025-04-20 a 2030-12-30)',
    criterio:
      'Update aplicavel: drift entre 2d e 365d em data_prevista de parcela_entrada com match unico (billId, numero_parcela, paymentTerm=PM) no income Sienge. Acima de 365d vai pra revisao humana.',
  },
  counts: {
    matched: aplicaveis.length + ja_ok.length + drift_grande.length,
    aplicaveis: aplicaveis.length,
    drift_grande_para_revisao: drift_grande.length,
    sem_match: sem_match.length,
    ja_ok: ja_ok.length,
    vendas_afetadas_plano: porVenda.size,
  },
  resumo_por_venda: [...porVenda.entries()].map(([vid, arr]) => ({
    venda_id: vid,
    contract: arr[0].contract,
    unidade: arr[0].unidade,
    parcelas_a_corrigir: arr.length,
    drift_max: Math.max(...arr.map((e) => Math.abs(e.drift_dias))),
    drift_min: Math.min(...arr.map((e) => Math.abs(e.drift_dias))),
  })).sort((a, b) => b.parcelas_a_corrigir - a.parcelas_a_corrigir),
  plano: planoUpdate,
  drift_grande_amostras: drift_grande.slice(0, 30),
  sem_match_amostras: sem_match.slice(0, 30),
}
writeFileSync(outFile, JSON.stringify(out, null, 2))
console.log(`\nSalvo: ${outFile} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`)
console.log('\nPra aplicar: aguardar autorizacao do usuario + service_role key.')
