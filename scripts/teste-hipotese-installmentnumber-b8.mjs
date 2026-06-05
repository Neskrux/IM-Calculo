// Teste da hipótese da b8 (colisão de numero_parcela) — ZERO request Sienge.
// ver .claude/rules/sincronizacao-sienge.md
//
// Fonte: docs/auditorias/fase0/fase0-universo-pagos-futuro.json
//        (payload /bulk-data/v1/income já baixado: 3721 parcelas, companyId=5 Figueira)
//
// Hipótese: o numero_parcela local colide porque o Sienge entrega installmentNumber
// no formato "x/y" (condição de pagamento — Parâmetro 651), e o match heurístico
// antigo achatou isso pra inteiro. installmentId+billId dão âncora 1:1 limpa.
//
// Saída: docs/rodadas/b8/teste-installmentnumber.json + print.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const SRC = 'docs/auditorias/fase0/fase0-universo-pagos-futuro.json'
const rows = JSON.parse(readFileSync(SRC, 'utf8')).rows
const N = rows.length

// 1) unicidade de installmentId
const ids = new Set()
const pares = new Set()
let nullId = 0
for (const r of rows) {
  if (r.installmentId == null) nullId++
  else ids.add(r.installmentId)
  pares.add(`${r.billId}|${r.installmentId}`)
}

// 2) formato de installmentNumber
let comBarra = 0, semBarra = 0
const exemplos = new Set()
for (const r of rows) {
  const n = String(r.installmentNumber ?? '')
  if (n.includes('/')) comBarra++; else semBarra++
  if (exemplos.size < 15) exemplos.add(n)
}

// 3) dentro do mesmo billId: numero inteiro colide enquanto installmentId é único?
const byBill = new Map()
for (const r of rows) {
  if (!byBill.has(r.billId)) byBill.set(r.billId, [])
  byBill.get(r.billId).push(r)
}
let billsColisaoInt = 0, billsInstIdDup = 0
const amostraColisao = []
for (const [bid, arr] of byBill) {
  const ints = arr.map(r => parseInt(String(r.installmentNumber), 10))
  const instIds = arr.map(r => r.installmentId)
  const colideInt = new Set(ints).size !== ints.length
  const dupInst = new Set(instIds).size !== instIds.length
  if (colideInt) billsColisaoInt++
  if (dupInst) billsInstIdDup++
  if (colideInt && !dupInst && amostraColisao.length < 5) {
    amostraColisao.push({
      billId: bid,
      linhas: arr.map(r => ({
        installmentId: r.installmentId,
        installmentNumber: r.installmentNumber,
        paymentTerm: r.paymentTerm?.id,
        originalAmount: r.originalAmount,
      })),
    })
  }
}

// 4) distribuição de paymentTerm
const pt = new Map()
for (const r of rows) {
  const id = r.paymentTerm?.id || '?'
  const d = r.paymentTerm?.descrition || r.paymentTerm?.description || ''
  if (!pt.has(id)) pt.set(id, { id, descricao: d, n: 0 })
  pt.get(id).n++
}
const ptTab = [...pt.values()].sort((a, b) => b.n - a.n)

const out = {
  meta: { src: SRC, geradoEm: new Date().toISOString(), totalRows: N },
  installmentId: { distintos: ids.size, nulos: nullId, paresBillInst: pares.size, unico1a1: pares.size === N && nullId === 0 },
  installmentNumber: { comBarra, semBarra, exemplos: [...exemplos] },
  colisao: {
    billsTotal: byBill.size,
    billsNumeroInteiroColide: billsColisaoInt,
    billsInstallmentIdDuplica: billsInstIdDup,
    amostra: amostraColisao,
  },
  paymentTerms: ptTab,
}

mkdirSync('docs/rodadas/b8', { recursive: true })
writeFileSync('docs/rodadas/b8/teste-installmentnumber.json', JSON.stringify(out, null, 2))

console.log('================ TESTE HIPÓTESE b8 (numero_parcela) ================')
console.log(`rows: ${N}`)
console.log(`installmentId distintos: ${ids.size} | nulos: ${nullId} | pares (billId,installmentId): ${pares.size}`)
console.log(`>> installmentId é âncora 1:1 única? ${out.installmentId.unico1a1 ? 'SIM' : 'NÃO'}`)
console.log(`installmentNumber com barra (x/y): ${comBarra} | sem barra: ${semBarra}`)
console.log(`   exemplos: ${[...exemplos].join(', ')}`)
console.log(`bills: ${byBill.size} | numero-INTEIRO colide em: ${billsColisaoInt} bills | installmentId duplica em: ${billsInstIdDup} bills`)
console.log('paymentTerms:', ptTab.map(t => `${t.id}(${t.descricao}):${t.n}`).join('  '))
console.log('Output: docs/rodadas/b8/teste-installmentnumber.json')
