// Validação B — distribuição completa de paymentTerm no income.
// ver .claude/rules/sincronizacao-sienge.md
//
// Zero request Sienge. Lê docs/fase0-universo-pagos-futuro.json e gera tabela
// com: id do term, descrição Sienge, nº de parcelas, nº de contratos distintos,
// valor original total, valor pago total, amostra de numero (ex. "13/60").
//
// Objetivo: tabela pronta pra o time IM validar com o Sienge qual é o significado
// de cada código — BA, CA, PU, CV, PA, BN etc. — e aí mapear pros 5 tipos internos.
//
// Saída: docs/validacao-B-payment-terms.json + print na tela.

import { readFileSync, writeFileSync } from 'node:fs'

const raw = JSON.parse(readFileSync('docs/fase0-universo-pagos-futuro.json', 'utf8'))
const rows = raw.rows || []

const agg = new Map()  // termId → {descricao, parcelas, contratos:Set, valorOriginal, pago, amostraNumero, amostraBillId}

for (const row of rows) {
  const pt = row.paymentTerm || {}
  const id = String(pt.id ?? 'UNKNOWN').trim()
  const descr = pt.descrition || pt.description || pt.name || '(sem descrição no payload)'
  if (!agg.has(id)) {
    agg.set(id, {
      id,
      descricao: descr,
      parcelas: 0,
      contratos: new Set(),
      valorOriginal: 0,
      pago: 0,
      amostraNumero: [],
      amostraBillId: [],
    })
  }
  const a = agg.get(id)
  a.parcelas++
  if (row.billId != null) a.contratos.add(row.billId)
  a.valorOriginal += Number(row.originalAmount || 0)
  const receipts = Array.isArray(row.receipts) ? row.receipts : []
  for (const rc of receipts) a.pago += Number(rc.netAmount || 0)
  if (a.amostraNumero.length < 3 && row.installmentNumber) a.amostraNumero.push(row.installmentNumber)
  if (a.amostraBillId.length < 3 && row.billId != null) a.amostraBillId.push(row.billId)
  // Se descrição surgir depois, adota
  if (a.descricao === '(sem descrição no payload)' && descr !== '(sem descrição no payload)') a.descricao = descr
}

const tabela = [...agg.values()]
  .sort((a, b) => b.parcelas - a.parcelas)
  .map(a => ({
    id: a.id,
    descricao: a.descricao,
    parcelas: a.parcelas,
    contratos: a.contratos.size,
    valorOriginal: Number(a.valorOriginal.toFixed(2)),
    pago: Number(a.pago.toFixed(2)),
    ticketMedio: a.parcelas > 0 ? Number((a.valorOriginal / a.parcelas).toFixed(2)) : 0,
    amostraNumero: a.amostraNumero,
    amostraBillId: a.amostraBillId,
  }))

console.log('================================================================')
console.log('VALIDAÇÃO B — distribuição de paymentTerm (tipos de parcela)')
console.log('================================================================')
console.log(`Total parcelas analisadas: ${rows.length}`)
console.log(`Tipos distintos:           ${tabela.length}`)
console.log('')
console.log('Tabela completa (ordenada por nº de parcelas):')
console.log('')
console.log('| id | descrição                      | parcelas | contratos | valor original | pago         | ticket médio | amostra numero |')
console.log('|----|--------------------------------|----------|-----------|----------------|--------------|--------------|----------------|')
for (const t of tabela) {
  const desc = (t.descricao || '').slice(0, 30).padEnd(30)
  const par  = String(t.parcelas).padStart(8)
  const ctr  = String(t.contratos).padStart(9)
  const vo   = t.valorOriginal.toFixed(2).padStart(14)
  const pg   = t.pago.toFixed(2).padStart(12)
  const tkt  = t.ticketMedio.toFixed(2).padStart(12)
  const am   = (t.amostraNumero.join(', ') || '-').padEnd(14)
  console.log(`| ${t.id.padEnd(2)} | ${desc} | ${par} | ${ctr} | ${vo} | ${pg} | ${tkt} | ${am} |`)
}
console.log('')

writeFileSync('docs/validacao-B-payment-terms.json', JSON.stringify({
  meta: { totalRows: rows.length, tiposDistintos: tabela.length },
  tipos: tabela,
}, null, 2))
console.log('Output: docs/validacao-B-payment-terms.json')
