// IO do registro de emissão (Supabase). Lógica pura em ./registroRelatorio.js
import { supabase } from '../lib/supabase'
import { BUCKET_RELATORIOS, caminhoPdfRelatorio, montarRegistroEmissao } from './registroRelatorio'

async function sha256Hex(blob) {
  const buf = typeof blob.arrayBuffer === 'function'
    ? await blob.arrayBuffer()
    : await new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = falha; r.readAsArrayBuffer(blob) })
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Sobe o PDF no bucket privado e grava o registro. Lança erro se qualquer passo falhar —
 * quem chama NÃO deve baixar o PDF nesse caso.
 */
export async function registrarEmissao({ blob, origem, corretorId, filtros, totais, parcelas }) {
  const id = crypto.randomUUID()
  const pdfPath = caminhoPdfRelatorio(corretorId, id)
  const pdfSha256 = await sha256Hex(blob)
  const row = montarRegistroEmissao({
    id, origem, corretorId, filtros, totais, parcelas, pdfPath, pdfSha256,
    versaoApp: import.meta.env?.VITE_APP_VERSION || import.meta.env?.MODE || null,
  })

  const { error: upErr } = await supabase.storage
    .from(BUCKET_RELATORIOS)
    .upload(pdfPath, blob, { contentType: 'application/pdf', upsert: false })
  if (upErr) throw new Error(`Não foi possível salvar o PDF do relatório: ${upErr.message}`)

  const { data, error } = await supabase.from('relatorios_emitidos').insert(row).select().single()
  if (error) throw new Error(`Não foi possível registrar a emissão do relatório: ${error.message}`)
  return data
}

/** Signed URL de um PDF já emitido (bucket privado). */
export async function urlPdfRelatorio(pdfPath) {
  const { data, error } = await supabase.storage.from(BUCKET_RELATORIOS).createSignedUrl(pdfPath, 300)
  if (error) throw new Error(`Não foi possível abrir o PDF: ${error.message}`)
  return data.signedUrl
}

export function baixarBlob(blob, nomeArquivo) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nomeArquivo
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
