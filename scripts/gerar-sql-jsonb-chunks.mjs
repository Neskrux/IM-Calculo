// Gera chunks JSONB para carregar via INSERT ... SELECT jsonb_to_recordset.
// Cada chunk tem ~1000 rows e fica em docs/backfill-stage-chunks/jsonb-NNN.sql
//
// Estratégia: um único SQL statement por chunk com jsonb_to_recordset — muito
// mais compacto que INSERT VALUES porque pagamos colunas 1x e não por row.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const CHUNK_SIZE = 250
const INPUT  = 'docs/backfill-stage.json'
const OUTDIR = 'docs/backfill-stage-chunks'

mkdirSync(OUTDIR, { recursive: true })

const raw = JSON.parse(readFileSync(INPUT, 'utf8'))
const stage = raw.stage || []

let chunkIdx = 0
for (let i = 0; i < stage.length; i += CHUNK_SIZE) {
  const slice = stage.slice(i, i + CHUNK_SIZE)
  const arr = slice.map(s => ({
    bill_id: s.billId,
    installment_id: s.installmentId,
    installment_number: s.installmentNumber,
    numero_parcela: s.numeroParcela,
    payment_term_id: s.paymentTermId,
    tipo_interno: s.tipoInterno,
    due_date: s.dueDate,
    payment_date: s.paymentDate,
    valor_original: s.valorOriginal,
    valor_pago: s.valorPago,
    contract_id: s.contractId,
    client_name: s.clientName,
  }))
  const json = JSON.stringify(arr).replace(/'/g, "''")
  const sql = `INSERT INTO sienge_raw.backfill_income_stage
  (bill_id, installment_id, installment_number, numero_parcela, payment_term_id,
   tipo_interno, due_date, payment_date, valor_original, valor_pago,
   contract_id, client_name)
SELECT
  bill_id, installment_id, installment_number, numero_parcela, payment_term_id,
  tipo_interno, due_date::date, payment_date::date, valor_original, valor_pago,
  contract_id, client_name
FROM jsonb_to_recordset('${json}'::jsonb)
AS x(
  bill_id            bigint,
  installment_id     bigint,
  installment_number text,
  numero_parcela     int,
  payment_term_id    text,
  tipo_interno       text,
  due_date           text,
  payment_date       text,
  valor_original     numeric,
  valor_pago         numeric,
  contract_id        text,
  client_name        text
);
`
  const fname = `${OUTDIR}/jsonb-${String(chunkIdx).padStart(3, '0')}.sql`
  writeFileSync(fname, sql)
  console.log(`${fname}: ${slice.length} rows, ${sql.length} chars`)
  chunkIdx++
}
console.log(`\nTotal: ${stage.length} rows em ${chunkIdx} chunks.`)
