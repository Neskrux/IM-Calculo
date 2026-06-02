// One-off: verifica os 57 pagamentos orfaos detectados no AdminDashboard.
// Orfao = pagamentos_prosoluto.venda_id que nao bate com vendas (excluido=false OR null).
// Investiga: quantos pagos vs pendentes? Se houver pagos, e caso de rodada b.
//
// ver .claude/rules/sincronizacao-sienge.md
// uso: node scripts/verificar-pagamentos-orfaos.mjs

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

const url = env.VITE_SUPABASE_URL
const anon = env.VITE_SUPABASE_ANON_KEY
if (!url || !anon) {
  console.error('missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
  process.exit(1)
}

const supa = createClient(url, anon)

// --- vendas ativas (mesmo filtro do AdminDashboard) ---
const { data: vendas, error: errV } = await supa
  .from('vendas')
  .select('id, excluido')
  .or('excluido.eq.false,excluido.is.null')
if (errV) { console.error('erro vendas:', errV); process.exit(1) }
const idsAtivas = new Set(vendas.map(v => String(v.id)))
console.log(`vendas ativas (excluido=false/null): ${idsAtivas.size}`)

// --- vendas excluidas pra contextualizar ---
const { data: vendasExc } = await supa
  .from('vendas')
  .select('id, excluido')
  .eq('excluido', true)
const idsExcluidas = new Set((vendasExc || []).map(v => String(v.id)))
console.log(`vendas excluidas (excluido=true): ${idsExcluidas.size}`)

// --- pagamentos paginados ---
let pagamentos = []
let page = 0
const pageSize = 1000
while (true) {
  const { data, error } = await supa
    .from('pagamentos_prosoluto')
    .select('id, venda_id, tipo, status, valor, data_pagamento, data_prevista')
    .range(page * pageSize, (page + 1) * pageSize - 1)
  if (error) { console.error('erro pagamentos:', error); process.exit(1) }
  if (!data || data.length === 0) break
  pagamentos = pagamentos.concat(data)
  if (data.length < pageSize) break
  page++
}
console.log(`pagamentos totais: ${pagamentos.length}`)

// --- classifica orfaos ---
const orfaos = pagamentos.filter(p => p.venda_id && !idsAtivas.has(String(p.venda_id)))
const orfaosPorVendaExcluida = orfaos.filter(p => idsExcluidas.has(String(p.venda_id)))
const orfaosSemVenda = orfaos.filter(p => !idsExcluidas.has(String(p.venda_id)))

console.log('')
console.log(`orfaos totais: ${orfaos.length}`)
console.log(`  - venda existe mas esta excluido=true: ${orfaosPorVendaExcluida.length}`)
console.log(`  - venda NAO existe no banco (mais grave): ${orfaosSemVenda.length}`)

// breakdown por status
function breakdown(arr, label) {
  const porStatus = arr.reduce((acc, p) => {
    const s = p.status || '(null)'
    acc[s] = (acc[s] || 0) + 1
    return acc
  }, {})
  console.log(`\n${label}:`)
  for (const [s, n] of Object.entries(porStatus).sort()) {
    console.log(`  ${s}: ${n}`)
  }
}
breakdown(orfaos, 'orfaos por status')
breakdown(orfaosPorVendaExcluida, 'orfaos (venda excluida) por status')
breakdown(orfaosSemVenda, 'orfaos (venda inexistente) por status')

// detalhe dos pagos (se houver — caso de revisao humana)
const pagosOrfaos = orfaos.filter(p => p.status === 'pago')
if (pagosOrfaos.length > 0) {
  console.log(`\n⚠️ ${pagosOrfaos.length} pagamento(s) com status='pago' em vendas excluidas/inexistentes:`)
  console.log('  (violacao da spec — vendas com pago nao podem ter excluido=true)')
  for (const p of pagosOrfaos.slice(0, 10)) {
    const tipoOrfao = idsExcluidas.has(String(p.venda_id)) ? 'venda-excluida' : 'venda-inexistente'
    console.log(`  - pag ${p.id} venda ${p.venda_id} (${tipoOrfao}) tipo=${p.tipo} valor=${p.valor} data_pagamento=${p.data_pagamento}`)
  }
  if (pagosOrfaos.length > 10) console.log(`  ... + ${pagosOrfaos.length - 10} restantes`)
} else {
  console.log('\n✅ nenhum pagamento orfao com status=pago. Soh ruido visual, pode filtrar silenciosamente.')
}
