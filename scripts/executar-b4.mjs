// Etapa 5B.4 — resolver colisoes Sienge (re-parcelamento na fonte).
// ver .claude/rules/sincronizacao-sienge.md
//
// Heuristica (validada com usuaria 2026-04-24):
//   Para cada chave (billId, tipo, seq) com 2+ linhas no bulk D Sienge,
//   eleger a linha com MAIOR dueDate como "serie vigente".
//   Tiebreaker (nao ocorreu nos dados): installmentId maior.
//
// Inclui pendentes E pagos (Sienge e fonte da verdade pra data_prevista
// tambem em linhas auditadas — data_pagamento fica intocada).
//
// Input:  docs/plano-b4.json (178 rows a atualizar)
// Output: docs/execucao-b4.json

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

const plano = JSON.parse(readFileSync('docs/plano-b4.json', 'utf8'))
const rows = plano.rows
console.log(`Input: ${rows.length} rows a atualizar`)
console.log(`  por status: ${JSON.stringify(plano.meta.porStatus)}`)
console.log(`  por tipo:   ${JSON.stringify(plano.meta.porTipo)}\n`)

// Agrupar por data_prevista_nova -> 1 PATCH por data
const byDate = new Map()
for (const r of rows) {
  if (!byDate.has(r.data_prevista_nova)) byDate.set(r.data_prevista_nova, [])
  byDate.get(r.data_prevista_nova).push(r)
}
console.log(`Datas distintas: ${byDate.size}\n`)

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    input: 'docs/plano-b4.json',
    heuristica: plano.meta.heuristica,
    inputRows: rows.length,
    porStatus: plano.meta.porStatus,
    porTipo: plano.meta.porTipo,
  },
  counts: {
    updated_pendente: 0,
    updated_pago: 0,
    failed_http: 0,
    skipado_cancelado: 0,
    retornou_vazio: 0,
  },
  falhas: [],
  sampleUpdates: [],
}

const dates = [...byDate.keys()]
const CONC = 8
let processed = 0
for (let i = 0; i < dates.length; i += CONC) {
  const batch = dates.slice(i, i + CONC)
  const results = await Promise.all(batch.map(async date => {
    const linhas = byDate.get(date)
    const ids = linhas.map(r => r.pagamento_id)
    const UPD_CHUNK = 150
    let updPend = 0, updPago = 0, skip = 0
    for (let j = 0; j < ids.length; j += UPD_CHUNK) {
      const slice = ids.slice(j, j + UPD_CHUNK)
      const url = `${SUPABASE_URL}/rest/v1/pagamentos_prosoluto?id=in.(${slice.join(',')})&status=in.(pendente,pago)`
      const body = JSON.stringify({ data_prevista: date, updated_at: new Date().toISOString() })
      const r = await fetch(url, { method: 'PATCH', headers: H, body })
      if (!r.ok) {
        const txt = await r.text()
        report.falhas.push({ date, httpStatus: r.status, body: txt.slice(0, 300), ids_sample: slice.slice(0, 3) })
        report.counts.failed_http++
        continue
      }
      const arr = await r.json()
      for (const row of arr) {
        if (row.status === 'pago') updPago++
        else if (row.status === 'pendente') updPend++
      }
      skip += (slice.length - arr.length)
      if (arr.length === 0) report.counts.retornou_vazio++
      if (report.sampleUpdates.length < 10 && arr.length > 0) {
        report.sampleUpdates.push({
          id: arr[0].id,
          tipo: arr[0].tipo,
          numero_parcela: arr[0].numero_parcela,
          data_prevista_nova: arr[0].data_prevista,
          status: arr[0].status,
        })
      }
    }
    return [date, updPend, updPago, skip]
  }))
  for (const [d, updPend, updPago, skip] of results) {
    report.counts.updated_pendente += updPend
    report.counts.updated_pago += updPago
    report.counts.skipado_cancelado += skip
  }
  processed += batch.length
  process.stdout.write(`  ${processed}/${dates.length} datas | pend=${report.counts.updated_pendente} pago=${report.counts.updated_pago} skip=${report.counts.skipado_cancelado}\r`)
}
process.stdout.write('\n')

writeFileSync('docs/execucao-b4.json', JSON.stringify(report, null, 2))

console.log('')
console.log('================================================================')
console.log('ETAPA 5B.4 — resolucao de colisoes Sienge concluida')
console.log('================================================================')
console.log(`  input rows:              ${report.meta.inputRows}`)
console.log(`  updated pendentes:       ${report.counts.updated_pendente}`)
console.log(`  updated pagos:           ${report.counts.updated_pago}`)
console.log(`  skipado (cancelado):     ${report.counts.skipado_cancelado}`)
console.log(`  retornou vazio:          ${report.counts.retornou_vazio}`)
console.log(`  falhas HTTP:             ${report.counts.failed_http}`)
console.log('')
console.log(`Output: docs/execucao-b4.json`)
