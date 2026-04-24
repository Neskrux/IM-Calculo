// Etapa 5A — corrige data_pagamento de pagamentos ja marcados 'pago'
// que divergem do Sienge em >1 dia.
// ver .claude/rules/sincronizacao-sienge.md + migration 020
//
// Pre-requisito: migration 020 aplicada (libera UPDATE de data_pagamento em pago).
//
// Input:  docs/backfill-drift-data-pagamento.json
// Output: docs/execucao-drift-data-pagamento.json
//
// Dedup: se o mesmo pagamento_id aparece N vezes (multiplas stage rows do
// Sienge apontando pra mesma linha local), pega a data MAIS RECENTE —
// representa o ultimo receipt conhecido do Sienge.

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

const raw = JSON.parse(readFileSync('docs/backfill-drift-data-pagamento.json', 'utf8'))
const rows = raw.rows || []

// Dedup por pagamento_id — mantem data mais recente
const best = new Map()
for (const r of rows) {
  const existing = best.get(r.pagamento_id)
  if (!existing || r.data_pagamento_sienge > existing.data_pagamento_sienge) {
    best.set(r.pagamento_id, r)
  }
}
console.log(`Input rows: ${rows.length}`)
console.log(`Dedup por pagamento_id: ${best.size}`)

// Agrupar por data_pagamento_sienge pra batch PATCH
const byDate = new Map()
for (const r of best.values()) {
  if (!byDate.has(r.data_pagamento_sienge)) byDate.set(r.data_pagamento_sienge, [])
  byDate.get(r.data_pagamento_sienge).push(r.pagamento_id)
}
console.log(`Datas distintas: ${byDate.size}\n`)

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    input: 'docs/backfill-drift-data-pagamento.json',
    inputRows: rows.length,
    uniqueIds: best.size,
    datasDistintas: byDate.size,
  },
  counts: {
    updated: 0,
    failed_http: 0,
    retornou_vazio: 0,
  },
  falhas: [],
}

const dates = [...byDate.keys()]
const CONC = 8
let processed = 0
for (let i = 0; i < dates.length; i += CONC) {
  const batch = dates.slice(i, i + CONC)
  const results = await Promise.all(batch.map(async dataPagamento => {
    const ids = byDate.get(dataPagamento)
    const UPD_CHUNK = 150
    let totalUpdated = 0
    for (let j = 0; j < ids.length; j += UPD_CHUNK) {
      const slice = ids.slice(j, j + UPD_CHUNK)
      // filtro: status=eq.pago (so mexe em quem ja esta pago; trigger 020
      // libera o UPDATE mas o filtro garante que nao vamos mexer num caso
      // de race condition onde a linha virou pendente)
      const url = `${SUPABASE_URL}/rest/v1/pagamentos_prosoluto?id=in.(${slice.join(',')})&status=eq.pago`
      const body = JSON.stringify({ data_pagamento: dataPagamento, updated_at: new Date().toISOString() })
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
    return [dataPagamento, ids.length, totalUpdated]
  }))
  for (const [d, alvo, updated] of results) {
    report.counts.updated += updated
  }
  processed += batch.length
  process.stdout.write(`  ${processed}/${dates.length} datas | updated=${report.counts.updated}\r`)
}
process.stdout.write('\n')

writeFileSync('docs/execucao-drift-data-pagamento.json', JSON.stringify(report, null, 2))

console.log('')
console.log('================================================================')
console.log('ETAPA 5A — correcao drift data_pagamento concluida')
console.log('================================================================')
console.log(`  input rows:        ${report.meta.inputRows}`)
console.log(`  unique IDs:        ${report.meta.uniqueIds}`)
console.log(`  updated:           ${report.counts.updated}`)
console.log(`  retornou vazio:    ${report.counts.retornou_vazio}`)
console.log(`  falhas HTTP:       ${report.counts.failed_http}`)
console.log('')
console.log(`Output: docs/execucao-drift-data-pagamento.json`)
