const crypto = require('crypto')

/**
 * Gera hash do conteúdo do arquivo para cache (SPEC: item 14).
 * @param {Buffer} buffer - Conteúdo do arquivo
 * @returns {string} Hash hexadecimal (ex.: sha256)
 */
function gerarHashArquivo(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('buffer deve ser um Buffer')
  }
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

module.exports = {
  gerarHashArquivo
}
