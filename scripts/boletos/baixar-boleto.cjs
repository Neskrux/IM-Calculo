// Baixa (cancela) UM boleto no Sicoob e sincroniza o status local.
// Uso: node baixar-boleto.cjs <nossoNumero>
const { CONFIG, supabase, obterToken, sicoobApi } = require('./sicoob.cjs')

const NOSSO_NUMERO = process.argv[2]
if (!NOSSO_NUMERO) { console.log('uso: node baixar-boleto.cjs <nossoNumero>'); process.exit(1) }

async function main() {
  const token = await obterToken('boletos_alteracao boletos_consulta')
  console.log(`baixando boleto nossoNumero=${NOSSO_NUMERO} no Sicoob...`)
  const resp = await sicoobApi(token, 'PATCH', `/boletos/${NOSSO_NUMERO}/baixar`, {
    numeroCliente: CONFIG.NUMERO_CLIENTE,
    codigoModalidade: 1,
  })
  console.log('HTTP', resp.status, resp.body ? `| ${resp.body.slice(0, 300)}` : '(sem corpo = sucesso)')
  if (resp.status < 200 || resp.status >= 300) return

  const { data, error } = await supabase
    .from('boletos')
    .update({ status: 'baixado', motivo_cancelamento: 'baixado via worker' })
    .eq('banco', 'sicoob')
    .eq('nosso_numero', String(NOSSO_NUMERO))
    .select('id, status')
  if (error) console.log('aviso: falhou sincronizar status local:', error.message)
  else console.log('status local:', data?.length ? 'baixado' : '(boleto não estava na tabela local)')
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
