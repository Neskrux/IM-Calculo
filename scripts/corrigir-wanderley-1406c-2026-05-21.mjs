// Correcao cirurgica do contrato 164 / Sienge 256 (Wanderley, unidade 1406 C).
//
// Causa:
// - O bill 226 tem dois blocos PM no Sienge:
//   1/5 de R$ 500,00 e 1/50 de R$ 875,97.
// - Historicamente, parte do backfill/sync cruzou linhas apenas por numero
//   de parcela. Isso deixou uma baixa antiga amarrada no bloco errado:
//   PM 3/50 (20/05/2026) nao existe no banco e PM 4/50 (20/06/2026)
//   ficou como pago, embora o Sienge esteja sem recibo.
//
// Politica:
// - Sienge income e fonte da verdade para status/data de pagamento.
// - Nao altera tipo/valor/comissao de linhas que ja estao pago.
// - Reverte baixa falsa com o fluxo explicito permitido:
//   status='pendente' + data_pagamento=NULL; depois cancela a duplicata.
//
// Uso:
//   node scripts/corrigir-wanderley-1406c-2026-05-21.mjs
//   node scripts/corrigir-wanderley-1406c-2026-05-21.mjs --apply

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const DATA_REF = new Date().toISOString().slice(0, 10)
const SCRIPT = 'scripts/corrigir-wanderley-1406c-2026-05-21.mjs'
const VENDA_ID = 'a7fe850b-0b89-44ab-b222-68cf877febfe'
const CONTRACT_ID = '256'
const BILL_ID = 226
const PCT_TOTAL = 7

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

function n(v) {
  return Number(v || 0)
}

function round2(v) {
  return Number(n(v).toFixed(2))
}

function round6(v) {
  return Number(n(v).toFixed(6))
}

function money(v) {
  return n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function cacheIncomeRows() {
  const cacheDir = resolve(process.cwd(), '.sienge-cache')
  if (!existsSync(cacheDir)) return []
  const files = readdirSync(cacheDir).filter((f) => f.endsWith('.json'))
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
      // ignora cache quebrado
    }
  }
  return []
}

function tipoInterno(row) {
  const id = row.paymentTerm?.id
  if (id === 'PM') return 'parcela_entrada'
  if (id === 'SN' || id === 'AT') return 'sinal'
  if (id === 'BA' || /^B\d+$/.test(String(id || ''))) return 'balao'
  return null
}

function pagamentoSienge(row) {
  return row.receipts?.[0]?.paymentDate || row.paymentDate || null
}

function byId(rows) {
  return new Map(rows.map((r) => [String(r.id), r]))
}

async function patchPagamento(id, patch, etapa, report) {
  if (!APPLY) {
    report.dryRun.push({ etapa, id, patch })
    return null
  }
  const { data, error } = await supa
    .from('pagamentos_prosoluto')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle()
  if (error) {
    report.errors.push({ etapa, id, error: error.message, patch })
    return null
  }
  report.aplicado.push({ etapa, id, patch, after: data })
  return data
}

async function insertPagamento(payload, etapa, report) {
  if (!APPLY) {
    report.dryRun.push({ etapa, insert: payload })
    return null
  }
  const { data, error } = await supa
    .from('pagamentos_prosoluto')
    .insert({ ...payload, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .select('*')
    .maybeSingle()
  if (error) {
    report.errors.push({ etapa, error: error.message, insert: payload })
    return null
  }
  report.aplicado.push({ etapa, insert: payload, after: data })
  return data
}

console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)

const { data: venda, error: vendaErr } = await supa
  .from('vendas')
  .select('id, sienge_contract_id, sienge_receivable_bill_id, unidade, valor_venda, valor_pro_soluto, tipo_corretor, excluido')
  .eq('id', VENDA_ID)
  .maybeSingle()
if (vendaErr || !venda) throw new Error(vendaErr?.message || 'venda nao encontrada')
if (String(venda.sienge_contract_id) !== CONTRACT_ID || Number(venda.sienge_receivable_bill_id) !== BILL_ID) {
  throw new Error(`venda alvo inesperada: contract=${venda.sienge_contract_id} bill=${venda.sienge_receivable_bill_id}`)
}

const fator = round6((n(venda.valor_venda) * (PCT_TOTAL / 100)) / n(venda.valor_pro_soluto))
const comissao500 = round2(500 * fator)
const comissao875 = round2(875.97 * fator)

const income = cacheIncomeRows()
const billRows = income
  .filter((r) => Number(r.billId) === BILL_ID)
  .map((r) => ({ ...r, _tipoInterno: tipoInterno(r), _paymentDate: pagamentoSienge(r) }))
  .filter((r) => r._tipoInterno)
  .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || Number(a.installmentId) - Number(b.installmentId))
if (!billRows.length) throw new Error('bill 226 nao encontrado no cache Sienge income')

const { data: pagamentos, error: pagErr } = await supa
  .from('pagamentos_prosoluto')
  .select('*')
  .eq('venda_id', VENDA_ID)
  .order('data_prevista', { ascending: true })
  .order('numero_parcela', { ascending: true })
if (pagErr) throw pagErr

const before = pagamentos.map((p) => ({
  id: p.id,
  tipo: p.tipo,
  numero_parcela: p.numero_parcela,
  valor: n(p.valor),
  status: p.status,
  data_prevista: p.data_prevista,
  data_pagamento: p.data_pagamento,
  comissao_gerada: n(p.comissao_gerada),
  sienge_bill_id: p.sienge_bill_id,
  sienge_installment_id: p.sienge_installment_id,
}))

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    modo: APPLY ? 'apply' : 'dry-run',
    script: SCRIPT,
    venda_id: VENDA_ID,
    contrato_sienge: CONTRACT_ID,
    bill_id: BILL_ID,
    observacao: 'Sienge REST de installments bloqueia 403 e bulk live retornou 429; cache income local usado como fonte Sienge mais recente disponivel.',
  },
  venda,
  fator,
  comissao: { parcela_500: comissao500, parcela_875_97: comissao875 },
  sienge_primeiras_linhas: billRows.slice(0, 12).map((r) => ({
    installmentId: r.installmentId,
    tipo: r._tipoInterno,
    paymentTermId: r.paymentTerm?.id,
    installmentNumber: r.installmentNumber,
    dueDate: r.dueDate,
    originalAmount: n(r.originalAmount),
    balanceAmount: n(r.balanceAmount),
    paymentDate: r._paymentDate,
  })),
  before,
  dryRun: [],
  aplicado: [],
  errors: [],
  after: [],
  validacao: {},
}

const rows = byId(pagamentos)
const required = [
  '46c6b6b3-384b-45f5-9304-7f2e695637cb',
  '6e5bbe8b-9876-4c33-baf7-d5d9d150df49',
  '7d1a5e3a-16c2-4af9-92c3-d47d5450a2dd',
  'a7818932-5577-403f-b291-4bc26b6679a1',
  'dd109942-e8ef-4792-b3a4-33acb9ed6d54',
  '2bb10257-20e7-4960-85ca-900b2d495393',
  'cfe2d865-a047-46e5-b2b0-726e660d5c2d',
  'abb904a7-7ed6-4931-b092-30fcd54ea70d',
  '0cc7dc02-5fce-43b4-beda-e09aed48f776',
]
for (const id of required) {
  if (!rows.has(id)) throw new Error(`pagamento esperado nao encontrado: ${id}`)
}

const updatesDiretos = [
  {
    id: '46c6b6b3-384b-45f5-9304-7f2e695637cb',
    etapa: 'ancorar PM 1/5 e corrigir data_pagamento',
    patch: { data_pagamento: '2025-10-20', status: 'pago', sienge_bill_id: BILL_ID, sienge_installment_id: '1' },
  },
  {
    id: '6e5bbe8b-9876-4c33-baf7-d5d9d150df49',
    etapa: 'ancorar PM 2/5 e corrigir data_pagamento',
    patch: { data_pagamento: '2025-11-19', status: 'pago', sienge_bill_id: BILL_ID, sienge_installment_id: '2' },
  },
  {
    id: '7d1a5e3a-16c2-4af9-92c3-d47d5450a2dd',
    etapa: 'ancorar PM 3/5 correta',
    patch: { data_pagamento: '2025-12-18', status: 'pago', sienge_bill_id: BILL_ID, sienge_installment_id: '3' },
  },
  {
    id: 'dd109942-e8ef-4792-b3a4-33acb9ed6d54',
    etapa: 'ancorar PM 4/5 e corrigir data_pagamento',
    patch: { data_pagamento: '2026-01-19', status: 'pago', sienge_bill_id: BILL_ID, sienge_installment_id: '4' },
  },
  {
    id: '2bb10257-20e7-4960-85ca-900b2d495393',
    etapa: 'ancorar PM 5/5 correta',
    patch: { data_pagamento: '2026-02-20', status: 'pago', sienge_bill_id: BILL_ID, sienge_installment_id: '5' },
  },
  {
    id: 'cfe2d865-a047-46e5-b2b0-726e660d5c2d',
    etapa: 'reativar PM 1/50 paga no Sienge',
    patch: {
      tipo: 'parcela_entrada',
      numero_parcela: 1,
      valor: 875.97,
      data_prevista: '2026-03-20',
      data_pagamento: '2026-03-20',
      status: 'pago',
      comissao_gerada: comissao875,
      fator_comissao_aplicado: fator,
      percentual_comissao_total: PCT_TOTAL,
      sienge_bill_id: BILL_ID,
      sienge_installment_id: '6',
    },
  },
  {
    id: 'abb904a7-7ed6-4931-b092-30fcd54ea70d',
    etapa: 'ancorar PM 2/50 e corrigir data_pagamento',
    patch: { data_pagamento: '2026-04-20', status: 'pago', sienge_bill_id: BILL_ID, sienge_installment_id: '7' },
  },
]

for (const u of updatesDiretos) {
  await patchPagamento(u.id, u.patch, u.etapa, report)
}

// Duplicata paga que nao existe como recibo separado no Sienge.
await patchPagamento(
  'a7818932-5577-403f-b291-4bc26b6679a1',
  { status: 'pendente', data_pagamento: null, sienge_bill_id: null, sienge_installment_id: null },
  'reverter baixa falsa duplicada PM 3/5',
  report,
)
await patchPagamento(
  'a7818932-5577-403f-b291-4bc26b6679a1',
  { status: 'cancelado', data_pagamento: null },
  'cancelar duplicata PM 3/5 apos reversao explicita',
  report,
)

// PM 3/50 (20/05/2026) existe no Sienge, sem recibo, e faltava no banco.
const { data: jaExistePm3 } = await supa
  .from('pagamentos_prosoluto')
  .select('id, status')
  .eq('venda_id', VENDA_ID)
  .eq('sienge_bill_id', BILL_ID)
  .eq('sienge_installment_id', '8')
  .maybeSingle()
if (jaExistePm3) {
  report.dryRun.push({ etapa: 'PM 3/50 ja existia; nao inserir', pagamento: jaExistePm3 })
} else {
  await insertPagamento(
    {
      venda_id: VENDA_ID,
      tipo: 'parcela_entrada',
      numero_parcela: 3,
      valor: 875.97,
      data_prevista: '2026-05-20',
      data_pagamento: null,
      status: 'pendente',
      comissao_gerada: comissao875,
      fator_comissao_aplicado: fator,
      percentual_comissao_total: PCT_TOTAL,
      sienge_bill_id: BILL_ID,
      sienge_installment_id: '8',
    },
    'criar PM 3/50 pendente (maio/2026)',
    report,
  )
}

// PM 4/50 (20/06/2026) esta sem recibo no Sienge; desfaz baixa falsa.
await patchPagamento(
  '0cc7dc02-5fce-43b4-beda-e09aed48f776',
  { status: 'pendente', data_pagamento: null, sienge_bill_id: BILL_ID, sienge_installment_id: '9' },
  'reverter baixa falsa PM 4/50 (junho/2026)',
  report,
)

const { data: afterRows, error: afterErr } = await supa
  .from('pagamentos_prosoluto')
  .select('*')
  .eq('venda_id', VENDA_ID)
  .order('data_prevista', { ascending: true })
  .order('numero_parcela', { ascending: true })
if (afterErr) throw afterErr

report.after = afterRows.map((p) => ({
  id: p.id,
  tipo: p.tipo,
  numero_parcela: p.numero_parcela,
  valor: n(p.valor),
  status: p.status,
  data_prevista: p.data_prevista,
  data_pagamento: p.data_pagamento,
  comissao_gerada: n(p.comissao_gerada),
  sienge_bill_id: p.sienge_bill_id,
  sienge_installment_id: p.sienge_installment_id,
}))

const ativos = report.after.filter((p) => p.status !== 'cancelado')
const maio = ativos.find((p) => p.valor === 875.97 && p.data_prevista === '2026-05-20')
const junho = ativos.find((p) => p.valor === 875.97 && p.data_prevista === '2026-06-20')
const pagasFuturas = ativos.filter((p) => p.status === 'pago' && p.data_prevista > DATA_REF)
report.validacao = {
  ativos: ativos.length,
  cancelados: report.after.length - ativos.length,
  comissao_paga: round2(ativos.filter((p) => p.status === 'pago').reduce((s, p) => s + n(p.comissao_gerada), 0)),
  tem_maio_2026_pendente: !!maio && maio.status === 'pendente',
  junho_2026_pendente_sem_baixa: !!junho && junho.status === 'pendente' && !junho.data_pagamento,
  pagas_futuras: pagasFuturas.map((p) => ({ id: p.id, numero_parcela: p.numero_parcela, valor: p.valor, data_prevista: p.data_prevista })),
}

console.log('\nResumo esperado:')
console.log(`  fator total: ${fator} | comissao 500=${money(comissao500)} | comissao 875,97=${money(comissao875)}`)
console.log(`  ativos apos ${APPLY ? 'apply' : 'dry-run'}: ${report.validacao.ativos}`)
console.log(`  maio/2026 pendente: ${report.validacao.tem_maio_2026_pendente}`)
console.log(`  junho/2026 pendente sem baixa: ${report.validacao.junho_2026_pendente_sem_baixa}`)
console.log(`  pagas futuras: ${report.validacao.pagas_futuras.length}`)
if (report.errors.length) {
  console.log(`  ERROS: ${report.errors.length}`)
  for (const e of report.errors) console.log(`    ${JSON.stringify(e)}`)
}

const outFile = `docs/correcao-wanderley-1406c-${DATA_REF}-${APPLY ? 'aplicado' : 'dryrun'}.json`
writeFileSync(outFile, JSON.stringify(report, null, 2))
console.log(`\nSalvo: ${outFile}`)
if (!APPLY) console.log('\nDry-run apenas. Para aplicar: node scripts/corrigir-wanderley-1406c-2026-05-21.mjs --apply')

