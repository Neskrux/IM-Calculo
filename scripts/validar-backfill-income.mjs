// Etapa 4 — validacao pos-execucao do backfill.
// ver .claude/rules/sincronizacao-sienge.md
//
// Pega o set completo de would_update e checa via REST o status atual de cada ID.
// Se !== 'pago', relata causa provavel (ja era pago antes com data diferente,
// cancelado, ou sumiu).

import { readFileSync, writeFileSync } from 'node:fs'

const SUPABASE_URL = 'https://jdkkusrxullttyeakwib.supabase.co'
const env = readFileSync('.env', 'utf8')
const KEY = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim()

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

const raw = JSON.parse(readFileSync('docs/backfill-would-update.json', 'utf8'))
const rows = raw.rows
const expectedById = new Map(rows.map(r => [r.pagamento_id, r.data_pagamento]))
const ids = [...expectedById.keys()]
console.log(`Validando ${ids.length} IDs...`)

const fetched = []
const CHUNK = 100
for (let i = 0; i < ids.length; i += CHUNK) {
  const slice = ids.slice(i, i + CHUNK)
  const url = `${SUPABASE_URL}/rest/v1/pagamentos_prosoluto?select=id,status,data_pagamento&id=in.(${slice.join(',')})`
  const r = await fetch(url, { headers: H })
  const arr = await r.json()
  fetched.push(...arr)
  process.stdout.write(`  ${fetched.length}/${ids.length}\r`)
}
process.stdout.write('\n')

const report = {
  meta: { geradoEm: new Date().toISOString(), total: ids.length },
  counts: {
    pago_data_bate: 0,
    pago_data_diverge: 0,
    nao_pago_final: 0,
    nao_encontrado: 0,
  },
  samples: { pago_data_diverge: [], nao_pago_final: [], nao_encontrado: [] },
}

const foundIds = new Set(fetched.map(x => x.id))
for (const id of ids) {
  if (!foundIds.has(id)) {
    report.counts.nao_encontrado++
    if (report.samples.nao_encontrado.length < 5) report.samples.nao_encontrado.push({ id })
  }
}
for (const row of fetched) {
  const expected = expectedById.get(row.id)
  if (row.status === 'pago') {
    if (row.data_pagamento === expected) report.counts.pago_data_bate++
    else {
      report.counts.pago_data_diverge++
      if (report.samples.pago_data_diverge.length < 10)
        report.samples.pago_data_diverge.push({ id: row.id, dataLocal: row.data_pagamento, dataSienge: expected })
    }
  } else {
    report.counts.nao_pago_final++
    if (report.samples.nao_pago_final.length < 10)
      report.samples.nao_pago_final.push({ id: row.id, status: row.status, data_pagamento: row.data_pagamento, dataSiengeEsperada: expected })
  }
}

console.log('')
console.log('================================================================')
console.log('VALIDACAO POS-ETAPA-4')
console.log('================================================================')
for (const [k, v] of Object.entries(report.counts)) {
  console.log(`  ${k.padEnd(22)} ${String(v).padStart(5)}`)
}
console.log('')

writeFileSync('docs/validacao-pos-etapa4.json', JSON.stringify(report, null, 2))
console.log('Output: docs/validacao-pos-etapa4.json')
