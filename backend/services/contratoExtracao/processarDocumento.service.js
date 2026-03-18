/**
 * Decide se extrai texto do PDF ou cai em fallback manual (MVP).
 * OCR continua fora do MVP imediato.
 */

const extrairTextoPdf = require('./extrairTextoPdf.service')

const MIN_CHARS_PDF = 100

/**
 * @param {Buffer} buffer - Conteúdo do arquivo
 * @param {string} mimetype - Ex.: application/pdf, image/png
 * @param {string} originalName - Nome original do arquivo
 * @returns {Promise<{ text: string, sourceType: string, manualRequired?: boolean, warnings?: string[] }>}
 */
async function processar(buffer, mimetype, originalName) {
  const isPdf = mimetype === 'application/pdf' || (originalName && originalName.toLowerCase().endsWith('.pdf'))

  console.log('[processarDocumento.service] iniciando', {
    nome: originalName,
    mimetype,
    isPdf
  })

  if (isPdf) {
    try {
      const text = await extrairTextoPdf.extrair(buffer)
      console.log('[processarDocumento.service] resultado PDF', {
        chars: text?.trim()?.length ?? 0,
        minChars: MIN_CHARS_PDF
      })
      if (text && text.trim().length >= MIN_CHARS_PDF) {
        return { text: text.trim(), sourceType: 'pdf_text' }
      }
    } catch (error) {
      console.log('[processarDocumento.service] fallback manual por erro no parse', {
        motivo: 'pdf_parse_error',
        message: error.message
      })
      return {
        text: '',
        sourceType: 'pdf_parse_error',
        manualRequired: true,
        warnings: ['Nao foi possivel ler automaticamente este PDF. Siga com preenchimento manual.']
      }
    }

    return {
      text: '',
      sourceType: 'pdf_text_insuficiente',
      manualRequired: true,
      warnings: ['Nao foi possivel extrair texto automaticamente deste documento. Siga com preenchimento manual.']
    }
  }

  return {
    text: '',
    sourceType: 'manual_only_format',
    manualRequired: true,
    warnings: ['Este formato ainda nao possui extracao automatica no MVP. Siga com preenchimento manual.']
  }
}

module.exports = {
  processar
}
