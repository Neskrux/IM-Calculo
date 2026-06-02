// Auditoria global: pra cada sales-contract de FIGUEIRA no Sienge, compara o
// broker (corretor) do Sienge com o corretor_id da venda no banco local.
// Reporta divergencias — onde o sync trouxe corretor errado ou ficou
// desatualizado.
//
// ver .claude/rules/sincronizacao-sienge.md
//
// Estrategia:
//  1. Paginar /sales-contracts?enterpriseId=2104 — pega broker.id de cada
//  2. Buscar vendas locais com sienge_contract_id naqueles contratos
//  3. Mapear sienge_broker_id (Sienge) -> corretor_id (banco) via usuarios
//  4. Reportar onde diverge

import { siengeGet, extractRows } from './_sienge-http.mjs'
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
const FIGUEIRA_ENTERPRISE_ID = 2104

// 1. todos os sales-contracts de FIGUEIRA no Sienge — captura broker main
console.log('[1/4] Paginando /sales-contracts?enterpriseId=2104 ...')
const contratosSienge = new Map() // contract_id -> { brokerId, brokerName, contractNumber, value, date }
let offset = 0
const limit = 200
while (true) {
  const resp = await siengeGet({
    path: '/sales-contracts',
    query: { enterpriseId: FIGUEIRA_ENTERPRISE_ID, limit, offset },
  })
  const rows = extractRows(resp.data)
  if (rows.length === 0) break
  for (const r of rows) {
    const brokers = Array.isArray(r.brokers) ? r.brokers : []
    const main = brokers.find(b => b.main) ?? brokers[0]
    contratosSienge.set(String(r.id), {
      brokerId: main?.id != null ? Number(main.id) : null,
      brokerName: main?.name ?? null,
      contractNumber: r.number,
      value: r.value ?? r.totalSellingValue,
      date: r.contractDate ?? r.date,
    })
  }
  if (rows.length < limit) break
  offset += limit
}
console.log(`  total contratos Sienge: ${contratosSienge.size}`)

// 2. vendas locais com sienge_contract_id
console.log('\n[2/4] Vendas locais com sienge_contract_id (excluido!=true) ...')
const { data: vendasLocais } = await supa
  .from('vendas')
  .select('id, sienge_contract_id, corretor_id, corretor_id_origem, excluido, data_venda')
  .or('excluido.eq.false,excluido.is.null')
  .not('sienge_contract_id', 'is', null)
console.log(`  total vendas locais com sienge_contract_id: ${vendasLocais.length}`)

// 3. mapear sienge_broker_id (Sienge) -> usuarios.id (banco)
console.log('\n[3/4] Mapeando corretores (usuarios.sienge_broker_id) ...')
const { data: corretores } = await supa
  .from('usuarios')
  .select('id, nome, email, sienge_broker_id, ativo')
  .eq('tipo', 'corretor')
  .not('sienge_broker_id', 'is', null)
const corBySienge = new Map() // sienge_broker_id (string) -> { id, nome, email, ativo }
for (const c of corretores) corBySienge.set(String(c.sienge_broker_id), c)
const corById = new Map() // usuarios.id -> dados
for (const c of corretores) corById.set(c.id, c)
console.log(`  corretores cadastrados com sienge_broker_id: ${corretores.length}`)

// 4. cruzar e reportar
console.log('\n[4/4] Cruzando ...\n')
const divergencias = []
const semCorretorLocal = []
const brokerSiengeSemCadastro = []
const semBrokerSienge = []

for (const v of vendasLocais) {
  const sienge = contratosSienge.get(String(v.sienge_contract_id))
  if (!sienge) continue // contrato nao apareceu na pagina /sales-contracts (raro)
  if (sienge.brokerId == null) { semBrokerSienge.push({ v, sienge }); continue }
  const corretorEsperado = corBySienge.get(String(sienge.brokerId))
  if (!corretorEsperado) {
    brokerSiengeSemCadastro.push({ v, sienge })
    continue
  }
  if (!v.corretor_id) { semCorretorLocal.push({ v, sienge, corretorEsperado }); continue }
  if (v.corretor_id !== corretorEsperado.id) {
    const corAtual = corById.get(v.corretor_id)
    divergencias.push({
      v, sienge, corretorEsperado,
      corAtual: corAtual ?? { id: v.corretor_id, nome: '(nao cadastrado)' },
    })
  }
}

console.log(`=== DIVERGENCIAS (banco != Sienge) ===`)
console.log(`total: ${divergencias.length}`)
for (const d of divergencias) {
  console.log(`\n  contract ${d.v.sienge_contract_id} (num=${d.sienge.contractNumber}, ${d.sienge.date}, R$ ${d.sienge.value})`)
  console.log(`    Sienge:  ${d.corretorEsperado.nome} (broker=${d.sienge.brokerId})`)
  console.log(`    Banco:   ${d.corAtual.nome} (id=${d.v.corretor_id})  origem=${d.v.corretor_id_origem}`)
  console.log(`    venda_id: ${d.v.id}`)
}

console.log(`\n=== VENDAS SEM corretor_id NO BANCO (mas Sienge tem broker) ===`)
console.log(`total: ${semCorretorLocal.length}`)
for (const x of semCorretorLocal.slice(0, 10)) {
  console.log(`  contract ${x.v.sienge_contract_id} -> esperado ${x.corretorEsperado.nome} (venda_id=${x.v.id})`)
}
if (semCorretorLocal.length > 10) console.log(`  ... + ${semCorretorLocal.length - 10}`)

console.log(`\n=== BROKER NO SIENGE QUE NAO TEM CADASTRO LOCAL EM usuarios ===`)
console.log(`total: ${brokerSiengeSemCadastro.length}`)
const brokersNaoCadastrados = new Map()
for (const x of brokerSiengeSemCadastro) {
  const k = String(x.sienge.brokerId)
  if (!brokersNaoCadastrados.has(k)) brokersNaoCadastrados.set(k, { brokerId: x.sienge.brokerId, brokerName: x.sienge.brokerName, count: 0 })
  brokersNaoCadastrados.get(k).count++
}
for (const [, info] of brokersNaoCadastrados) {
  console.log(`  broker ${info.brokerId} (${info.brokerName ?? '?'}) — ${info.count} contrato(s)`)
}

console.log(`\n=== CONTRATOS SIENGE SEM broker (main) ===`)
console.log(`total: ${semBrokerSienge.length}`)
for (const x of semBrokerSienge.slice(0, 10)) {
  console.log(`  contract ${x.v.sienge_contract_id} (num=${x.sienge.contractNumber}, R$ ${x.sienge.value})`)
}
