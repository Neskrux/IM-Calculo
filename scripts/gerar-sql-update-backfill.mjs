// Gera chunks SQL pra aplicar UPDATE pendente->pago via jsonb_to_recordset.
// ver .claude/rules/sincronizacao-sienge.md
//
// Cada chunk tem ~500 rows. Output: docs/backfill-update-sql/upd-NNN.sql
// O UPDATE so mexe em status + data_pagamento + updated_at. Trigger 017
// continua protegendo tudo mais.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'

const CHUNK_SIZE = 500
const INPUT  = 'docs/backfill-would-update.json'
const OUTDIR = 'docs/backfill-update-sql'

mkdirSync(OUTDIR, { recursive: true })
for (const f of readdirSync(OUTDIR)) {
  if (f.endsWith('.sql')) unlinkSync(`${OUTDIR}/${f}`)
}

const raw = JSON.parse(readFileSync(INPUT, 'utf8'))
const rows = raw.rows || []

let chunkIdx = 0
for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
  const slice = rows.slice(i, i + CHUNK_SIZE).map(r => ({
    pagamento_id: r.pagamento_id,
    data_pagamento: r.data_pagamento,
  }))
  const json = JSON.stringify(slice).replace(/'/g, "''")
  const sql = `WITH upd AS (
  UPDATE public.pagamentos_prosoluto p
     SET status = 'pago',
         data_pagamento = x.data_pagamento::date,
         updated_at = now()
    FROM jsonb_to_recordset('${json}'::jsonb)
      AS x(pagamento_id uuid, data_pagamento text)
   WHERE p.id = x.pagamento_id
     AND p.status = 'pendente'
  RETURNING p.id
)
SELECT ${slice.length} AS chunk_size, COUNT(*) AS rows_updated FROM upd;
`
  const fname = `${OUTDIR}/upd-${String(chunkIdx).padStart(3, '0')}.sql`
  writeFileSync(fname, sql)
  console.log(`${fname}: ${slice.length} rows, ${sql.length} chars`)
  chunkIdx++
}
console.log(`\nTotal: ${rows.length} rows em ${chunkIdx} chunks.`)
