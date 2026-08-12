// Regenera os PDFs da homologação Ailos a partir dos JSONs já salvos
// (ailos-homolog-boleto-<n>.json) — SEM emitir boletos novos.
// Uso: node ailos-regerar-pdfs.cjs
// Útil quando só o layout do PDF muda (ex.: inclusão da logo pedida pela homologação).
const fs = require('fs')
const path = require('path')
const { CONFIG } = require('./ailos.cjs')
const { gerarBoletoPdf } = require('./ailos-boleto-pdf.cjs')

const iso = (d) => d.toISOString().slice(0, 10)

let ok = 0
for (let n = 1; n <= 5; n++) {
  const jsonPath = path.join(__dirname, `ailos-homolog-boleto-${n}.json`)
  if (!fs.existsSync(jsonPath)) continue
  const { payload, retorno } = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  const b = retorno?.boleto
  if (!b?.codigoBarras?.codigoBarras) { console.log(`[${n}] sem codigoBarras — pulado`); continue }

  const end = payload.pagador.endereco
  const dados = {
    linhaDigitavel: b.codigoBarras.linhaDigitavel,
    codigoBarras: b.codigoBarras.codigoBarras,
    nossoNumero: b.documento?.nossoNumero,
    beneficiario: {
      nome: b.beneficiario?.entidadeLegal?.nome || 'IM CONSTRUTORA E INCORPORADORA',
      cnpj: b.beneficiario?.entidadeLegal?.identificadorReceitaFederal || '14587169000102',
    },
    agenciaCodigo: `${CONFIG.AGENCIA} / ${CONFIG.CEDENTE}`,
    pagador: {
      nome: payload.pagador.entidadeLegal.nome,
      doc: payload.pagador.entidadeLegal.identificadorReceitaFederal,
      endereco: `${end.logradouro}, ${end.numero} - ${end.bairro} - ${end.cidade}/${end.uf} - CEP ${end.cep}`,
    },
    dataDocumento: payload.emissao.dataEmissaoDocumento,
    numeroDocumento: payload.documento.numeroDocumento,
    especieDoc: 'MENS',
    aceite: 'N',
    dataProcessamento: iso(new Date()),
    carteira: CONFIG.CARTEIRA,
    valor: payload.valorBoleto.valorNominal,
    vencimento: payload.vencimento.dataVencimento,
    instrucoes: [
      ...(payload.pagador.mensagemPagador || []),
      'Nao receber apos 60 dias do vencimento.',
    ],
    pixQrCodeBase64: b.pix?.qrCode || null,
    pixCopiaECola: b.pix?.copiaECola || null,
  }

  const pdfPath = path.join(__dirname, `ailos-homolog-boleto-${n}.pdf`)
  gerarBoletoPdf(dados, pdfPath)
  const kb = (fs.statSync(pdfPath).size / 1024).toFixed(0)
  console.log(`[${n}] ✓ nossoNumero ${dados.nossoNumero} → ${path.basename(pdfPath)} (${kb} KB)`)
  ok++
}
console.log(ok ? `\n${ok} PDF(s) regenerados com a logo.` : 'nenhum JSON encontrado')
