// Etapa 5B.2 — drift data_prevista SEGURO, automatico.
// ver .claude/rules/sincronizacao-sienge.md + docs/fase5-plano-drift-data-prevista-v2.json
//
// Criterios (todos simultaneos):
//   1. tipo = 'parcela_entrada'
//   2. status = 'pendente'
//   3. |delta_dias| <= 30  (exclui os >365d que precisam decisao de negocio)
//   4. chave (billId, tipo, seq) sem colisao no bulk D
//      (exclui re-parcelamentos onde nao sabemos qual serie e a correta)
//
// Racional: padrao observado e "dia 20 local vs dia 10 Sienge" — bug sistematico
// do gerador antigo de parcelas, nao renegociacao. Sienge e fonte da verdade.
//
// Input:  docs/fase5-plano-drift-data-prevista-v2.json
//         docs/fase5-universo-dueDate-RAW.json (pra detectar colisoes completas)
// Output: docs/execucao-drift-data-prevista-seguro.json

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

// Mesmo mapeamento do analisador v2
const PT_MAP = {
  PM: { tipo: 'parcela_entrada', seqFromInstallment: true },
  SN: { tipo: 'sinal', seq: 1 },
  AT: { tipo: 'sinal', seq: 1 },
  B1: { tipo: 'balao', seq: 1 }, B2: { tipo: 'balao', seq: 2 }, B3: { tipo: 'balao', seq: 3 },
  B4: { tipo: 'balao', seq: 4 }, B5: { tipo: 'balao', seq: 5 }, B6: { tipo: 'balao', seq: 6 },
  B7: { tipo: 'balao', seq: 7 }, B8: { tipo: 'balao', seq: 8 }, B9: { tipo: 'balao', seq: 9 },
  BA: { tipo: 'balao', seqFromInstallment: true },
}

// ============================================================
// 1. Detectar chaves com colisao no bulk D
// ============================================================
console.log('[1/4] Detectando chaves com colisao no bulk D...')
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

// ============================================================
// 2. Filtrar plano drift
// ============================================================
console.log('[2/4] Filtrando plano drift...')
const plano = JSON.parse(readFileSync('docs/fase5-plano-drift-data-prevista-v2.json', 'utf8'))
const totalInput = plano.rows.length

const filtrados = plano.rows.filter(r => {
  if (r.tipo !== 'parcela_entrada') return false
  if (r.status !== 'pendente') return false
  if (Math.abs(r.delta_dias) > 30) return false
  const key = `${r.sienge_receivable_bill_id}|parcela_entrada|${r.numero_parcela}`
  if (colisaoSet.has(key)) return false
  return true
})

// Distribuicao |delta| dos filtrados
const dist = { '<=7d':0, '8-15d':0, '16-30d':0 }
const deltas = filtrados.map(r => r.delta_dias)
for (const r of filtrados) {
  const d = Math.abs(r.delta_dias)
  if (d<=7) dist['<=7d']++
  else if (d<=15) dist['8-15d']++
  else dist['16-30d']++
}
const uniqueDeltas = [...new Set(deltas)].sort((a,b)=>a-b)
console.log(`  total input:              ${totalInput}`)
console.log(`  filtrados (elegiveis):    ${filtrados.length}`)
console.log(`  distribuicao |delta|:     ${JSON.stringify(dist)}`)
console.log(`  deltas distintos:         ${uniqueDeltas.join(', ')}`)
console.log(`  vendas distintas afetadas:${new Set(filtrados.map(r=>r.venda_id)).size}\n`)

// ============================================================
// 3. Agrupar por (data_prevista_sienge) — 1 PATCH por data
// ============================================================
console.log('[3/4] Agrupando por data_prevista_sienge...')
const byDate = new Map()
for (const r of filtrados) {
  if (!byDate.has(r.data_prevista_sienge)) byDate.set(r.data_prevista_sienge, [])
  byDate.get(r.data_prevista_sienge).push(r.pagamento_id)
}
console.log(`  datas distintas: ${byDate.size}\n`)

// ============================================================
// 4. Executar
// ============================================================
console.log('[4/4] Executando PATCHes...')

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    input: 'docs/fase5-plano-drift-data-prevista-v2.json',
    inputRows: totalInput,
    elegiveis: filtrados.length,
    colisoesExcluidas: colisaoSet.size,
    distribuicaoDelta: dist,
    deltasDistintos: uniqueDeltas,
    datasDistintas: byDate.size,
  },
  counts: {
    updated: 0,
    failed_http: 0,
    skipado_nao_pendente: 0,
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
    const ids = byDate.get(date)
    const UPD_CHUNK = 150
    let upd = 0, skip = 0
    for (let j = 0; j < ids.length; j += UPD_CHUNK) {
      const slice = ids.slice(j, j + UPD_CHUNK)
      // Filtro duplo: status=eq.pendente garante que nada que virou pago entre no UPDATE
      const url = `${SUPABASE_URL}/rest/v1/pagamentos_prosoluto?id=in.(${slice.join(',')})&status=eq.pendente`
      const body = JSON.stringify({ data_prevista: date, updated_at: new Date().toISOString() })
      const r = await fetch(url, { method: 'PATCH', headers: H, body })
      if (!r.ok) {
        const txt = await r.text()
        report.falhas.push({ date, httpStatus: r.status, body: txt.slice(0, 300), ids_sample: slice.slice(0, 3) })
        report.counts.failed_http++
        continue
      }
      const arr = await r.json()
      upd += arr.length
      skip += (slice.length - arr.length)
      if (arr.length === 0) report.counts.retornou_vazio++
      if (report.sampleUpdates.length < 5 && arr.length > 0) {
        report.sampleUpdates.push({ id: arr[0].id, data_prevista_nova: arr[0].data_prevista, numero_parcela: arr[0].numero_parcela })
      }
    }
    return [date, ids.length, upd, skip]
  }))
  for (const [d, alvo, upd, skip] of results) {
    report.counts.updated += upd
    report.counts.skipado_nao_pendente += skip
  }
  processed += batch.length
  process.stdout.write(`  ${processed}/${dates.length} datas | updated=${report.counts.updated} skip=${report.counts.skipado_nao_pendente}\r`)
}
process.stdout.write('\n')

writeFileSync('docs/execucao-drift-data-prevista-seguro.json', JSON.stringify(report, null, 2))

console.log('')
console.log('================================================================')
console.log('ETAPA 5B.2 — drift data_prevista SEGURO concluido')
console.log('================================================================')
console.log(`  input rows (plano total):  ${report.meta.inputRows}`)
console.log(`  elegiveis (filtro seguro): ${report.meta.elegiveis}`)
console.log(`  updated:                   ${report.counts.updated}`)
console.log(`  skipado (nao pendente):    ${report.counts.skipado_nao_pendente}`)
console.log(`  retornou vazio (chunk):    ${report.counts.retornou_vazio}`)
console.log(`  falhas HTTP:               ${report.counts.failed_http}`)
console.log('')
console.log(`Output: docs/execucao-drift-data-prevista-seguro.json`)
