// Autorização do cooperado na Ailos (passo interativo, 1x por ambiente).
// Uso: node ailos-login.cjs
//
// 1. Pede o id da tela de login (client token + apiKeyDeveloper + state + callback)
// 2. Imprime a URL — abrir no navegador e logar:
//    homolog: conta 7902.556-0 · senha aaaaa11111@
// 3. A Ailos chama o callback (edge function ailos-boletos/callback), que grava
//    o code em ailos_tokens. O script fica aguardando e confirma.
const { CONFIG, iniciarLoginCooperado, aguardarCodeCooperado, ailosApi } = require('./ailos.cjs')

;(async () => {
  console.log(`Ambiente: ${CONFIG.AMBIENTE} (${CONFIG.HOST})`)
  const { loginUrl } = await iniciarLoginCooperado()
  console.log('\n=== ABRA ESTA URL NO NAVEGADOR E FAÇA O LOGIN DO COOPERADO ===\n')
  console.log(loginUrl)
  console.log('\n(homolog: conta 7902.556-0 / senha aaaaa11111@)')
  console.log('\nAguardando o callback da Ailos (até 5 min)...')

  await aguardarCodeCooperado()
  console.log('\n✅ Cooperado autorizado! Code gravado em ailos_tokens.')

  // smoke test: consulta um boleto inexistente só pra validar as duas credenciais
  const r = await ailosApi('GET',
    `/ailos/cobranca/api/v2/boletos/consultar/boleto/convenios/${CONFIG.CONVENIO}/1`)
  console.log(`\nSmoke test (consultar boleto 1): HTTP ${r.status}`)
  console.log(r.body.slice(0, 300))
  console.log('\nPronto — pode rodar: node ailos-emitir-teste.cjs')
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
