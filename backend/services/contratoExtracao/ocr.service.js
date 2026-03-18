/**
 * OCR para PDF escaneado / imagem (SPEC: item 7 - fallback).
 * Stub: retorna string vazia até integrar Tesseract ou API.
 */

async function extrair(buffer, mimetype) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { text: '', sourceType: 'ocr' }
  }
  // TODO: integrar Tesseract ou Document AI / Textract
  return { text: '', sourceType: 'ocr' }
}

module.exports = {
  extrair
}
