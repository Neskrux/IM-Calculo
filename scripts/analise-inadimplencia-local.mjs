// READ-ONLY. Decompõe a inadimplência inflada do banco local cruzando as parcelas
// PENDENTES locais contra o conjunto de PAGAS do Sienge (bulk já baixado).
// ver .claude/rules/sincronizacao-sienge.md · não escreve nada.
//
// Pergunta: das pendentes locais "vencidas" (data_prevista < hoje), quantas o Sienge
// já considera PAGAS (falso pendente) vs sem âncora (órfã/gêmeo) vs candidatas reais?

import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const HOJE = '2026-06-02'
const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || fromFile('SUPABASE_SERVICE_ROLE_KEY') ||
            process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supabase = createClient(URL, KEY)

// 1) conjunto de PAGAS do Sienge (par billId/installmentId) — universo P mais amplo
const pagos = JSON.parse(readFileSync('docs/auditorias/fase0/fase0-universo-pagos-futuro.json', 'utf8')).rows
const paidSet = new Set(pagos.map((r) => `${r.billId}/${r.installmentId}`))
console.log(`Sienge PAGAS (par bill/installment): ${paidSet.size}`)

// 2) vendas ativas (não distrato, não excluída)
const vendasAtivas = new Set()
for (let from = 0; ; from += 1000) {
  const { data } = await supabase.from('vendas').select('id, status, excluido').range(from, from + 999)
  for (const v of data || []) if (v.excluido !== true && v.status !== 'distrato') vendasAtivas.add(v.id)
  if (!data || data.length < 1000) break
}

// 3) pendentes locais (paginado)
let pend = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase.from('pagamentos_prosoluto')
    .select('id, venda_id, tipo, valor, data_prevista, sienge_bill_id, sienge_installment_id')
    .eq('status', 'pendente').order('id', { ascending: true }).range(from, from + 999)
  if (error) throw error
  pend = pend.concat(data || [])
  if (!data || data.length < 1000) break
}
console.log(`pendentes locais (todas): ${pend.length}`)

// só de vendas ativas
const pendAtivas = pend.filter((p) => vendasAtivas.has(p.venda_id))
// "vencidas" pela data_prevista local
const vencidas = pendAtivas.filter((p) => p.data_prevista && p.data_prevista < HOJE)

const par = (p) => `${p.sienge_bill_id}/${p.sienge_installment_id}`
const soma = (arr) => arr.reduce((a, p) => a + (Number(p.valor) || 0), 0)

const falsoPago = vencidas.filter((p) => p.sienge_installment_id != null && paidSet.has(par(p)))
const ancoradoNaoPago = vencidas.filter((p) => p.sienge_installment_id != null && !paidSet.has(par(p)))
const semAncora = vencidas.filter((p) => p.sienge_installment_id == null)

const brl = (n) => 'R$ ' + n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
const pct = (a, b) => (b > 0 ? (100 * a / b).toFixed(1) + '%' : '-')

console.log(`\n=== PENDENTES de vendas ativas: ${pendAtivas.length} (soma ${brl(soma(pendAtivas))}) ===`)
console.log(`"vencidas" localmente (data_prevista < ${HOJE}): ${vencidas.length} (soma ${brl(soma(vencidas))})`)
console.log(`\nDecomposição das ${vencidas.length} pendentes-vencidas locais:`)
console.log(`  A) Sienge JÁ PAGOU (falso pendente):      ${falsoPago.length}  (${pct(falsoPago.length, vencidas.length)})  ${brl(soma(falsoPago))}`)
console.log(`  B) ancorada e Sienge NÃO pagou:           ${ancoradoNaoPago.length}  (${pct(ancoradoNaoPago.length, vencidas.length)})  ${brl(soma(ancoradoNaoPago))}`)
console.log(`  C) SEM âncora (órfã/gêmeo/não casada):    ${semAncora.length}  (${pct(semAncora.length, vencidas.length)})  ${brl(soma(semAncora))}`)
console.log(`\n  -> (A) é inflação por pagamento-não-registrado; (C) é provável gêmeo/órfã; (B) precisa checar data do Sienge.`)
