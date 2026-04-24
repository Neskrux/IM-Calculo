// Etapa 4 — executa backfill pendente->pago via REST PATCH.
// ver .claude/rules/sincronizacao-sienge.md
//
// Input:  docs/backfill-would-update.json (gerado pelo DRY RUN)
// Output: docs/execucao-backfill-income.json (metricas por data + resumo)
//
// Estrategia: agrupa por data_pagamento (219 datas distintas) e faz 1 PATCH
// por data usando id=in.(...) — 1 call da API pra N rows com mesma data.
//
// Filtro do WHERE: status=eq.pendente (trigger 017 bloqueia pago de qualquer
// jeito; filtro explicito evita mexer em casos de race).
//
// Concorrencia: 8 PATCHs em paralelo (respeitando limite do PostgREST).

import { readFileSync, writeFileSync } from 'node:fs'

const SUPABASE_URL = 'https://jdkkusrxullttyeakwib.supabase.co'
const env = readFileSync('.env', 'utf8')
const KEY = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim()

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

const raw = JSON.parse(readFileSync('docs/backfill-would-update.json', 'utf8'))
const rows = raw.rows || []

// agrupar por data_pagamento
const byDate = new Map()
for (const r of rows) {
  if (!byDate.has(r.data_pagamento)) byDate.set(r.data_pagamento, [])
  byDate.get(r.data_pagamento).push(r.pagamento_id)
}
console.log(`Total rows: ${rows.length}`)
console.log(`Datas distintas: ${byDate.size}`)
console.log(`Chunks IN() = 1 por data. Concorrencia: 8.\n`)

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    input: 'docs/backfill-would-update.json',
    totalAlvo: rows.length,
    datasDistintas: byDate.size,
  },
  counts: {
    updated: 0,
    ids_alvo: rows.length,
    failed_http: 0,
    retornou_vazio: 0,
  },
  porData: {},
  falhas: [],
}

async function patchOneDate(dataPagamento, ids) {
  // split em chunks de 200 IDs (URL pode estourar com in.(...))
  const UPD_CHUNK = 150
  let totalUpdated = 0
  for (let i = 0; i < ids.length; i += UPD_CHUNK) {
    const slice = ids.slice(i, i + UPD_CHUNK)
    const url = `${SUPABASE_URL}/rest/v1/pagamentos_prosoluto?id=in.(${slice.join(',')})&status=eq.pendente`
    const body = JSON.stringify({
      status: 'pago',
      data_pagamento: dataPagamento,
      updated_at: new Date().toISOString(),
    })
    const r = await fetch(url, { method: 'PATCH', headers: H, body })
    if (!r.ok) {
      const txt = await r.text()
      report.falhas.push({ data: dataPagamento, httpStatus: r.status, body: txt.slice(0, 300), ids_sample: slice.slice(0, 3) })
      report.counts.failed_http++
      continue
    }
    const arr = await r.json()
    totalUpdated += arr.length
    if (arr.length === 0) report.counts.retornou_vazio++
  }
  return totalUpdated
}

const dates = [...byDate.keys()]
const CONC = 8
let processed = 0
for (let i = 0; i < dates.length; i += CONC) {
  const batch = dates.slice(i, i + CONC)
  const results = await Promise.all(batch.map(async d => {
    const ids = byDate.get(d)
    const updated = await patchOneDate(d, ids)
    return [d, ids.length, updated]
  }))
  for (const [d, alvo, updated] of results) {
    report.counts.updated += updated
    report.porData[d] = { alvo, updated }
  }
  processed += batch.length
  process.stdout.write(`  ${processed}/${dates.length} datas | updated=${report.counts.updated}\r`)
}
process.stdout.write('\n')

writeFileSync('docs/execucao-backfill-income.json', JSON.stringify(report, null, 2))

console.log('')
console.log('================================================================')
console.log('ETAPA 4 — execucao concluida')
console.log('================================================================')
console.log(`  ids alvo:         ${report.counts.ids_alvo}`)
console.log(`  updated:          ${report.counts.updated}`)
console.log(`  datas com 0 hits: ${report.counts.retornou_vazio}`)
console.log(`  falhas HTTP:      ${report.counts.failed_http}`)
console.log('')
console.log(`Output: docs/execucao-backfill-income.json`)
