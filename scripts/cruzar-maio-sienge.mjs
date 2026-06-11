// Cruzamento de MAIO/2026: Sienge income (pagas em maio) vs banco (pagas em maio).
// READ-ONLY (nenhum write). Bulk-data (sem quota). ver .claude/rules/sincronizacao-sienge.md
//
// Objetivo: achar "pagou 2 em maio e o relatorio mostra 1" — vendas onde o Sienge
// conta MAIS parcelas pagas em maio do que o nosso banco. Separa sync-lag (banco
// atrasado) de inadimplencia real (cliente nao pagou -> Sienge tambem nao tem).
//
// Uso: node scripts/cruzar-maio-sienge.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { siengeGet, extractRows } from './_sienge-http.mjs'

const MES_INI = '2026-05-01'
const MES_FIM = '2026-05-31'
const FIGUEIRA = '0d7d01f4-c398-4d9a-a280-13f44c957279'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)
const PAGE = 1000

const MAPA_TIPO = {
  PM: 'parcela_entrada', SN: 'sinal', AT: 'sinal',
  BA: 'balao', B1: 'balao', B2: 'balao', B3: 'balao', B4: 'balao', B5: 'balao', B6: 'balao', B7: 'balao', B8: 'balao',
}
const tipoInterno = (i) => MAPA_TIPO[i.paymentTerm?.id] || null
const pagDate = (i) => i.paymentDate || (Array.isArray(i.receipts) && i.receipts[0]?.paymentDate) || null
const emMaio = (d) => d && String(d).slice(0, 10) >= MES_INI && String(d).slice(0, 10) <= MES_FIM

// 1. vendas Figueira ativas com bill
console.log('Carregando vendas...')
const vendas = []
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supa.from('vendas')
    .select('id, sienge_contract_id, sienge_receivable_bill_id, unidade, cliente_id, corretor_id, tipo_corretor, situacao_contrato, data_distrato')
    .eq('empreendimento_id', FIGUEIRA).not('sienge_receivable_bill_id', 'is', null).eq('excluido', false)
    .range(from, from + PAGE - 1)
  if (error) { console.error(error); process.exit(1) }
  if (!data?.length) break
  vendas.push(...data.filter((v) => v.situacao_contrato !== '3'))
  if (data.length < PAGE) break
}
console.log(`  ${vendas.length} vendas ativas com bill`)

// 2. pagamentos (banco): pagas em maio + total de parcelas ativas (estrutural)
console.log('Carregando pagamentos...')
const vendaIds = vendas.map((v) => v.id)
const bancoMaio = new Map()   // venda_id -> count pagas em maio
const bancoAtivas = new Map() // venda_id -> count parcelas nao-canceladas (estrutural)
for (let i = 0; i < vendaIds.length; i += 50) {
  const chunk = vendaIds.slice(i, i + 50)
  for (let f = 0; ; f += PAGE) {
    const { data } = await supa.from('pagamentos_prosoluto')
      .select('venda_id, status, data_pagamento')
      .in('venda_id', chunk).order('id')
      .range(f, f + PAGE - 1)
    if (!data?.length) break
    for (const p of data) {
      if (p.status === 'cancelado') continue
      bancoAtivas.set(p.venda_id, (bancoAtivas.get(p.venda_id) || 0) + 1)
      if (p.status === 'pago' && emMaio(p.data_pagamento)) bancoMaio.set(p.venda_id, (bancoMaio.get(p.venda_id) || 0) + 1)
    }
    if (data.length < PAGE) break
  }
}

// 3. income Sienge (bulk, cache 1h)
console.log('Baixando income do Sienge (bulk-data)...')
const r = await siengeGet({ path: '/bulk-data/v1/income', query: { startDate: '2023-01-01', endDate: '2031-12-31', selectionType: 'D', companyId: 5 } })
const income = extractRows(r.data)
console.log(`  ${income.length} linhas income`)

const siengeMaioPorBill = new Map()  // bill -> count pagas em maio (pro-soluto)
const siengeTotalPorBill = new Map() // bill -> count total parcelas pro-soluto (estrutural)
for (const i of income) {
  if (!tipoInterno(i)) continue
  const bill = Number(i.billId)
  if (!bill) continue
  siengeTotalPorBill.set(bill, (siengeTotalPorBill.get(bill) || 0) + 1)
  if (emMaio(pagDate(i))) siengeMaioPorBill.set(bill, (siengeMaioPorBill.get(bill) || 0) + 1)
}

// 4. cruzar
const linhas = []
for (const v of vendas) {
  const bill = Number(v.sienge_receivable_bill_id)
  let siengeN = siengeMaioPorBill.get(bill) || 0
  // distrato-aware: baixa pos-distrato nao conta (mas vendas ativas situacao<>3 ja filtradas)
  const bancoN = bancoMaio.get(v.id) || 0
  const siengeTot = siengeTotalPorBill.get(bill) || 0
  const bancoTot = bancoAtivas.get(v.id) || 0
  const difMaio = siengeN - bancoN
  const difEstrut = siengeTot - bancoTot
  if (difMaio === 0 && difEstrut === 0) continue
  linhas.push({
    contrato: v.sienge_contract_id, unidade: v.unidade, bill,
    tipo_corretor: v.tipo_corretor, cliente_id: v.cliente_id, corretor_id: v.corretor_id,
    sienge_maio: siengeN, banco_maio: bancoN, diff: difMaio,
    sienge_total: siengeTot, banco_total: bancoTot, diff_estrutural: difEstrut,
  })
}
linhas.sort((a, b) => b.diff - a.diff)

// 5. enriquecer nomes
const cliIds = [...new Set(linhas.map((l) => l.cliente_id).filter(Boolean))]
const corIds = [...new Set(linhas.map((l) => l.corretor_id).filter(Boolean))]
const { data: clis } = await supa.from('clientes').select('id, nome_completo').in('id', cliIds.length ? cliIds : ['x'])
const { data: cors } = await supa.from('usuarios').select('id, nome').in('id', corIds.length ? corIds : ['x'])
const cliMap = new Map((clis || []).map((c) => [c.id, c.nome_completo]))
const corMap = new Map((cors || []).map((c) => [c.id, c.nome]))

const nome = (l) => `${cliMap.get(l.cliente_id) || '?'} — ${corMap.get(l.corretor_id) || '?'}`
const sublag = linhas.filter((l) => l.diff > 0)
const sobra = linhas.filter((l) => l.diff < 0)
const estrutFalta = linhas.filter((l) => l.diff_estrutural > 0) // Sienge tem MAIS parcelas (banco perdeu)
const estrutSobra = linhas.filter((l) => l.diff_estrutural < 0) // banco tem MAIS parcelas que Sienge

console.log(`\n=== [MAIO] SYNC-LAG: Sienge marca MAIS pagas em maio que o banco ===  (${sublag.length})`)
for (const l of sublag) console.log(`  ${l.unidade.padEnd(9)} c${l.contrato} | Sienge ${l.sienge_maio} x banco ${l.banco_maio} (+${l.diff})  ${nome(l)}`)
console.log(`\n=== [MAIO] BANCO mostra MAIS pagas que o Sienge (duplicata/baixa?) ===  (${sobra.length})`)
for (const l of sobra) console.log(`  ${l.unidade.padEnd(9)} c${l.contrato} | Sienge ${l.sienge_maio} x banco ${l.banco_maio} (${l.diff})  ${nome(l)}`)
console.log(`\n=== [ESTRUTURAL] Sienge tem MAIS parcelas que o banco (parcela faltando — "eram 2, veio 1") ===  (${estrutFalta.length})`)
for (const l of estrutFalta) console.log(`  ${l.unidade.padEnd(9)} c${l.contrato} | Sienge ${l.sienge_total} x banco ${l.banco_total} (+${l.diff_estrutural})  ${nome(l)}`)
console.log(`\n=== [ESTRUTURAL] Banco tem MAIS parcelas que o Sienge (parcela a mais/duplicata) ===  (${estrutSobra.length})`)
for (const l of estrutSobra) console.log(`  ${l.unidade.padEnd(9)} c${l.contrato} | Sienge ${l.sienge_total} x banco ${l.banco_total} (${l.diff_estrutural})  ${nome(l)}`)

const out = {
  meta: { geradoEm: new Date().toISOString(), mes: '2026-05', spec_ref: '.claude/rules/sincronizacao-sienge.md', modo: 'read-only' },
  resumo: { sync_lag: sublag.length, banco_a_mais: sobra.length, income_linhas: income.length, vendas: vendas.length },
  sync_lag: sublag.map((l) => ({ ...l, cliente: cliMap.get(l.cliente_id), corretor: corMap.get(l.corretor_id) })),
  banco_a_mais: sobra.map((l) => ({ ...l, cliente: cliMap.get(l.cliente_id), corretor: corMap.get(l.corretor_id) })),
}
mkdirSync('docs/auditorias/2026-06-08-relatorio-maio', { recursive: true })
writeFileSync('docs/auditorias/2026-06-08-relatorio-maio/cruzamento-maio-sienge.json', JSON.stringify(out, null, 2))
console.log(`\nSalvo: docs/auditorias/2026-06-08-relatorio-maio/cruzamento-maio-sienge.json`)
