// Audita parcelas locais marcadas como pagas no futuro e cruza com o income
// do Sienge. Nao altera banco.
//
// Uso:
//   node scripts/auditar-pagos-futuros-sienge.mjs
//   node scripts/auditar-pagos-futuros-sienge.mjs --data=2026-05-21

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const DATA_REF =
  process.argv.find((arg) => arg.startsWith('--data='))?.split('=')[1] ||
  new Date().toISOString().slice(0, 10)
const FIGUEIRA_ID = '0d7d01f4-c398-4d9a-a280-13f44c957279'
const PAGE = 1000

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const env = Object.fromEntries(
  envFile
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)

const URL = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL
const KEY = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
if (!URL || !KEY) {
  console.error('faltando VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY')
  process.exit(1)
}

const supa = createClient(URL, KEY)
const norm = (v) => Number(v || 0).toFixed(2)

function tipoInterno(row) {
  const id = row.paymentTerm?.id
  if (id === 'PM') return 'parcela_entrada'
  if (id === 'SN' || id === 'AT') return 'sinal'
  if (id === 'BA' || /^B\d+$/.test(String(id || ''))) return 'balao'
  return null
}

function dataRecibo(row) {
  return row.paymentDate || row.receipts?.[0]?.paymentDate || null
}

function carregarIncomeDoCache() {
  const cacheDir = resolve(process.cwd(), '.sienge-cache')
  if (!existsSync(cacheDir)) return []
  const files = readdirSync(cacheDir).filter((file) => file.endsWith('.json'))
  for (const file of files) {
    try {
      const payload = JSON.parse(readFileSync(resolve(cacheDir, file), 'utf8'))
      if (!String(payload.url || '').includes('/bulk-data/v1/income')) continue
      const rows =
        payload.data?.results ||
        payload.data?.income ||
        payload.data?.data ||
        (Array.isArray(payload.data) ? payload.data : [])
      if (rows.length) return rows
    } catch {
      // ignora arquivo de cache quebrado
    }
  }
  return []
}

async function buscarTodos(queryFactory) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await queryFactory().range(from, from + PAGE - 1)
    if (error) throw error
    if (!data?.length) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

const income = carregarIncomeDoCache()
if (!income.length) {
  console.error('Nenhum cache de /bulk-data/v1/income encontrado em .sienge-cache.')
  process.exit(1)
}

const incomePorChave = new Map()
const incomePorInst = new Map()
for (const row of income) {
  const tipo = tipoInterno(row)
  if (!tipo) continue
  const bill = Number(row.billId)
  const inst = String(row.installmentId ?? '')
  const item = {
    bill,
    tipo,
    valor: Number(row.originalAmount || 0),
    dueDate: row.dueDate,
    installmentId: inst,
    paymentDate: dataRecibo(row),
    receiptsCount: row.receipts?.length || 0,
  }
  const chave = `${bill}|${tipo}|${norm(row.originalAmount)}|${row.dueDate}`
  if (!incomePorChave.has(chave)) incomePorChave.set(chave, [])
  incomePorChave.get(chave).push(item)
  if (inst) incomePorInst.set(`${bill}|${inst}`, item)
}

const vendas = await buscarTodos(() =>
  supa
    .from('vendas')
    .select('id, sienge_contract_id, sienge_receivable_bill_id, unidade, cliente_id, corretor_id, excluido')
    .eq('empreendimento_id', FIGUEIRA_ID)
    .not('sienge_receivable_bill_id', 'is', null)
    .or('excluido.eq.false,excluido.is.null'),
)

const vendasPorId = new Map(vendas.map((v) => [v.id, v]))
const pagamentos = []
const vendaIds = vendas.map((v) => v.id)
for (let i = 0; i < vendaIds.length; i += 50) {
  const chunk = vendaIds.slice(i, i + 50)
  const rows = await buscarTodos(() =>
    supa
      .from('pagamentos_prosoluto')
      .select('id, venda_id, tipo, numero_parcela, valor, data_prevista, data_pagamento, status, sienge_bill_id, sienge_installment_id')
      .in('venda_id', chunk)
      .eq('status', 'pago')
      .gt('data_prevista', DATA_REF),
  )
  pagamentos.push(...rows)
}

const suspeitos = []
const adiantadosConfirmados = []
for (const p of pagamentos) {
  const venda = vendasPorId.get(p.venda_id)
  const bill = Number(p.sienge_bill_id || venda?.sienge_receivable_bill_id)
  let match = null
  if (p.sienge_installment_id) {
    match = incomePorInst.get(`${bill}|${p.sienge_installment_id}`)
  }
  if (!match) {
    const matches = incomePorChave.get(`${bill}|${p.tipo}|${norm(p.valor)}|${p.data_prevista}`) || []
    if (matches.length === 1) match = matches[0]
  }

  const item = {
    venda_id: p.venda_id,
    pagamento_id: p.id,
    contrato: venda?.sienge_contract_id,
    unidade: venda?.unidade,
    tipo: p.tipo,
    numero_parcela: p.numero_parcela,
    valor: Number(p.valor || 0),
    data_prevista: p.data_prevista,
    data_pagamento: p.data_pagamento,
    bill,
    sienge_installment_id: p.sienge_installment_id || null,
    sienge_paymentDate: match?.paymentDate || null,
    motivo: null,
  }

  if (match?.paymentDate) {
    adiantadosConfirmados.push(item)
  } else {
    item.motivo = match ? 'local pago futuro, Sienge sem recibo' : 'local pago futuro, sem match unico no Sienge'
    suspeitos.push(item)
  }
}

const porContrato = {}
for (const item of suspeitos) {
  const key = `${item.contrato || '-'} | ${item.unidade || '-'}`
  porContrato[key] = (porContrato[key] || 0) + 1
}

const out = {
  meta: {
    geradoEm: new Date().toISOString(),
    dataReferencia: DATA_REF,
    fonteSienge: '.sienge-cache /bulk-data/v1/income',
    observacao: 'Suspeito nao e correcao automatica. Revisar com Sienge/financeiro antes de reverter baixas em massa.',
  },
  counts: {
    pagos_futuros_locais: pagamentos.length,
    adiantados_confirmados_sienge: adiantadosConfirmados.length,
    suspeitos: suspeitos.length,
  },
  porContrato,
  suspeitos,
  adiantados_confirmados_amostra: adiantadosConfirmados.slice(0, 50),
}

const outFile = `docs/auditoria-pagos-futuros-sienge-${DATA_REF}.json`
writeFileSync(outFile, JSON.stringify(out, null, 2))

console.log(JSON.stringify(out.counts, null, 2))
console.log(`suspeitos por contrato: ${Object.keys(porContrato).length}`)
for (const item of suspeitos.slice(0, 30)) {
  console.log([
    item.contrato,
    item.unidade,
    item.tipo,
    item.numero_parcela,
    item.valor,
    item.data_prevista,
    item.data_pagamento,
    item.motivo,
  ].join(' | '))
}
console.log(`\nSalvo: ${outFile}`)

