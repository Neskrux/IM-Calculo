// Valida invariantes de pagamentos_prosoluto + vendas apos as correcoes de
// 2026-05-13/14. Garante que o que o corretor/admin VE no dashboard esta
// consistente. READ-ONLY.
//
// Spec: .claude/rules/sincronizacao-sienge.md (secao "Invariantes")

import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

// carrega todos os pagamentos
const pagamentos = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supa
    .from('pagamentos_prosoluto')
    .select('id, venda_id, numero_parcela, tipo, valor, data_prevista, data_pagamento, status, comissao_gerada')
    .range(from, from + 999)
  if (error) { console.error('erro:', error); process.exit(1) }
  if (!data?.length) break
  pagamentos.push(...data)
  if (data.length < 1000) break
}
console.log(`Pagamentos carregados: ${pagamentos.length}\n`)

let falhas = 0
const check = (nome, lista) => {
  if (lista.length === 0) {
    console.log(`  ✓ ${nome}`)
  } else {
    falhas += lista.length
    console.log(`  ✗ ${nome}: ${lista.length} violacoes`)
    for (const x of lista.slice(0, 5)) console.log(`      ${JSON.stringify(x).slice(0, 160)}`)
    if (lista.length > 5) console.log(`      ... +${lista.length - 5}`)
  }
}

console.log('=== Invariantes da spec ===')
// 1. pago => data_pagamento NOT NULL
check(
  'todo status=pago tem data_pagamento',
  pagamentos.filter((p) => p.status === 'pago' && !p.data_pagamento).map((p) => ({ id: p.id, status: p.status, dp: p.data_pagamento })),
)
// 2. pendente => data_pagamento NULL
check(
  'todo status=pendente tem data_pagamento NULL',
  pagamentos.filter((p) => p.status === 'pendente' && p.data_pagamento).map((p) => ({ id: p.id, dp: p.data_pagamento })),
)
// 3. data_prevista sempre preenchida (exceto talvez comissao_integral)
check(
  'data_prevista preenchida',
  pagamentos.filter((p) => !p.data_prevista && p.tipo !== 'comissao_integral').map((p) => ({ id: p.id, tipo: p.tipo })),
)
// 4. nenhum ano absurdo em datas (bug 2202)
const anoAbsurdo = (d) => d && (Number(d.slice(0, 4)) < 2020 || Number(d.slice(0, 4)) > 2035)
check(
  'sem ano absurdo (<2020 ou >2035) em data_pagamento',
  pagamentos.filter((p) => anoAbsurdo(p.data_pagamento)).map((p) => ({ id: p.id, dp: p.data_pagamento })),
)
check(
  'sem ano absurdo em data_prevista',
  pagamentos.filter((p) => anoAbsurdo(p.data_prevista)).map((p) => ({ id: p.id, dp: p.data_prevista })),
)
// 5. valor > 0
check('valor > 0', pagamentos.filter((p) => !(Number(p.valor) > 0)).map((p) => ({ id: p.id, valor: p.valor })))
// 6. comissao_gerada >= 0
check('comissao_gerada >= 0', pagamentos.filter((p) => Number(p.comissao_gerada) < 0).map((p) => ({ id: p.id, c: p.comissao_gerada })))

console.log('\n=== Distribuicao de status ===')
const dist = {}
for (const p of pagamentos) dist[p.status] = (dist[p.status] || 0) + 1
for (const [s, n] of Object.entries(dist)) {
  console.log(`  ${s}: ${n} (${((100 * n) / pagamentos.length).toFixed(1)}%)`)
}

console.log('\n=== Spot-check: vendas que tiveram parcelas canceladas hoje ===')
// Fernanda c287, Caroline c340, Carlos c173, Josapha c219, contrato 228
const contratosMexidos = ['287', '340', '173', '219', '228']
for (const cid of contratosMexidos) {
  const { data: vs } = await supa.from('vendas').select('id, unidade, valor_pro_soluto').eq('sienge_contract_id', cid)
  const v = vs?.[0]
  if (!v) { console.log(`  contrato ${cid}: venda nao encontrada`); continue }
  const ps = pagamentos.filter((p) => p.venda_id === v.id)
  const pagos = ps.filter((p) => p.status === 'pago')
  const pend = ps.filter((p) => p.status === 'pendente')
  const canc = ps.filter((p) => p.status === 'cancelado')
  // soma como o dashboard faz: ignora cancelados
  const comissaoAtiva = ps.filter((p) => p.status !== 'cancelado').reduce((s, p) => s + (Number(p.comissao_gerada) || 0), 0)
  const comissaoPaga = pagos.reduce((s, p) => s + (Number(p.comissao_gerada) || 0), 0)
  const proSolutoAtivo = ps.filter((p) => p.status !== 'cancelado').reduce((s, p) => s + (Number(p.valor) || 0), 0)
  console.log(
    `  contrato ${cid} (${v.unidade}): ${ps.length} parcelas [${pagos.length} pago / ${pend.length} pend / ${canc.length} canc] | ` +
      `comissao ativa=R$ ${comissaoAtiva.toFixed(2)} (paga R$ ${comissaoPaga.toFixed(2)}) | pro-soluto ativo=R$ ${proSolutoAtivo.toFixed(2)} (venda diz ${v.valor_pro_soluto})`,
  )
}

console.log('\n=== Spot-check: venda 390 do CLAUDIO (a correta) vs 236 (duplicata) ===')
for (const cid of ['390', '236']) {
  const { data: vs } = await supa.from('vendas').select('id, unidade, valor_pro_soluto, status').eq('sienge_contract_id', cid)
  const v = vs?.[0]
  if (!v) { console.log(`  contrato ${cid}: nao encontrada`); continue }
  const ps = pagamentos.filter((p) => p.venda_id === v.id)
  const pagos = ps.filter((p) => p.status === 'pago')
  const comissaoPaga = pagos.reduce((s, p) => s + (Number(p.comissao_gerada) || 0), 0)
  console.log(`  contrato ${cid} (${v.unidade}): ${ps.length} parcelas, ${pagos.length} pagas, comissao paga R$ ${comissaoPaga.toFixed(2)}`)
}

console.log('')
if (falhas === 0) {
  console.log('✅ TODAS as invariantes OK — dados consistentes pro dashboard.')
} else {
  console.log(`❌ ${falhas} violacoes encontradas — investigar antes de confiar nos relatorios.`)
  process.exit(1)
}
