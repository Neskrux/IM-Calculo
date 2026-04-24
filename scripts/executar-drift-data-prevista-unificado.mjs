// Etapa 5B.2+5B.3 unificada — drift data_prevista: TODOS os tipos mapeados,
// pendentes E pagos, Sienge e verdade.
// ver .claude/rules/sincronizacao-sienge.md
//
// Criterios:
//   1. status IN ('pendente', 'pago')  (exclui cancelado)
//   2. chave (billId, tipo, seq) sem colisao no bulk D Sienge
//      (re-parcelamentos na fonte precisam decisao de negocio)
//
// Trigger 017 NAO protege data_prevista nem numero_parcela — UPDATE em pago e aceito.
// Apenas tipo/valor/comissao_gerada/fator_comissao_aplicado/percentual_comissao_total/
// data_pagamento sao imutaveis em pago.
//
// Input:  docs/fase5-plano-drift-data-prevista-v2.json (pos-renumeracao, 409 rows)
//         docs/fase5-universo-dueDate-RAW.json
// Output: docs/execucao-drift-data-prevista-unificado.json

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

const PT_MAP = {
  PM: { tipo: 'parcela_entrada', seqFromInstallment: true },
  SN: { tipo: 'sinal', seq: 1 },
  AT: { tipo: 'sinal', seq: 1 },
  B1: { tipo: 'balao', seq: 1 }, B2: { tipo: 'balao', seq: 2 }, B3: { tipo: 'balao', seq: 3 },
  B4: { tipo: 'balao', seq: 4 }, B5: { tipo: 'balao', seq: 5 }, B6: { tipo: 'balao', seq: 6 },
  B7: { tipo: 'balao', seq: 7 }, B8: { tipo: 'balao', seq: 8 }, B9: { tipo: 'balao', seq: 9 },
  BA: { tipo: 'balao', seqFromInstallment: true },
}

console.log('[1/4] Detectando colisoes no bulk D...')
const rawDue = JSON.parse(readFileSync('docs/fase5-universo-dueDate-RAW.json', 'utf8'))
const rowsDue = rawDue.data || []
const keyCount = new Map()
for (const r of rowsDue) {
  const ptId = r.paymentTerm?.id
  const map = PT_MAP[ptId]
  if (!map) continue
  let seq = map.seq
  if (map.seqFromInstallment) {
    const [n] = String(r.installmentNumber || '').split('/')
    seq = parseInt(n, 10)
    if (!Number.isFinite(seq)) continue
  }
  const key = `${r.billId}|${map.tipo}|${seq}`
  keyCount.set(key, (keyCount.get(key) || 0) + 1)
}
const colisaoSet = new Set()
for (const [k, v] of keyCount) if (v > 1) colisaoSet.add(k)
console.log(`  chaves mapeadas: ${keyCount.size}  colisoes: ${colisaoSet.size}\n`)

console.log('[2/4] Filtrando plano...')
const plano = JSON.parse(readFileSync('docs/fase5-plano-drift-data-prevista-v2.json', 'utf8'))
const totalInput = plano.rows.length

const filtrados = plano.rows.filter(r => {
  if (r.status !== 'pendente' && r.status !== 'pago') return false
  const key = `${r.sienge_receivable_bill_id}|${r.tipo}|${r.numero_parcela}`
  if (colisaoSet.has(key)) return false
  return true
})

// Distribuicao
const porTipo = {}
const porStatus = {}
const porDelta = { '<=7d':0, '8-30d':0, '31-180d':0, '181-365d':0, '>365d':0 }
for (const r of filtrados) {
  porTipo[r.tipo] = (porTipo[r.tipo] || 0) + 1
  porStatus[r.status] = (porStatus[r.status] || 0) + 1
  const d = Math.abs(r.delta_dias)
  if (d<=7) porDelta['<=7d']++
  else if (d<=30) porDelta['8-30d']++
  else if (d<=180) porDelta['31-180d']++
  else if (d<=365) porDelta['181-365d']++
  else porDelta['>365d']++
}
console.log(`  total input:  ${totalInput}`)
console.log(`  elegiveis:    ${filtrados.length}`)
console.log(`  por tipo:     ${JSON.stringify(porTipo)}`)
console.log(`  por status:   ${JSON.stringify(porStatus)}`)
console.log(`  por delta:    ${JSON.stringify(porDelta)}`)
console.log(`  vendas distintas: ${new Set(filtrados.map(r=>r.venda_id)).size}\n`)

console.log('[3/4] Agrupando por data_prevista_sienge...')
const byDate = new Map()
for (const r of filtrados) {
  if (!byDate.has(r.data_prevista_sienge)) byDate.set(r.data_prevista_sienge, [])
  byDate.get(r.data_prevista_sienge).push(r)
}
console.log(`  datas distintas: ${byDate.size}\n`)

console.log('[4/4] Executando PATCHes...')

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    input: 'docs/fase5-plano-drift-data-prevista-v2.json',
    inputRows: totalInput,
    elegiveis: filtrados.length,
    colisoesExcluidas: colisaoSet.size,
    porTipo, porStatus, porDelta,
    datasDistintas: byDate.size,
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
    const statusById = new Map(linhas.map(r => [r.pagamento_id, r.status]))
    const UPD_CHUNK = 150
    let updPend = 0, updPago = 0, skip = 0
    for (let j = 0; j < ids.length; j += UPD_CHUNK) {
      const slice = ids.slice(j, j + UPD_CHUNK)
      // Filtro duplo: status in (pendente, pago) — guarda contra race com cancelado
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

writeFileSync('docs/execucao-drift-data-prevista-unificado.json', JSON.stringify(report, null, 2))

console.log('')
console.log('================================================================')
console.log('ETAPA 5B.2+5B.3 UNIFICADA — drift data_prevista concluido')
console.log('================================================================')
console.log(`  input rows:              ${report.meta.inputRows}`)
console.log(`  elegiveis:               ${report.meta.elegiveis}`)
console.log(`  updated pendentes:       ${report.counts.updated_pendente}`)
console.log(`  updated pagos:           ${report.counts.updated_pago}`)
console.log(`  skipado (cancelado):     ${report.counts.skipado_cancelado}`)
console.log(`  retornou vazio (chunk):  ${report.counts.retornou_vazio}`)
console.log(`  falhas HTTP:             ${report.counts.failed_http}`)
console.log('')
console.log(`Output: docs/execucao-drift-data-prevista-unificado.json`)
