// WORKER: baixa os PDFs OFICIAIS dos boletos de produção (segunda via, mTLS)
// e envia pro Storage via edge function /armazenar-pdf. Idempotente: só
// processa boletos sem pdf_path. Rodar SEMPRE após um lote de emissão.
const { CONFIG, SUPABASE_URL, supabase, dormir, obterToken, sicoobApi, workerSecret } = require('./sicoob.cjs')

async function armazenar(boletoId, pdfB64) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/sicoob-boletos/armazenar-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worker_secret: workerSecret(), boleto_id: boletoId, pdf_base64: pdfB64 }),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

async function main() {
  const { data: boletos, error } = await supabase
    .from('boletos')
    .select('id, nosso_numero, pdf_path, status')
    .eq('ambiente', 'producao')
    .is('pdf_path', null)
    .not('nosso_numero', 'is', null)
    .order('nosso_numero')
  if (error) throw new Error(error.message)
  console.log(`boletos de produção sem PDF armazenado: ${boletos.length}`)
  if (boletos.length === 0) { console.log('nada a fazer.'); return }

  let token = await obterToken('boletos_consulta')
  let ok = 0
  const erros = []

  for (let i = 0; i < boletos.length; i++) {
    const b = boletos[i]
    if (i > 0 && i % 40 === 0) token = await obterToken('boletos_consulta')

    const qs = `numeroCliente=${CONFIG.NUMERO_CLIENTE}&codigoModalidade=1&nossoNumero=${b.nosso_numero}&gerarPdf=true`
    const resp = await sicoobApi(token, 'GET', `/boletos/segunda-via?${qs}`)

    let pdf = null
    try {
      const j = JSON.parse(resp.body)
      pdf = (j.resultado ?? j).pdfBoleto ?? null
    } catch { /* corpo não-JSON */ }

    if (resp.status === 200 && pdf) {
      const arm = await armazenar(b.id, pdf)
      if (arm.status === 200 && arm.body.ok) ok++
      else erros.push(`nossoNumero ${b.nosso_numero}: armazenar falhou ${arm.status} ${JSON.stringify(arm.body).slice(0, 120)}`)
    } else {
      erros.push(`nossoNumero ${b.nosso_numero}: segunda-via HTTP ${resp.status} ${resp.body.slice(0, 120)}`)
    }
    process.stdout.write(`\r${i + 1}/${boletos.length} armazenados=${ok} erros=${erros.length}   `)
    await dormir(250)
  }

  console.log(`\n\nFINAL: ${ok} PDFs armazenados | ${erros.length} erros`)
  if (erros.length) console.log('erros:\n  ' + erros.slice(0, 15).join('\n  '))
}
main().catch(e => { console.error('\nERRO FATAL:', e.message); process.exit(1) })
