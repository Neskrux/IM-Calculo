// Etapa C.1 — probe do endpoint /accounts-receivable/receivable-bills/{billId}/commissions
// ver .claude/rules/sincronizacao-sienge.md + .claude/rules/rodadas-b.md
//
// Objetivo: validar shape da resposta de commissions antes de gastar quota
// nos 13 contratos. Usa contrato 75 (RICARDO JOSÉ GIRARD, billId=11).
//
// Quota: 1 chamada da REST v1 (limite 100/dia).
//
// Output: docs/C1-probe-commissions-75.json (resposta crua, regra de quota dura)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

function loadEnv() {
  const raw = readFileSync('.env', 'utf8')
  const env = {}
  for (const line of raw.split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue
    const idx = line.indexOf('=')
    const k = line.slice(0, idx).trim()
    const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    env[k] = v
  }
  return { ...process.env, ...env }
}

const env = loadEnv()
const AUTH = 'Basic ' + Buffer.from(`${env.SIENGE_USERNAME}:${env.SIENGE_PASSWORD}`).toString('base64')
const REST_BASE = `https://api.sienge.com.br/${env.SIENGE_SUBDOMAIN}/public/api/v1`
const BILL_ID = 11
const TIMEOUT_MS = 30_000

mkdirSync('docs', { recursive: true })

async function rawGet(path) {
  const url = `${REST_BASE}${path}`
  const t0 = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: AUTH, Accept: 'application/json' },
      signal: ctrl.signal,
    })
    const elapsedMs = Date.now() - t0
    const bodyText = await res.text()
    return {
      ok: res.ok,
      status: res.status,
      elapsedMs,
      headers: Object.fromEntries(res.headers.entries()),
      bodyText,
    }
  } finally {
    clearTimeout(timer)
  }
}

const SIENGE_CONTRACT_ID = 75
const probes = []

const tentativas = [
  `/sales-contracts/${SIENGE_CONTRACT_ID}`,
  `/accounts-receivable/receivable-bills/${BILL_ID}/installments`,
  `/sales-contracts?contractId=${SIENGE_CONTRACT_ID}`,
  `/sales-contracts/${SIENGE_CONTRACT_ID}/sale-conditions`,
  `/sales-contracts/${SIENGE_CONTRACT_ID}/sales-team`,
  `/commissions/${SIENGE_CONTRACT_ID}`,
]

for (const path of tentativas) {
  console.log(`[C.1] tentando GET ${path}`)
  const r = await rawGet(path)
  console.log(`  -> HTTP ${r.status} em ${r.elapsedMs}ms`)
  probes.push({ path, ...r, bodyPreview: r.bodyText.slice(0, 400) })
  if (r.ok) break // primeiro sucesso e o vencedor
}

const probe1 = probes[probes.length - 1]

// Salva raw ANTES de parsear (regra de memoria sobre quota dura)
writeFileSync('docs/C1-probe-commissions-75.json', JSON.stringify({
  meta: {
    geradoEm: new Date().toISOString(),
    spec_ref: '.claude/rules/sincronizacao-sienge.md',
    script: 'C1-probe-commissions-sienge',
    bill_id: BILL_ID,
    sienge_contract_id: SIENGE_CONTRACT_ID,
    venda_referencia: 'contrato 75 / sienge_contract_id 75 / RICARDO JOSE GIRARD'
  },
  tentativas: probes.map(p => ({
    path: p.path, status: p.status, elapsedMs: p.elapsedMs,
    body_completo: p.ok ? p.bodyText : undefined,
    body_preview: !p.ok ? p.bodyPreview : undefined
  })),
}, null, 2))

console.log('\n[C.1] Resposta crua salva em docs/C1-probe-commissions-75.json')
console.log(`Status: ${probe1.status} ${probe1.ok ? '(OK)' : '(FAIL)'}`)
if (probe1.ok) {
  let parsed
  try { parsed = JSON.parse(probe1.bodyText) } catch (_) {}
  if (parsed) {
    console.log('Shape (top-level keys):', Object.keys(parsed))
    if (Array.isArray(parsed)) {
      console.log(`Array com ${parsed.length} entries`)
      if (parsed.length) console.log('Primeiro entry:', JSON.stringify(parsed[0], null, 2))
    } else if (parsed.results) {
      console.log(`results[].length = ${parsed.results.length}`)
      if (parsed.results.length) console.log('Primeiro result:', JSON.stringify(parsed.results[0], null, 2))
    }
  }
} else {
  console.log('Body:', probe1.bodyText.slice(0, 500))
}
