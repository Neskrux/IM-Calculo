// Etapa 2 — monta staging de backfill pagos do Sienge.
// ver .claude/rules/sincronizacao-sienge.md
//
// Input:  docs/fase0-universo-pagos-futuro.json  (3721 parcelas pagas Figueira)
// Output: docs/backfill-stage.json               (staging limpo, pronto pra JOIN)
//
// Regras aplicadas (martelo batido com o time IM):
//   DESCARTAR paymentTerm.id: PU, PA, CA, CV, BN
//   INCLUIR e mapear pra tipo interno:
//     PM                         -> parcela_entrada
//     AT, SN                     -> sinal
//     BA, B1, B2, B3, B4, B5     -> balao
//
// Normalizações:
//   - numero_parcela = parte antes da "/" em installmentNumber (ex: "13/60" -> 13)
//   - paymentDate = max(receipts[].paymentDate) — se múltiplos recibos, o último
//   - valor_pago  = sum(receipts[].netAmount)
//   - valor       = originalAmount (valor original da parcela no Sienge)
//
// Zero request Sienge. Puro processamento local.

import { readFileSync, writeFileSync } from 'node:fs'

const TIPOS_DESCARTADOS = new Set(['PU', 'PA', 'CA', 'CV', 'BN'])
const MAPA_TIPO = {
  PM: 'parcela_entrada',
  AT: 'sinal',
  SN: 'sinal',
  BA: 'balao',
  B1: 'balao',
  B2: 'balao',
  B3: 'balao',
  B4: 'balao',
  B5: 'balao',
}

const INPUT  = 'docs/fase0-universo-pagos-futuro.json'
const OUTPUT = 'docs/backfill-stage.json'

const raw = JSON.parse(readFileSync(INPUT, 'utf8'))
const rows = raw.rows || []

const stage = []
const desc = {
  total: rows.length,
  descartadosPorTipo: 0,
  descartadosSemBillId: 0,
  descartadosSemPayment: 0,
  descartadosTipoDesconhecido: 0,
  descartadosNumeroInvalido: 0,
  aceitos: 0,
  porTipo: {},
  porPaymentTerm: {},
}

for (const r of rows) {
  const ptId = String(r.paymentTerm?.id || '').trim()

  // regra 1: descartar tipos não relevantes
  if (TIPOS_DESCARTADOS.has(ptId)) {
    desc.descartadosPorTipo++
    desc.porPaymentTerm[ptId] = (desc.porPaymentTerm[ptId] || 0) + 1
    continue
  }

  // regra 2: precisa de billId pra dar JOIN com vendas.sienge_receivable_bill_id
  if (r.billId == null) {
    desc.descartadosSemBillId++
    continue
  }

  // regra 3: mapeamento interno
  const tipoInterno = MAPA_TIPO[ptId]
  if (!tipoInterno) {
    desc.descartadosTipoDesconhecido++
    desc.porPaymentTerm[`UNKNOWN:${ptId}`] = (desc.porPaymentTerm[`UNKNOWN:${ptId}`] || 0) + 1
    continue
  }

  // regra 4: extrair numero_parcela
  const instNum = String(r.installmentNumber || '').trim()
  const parteAntesBarra = instNum.split('/')[0]
  const numeroParcela = Number(parteAntesBarra)
  if (!Number.isFinite(numeroParcela) || numeroParcela <= 0) {
    desc.descartadosNumeroInvalido++
    continue
  }

  // regra 5: extrair payment date
  const receipts = Array.isArray(r.receipts) ? r.receipts : []
  const paymentDates = receipts.map(x => x.paymentDate).filter(Boolean).sort()
  const paymentDate = paymentDates[paymentDates.length - 1] || null
  if (!paymentDate) {
    desc.descartadosSemPayment++
    continue
  }

  const pago = receipts.reduce((a, x) => a + Number(x.netAmount || 0), 0)

  stage.push({
    billId: Number(r.billId),
    installmentId: r.installmentId ?? null,
    installmentNumber: instNum,
    numeroParcela,
    paymentTermId: ptId,
    tipoInterno,
    dueDate: r.dueDate || null,
    paymentDate,
    valorOriginal: Number(r.originalAmount || 0),
    valorPago: Number(pago.toFixed(2)),
    contractId: r.contractId ?? null,
    clientName: r.clientName ?? null,
  })

  desc.aceitos++
  desc.porTipo[tipoInterno] = (desc.porTipo[tipoInterno] || 0) + 1
  desc.porPaymentTerm[ptId] = (desc.porPaymentTerm[ptId] || 0) + 1
}

const billIdsDistintos = new Set(stage.map(s => s.billId)).size

console.log('================================================================')
console.log('ETAPA 2 — staging de backfill montado')
console.log('================================================================')
console.log(`Input:  ${INPUT}  (${desc.total} linhas)`)
console.log('')
console.log('Descartados:')
console.log(`  por tipo (PU/PA/CA/CV/BN):    ${desc.descartadosPorTipo}`)
console.log(`  sem billId:                   ${desc.descartadosSemBillId}`)
console.log(`  sem paymentDate:              ${desc.descartadosSemPayment}`)
console.log(`  tipo desconhecido:            ${desc.descartadosTipoDesconhecido}`)
console.log(`  installmentNumber inválido:   ${desc.descartadosNumeroInvalido}`)
console.log('')
console.log(`Aceitos:                        ${desc.aceitos}`)
console.log(`billIds distintos no stage:     ${billIdsDistintos}`)
console.log('')
console.log('Por tipo interno:')
for (const [t, n] of Object.entries(desc.porTipo).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(18)} ${String(n).padStart(5)}`)
}
console.log('')
console.log('Por paymentTerm (Sienge original):')
for (const [t, n] of Object.entries(desc.porPaymentTerm).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(18)} ${String(n).padStart(5)}`)
}
console.log('')

writeFileSync(OUTPUT, JSON.stringify({
  meta: {
    geradoEm: new Date().toISOString(),
    input: INPUT,
    descartados: {
      porTipo: desc.descartadosPorTipo,
      semBillId: desc.descartadosSemBillId,
      semPaymentDate: desc.descartadosSemPayment,
      tipoDesconhecido: desc.descartadosTipoDesconhecido,
      numeroInvalido: desc.descartadosNumeroInvalido,
    },
    aceitos: desc.aceitos,
    billIdsDistintos,
    porTipo: desc.porTipo,
    porPaymentTerm: desc.porPaymentTerm,
  },
  stage,
}, null, 2))

console.log(`Output: ${OUTPUT}`)
console.log(`Total bytes: ${JSON.stringify({ stage }).length}`)
