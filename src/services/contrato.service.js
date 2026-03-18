const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3030'

export async function extrairContrato(file) {
  const formData = new FormData()
  formData.append('file', file)

  console.log('[contrato.service] enviando contrato para extracao', {
    nome: file?.name,
    size: file?.size,
    type: file?.type
  })

  const response = await fetch(`${BACKEND_BASE_URL}/vendas/extrair-contrato`, {
    method: 'POST',
    body: formData
  })

  const payload = await response.json().catch(() => null)

  console.log('[contrato.service] resposta recebida', {
    status: response.status,
    ok: response.ok,
    manualRequired: payload?.data?.manual_required ?? null,
    warningsCount: payload?.data?.warnings?.length ?? 0,
    sourceType: payload?.data?.document_meta?.source_type ?? null
  })

  if (!response.ok) {
    throw new Error(payload?.error || 'Nao foi possivel extrair os dados do contrato.')
  }

  return payload
}
