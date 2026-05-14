// Verifica a venda do LEANDRO (908 A, bill 381) contra o Sienge REAL —
// baixa o income do bulk-data e compara parcela a parcela com o banco.
// READ-ONLY. Sem inferencia: usa os dados reais do Sienge.

import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { siengeGet, extractRows } from './_sienge-http.mjs'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

const BILL = 381

// 1. banco local
const { data: vs } = await supa.from('vendas').select('*').ilike('unidade', '908 A')
const v = vs[0]
console.log(`=== BANCO LOCAL — venda ${v.id.slice(0, 8)} ===`)
console.log(`  contrato=${v.sienge_contract_id} bill=${v.sienge_receivable_bill_id} valor=${v.valor_venda} pro_soluto=${v.valor_pro_soluto}`)
const { data: pags } = await supa
  .from('pagamentos_prosoluto')
  .select('id, numero_parcela, tipo, valor, data_prevista, data_pagamento, status')
  .eq('venda_id', v.id)

// 2. Sienge — income do bill 381 (varre 2023-2031 pra pegar tudo)
console.log(`\n=== SIENGE — income do bill ${BILL} ===`)
const r = await siengeGet({
  path: '/bulk-data/v1/income',
  query: { startDate: '2023-01-01', endDate: '2031-12-31', selectionType: 'D', companyId: 5 },
})
const todasIncome = extractRows(r.data)
const incomeBill = todasIncome.filter((i) => Number(i.billId) === BILL)
console.log(`  parcelas no Sienge: ${incomeBill.length}`)
console.log('  inst  | termo | valor    | dueDate    | paymentDate | recebido')
const siengeOrdenado = incomeBill.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
let siengeSomaPM = 0
let siengeSomaPaga = 0
for (const i of siengeOrdenado) {
  const recebido = (i.receipts || []).reduce((s, x) => s + Number(x.netAmount || 0), 0)
  const dataPag = i.paymentDate || (i.receipts?.[0]?.paymentDate) || '-'
  const termo = i.paymentTerm?.id || '?'
  if (termo === 'PM') siengeSomaPM += Number(i.originalAmount || 0)
  if (recebido > 0) siengeSomaPaga += recebido
  console.log(
    `  ${String(i.installmentNumber || '?').padEnd(5)} | ${termo.padEnd(5)} | ` +
      `${String(i.originalAmount || 0).padStart(8)} | ${(i.dueDate || '-').padEnd(10)} | ${String(dataPag).padEnd(11)} | ${recebido.toFixed(2)}`,
  )
}
console.log(`  soma PM no Sienge: ${siengeSomaPM.toFixed(2)} | soma recebida: ${siengeSomaPaga.toFixed(2)}`)

// 3. comparacao
console.log(`\n=== COMPARACAO ===`)
const ativos = pags.filter((p) => p.status !== 'cancelado')
const somaAtiva = ativos.reduce((s, p) => s + Number(p.valor || 0), 0)
const somaPaga = pags.filter((p) => p.status === 'pago').reduce((s, p) => s + Number(p.valor || 0), 0)
console.log(`  Sienge:  ${incomeBill.length} parcelas | soma PM ${siengeSomaPM.toFixed(2)}`)
console.log(`  Banco:   ${pags.length} parcelas (${ativos.length} ativas) | soma ativas ${somaAtiva.toFixed(2)} | soma pagas ${somaPaga.toFixed(2)}`)
console.log(`  pro_soluto cadastrado na venda: ${v.valor_pro_soluto}`)
console.log('')

// match por valor + dueDate
const norm = (x) => Number(x).toFixed(2)
const siengeKeys = new Map()
for (const i of incomeBill) {
  if (i.paymentTerm?.id !== 'PM') continue
  const k = `${norm(i.originalAmount)}__${i.dueDate}`
  siengeKeys.set(k, (siengeKeys.get(k) || 0) + 1)
}
const bancoKeys = new Map()
for (const p of ativos) {
  const k = `${norm(p.valor)}__${p.data_prevista}`
  bancoKeys.set(k, (bancoKeys.get(k) || 0) + 1)
}
// parcelas no Sienge que NAO tem match ativo no banco
const soNoSienge = []
for (const [k, n] of siengeKeys.entries()) {
  const noBanco = bancoKeys.get(k) || 0
  if (noBanco < n) soNoSienge.push(`${k} (Sienge ${n}x, banco ativo ${noBanco}x)`)
}
const soNoBanco = []
for (const [k, n] of bancoKeys.entries()) {
  const noSienge = siengeKeys.get(k) || 0
  if (noSienge < n) soNoBanco.push(`${k} (banco ativo ${n}x, Sienge ${noSienge}x)`)
}
console.log(`  parcelas PM do Sienge SEM match ativo no banco: ${soNoSienge.length}`)
for (const x of soNoSienge) console.log(`    falta no banco: ${x}`)
console.log(`  parcelas ativas no banco SEM match no Sienge: ${soNoBanco.length}`)
for (const x of soNoBanco) console.log(`    sobra no banco: ${x}`)
