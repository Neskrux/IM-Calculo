// Pergunta direto ao Sienge: a Carolina (brokerId=129) tem vendas em qualquer
// empreendimento da IM, ou só nas 4 de Figueira que estao no banco local?
//
// Atravessa todos os empreendimentos da tabela empreendimentos e busca
// sales-contracts neles, filtrando os que tem broker 129 no sales-team.

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

// pega lista de empreendimentos da IM
const { data: emps } = await supa.from('empreendimentos').select('id, nome, sienge_enterprise_id')
console.log(`empreendimentos cadastrados: ${emps?.length}`)
const empsComSiengeId = (emps || []).filter(e => e.sienge_enterprise_id)
console.log(`com sienge_enterprise_id: ${empsComSiengeId.length}`)
for (const e of empsComSiengeId) {
  console.log(`  ${e.sienge_enterprise_id}  ${e.nome}`)
}

const BROKER_ID = 129
const todasContratos = []

for (const emp of empsComSiengeId) {
  console.log(`\n--- ${emp.nome} (enterpriseId=${emp.sienge_enterprise_id}) ---`)
  let offset = 0
  const limit = 100
  let totalEmp = 0
  let comBroker = 0
  while (true) {
    let resp
    try {
      resp = await siengeGet({
        path: '/sales-contracts',
        query: { enterpriseId: emp.sienge_enterprise_id, limit, offset },
      })
    } catch (err) {
      console.log(`  erro: ${err.message.slice(0, 200)}`)
      break
    }
    const rows = extractRows(resp.data)
    if (rows.length === 0) break
    totalEmp += rows.length
    for (const r of rows) {
      // campo correto no payload Sienge eh "brokers" (ver normalize/sales-contracts.ts:37)
      const brokers = Array.isArray(r.brokers) ? r.brokers : []
      const hit = brokers.find(b => Number(b.id) === BROKER_ID)
      if (hit) {
        comBroker++
        todasContratos.push({
          empreendimento: emp.nome,
          contractId: r.id,
          contractNumber: r.number,
          unit: r.units?.[0]?.name || r.unitName || '-',
          value: r.value || r.totalSellingValue,
          date: r.contractDate || r.date,
          brokerInfo: hit,
        })
      }
    }
    if (rows.length < limit) break
    offset += limit
  }
  console.log(`  contratos no empreendimento: ${totalEmp}, com Carolina (129): ${comBroker}`)
}

console.log(`\n=== TOTAL DE CONTRATOS DA CAROLINA NO SIENGE ===`)
console.log(`${todasContratos.length} contratos`)
for (const c of todasContratos) {
  console.log(`  ${c.contractId} | ${c.empreendimento} | num=${c.contractNumber} | unid ${c.unit} | ${c.date} | R$ ${c.value}`)
}
