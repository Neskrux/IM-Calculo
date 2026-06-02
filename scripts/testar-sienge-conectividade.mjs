// Probe minimo de conectividade Sienge — UMA chamada bulk-data/income com
// range curto. Usado pra verificar se o rate-limit / circuit-breaker do
// Sienge ja expirou antes de disparar o cron.
//
// SIENGE_NO_STALE=1 forcado: sem isso, cache vencido mascararia um bloqueio
// ativo. noCache:true: ignora cache de leitura, bate na API de verdade.
//
// ver .claude/rules/sincronizacao-sienge.md

import { siengeGet, extractRows } from './_sienge-http.mjs'

process.env.SIENGE_NO_STALE = '1'

const t0 = Date.now()
try {
  const res = await siengeGet({
    path: '/bulk-data/v1/income',
    query: { startDate: '2026-05-01', endDate: '2026-05-02', selectionType: 'D', companyId: 5 },
    noCache: true,
  })
  const rows = extractRows(res.data)
  console.log(`OK — Sienge respondeu HTTP ${res.status} em ${Date.now() - t0}ms (${rows.length} linhas no range probe)`)
  console.log('Rate-limit/circuit-breaker: EXPIRADO. Seguro disparar o cron.')
  process.exit(0)
} catch (e) {
  const msg = String(e)
  const m429 = msg.match(/429 after (\d+)s/)
  if (m429) {
    console.error(`BLOQUEADO — Sienge 429, retry-after=${m429[1]}s (~${Math.round(m429[1] / 3600)}h)`)
    console.error('NAO disparar o cron ainda — cada tentativa renova o bloqueio.')
  } else {
    console.error(`FALHOU — ${msg.slice(0, 300)}`)
  }
  process.exit(1)
}
