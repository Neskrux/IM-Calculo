// Etapa C.1b — testa GET /sales-contracts/{id} pra varios contratos
// pra ver se linkedCommissions tem dado em algum.
// ver .claude/rules/sincronizacao-sienge.md
//
// Quota: 13 chamadas REST v1.

import { readFileSync, writeFileSync } from 'node:fs'

function loadEnv() {
  const raw = readFileSync('.env', 'utf8')
  const env = {}
  for (const line of raw.split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue
    const idx = line.indexOf('=')
    env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
  }
  return { ...process.env, ...env }
}

const env = loadEnv()
const AUTH = 'Basic ' + Buffer.from(`${env.SIENGE_USERNAME}:${env.SIENGE_PASSWORD}`).toString('base64')
const REST_BASE = `https://api.sienge.com.br/${env.SIENGE_SUBDOMAIN}/public/api/v1`

const CONTRATOS = [75, 79, 161, 174, 176, 213, 236, 294, 390, 411, 433, 434, 435]

const results = []
for (const id of CONTRATOS) {
  try {
    const r = await fetch(`${REST_BASE}/sales-contracts/${id}`, {
      headers: { Authorization: AUTH, Accept: 'application/json' }
    })
    const txt = await r.text()
    let parsed
    try { parsed = JSON.parse(txt) } catch (_) { parsed = null }
    const lc = parsed?.linkedCommissions
    results.push({
      sienge_contract_id: id,
      status: r.status,
      has_linkedCommissions: lc !== null && lc !== undefined,
      linkedCommissions: lc,
      cliente: parsed?.salesContractCustomers?.[0]?.name,
      raw_top_keys: parsed ? Object.keys(parsed) : null
    })
    console.log(`${id}: HTTP ${r.status}, linkedCommissions=${JSON.stringify(lc)?.slice(0,80)}`)
  } catch (e) {
    results.push({ sienge_contract_id: id, error: e.message })
    console.log(`${id}: ERROR ${e.message}`)
  }
}

writeFileSync('docs/C1b-probe-multi-contracts.json', JSON.stringify({
  meta: { geradoEm: new Date().toISOString(), spec_ref: '.claude/rules/sincronizacao-sienge.md', total_contratos: CONTRATOS.length },
  results
}, null, 2))

const com_dados = results.filter(r => r.has_linkedCommissions)
console.log(`\nTotal: ${results.length}. Com linkedCommissions populado: ${com_dados.length}`)
