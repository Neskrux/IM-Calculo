// Corrige corretor_id da venda 138 (sienge_contract_id) — atribuida no banco
// ao Bruno Diogo (broker 162) mas no Sienge o broker eh Carolina (129).
//
// Resultado: vendas.corretor_id = Carolina e origem = 'manual' (protege
// contra sync sobrescrever de novo, conforme migration 021 + .claude/rules/
// sincronizacao-sienge.md).
//
// IMPORTANTE: nao mexe em pagamentos_prosoluto. tipo_corretor permanece
// 'externo' (ambos sao externos), entao comissao_gerada por parcela e
// fator_comissao_aplicado continuam corretos. Soh o destinatario muda.
//
// Parte financeira (quem recebeu de fato os R$ 5.476,79 das 11 parcelas ja
// pagas) e decisao de negocio — controladoria valida.

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

const VENDA_ID = '45ea6703-2e75-4c9a-a572-27710936f03b'
const CAROLINA_ID = '4c04b405-d75b-4638-9dab-c149e563bc0c'
const BRUNO_DIOGO_ID = '8d364f54-cb5f-45ae-af2b-862c1694426e'

// antes
const { data: antes } = await supa
  .from('vendas')
  .select('id, sienge_contract_id, corretor_id, corretor_id_origem')
  .eq('id', VENDA_ID)
  .maybeSingle()
console.log('antes:', antes)

if (!antes) { console.error('venda nao encontrada'); process.exit(1) }
if (antes.corretor_id !== BRUNO_DIOGO_ID) {
  console.log('corretor_id ja foi alterado — nao aplica de novo.')
  process.exit(0)
}

// aplica
const { data: depois, error } = await supa
  .from('vendas')
  .update({
    corretor_id: CAROLINA_ID,
    corretor_id_origem: 'manual',
  })
  .eq('id', VENDA_ID)
  .select('id, corretor_id, corretor_id_origem, updated_at')
  .maybeSingle()

if (error) { console.error('erro:', error); process.exit(1) }
console.log('depois:', depois)
console.log('\nOK — venda 138 reatribuida pra Carolina (broker 129).')
console.log('Pagamentos NAO foram alterados — comissao_gerada por parcela ja estava correta.')
console.log('Acao manual pendente: controladoria valida quem recebeu os R$ 5.476,79 das 11 parcelas ja pagas.')
