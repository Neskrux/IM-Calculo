// Investiga os baloes (tipo='balao') sem data_prevista detectados pela
// validacao de sanidade 2026-05-14. Sem data_prevista o balao nao aparece
// posicionado no calendario nem em filtros de periodo.
//
// Pra cada balao orfao: puxa a venda, cliente, e checa se ha info local pra
// derivar a data (vencimento_balao, periodicidade_balao) ou se precisa do Sienge.
//
// READ-ONLY. Saida: docs/baloes-sem-data-{date}.json + .md pra gestora.
// Spec: .claude/rules/sincronizacao-sienge.md

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

// 1. todos os baloes sem data_prevista
console.log('=== 1. Baloes sem data_prevista ===')
const baloes = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supa
    .from('pagamentos_prosoluto')
    .select('id, venda_id, numero_parcela, tipo, valor, data_prevista, data_pagamento, status, comissao_gerada')
    .eq('tipo', 'balao')
    .is('data_prevista', null)
    .range(from, from + 999)
  if (error) { console.error('erro:', error); process.exit(1) }
  if (!data?.length) break
  baloes.push(...data)
  if (data.length < 1000) break
}
console.log(`  baloes sem data_prevista: ${baloes.length}`)

// 2. agrupar por venda + puxar metadados
const porVenda = new Map()
for (const b of baloes) {
  if (!porVenda.has(b.venda_id)) porVenda.set(b.venda_id, [])
  porVenda.get(b.venda_id).push(b)
}
console.log(`  vendas afetadas: ${porVenda.size}`)

const vendaIds = [...porVenda.keys()]
const vendasMeta = new Map()
for (let i = 0; i < vendaIds.length; i += 100) {
  const { data } = await supa
    .from('vendas')
    .select(
      'id, sienge_contract_id, numero_contrato, unidade, valor_venda, cliente_id, corretor_id, ' +
        'excluido, teve_balao, qtd_balao, valor_balao, valor_balao_unitario, vencimento_balao, periodicidade_balao, sienge_receivable_bill_id',
    )
    .in('id', vendaIds.slice(i, i + 100))
  for (const v of data || []) vendasMeta.set(v.id, v)
}
const clienteIds = [...new Set([...vendasMeta.values()].map((v) => v.cliente_id).filter(Boolean))]
const clientes = new Map()
for (let i = 0; i < clienteIds.length; i += 100) {
  const { data } = await supa.from('clientes').select('id, nome_completo, cpf, telefone').in('id', clienteIds.slice(i, i + 100))
  for (const c of data || []) clientes.set(c.id, c)
}

// 3. cache income — ver se o bill da venda tem baloes (tipo BA/B1..B5) com dueDate
const cacheDir = resolve(process.cwd(), '.sienge-cache')
let income = []
if (existsSync(cacheDir)) {
  for (const f of readdirSync(cacheDir).filter((x) => x.endsWith('.json'))) {
    try {
      const c = JSON.parse(readFileSync(resolve(cacheDir, f), 'utf8'))
      if (!c.url?.includes('/bulk-data/v1/income')) continue
      const rows = c.data?.results || c.data?.income || c.data?.data || (Array.isArray(c.data) ? c.data : [])
      if (rows.length) { income = rows; break }
    } catch { /* skip */ }
  }
}
const TIPOS_BALAO_SIENGE = new Set(['BA', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'])
const baloesSiengePorBill = new Map()
for (const i of income) {
  if (!TIPOS_BALAO_SIENGE.has(i.paymentTerm?.id)) continue
  const bill = Number(i.billId)
  if (!baloesSiengePorBill.has(bill)) baloesSiengePorBill.set(bill, [])
  baloesSiengePorBill.get(bill).push({ inst: i.installmentNumber, due: i.dueDate, termo: i.paymentTerm?.id })
}

// 4. montar casos
const casos = []
for (const [vid, bs] of porVenda.entries()) {
  const v = vendasMeta.get(vid) || {}
  const cli = clientes.get(v.cliente_id)
  const billSienge = Number(v.sienge_receivable_bill_id)
  const baloesNoSienge = baloesSiengePorBill.get(billSienge) || []
  // diagnostico: tem como derivar a data?
  let fonte_possivel = 'revisao_humana'
  if (baloesNoSienge.length > 0) fonte_possivel = 'sienge_income (bill tem baloes com dueDate)'
  else if (v.vencimento_balao) fonte_possivel = 'venda.vencimento_balao'
  casos.push({
    venda_id: vid,
    sienge_contract_id: v.sienge_contract_id,
    numero_contrato: v.numero_contrato,
    unidade: v.unidade,
    cliente: cli?.nome_completo || null,
    cliente_cpf: cli?.cpf || null,
    excluido: v.excluido,
    qtd_baloes_sem_data: bs.length,
    baloes: bs.map((b) => ({ numero_parcela: b.numero_parcela, valor: b.valor, status: b.status, data_pagamento: b.data_pagamento })),
    venda_balao_info: {
      teve_balao: v.teve_balao,
      qtd_balao: v.qtd_balao,
      valor_balao: v.valor_balao,
      valor_balao_unitario: v.valor_balao_unitario,
      vencimento_balao: v.vencimento_balao,
      periodicidade_balao: v.periodicidade_balao,
    },
    baloes_no_sienge: baloesNoSienge,
    fonte_possivel,
  })
}

casos.sort((a, b) => b.qtd_baloes_sem_data - a.qtd_baloes_sem_data)

const data = new Date().toISOString().slice(0, 10)
const out = {
  meta: {
    geradoEm: new Date().toISOString(),
    total_baloes: baloes.length,
    total_vendas: casos.length,
    regra: 'Baloes (tipo=balao) sem data_prevista — nao aparecem posicionados no calendario nem em filtros de periodo.',
  },
  casos,
}
writeFileSync(`docs/baloes-sem-data-${data}.json`, JSON.stringify(out, null, 2))
console.log(`\nSalvo: docs/baloes-sem-data-${data}.json`)

// resumo console
console.log('\n=== Resumo ===')
const pagos = baloes.filter((b) => b.status === 'pago').length
const pend = baloes.filter((b) => b.status === 'pendente').length
const canc = baloes.filter((b) => b.status === 'cancelado').length
console.log(`  ${baloes.length} baloes sem data: ${pagos} pagos, ${pend} pendentes, ${canc} cancelados`)
const porFonte = {}
for (const c of casos) porFonte[c.fonte_possivel] = (porFonte[c.fonte_possivel] || 0) + 1
console.log(`  por fonte possivel de correcao:`)
for (const [f, n] of Object.entries(porFonte)) console.log(`    ${f}: ${n} vendas`)

console.log('\n=== Por venda ===')
for (const c of casos) {
  console.log(
    `  contrato ${c.sienge_contract_id || '-'} (${c.unidade || '-'}) ${c.cliente || '?'}: ` +
      `${c.qtd_baloes_sem_data} balao(oes) sem data ${c.excluido ? '[VENDA EXCLUIDA]' : ''} | fonte: ${c.fonte_possivel}`,
  )
}
