/**
 * Extrai texto de PDF com texto selecionável (SPEC: item 7).
 */

const { PDFParse } = require('pdf-parse')

async function extrair(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return ''
  }

  console.log('[extrairTextoPdf.service] iniciando parse PDF', {
    bytes: buffer.length
  })

  const parser = new PDFParse({ data: buffer })

  try {
    const result = await parser.getText()
    const textoLimpo = limparTextoPdf(result?.text)
    console.log('[extrairTextoPdf.service] parse concluido', {
      rawChars: result?.text?.length ?? 0,
      cleanedChars: textoLimpo.length
    })
    return textoLimpo
  } finally {
    if (typeof parser.destroy === 'function') {
      await parser.destroy()
    }
  }
}

function limparTextoPdf(texto) {
  if (!texto || typeof texto !== 'string') {
    return ''
  }

  return texto
    .replace(/\u0000/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

module.exports = {
  extrair
}
