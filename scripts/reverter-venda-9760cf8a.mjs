// Reverte a exclusao manual da venda 9760cf8a-5826-4b18-b233-780551ec5586
// (FIGUEIRA GARCIA, unidade 1603 C, cliente HELOIZA MARCHINI SANCHES,
// corretora Carolina). Excluida manualmente em 2026-05-11 17:30 sob a
// impressao de duplicata — investigacao nao encontrou duplicata.
//
// Tem 3 pagamentos pagos legitimos (R$ 4.607,73, comissao R$ 1.612,71).
// Excluir uma venda com pagos viola .claude/rules/sincronizacao-sienge.md.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=')
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)

const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const VENDA_ID = '9760cf8a-5826-4b18-b233-780551ec5586'

const { data: antes } = await supa.from('vendas').select('id, excluido, updated_at').eq('id', VENDA_ID).maybeSingle()
if (!antes) { console.error('venda nao encontrada'); process.exit(1) }
console.log('antes:', antes)

if (!antes.excluido) {
  console.log('venda ja esta excluido=false. Nada a fazer.')
  process.exit(0)
}

const { data: depois, error } = await supa
  .from('vendas')
  .update({ excluido: false })
  .eq('id', VENDA_ID)
  .select('id, excluido, updated_at')
  .maybeSingle()

if (error) { console.error('erro no update:', error); process.exit(1) }
console.log('depois:', depois)
console.log('OK — venda restaurada.')
