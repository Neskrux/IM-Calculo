// Gera INSERT SQL em chunks pra carregar docs/backfill-stage.json
// em sienge_raw.backfill_income_stage.
//
// Output: docs/backfill-stage-chunks/chunk-NNN.sql (um arquivo por chunk)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const CHUNK_SIZE = 300
const INPUT  = 'docs/backfill-stage.json'
const OUTDIR = 'docs/backfill-stage-chunks'

mkdirSync(OUTDIR, { recursive: true })

const raw = JSON.parse(readFileSync(INPUT, 'utf8'))
const stage = raw.stage || []

function sqlStr(v) {
  if (v == null) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}
function sqlNum(v) {
  if (v == null || !Number.isFinite(Number(v))) return 'NULL'
  return String(v)
}
function sqlDate(v) {
  if (!v) return 'NULL'
  return `'${v}'::date`
}

const header = `INSERT INTO sienge_raw.backfill_income_stage
  (bill_id, installment_id, installment_number, numero_parcela, payment_term_id,
   tipo_interno, due_date, payment_date, valor_original, valor_pago,
   contract_id, client_name)
VALUES
`

let chunkIdx = 0
for (let i = 0; i < stage.length; i += CHUNK_SIZE) {
  const slice = stage.slice(i, i + CHUNK_SIZE)
  const values = slice.map(s => {
    return `(${sqlNum(s.billId)},${sqlNum(s.installmentId)},${sqlStr(s.installmentNumber)},${sqlNum(s.numeroParcela)},${sqlStr(s.paymentTermId)},${sqlStr(s.tipoInterno)},${sqlDate(s.dueDate)},${sqlDate(s.paymentDate)},${sqlNum(s.valorOriginal)},${sqlNum(s.valorPago)},${sqlStr(s.contractId)},${sqlStr(s.clientName)})`
  }).join(',\n')
  const sql = header + values + ';\n'
  const fname = `${OUTDIR}/chunk-${String(chunkIdx).padStart(3, '0')}.sql`
  writeFileSync(fname, sql)
  console.log(`${fname}: ${slice.length} rows, ${sql.length} chars`)
  chunkIdx++
}
console.log(`\nTotal: ${stage.length} rows em ${chunkIdx} chunks.`)
