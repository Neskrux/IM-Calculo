// Investiga a venda excluida 9760cf8a-5826-4b18-b233-780551ec5586,
// que tem 57 pagamentos remanescentes (3 pagos — viola spec).
//
// ver .claude/rules/sincronizacao-sienge.md

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

const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const VENDA_ID = '9760cf8a-5826-4b18-b233-780551ec5586'

// 1. dados da venda excluida
console.log('=== 1. VENDA EXCLUIDA ===')
const { data: venda, error: errV } = await supa
  .from('vendas')
  .select('*')
  .eq('id', VENDA_ID)
  .maybeSingle()
if (errV) { console.error(errV); process.exit(1) }
if (!venda) { console.error('venda nao encontrada'); process.exit(1) }

const camposChave = [
  'id', 'sienge_contract_id', 'numero_contrato', 'corretor_id', 'cliente_id',
  'empreendimento_id', 'bloco', 'andar', 'unidade',
  'valor_venda', 'valor_pro_soluto', 'percentual_total', 'fator_comissao',
  'tipo_corretor', 'data_venda', 'data_entrada',
  'excluido', 'created_at', 'updated_at',
  'corretor_id_origem', 'cliente_id_origem',
]
for (const c of camposChave) {
  if (venda[c] !== undefined) console.log(`  ${c}: ${JSON.stringify(venda[c])}`)
}

// 2. corretor, cliente, empreendimento
console.log('\n=== 2. RELACIONAMENTOS ===')
if (venda.corretor_id) {
  const { data: corr } = await supa.from('usuarios').select('id, nome, email, tipo_corretor').eq('id', venda.corretor_id).maybeSingle()
  console.log('  corretor:', corr ? `${corr.nome} (${corr.email}, ${corr.tipo_corretor || '-'})` : 'NAO ENCONTRADO')
}
if (venda.cliente_id) {
  const { data: cli } = await supa.from('clientes').select('id, nome_completo, cpf, cnpj').eq('id', venda.cliente_id).maybeSingle()
  console.log('  cliente:', cli ? `${cli.nome_completo} (cpf=${cli.cpf || '-'}, cnpj=${cli.cnpj || '-'})` : 'NAO ENCONTRADO')
}
if (venda.empreendimento_id) {
  const { data: emp } = await supa.from('empreendimentos').select('id, nome').eq('id', venda.empreendimento_id).maybeSingle()
  console.log('  empreendimento:', emp ? emp.nome : 'NAO ENCONTRADO')
}

// 3. pagamentos da venda — distribuicao
console.log('\n=== 3. PAGAMENTOS DESTA VENDA ===')
const { data: pags } = await supa
  .from('pagamentos_prosoluto')
  .select('id, numero_parcela, tipo, status, valor, comissao_gerada, data_prevista, data_pagamento, fator_comissao_aplicado, percentual_comissao_total')
  .eq('venda_id', VENDA_ID)
  .order('data_prevista', { ascending: true })
console.log(`  total: ${pags.length}`)
const porStatus = pags.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc }, {})
console.log('  por status:', porStatus)
const porTipo = pags.reduce((acc, p) => { acc[p.tipo] = (acc[p.tipo] || 0) + 1; return acc }, {})
console.log('  por tipo:', porTipo)
const somaValor = pags.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0)
const somaComissao = pags.reduce((s, p) => s + (parseFloat(p.comissao_gerada) || 0), 0)
const somaPagoComissao = pags.filter(p => p.status === 'pago').reduce((s, p) => s + (parseFloat(p.comissao_gerada) || 0), 0)
console.log(`  soma valor pagamentos: R$ ${somaValor.toFixed(2)}`)
console.log(`  soma comissao gerada total: R$ ${somaComissao.toFixed(2)}`)
console.log(`  soma comissao ja paga: R$ ${somaPagoComissao.toFixed(2)}`)

// detalhe dos pagos
const pagos = pags.filter(p => p.status === 'pago')
console.log(`\n  ${pagos.length} pagamento(s) com status='pago':`)
for (const p of pagos) {
  console.log(`    #${p.numero_parcela} ${p.tipo} valor=${p.valor} comissao=${p.comissao_gerada} data_prevista=${p.data_prevista} data_pagamento=${p.data_pagamento}`)
}

// 4. duplicata? mesmo sienge_contract_id ou mesmo cliente+empreendimento
console.log('\n=== 4. POSSIVEIS DUPLICATAS ===')
if (venda.sienge_contract_id) {
  const { data: porContract } = await supa
    .from('vendas')
    .select('id, excluido, created_at, sienge_contract_id, corretor_id, cliente_id')
    .eq('sienge_contract_id', venda.sienge_contract_id)
  console.log(`  vendas com mesmo sienge_contract_id (${venda.sienge_contract_id}): ${porContract.length}`)
  for (const v of porContract) {
    console.log(`    ${v.id} excluido=${v.excluido} created=${v.created_at}`)
  }
}
if (venda.cliente_id && venda.empreendimento_id) {
  const { data: porClienteEmp } = await supa
    .from('vendas')
    .select('id, excluido, created_at, sienge_contract_id, bloco, andar, unidade')
    .eq('cliente_id', venda.cliente_id)
    .eq('empreendimento_id', venda.empreendimento_id)
  console.log(`\n  vendas do mesmo cliente+empreendimento: ${porClienteEmp.length}`)
  for (const v of porClienteEmp) {
    console.log(`    ${v.id} excluido=${v.excluido} unidade=${v.bloco}/${v.andar}/${v.unidade} created=${v.created_at} contract=${v.sienge_contract_id}`)
  }
}

// 5. comissoes_venda (snapshot por venda)
console.log('\n=== 5. SNAPSHOT comissoes_venda ===')
const { data: snaps } = await supa
  .from('comissoes_venda')
  .select('*')
  .eq('venda_id', VENDA_ID)
console.log(`  registros: ${snaps?.length || 0}`)
for (const s of snaps || []) {
  console.log(`    cargo=${s.cargo || s.nome_cargo || '-'} percentual=${s.percentual} valor=${s.valor_comissao || s.valor || '-'}`)
}
