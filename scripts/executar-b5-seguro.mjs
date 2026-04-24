// Etapa 5B.5 (parte segura) — cancela perdedores nos 55 grupos sem risco.
// ver .claude/rules/sincronizacao-sienge.md
//
// Criterio de "grupo seguro":
//   - vencedor.dist_dias <= 30 (bate com Sienge)
//   - todos perdedores pagos tem dist <= 30 (duplicata limpa, nao e pagamento em outro periodo)
//
// Acao: status='cancelado' nos perdedores (preserva data_pagamento, nao e delete).
// Perdedor ja cancelado: skip.
//
// Input:  docs/b5-plano-seguro.json
// Output: docs/execucao-b5-seguro.json

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

const plano = JSON.parse(readFileSync('docs/b5-plano-seguro.json', 'utf8'))
const grupos = plano.grupos

const idsCancelarPendentes = []
const idsPagoParaRevisao = []
for (const g of grupos) {
  for (const p of g.perdedores) {
    if (p.acao !== 'cancelar') continue
    if (p.status === 'pendente') {
      idsCancelarPendentes.push({ id: p.id, venda_id: g.venda_id, seq: g.seq })
    } else if (p.status === 'pago') {
      idsPagoParaRevisao.push({ id: p.id, venda_id: g.venda_id, seq: g.seq, contract: g.contract, dpag: p.data_pagamento })
    }
  }
}
console.log(`Grupos seguros: ${grupos.length}`)
console.log(`Pendentes a cancelar (processa): ${idsCancelarPendentes.length}`)
console.log(`Pagos a cancelar (bloqueado por trigger — vai pra revisao humana): ${idsPagoParaRevisao.length}\n`)

const idsCancelar = idsCancelarPendentes

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    gruposSeguros: grupos.length,
    linhasParaCancelar: idsCancelar.length,
    acao: "status='cancelado' (preserva data_pagamento, nao DELETE)",
  },
  counts: { updated: 0, falhas_http: 0, retornou_vazio: 0 },
  falhas: [],
  amostraUpdates: [],
  pagosRevisaoHumana: idsPagoParaRevisao,
}

const CHUNK = 100
for (let i = 0; i < idsCancelar.length; i += CHUNK) {
  const slice = idsCancelar.slice(i, i + CHUNK).map(x => x.id)
  const url = `${SUPABASE_URL}/rest/v1/pagamentos_prosoluto?id=in.(${slice.join(',')})`
  const body = JSON.stringify({ status: 'cancelado', updated_at: new Date().toISOString() })
  const r = await fetch(url, { method: 'PATCH', headers: H, body })
  if (!r.ok) {
    const txt = await r.text()
    report.falhas.push({ httpStatus: r.status, body: txt.slice(0, 500), ids_sample: slice.slice(0, 3) })
    report.counts.falhas_http++
    console.log(`  chunk ${i}-${i+slice.length} FALHOU (${r.status})`)
    continue
  }
  const arr = await r.json()
  report.counts.updated += arr.length
  if (arr.length === 0) report.counts.retornou_vazio++
  if (report.amostraUpdates.length < 10 && arr.length > 0) {
    report.amostraUpdates.push({
      id: arr[0].id,
      tipo: arr[0].tipo,
      numero_parcela: arr[0].numero_parcela,
      status_novo: arr[0].status,
      data_pagamento: arr[0].data_pagamento,
    })
  }
  process.stdout.write(`  ${Math.min(i+slice.length, idsCancelar.length)}/${idsCancelar.length} processados (updated=${report.counts.updated})\r`)
}
process.stdout.write('\n')

writeFileSync('docs/execucao-b5-seguro.json', JSON.stringify(report, null, 2))

console.log('')
console.log('================================================================')
console.log('ETAPA 5B.5 (parte segura) — duplicatas de parcela_entrada')
console.log('================================================================')
console.log(`  grupos seguros:           ${grupos.length}`)
console.log(`  linhas a cancelar:        ${idsCancelar.length}`)
console.log(`  updated:                  ${report.counts.updated}`)
console.log(`  falhas HTTP:              ${report.counts.falhas_http}`)
console.log(`  chunks vazios:            ${report.counts.retornou_vazio}`)
console.log('')
console.log('Output: docs/execucao-b5-seguro.json')
console.log('\nRevisao humana pendente: docs/b5-revisao-humana.json (34 grupos)')
