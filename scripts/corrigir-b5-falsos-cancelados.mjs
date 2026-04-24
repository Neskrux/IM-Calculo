// Correcao B.5 — reverter cancelado->pendente nas parcelas que batem com Sienge.
// ver .claude/rules/sincronizacao-sienge.md
//
// Contexto: a B.5 cancelou duplicatas em vendas que tinham duas series identicas.
// Em algumas vendas a serie "perdedora" era a que realmente batia com o cronograma
// atual do Sienge — ou seja, cancelamos parcelas validas. A Etapa 0.3 identificou
// 281 casos onde uma cancelada local bate com pendente do Sienge (por seq + valor,
// tolerancia de 30 dias em data_prevista).
//
// Acao por linha:
//   UPDATE pagamentos_prosoluto
//     SET status='pendente',
//         data_pagamento=NULL (ja era null em cancelada),
//         data_prevista=<dueDate Sienge quando diferente>,
//         updated_at=now()
//     WHERE id=<id da cancelada>
//
// Invariantes respeitadas:
//   - cancelado->pendente nao e bloqueado por trigger (so pago->pendente e).
//   - data_prevista livre (trigger 017 so bloqueia tipo/valor/comissao em pago).
//
// Input:  docs/etapa0-parcelas-faltantes.json
// Output: docs/correcao-b5-falsos-cancelados.json

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

const input = JSON.parse(readFileSync('docs/etapa0-parcelas-faltantes.json', 'utf8'))
const alvos = input.falsosCancelados
console.log(`Falsos cancelados a reverter: ${alvos.length}`)

// Dividir em dois buckets:
//   A) data_prevista ja bate com Sienge -> UPDATE apenas status
//   B) data_prevista diverge (renegociacao de dia) -> UPDATE status + data_prevista
const bucketA = alvos.filter(x => !x.precisa_atualizar_data_prevista)
const bucketB = alvos.filter(x => x.precisa_atualizar_data_prevista)
console.log(`  bucket A (so status):                   ${bucketA.length}`)
console.log(`  bucket B (status + data_prevista novo): ${bucketB.length}`)

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    totalAlvos: alvos.length,
    bucketA: bucketA.length,
    bucketB: bucketB.length,
    acao: "UPDATE status=pendente (e data_prevista=dueDate Sienge quando diverge). Pre-condicao: status atual=cancelado (guard no filtro da query).",
  },
  counts: { updated: 0, falhas_http: 0, skip_estado_mudou: 0 },
  falhas: [],
  amostraUpdates: [],
}

// Bucket A em chunks (sem alterar data_prevista)
const CHUNK = 100
for (let i = 0; i < bucketA.length; i += CHUNK) {
  const slice = bucketA.slice(i, i + CHUNK)
  const ids = slice.map(x => x.cancelada_id)
  const url = `${SUPABASE_URL}/rest/v1/pagamentos_prosoluto?id=in.(${ids.join(',')})&status=eq.cancelado`
  const body = JSON.stringify({ status: 'pendente', updated_at: new Date().toISOString() })
  const r = await fetch(url, { method: 'PATCH', headers: H, body })
  if (!r.ok) {
    const txt = await r.text()
    report.falhas.push({ bucket: 'A', httpStatus: r.status, body: txt.slice(0, 500), ids_sample: ids.slice(0, 3) })
    report.counts.falhas_http++
    console.log(`  [A] chunk ${i}-${i+slice.length} FALHOU (${r.status})`)
    continue
  }
  const arr = await r.json()
  report.counts.updated += arr.length
  if (arr.length < slice.length) report.counts.skip_estado_mudou += (slice.length - arr.length)
  if (report.amostraUpdates.length < 10 && arr.length > 0) {
    report.amostraUpdates.push({ bucket: 'A', id: arr[0].id, tipo: arr[0].tipo, numero_parcela: arr[0].numero_parcela, status_novo: arr[0].status })
  }
  process.stdout.write(`  [A] ${Math.min(i+slice.length, bucketA.length)}/${bucketA.length} (updated total=${report.counts.updated})\r`)
}
process.stdout.write('\n')

// Bucket B — um UPDATE por linha (data_prevista diferente por linha)
let b_idx = 0
for (const x of bucketB) {
  b_idx++
  const url = `${SUPABASE_URL}/rest/v1/pagamentos_prosoluto?id=eq.${x.cancelada_id}&status=eq.cancelado`
  const body = JSON.stringify({
    status: 'pendente',
    data_prevista: x.dueDate,
    updated_at: new Date().toISOString(),
  })
  const r = await fetch(url, { method: 'PATCH', headers: H, body })
  if (!r.ok) {
    const txt = await r.text()
    report.falhas.push({ bucket: 'B', httpStatus: r.status, body: txt.slice(0, 500), id: x.cancelada_id })
    report.counts.falhas_http++
    continue
  }
  const arr = await r.json()
  if (arr.length === 0) { report.counts.skip_estado_mudou++; continue }
  report.counts.updated += arr.length
  if (report.amostraUpdates.length < 20) {
    report.amostraUpdates.push({
      bucket: 'B',
      id: arr[0].id,
      tipo: arr[0].tipo,
      numero_parcela: arr[0].numero_parcela,
      status_novo: arr[0].status,
      data_prevista_nova: arr[0].data_prevista,
      data_prevista_antiga: x.cancelada_data_prevista,
    })
  }
  if (b_idx % 25 === 0) process.stdout.write(`  [B] ${b_idx}/${bucketB.length} (updated total=${report.counts.updated})\r`)
}
process.stdout.write('\n')

writeFileSync('docs/correcao-b5-falsos-cancelados.json', JSON.stringify(report, null, 2))

console.log('')
console.log('================================================================')
console.log('CORRECAO B.5 — reverter falsos cancelados')
console.log('================================================================')
console.log(`  alvos:             ${alvos.length}`)
console.log(`  bucket A / B:      ${bucketA.length} / ${bucketB.length}`)
console.log(`  updated:           ${report.counts.updated}`)
console.log(`  falhas HTTP:       ${report.counts.falhas_http}`)
console.log(`  skip (estado mudou): ${report.counts.skip_estado_mudou}`)
console.log('')
console.log('Output: docs/correcao-b5-falsos-cancelados.json')
