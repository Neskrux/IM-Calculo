// Converte base64 em Blob de PDF de forma TOLERANTE.
//
// Por quê: o atob() do navegador é estrito (exige comprimento múltiplo de 4);
// o sandbox do Sicoob devolve pdfBoleto com base64 truncado/sem padding e o
// download quebrava com InvalidCharacterError. Aqui limpamos sujeira, cortamos
// resto inválido e re-padronizamos antes de decodificar.
export function base64ParaBytes(b64) {
  let s = String(b64 ?? '').replace(/[^A-Za-z0-9+/=]/g, '').replace(/=+$/, '')
  // comprimento ≡ 1 (mod 4) é irrecuperável — descarta o último char (truncamento)
  if (s.length % 4 === 1) s = s.slice(0, -1)
  const resto = s.length % 4
  if (resto) s += '='.repeat(4 - resto)
  return Uint8Array.from(atob(s), c => c.charCodeAt(0))
}

export function base64ParaPdfBlob(b64) {
  return new Blob([base64ParaBytes(b64)], { type: 'application/pdf' })
}

// Dispara o download de um PDF vindo em base64.
export function baixarPdfBase64(b64, nomeArquivo) {
  const blob = base64ParaPdfBlob(b64)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  a.click()
  URL.revokeObjectURL(url)
}
