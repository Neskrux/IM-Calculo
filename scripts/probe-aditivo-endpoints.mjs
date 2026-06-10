// Probe MACRO (1 request por endpoint) — testa autorização + formato antes de gastar a quota do dia.
// (1) sales-contracts fresh → confirma acesso + se traz containsRemadeInstallments atualizado.
// (2) remade-installments → testa se o módulo está habilitado (403?) e os campos do reparcelamento.
// READ-ONLY à API Sienge (não toca banco). ver .claude/rules/sincronizacao-sienge.md
import { readFileSync } from 'node:fs'

const env = {}
for (const l of readFileSync('.env', 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}
const AUTH = 'Basic ' + Buffer.from(`${env.SIENGE_USERNAME}:${env.SIENGE_PASSWORD}`).toString('base64')
const BASE = `https://api.sienge.com.br/${env.SIENGE_SUBDOMAIN}/public/api/v1`

async function probe(label, path) {
  const url = `${BASE}${path}`
  const t0 = Date.now()
  let res, body
  try {
    res = await fetch(url, { headers: { Authorization: AUTH, Accept: 'application/json' } })
    const txt = await res.text()
    try { body = JSON.parse(txt) } catch { body = txt.slice(0, 400) }
  } catch (e) { console.log(`\n=== ${label} ===\nGET ${url}\nNETERR ${String(e).slice(0, 180)}`); return }
  const rl = res.headers.get('X-Rate-Limit-Remaining') || res.headers.get('RateLimit-Remaining') || '?'
  console.log(`\n=== ${label} ===`)
  console.log(`GET ${url}`)
  console.log(`status=${res.status}  ${Date.now() - t0}ms  rateLimit=${rl}`)
  const rows = body?.results || body?.data
  if (Array.isArray(rows)) {
    console.log(`results=${rows.length}  keys[0]=${rows[0] ? Object.keys(rows[0]).join(',') : '(vazio)'}`)
    if (rows[0]) console.log('SAMPLE COMPLETO:\n', JSON.stringify(rows[0], null, 2))
  } else {
    console.log('body:', JSON.stringify(body, null, 2).slice(0, 1500))
  }
}

// remade-installments — agora liberado? campos completos do reparcelamento
await probe('remade-installments (1 item)', `/remade-installments?limit=1`)
