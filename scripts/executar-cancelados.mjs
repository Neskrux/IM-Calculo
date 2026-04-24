// Etapa 5B-cancelados — marca pendentes -> cancelado para as 31 vendas
// canceladas no Sienge (situation=CANCELED, enterpriseId=2104).
// ver .claude/rules/sincronizacao-sienge.md + docs/cancelados-sienge-registry.md
//
// Regra:
//  - Só mexe em linhas status='pendente' das vendas canceladas.
//  - Filtro duplo: id IN (plano) AND status=eq.pendente (guarda-corpo HTTP).
//  - NÃO mexe em 'pago' (trigger 017 bloquearia + é histórico de caixa).
//  - NÃO mexe em vendas.excluido.
//
// Input:  docs/fase5-plano-cancelados-v2.json (rows: 297)
// Output: docs/execucao-cancelados.json

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

const plano = JSON.parse(readFileSync('docs/fase5-plano-cancelados-v2.json', 'utf8'))
const rows = plano.rows || []
console.log(`Input: ${rows.length} parcelas pendente -> cancelado`)
console.log(`Vendas distintas: ${new Set(rows.map(r => r.venda_id)).size}`)
console.log(`Sienge contract_ids: ${new Set(rows.map(r => r.sienge_contract_id)).size}\n`)

const ids = rows.map(r => r.pagamento_id)

// Dedup por seguranca (plano v2 ja deve estar unique, mas defensivo)
const uniqIds = [...new Set(ids)]
if (uniqIds.length !== ids.length) {
  console.log(`Dedup: ${ids.length} -> ${uniqIds.length} ids unicos`)
}

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    input: 'docs/fase5-plano-cancelados-v2.json',
    inputRows: rows.length,
    uniqueIds: uniqIds.length,
  },
  counts: {
    updated: 0,
    failed_http: 0,
    retornou_vazio: 0,
    skipado_nao_pendente: 0,
  },
  falhas: [],
  sampleUpdates: [],
}

const CHUNK = 120
let processed = 0
for (let i = 0; i < uniqIds.length; i += CHUNK) {
  const slice = uniqIds.slice(i, i + CHUNK)
  // filtro duplo: id in (slice) AND status=eq.pendente
  const url = `${SUPABASE_URL}/rest/v1/pagamentos_prosoluto?id=in.(${slice.join(',')})&status=eq.pendente`
  const body = JSON.stringify({
    status: 'cancelado',
    updated_at: new Date().toISOString(),
  })
  const r = await fetch(url, { method: 'PATCH', headers: H, body })
  if (!r.ok) {
    const txt = await r.text()
    report.falhas.push({
      chunk_start: i,
      httpStatus: r.status,
      body: txt.slice(0, 400),
      ids_sample: slice.slice(0, 5),
    })
    report.counts.failed_http++
    console.log(`  ! chunk ${i}: HTTP ${r.status}`)
    continue
  }
  const arr = await r.json()
  report.counts.updated += arr.length
  const skipados = slice.length - arr.length
  report.counts.skipado_nao_pendente += skipados
  if (arr.length === 0) report.counts.retornou_vazio++
  if (report.sampleUpdates.length < 5 && arr.length > 0) {
    report.sampleUpdates.push({ id: arr[0].id, status_novo: arr[0].status, venda_id: arr[0].venda_id, numero_parcela: arr[0].numero_parcela })
  }
  processed += slice.length
  process.stdout.write(`  ${processed}/${uniqIds.length} processados | updated=${report.counts.updated} skip=${report.counts.skipado_nao_pendente}\r`)
}
process.stdout.write('\n')

writeFileSync('docs/execucao-cancelados.json', JSON.stringify(report, null, 2))

console.log('')
console.log('================================================================')
console.log('ETAPA 5B-CANCELADOS concluida')
console.log('================================================================')
console.log(`  input rows:              ${report.meta.inputRows}`)
console.log(`  unique IDs:              ${report.meta.uniqueIds}`)
console.log(`  updated:                 ${report.counts.updated}`)
console.log(`  skipado (nao pendente):  ${report.counts.skipado_nao_pendente}`)
console.log(`  retornou vazio (chunk):  ${report.counts.retornou_vazio}`)
console.log(`  falhas HTTP:             ${report.counts.failed_http}`)
console.log('')
console.log(`Output: docs/execucao-cancelados.json`)
