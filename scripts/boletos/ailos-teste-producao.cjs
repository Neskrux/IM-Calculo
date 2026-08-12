// TESTE DE PRODUÇÃO da homologação Ailos — emite os 2 boletos REAIS de R$ 10,00
// que a equipe de homologação pediu (e-mail 2026-08-10):
//   Boleto 1: com BolePIX  → pagar via QR Code / Pix copia-e-cola
//   Boleto 2: SEM BolePIX  → pagar pelo código de barras tradicional
//
// ⚠️ PRODUÇÃO: boletos reais registrados na Nuclea, na conta 20974370 da IM.
//    Os R$ 20,00 pagos caem na própria conta da IM (menos tarifas).
//
// Uso:
//   AILOS_ENV=producao node ailos-login.cjs          (1x — autorizar cooperado em produção)
//   AILOS_ENV=producao node ailos-teste-producao.cjs
//
// Saída: ailos-producao-teste-{1,2}.json + .pdf + instruções de pagamento no console.
const fs = require('fs')
const path = require('path')
const { CONFIG, ailosApi } = require('./ailos.cjs')
const { gerarBoletoPdf } = require('./ailos-boleto-pdf.cjs')

if (CONFIG.AMBIENTE !== 'producao') {
  console.error('ERRO: rode com AILOS_ENV=producao (este teste é o de produção pedido pela Ailos).')
  process.exit(1)
}

// Pagador real do teste: Bruno (vai efetuar os 2 pagamentos)
const PAGADOR = {
  cpf: '11888503939',
  nome: 'BRUNO SANDOVAL RIBEIRO',
  endereco: {
    cep: '80010000',
    logradouro: 'AV REPUBLICA ARGENTINA',
    numero: '1237',
    complemento: 'AP 1501',
    bairro: 'AGUA VERDE',
    cidade: 'CURITIBA',
    uf: 'PR',
  },
}

const hoje = new Date()
const iso = (d) => d.toISOString().slice(0, 10)
const maisDias = (n) => { const d = new Date(hoje); d.setDate(d.getDate() + n); return d }

// descricaoDocumento: máx 15 caracteres (validador de produção, 2026-08-11)
const TESTES = [
  { n: 1, bolePix: true,  desc: 'TESTE-PROD-PIX', msg: 'Teste homologacao producao - pagar via QR Pix' },
  { n: 2, bolePix: false, desc: 'TESTE-PROD-BAR', msg: 'Teste homologacao producao - pagar via codigo de barras' },
]

function montarPayload(t) {
  const numeroDocumento = Number(String(Date.now()).slice(-8)) + t.n
  return {
    convenioCobranca: { codigoCarteiraCobranca: Number(CONFIG.CARTEIRA) },
    documento: {
      numeroDocumento,
      descricaoDocumento: t.desc,
      especieDocumento: 4, // MENS
    },
    emissao: { formaEmissao: 2, dataEmissaoDocumento: iso(hoje) },
    pagador: {
      entidadeLegal: {
        identificadorReceitaFederal: PAGADOR.cpf,
        tipoPessoa: 1,
        nome: PAGADOR.nome,
      },
      emails: [],
      endereco: PAGADOR.endereco,
      mensagemPagador: [t.msg],
    },
    vencimento: { dataVencimento: iso(maisDias(7)) },
    instrucoes: {
      valorAbatimento: 0,
      tipoMulta: 3, valorMulta: 0,
      tipoJurosMora: 3, valorJurosMora: 0,
      diasNegativacao: 0, diasProtesto: 0,
    },
    valorBoleto: { valorNominal: 10.00 },
    avisoSms: {
      enviarAvisoVencimentoSms: 0,
      enviarAvisoVencimentoSmsAntesVencimento: false,
      enviarAvisoVencimentoSmsDiaVencimento: false,
      enviarAvisoVencimentoSmsAposVencimento: false,
    },
    pagamentoDivergente: { tipoPagamentoDivergente: 0, valorMinimoPagamentoDivergente: 0 },
    indicadorRegistroNuclea: 1,
    bolePix: t.bolePix,
  }
}

;(async () => {
  console.log(`⚠️  PRODUÇÃO Ailos · convênio ${CONFIG.CONVENIO} · conta ${CONFIG.CEDENTE}`)
  console.log('Emitindo 2 boletos REAIS de R$ 10,00 (teste final da homologação)\n')

  for (const t of TESTES) {
    // idempotência: boleto já emitido com sucesso não re-emite (evita duplicar cobrança real)
    const jsonAnterior = path.join(__dirname, `ailos-producao-teste-${t.n}.json`)
    if (fs.existsSync(jsonAnterior)) {
      const prev = JSON.parse(fs.readFileSync(jsonAnterior, 'utf8'))
      if ((prev.status === 200 || prev.status === 201) && prev.retorno?.boleto) {
        console.log(`[${t.n}/2] ${t.desc} — já emitido (nossoNumero ${prev.retorno.boleto?.documento?.nossoNumero}), pulando`)
        continue
      }
    }

    const payload = montarPayload(t)
    console.log(`[${t.n}/2] ${t.desc} — bolePix=${t.bolePix}, venc ${payload.vencimento.dataVencimento}`)

    const r = await ailosApi('POST',
      `/ailos/cobranca/api/v2/boletos/gerar/boleto/convenios/${CONFIG.CONVENIO}`, payload)

    const jsonPath = path.join(__dirname, `ailos-producao-teste-${t.n}.json`)
    fs.writeFileSync(jsonPath, JSON.stringify({ status: r.status, payload, retorno: tryJson(r.body) }, null, 2))

    if (r.status !== 200 && r.status !== 201) {
      console.error(`  ✗ HTTP ${r.status}: ${r.body.slice(0, 400)}`)
      continue
    }

    const b = tryJson(r.body)?.boleto
    const end = PAGADOR.endereco
    const dados = {
      linhaDigitavel: b?.codigoBarras?.linhaDigitavel,
      codigoBarras: b?.codigoBarras?.codigoBarras,
      nossoNumero: b?.documento?.nossoNumero,
      beneficiario: {
        nome: b?.beneficiario?.entidadeLegal?.nome || 'IM CONSTRUTORA E INCORPORADORA',
        cnpj: b?.beneficiario?.entidadeLegal?.identificadorReceitaFederal || '14587169000102',
      },
      agenciaCodigo: `${CONFIG.AGENCIA} / ${CONFIG.CEDENTE}`,
      pagador: {
        nome: PAGADOR.nome, doc: PAGADOR.cpf,
        endereco: `${end.logradouro}, ${end.numero} ${end.complemento} - ${end.bairro} - ${end.cidade}/${end.uf} - CEP ${end.cep}`,
      },
      dataDocumento: payload.emissao.dataEmissaoDocumento,
      numeroDocumento: payload.documento.numeroDocumento,
      especieDoc: 'MENS', aceite: 'N',
      dataProcessamento: iso(hoje),
      carteira: CONFIG.CARTEIRA,
      valor: 10.00,
      vencimento: payload.vencimento.dataVencimento,
      instrucoes: [t.msg, 'Nao receber apos 60 dias do vencimento.'],
      pixQrCodeBase64: b?.pix?.qrCode || null,
      pixCopiaECola: b?.pix?.copiaECola || null,
    }

    const pdfPath = path.join(__dirname, `ailos-producao-teste-${t.n}.pdf`)
    gerarBoletoPdf(dados, pdfPath)
    console.log(`  ✓ nossoNumero ${dados.nossoNumero} · ${path.basename(pdfPath)}`)
    console.log(`  linha digitável: ${dados.linhaDigitavel}`)
    if (t.bolePix && dados.pixCopiaECola) {
      console.log(`  Pix copia-e-cola:\n  ${dados.pixCopiaECola}`)
    }
    console.log('')
  }

  console.log('COMO PAGAR (conforme pedido da Ailos):')
  console.log('  Boleto 1 → pelo QR Code do PDF ou Pix copia-e-cola acima')
  console.log('  Boleto 2 → pela linha digitável/código de barras (app do banco, seção Boletos)')
  console.log('Depois dos 2 pagamentos compensarem, responder o e-mail da Ailos confirmando.')
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })

function tryJson(s) { try { return JSON.parse(s) } catch { return s } }
