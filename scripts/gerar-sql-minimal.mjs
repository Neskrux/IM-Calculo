// Gera chunks VALUES minimalistas — só campos usados no DRY RUN e UPDATE.
// Drop: installment_id, installment_number, contract_id, client_name, payment_term_id.
//
// Campos mantidos: bill_id, numero_parcela, tipo_interno, due_date, payment_date,
//                  valor_original, valor_pago.
//
// Output: docs/backfill-stage-chunks/mini-NNN.sql

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'

const CHUNK_SIZE = 600
const INPUT  = 'docs/backfill-stage.json'
const OUTDIR = 'docs/backfill-stage-chunks'

mkdirSync(OUTDIR, { recursive: true })
for (const f of readdirSync(OUTDIR)) {
  if (f.endsWith('.sql')) unlinkSync(`${OUTDIR}/${f}`)
}

const raw = JSON.parse(readFileSync(INPUT, 'utf8'))
const stage = raw.stage || []

function num(v) { return v == null || !Number.isFinite(Number(v)) ? 'NULL' : String(v) }
function str(v) { return v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'` }
function dt(v)  { return !v ? 'NULL' : `'${v}'` }

const header = `INSERT INTO sienge_raw.backfill_income_stage
  (bill_id, numero_parcela, tipo_interno, due_date, payment_date,
   valor_original, valor_pago, payment_term_id)
VALUES
`

let chunkIdx = 0
for (let i = 0; i < stage.length; i += CHUNK_SIZE) {
  const slice = stage.slice(i, i + CHUNK_SIZE)
  const values = slice.map(s =>
    `(${num(s.billId)},${num(s.numeroParcela)},${str(s.tipoInterno)},${dt(s.dueDate)},${dt(s.paymentDate)},${num(s.valorOriginal)},${num(s.valorPago)},${str(s.paymentTermId)})`
  ).join(',\n')
  const sql = header + values + ';\n'
  const fname = `${OUTDIR}/mini-${String(chunkIdx).padStart(3, '0')}.sql`
  writeFileSync(fname, sql)
  console.log(`${fname}: ${slice.length} rows, ${sql.length} chars`)
  chunkIdx++
}
console.log(`\nTotal: ${stage.length} rows em ${chunkIdx} chunks.`)
