// Emissão de boletos de TESTE na homologação Ailos + geração dos PDFs
// que a equipe de homologação pede (3 exemplares).
//
// Uso: node ailos-emitir-teste.cjs           (emite 3 boletos de teste)
//      node ailos-emitir-teste.cjs 1         (emite só 1)
//
// Pré-requisito: node ailos-login.cjs (autorização do cooperado gravada).
// Saída: ailos-homolog-boleto-<n>.json (retorno cru) + .pdf (layout pra validação).
// NÃO grava na tabela boletos — homologação é ambiente de teste, sem vínculo
// com parcelas reais. A integração com o sistema entra depois da produção.
const fs = require('fs')
const path = require('path')
const { CONFIG, ailosApi } = require('./ailos.cjs')
const { gerarBoletoPdf } = require('./ailos-boleto-pdf.cjs')

const QTD = Math.max(1, Math.min(5, Number(process.argv[2]) || 3))

// pagador fictício de homologação (CPF de teste válido por dígito verificador)
const PAGADOR_TESTE = {
  cpf: '11144477735',
  nome: 'PAGADOR TESTE HOMOLOGACAO',
  endereco: {
    cep: '89010000',
    logradouro: 'RUA TESTE DE HOMOLOGACAO',
    numero: '100',
    complemento: 'SALA 1',
    bairro: 'CENTRO',
    cidade: 'BLUMENAU',
    uf: 'SC',
  },
}

const hoje = new Date()
const iso = (d) => d.toISOString().slice(0, 10)
const maisDias = (n) => { const d = new Date(hoje); d.setDate(d.getDate() + n); return d }

function montarPayload(n) {
  // numeroDocumento: int até 9 dígitos, único por convênio — derivado do relógio
  const numeroDocumento = Number(String(Date.now()).slice(-8)) + n
  return {
    convenioCobranca: {
      codigoCarteiraCobranca: Number(CONFIG.CARTEIRA), // carteira 01
    },
    documento: {
      numeroDocumento,
      descricaoDocumento: `TESTE-HML-${n}`,
      especieDocumento: 4, // MENS – mensalidade (parcela de imóvel)
    },
    emissao: {
      formaEmissao: 2, // cooperado emite e expede (nós geramos o PDF)
      dataEmissaoDocumento: iso(hoje),
    },
    pagador: {
      entidadeLegal: {
        identificadorReceitaFederal: PAGADOR_TESTE.cpf,
        tipoPessoa: 1, // física
        nome: PAGADOR_TESTE.nome,
      },
      emails: [],
      endereco: PAGADOR_TESTE.endereco,
      mensagemPagador: [`Parcela de teste ${n} - homologacao IM`],
    },
    vencimento: {
      dataVencimento: iso(maisDias(10 + n * 5)),
    },
    instrucoes: {
      valorAbatimento: 0,
      tipoMulta: 3,      // isento (decisão juros/multa pendente — igual Sicoob)
      valorMulta: 0,
      tipoJurosMora: 3,  // isento
      valorJurosMora: 0,
      diasNegativacao: 0,
      diasProtesto: 0,
    },
    valorBoleto: {
      valorNominal: 100 * n + 0.5, // valores distintos: 100,50 / 200,50 / 300,50
    },
    avisoSms: {
      enviarAvisoVencimentoSms: 0,
      enviarAvisoVencimentoSmsAntesVencimento: false,
      enviarAvisoVencimentoSmsDiaVencimento: false,
      enviarAvisoVencimentoSmsAposVencimento: false,
    },
    pagamentoDivergente: {
      tipoPagamentoDivergente: 0,
      valorMinimoPagamentoDivergente: 0,
    },
    indicadorRegistroNuclea: 1, // registro online
    bolePix: true,              // QR Code Pix no boleto
  }
}

function dadosPdf(ret, payload) {
  const b = ret.boleto || ret
  return {
    linhaDigitavel: b?.codigoBarras?.linhaDigitavel,
    codigoBarras: b?.codigoBarras?.codigoBarras,
    nossoNumero: b?.documento?.nossoNumero,
    beneficiario: {
      nome: b?.beneficiario?.entidadeLegal?.nome || 'IM CONSTRUTORA E INCORPORADORA',
      cnpj: b?.beneficiario?.entidadeLegal?.identificadorReceitaFederal || '14587169000102',
    },
    agenciaCodigo: `${CONFIG.AGENCIA} / ${CONFIG.CEDENTE}`,
    pagador: {
      nome: payload.pagador.entidadeLegal.nome,
      doc: payload.pagador.entidadeLegal.identificadorReceitaFederal,
      endereco: `${PAGADOR_TESTE.endereco.logradouro}, ${PAGADOR_TESTE.endereco.numero} - ${PAGADOR_TESTE.endereco.bairro} - ${PAGADOR_TESTE.endereco.cidade}/${PAGADOR_TESTE.endereco.uf} - CEP ${PAGADOR_TESTE.endereco.cep}`,
    },
    dataDocumento: payload.emissao.dataEmissaoDocumento,
    numeroDocumento: payload.documento.numeroDocumento,
    especieDoc: 'MENS',
    aceite: 'N',
    dataProcessamento: iso(hoje),
    carteira: CONFIG.CARTEIRA,
    valor: payload.valorBoleto.valorNominal,
    vencimento: payload.vencimento.dataVencimento,
    instrucoes: [
      ...payload.pagador.mensagemPagador,
      'Nao receber apos 60 dias do vencimento.',
    ],
    pixQrCodeBase64: b?.pix?.qrCode || null,
    pixCopiaECola: b?.pix?.copiaECola || null,
  }
}

;(async () => {
  console.log(`Ambiente: ${CONFIG.AMBIENTE} · convênio ${CONFIG.CONVENIO} · emitindo ${QTD} boleto(s) de teste\n`)

  for (let n = 1; n <= QTD; n++) {
    const payload = montarPayload(n)
    console.log(`[${n}/${QTD}] POST gerar boleto — doc ${payload.documento.numeroDocumento}, R$ ${payload.valorBoleto.valorNominal}, venc ${payload.vencimento.dataVencimento}`)

    const r = await ailosApi('POST',
      `/ailos/cobranca/api/v2/boletos/gerar/boleto/convenios/${CONFIG.CONVENIO}`, payload)

    const jsonPath = path.join(__dirname, `ailos-homolog-boleto-${n}.json`)
    fs.writeFileSync(jsonPath, JSON.stringify({ status: r.status, payload, retorno: tryJson(r.body) }, null, 2))

    if (r.status !== 200 && r.status !== 201) {
      console.error(`  ✗ HTTP ${r.status}: ${r.body.slice(0, 400)}`)
      console.error(`  (retorno salvo em ${path.basename(jsonPath)})`)
      continue
    }

    const ret = tryJson(r.body)
    const dados = dadosPdf(ret, payload)
    if (!dados.codigoBarras || !dados.linhaDigitavel) {
      console.error('  ✗ retorno sem codigoBarras/linhaDigitavel — ver JSON salvo')
      continue
    }

    const pdfPath = path.join(__dirname, `ailos-homolog-boleto-${n}.pdf`)
    gerarBoletoPdf(dados, pdfPath)
    console.log(`  ✓ nossoNumero ${dados.nossoNumero} · ${path.basename(pdfPath)}`)
  }

  console.log('\nPronto. Confira os PDFs e envie os 3 pra homologacaocobranca@ailos.coop.br')
  console.log('(responder no MESMO e-mail, sem mudar o assunto — protocolo Ailos)')
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })

function tryJson(s) { try { return JSON.parse(s) } catch { return s } }
