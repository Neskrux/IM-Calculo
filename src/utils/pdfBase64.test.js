import { describe, it, expect } from 'vitest'
import { base64ParaBytes, base64ParaPdfBlob } from './pdfBase64'

// btoa/atob existem no jsdom
const b64pdf = btoa('%PDF-1.4 conteudo de teste')
const texto = (bytes) => new TextDecoder().decode(bytes)

describe('base64ParaBytes / base64ParaPdfBlob', () => {
  it('decodifica base64 válido', () => {
    expect(texto(base64ParaBytes(b64pdf))).toContain('%PDF-1.4')
    expect(base64ParaPdfBlob(b64pdf).type).toBe('application/pdf')
  })

  it('tolera base64 sem padding (caso real do sandbox Sicoob)', () => {
    const semPadding = b64pdf.replace(/=+$/, '')
    expect(texto(base64ParaBytes(semPadding))).toContain('%PDF-1.4')
  })

  it('tolera base64 truncado com comprimento ≡ 1 (mod 4)', () => {
    let truncado = b64pdf.replace(/=+$/, '')
    while (truncado.length % 4 !== 1) truncado = truncado.slice(0, -1)
    // não deve lançar InvalidCharacterError
    expect(() => base64ParaBytes(truncado)).not.toThrow()
  })

  it('remove quebras de linha e espaços', () => {
    const sujo = b64pdf.match(/.{1,10}/g).join('\n')
    expect(texto(base64ParaBytes(sujo))).toContain('%PDF-1.4')
  })
})
