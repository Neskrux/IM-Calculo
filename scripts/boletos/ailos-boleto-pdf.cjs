// Gerador de PDF de boleto AILOS (banco 085) — layout Febraban
// Recibo do Pagador + Ficha de Compensação + código de barras ITF-25 + QR Pix (bolePix).
//
// A API da Ailos NÃO devolve PDF: devolve codigoBarras/linhaDigitavel/pix.qrCode
// e o layout é responsabilidade do cooperado (Cartilha, seção de impressão).
// Este módulo monta o PDF a partir do retorno da emissão.
const { jsPDF } = require('jspdf')
const fs = require('fs')
const path = require('path')

// Logo oficial do Sistema Ailos (PNG 1011x347, fundo transparente — veio no zip
// da homologação). Fallback: texto "AILOS" se o arquivo não existir.
let LOGO_AILOS = null
try {
  LOGO_AILOS = fs.readFileSync(path.join(__dirname, 'ailos-logo.png')).toString('base64')
} catch { /* sem logo, usa texto */ }

// ---------- helpers ----------
const fmtBRL = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtData = (d) => {
  if (!d) return ''
  const s = String(d).slice(0, 10)
  const [a, m, dia] = s.split('-')
  return `${dia}/${m}/${a}`
}
const fmtCpfCnpj = (doc) => {
  const d = String(doc || '').replace(/\D/g, '')
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return String(doc || '')
}

// ---------- ITF-25 (Interleaved 2 of 5) ----------
// padrões por dígito: n=estreito, w=largo (5 elementos)
const ITF = {
  0: 'nnwwn', 1: 'wnnnw', 2: 'nwnnw', 3: 'wwnnn', 4: 'nnwnw',
  5: 'wnwnn', 6: 'nwwnn', 7: 'nnnww', 8: 'wnnwn', 9: 'nwnwn',
}
/**
 * Desenha o código de barras ITF do boleto (44 dígitos) no doc.
 * Módulo estreito ~0.254mm, largo 3x — largura total ~103mm (padrão Febraban).
 */
function drawITF(doc, codigo, x, y, altura = 13) {
  const dig = String(codigo).replace(/\D/g, '')
  if (dig.length % 2 !== 0) throw new Error('ITF exige quantidade par de dígitos')
  const n = 0.254           // módulo estreito (mm)
  const w = n * 3           // módulo largo
  let cx = x
  doc.setFillColor(0, 0, 0)
  const bar = (largura) => { doc.rect(cx, y, largura, altura, 'F'); cx += largura }
  const gap = (largura) => { cx += largura }

  // start: 4 módulos estreitos (barra, espaço, barra, espaço)
  bar(n); gap(n); bar(n); gap(n)
  // pares intercalados: dígito 1 nas barras, dígito 2 nos espaços
  for (let i = 0; i < dig.length; i += 2) {
    const b = ITF[dig[i]], s = ITF[dig[i + 1]]
    for (let j = 0; j < 5; j++) {
      bar(b[j] === 'w' ? w : n)
      gap(s[j] === 'w' ? w : n)
    }
  }
  // stop: barra larga, espaço estreito, barra estreita
  bar(w); gap(n); bar(n)
  return cx - x // largura desenhada
}

// ---------- layout ----------
const M = 8            // margem esquerda/direita (mm)
const LARG = 210 - 2 * M

/**
 * Gera o PDF do boleto Ailos.
 * @param dados {{
 *   linhaDigitavel, codigoBarras, nossoNumero,
 *   beneficiario: { nome, cnpj, endereco },
 *   agenciaCodigo,                       // "0101-5 / 20974370"
 *   pagador: { nome, doc, endereco },
 *   dataDocumento, numeroDocumento, especieDoc, aceite, dataProcessamento,
 *   carteira, valor, vencimento, localPagamento,
 *   instrucoes: string[],                // linhas de instrução
 *   pixQrCodeBase64, pixCopiaECola,      // opcionais (bolePix)
 * }}
 * @param caminho arquivo .pdf de saída
 */
function gerarBoletoPdf(dados, caminho) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  doc.setLineWidth(0.2)

  const cab = (x, y, wCol, label) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5)
    doc.text(label, x + 0.8, y + 2.2)
  }
  const val = (x, y, wCol, texto, { bold = true, size = 8, right = false } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size)
    const t = String(texto ?? '')
    if (right) doc.text(t, x + wCol - 1, y + 6, { align: 'right' })
    else doc.text(t, x + 0.8, y + 6)
  }

  // ===================== bloco (recibo ou ficha) =====================
  // desenha as linhas do boleto a partir de yTop; retorna y final
  const bloco = (yTop, titulo, comBarcode) => {
    let y = yTop

    // cabeçalho: logo Ailos | 085-0 | linha digitável
    if (LOGO_AILOS) {
      // 1011x347 → proporção ~2,91; altura 6,5mm → largura ~19mm, centrada na célula de 32mm
      doc.addImage(LOGO_AILOS, 'PNG', M + 2, y + 0.75, 19, 6.5, 'logoAilos', 'FAST')
    } else {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
      doc.text('AILOS', M + 2, y + 6)
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
    doc.line(M + 32, y, M + 32, y + 8)
    doc.setFontSize(13)
    doc.text('085-0', M + 34, y + 6)
    doc.line(M + 48, y, M + 48, y + 8)
    doc.setFontSize(comBarcode ? 10.5 : 9.5)
    doc.text(String(dados.linhaDigitavel || ''), M + LARG - 1, y + 6, { align: 'right' })
    doc.line(M, y + 8, M + LARG, y + 8)
    doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5)
    doc.text(titulo, M + LARG - 1, y - 1, { align: 'right' })
    y += 8

    const linha = (altura, cols) => {
      // cols: [{w, label, valor, opts}]
      let x = M
      for (const c of cols) {
        doc.rect(x, y, c.w, altura)
        if (c.label) cab(x, y, c.w, c.label)
        if (c.valor !== undefined) val(x, y, c.w, c.valor, c.opts)
        x += c.w
      }
      y += altura
    }

    const wDir = 42 // coluna da direita (vencimento/valores)

    linha(8, [
      { w: LARG - wDir, label: 'Local de Pagamento', valor: dados.localPagamento || 'PAGÁVEL PREFERENCIALMENTE NAS COOPERATIVAS DO SISTEMA AILOS', opts: { bold: false, size: 7 } },
      { w: wDir, label: 'Vencimento', valor: fmtData(dados.vencimento), opts: { right: true } },
    ])
    linha(8, [
      { w: LARG - wDir, label: 'Beneficiário', valor: `${dados.beneficiario.nome}  -  CNPJ: ${fmtCpfCnpj(dados.beneficiario.cnpj)}`, opts: { bold: false, size: 7.5 } },
      { w: wDir, label: 'Agência/Código Beneficiário', valor: dados.agenciaCodigo, opts: { right: true } },
    ])
    linha(8, [
      { w: 30, label: 'Data do Documento', valor: fmtData(dados.dataDocumento), opts: { bold: false, size: 7.5 } },
      { w: 40, label: 'Nº do Documento', valor: dados.numeroDocumento, opts: { bold: false, size: 7.5 } },
      { w: 22, label: 'Espécie Doc.', valor: dados.especieDoc || 'DM', opts: { bold: false, size: 7.5 } },
      { w: 16, label: 'Aceite', valor: dados.aceite || 'N', opts: { bold: false, size: 7.5 } },
      { w: LARG - wDir - 108, label: 'Data Processamento', valor: fmtData(dados.dataProcessamento), opts: { bold: false, size: 7.5 } },
      { w: wDir, label: 'Nosso Número', valor: dados.nossoNumero, opts: { right: true } },
    ])
    linha(8, [
      { w: 30, label: 'Uso do Banco', valor: '' },
      { w: 20, label: 'Carteira', valor: dados.carteira || '01', opts: { bold: false, size: 7.5 } },
      { w: 20, label: 'Espécie Moeda', valor: 'R$', opts: { bold: false, size: 7.5 } },
      { w: 24, label: 'Quantidade', valor: '' },
      { w: LARG - wDir - 94, label: '(x) Valor', valor: '' },
      { w: wDir, label: '(=) Valor do Documento', valor: fmtBRL(dados.valor), opts: { right: true } },
    ])

    // instruções (esq) + coluna de valores (dir)
    const hInstr = 30
    const xDir = M + LARG - wDir
    doc.rect(M, y, LARG - wDir, hInstr)
    cab(M, y, LARG - wDir, 'Instruções (texto de responsabilidade do beneficiário)')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
    const instrucoes = dados.instrucoes || []
    instrucoes.slice(0, 6).forEach((t, i) => doc.text(String(t), M + 1, y + 6 + i * 3.6))

    // QR Pix dentro do quadro de instruções (bolePix)
    if (dados.pixQrCodeBase64) {
      try {
        doc.addImage(dados.pixQrCodeBase64, 'PNG', M + LARG - wDir - 26, y + 3, 24, 24)
        doc.setFontSize(5.5)
        doc.text('Pague via Pix', M + LARG - wDir - 26 + 12, y + 29, { align: 'center' })
      } catch { /* QR inválido não derruba o PDF */ }
    }

    const sub = hInstr / 5
    const rotulos = ['(-) Desconto/Abatimento', '(-) Outras Deduções', '(+) Mora/Multa', '(+) Outros Acréscimos', '(=) Valor Cobrado']
    rotulos.forEach((r, i) => {
      doc.rect(xDir, y + i * sub, wDir, sub)
      cab(xDir, y + i * sub, wDir, r)
    })
    y += hInstr

    // pagador
    const hPag = 14
    doc.rect(M, y, LARG, hPag)
    cab(M, y, LARG, 'Pagador')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
    doc.text(`${dados.pagador.nome}  -  ${fmtCpfCnpj(dados.pagador.doc)}`, M + 1, y + 6)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    doc.text(String(dados.pagador.endereco || ''), M + 1, y + 10)
    y += hPag

    doc.setFont('helvetica', 'normal'); doc.setFontSize(6)
    doc.text('Sacador/Avalista:', M, y + 3.5)
    doc.text(comBarcode ? 'Autenticação Mecânica — FICHA DE COMPENSAÇÃO' : 'Autenticação Mecânica — RECIBO DO PAGADOR',
      M + LARG, y + 3.5, { align: 'right' })
    y += 6

    if (comBarcode) {
      drawITF(doc, dados.codigoBarras, M, y + 2, 13)
      y += 17
    }
    return y
  }

  // ============ página ============
  let y = bloco(14, 'RECIBO DO PAGADOR', false)

  // linha de corte
  y += 4
  doc.setLineDashPattern([1.2, 1.2], 0)
  doc.line(M, y, M + LARG, y)
  doc.setLineDashPattern([], 0)
  doc.setFontSize(6); doc.text('corte na linha pontilhada', M + LARG, y - 1, { align: 'right' })
  y += 6

  bloco(y, 'FICHA DE COMPENSAÇÃO', true)

  doc.save(caminho)
  return caminho
}

module.exports = { gerarBoletoPdf, drawITF }
