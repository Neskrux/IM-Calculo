/**
 * Controller: recebe request, chama service, devolve response (SPEC - sem regra de negócio).
 */

const { extrairContrato } = require('../services/contratoExtracao/extrairContrato.service')

const FORMATOS_ACEITOS = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png'
]

async function extrairContratoHandler(req, res) {
  const file = req.file
  if (!file) {
    return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado. Use o campo "file".' })
  }

  console.log('[contratos.controller] upload recebido', {
    nome: file.originalname,
    mimetype: file.mimetype,
    size: file.size
  })

  if (!FORMATOS_ACEITOS.includes(file.mimetype)) {
    return res.status(400).json({
      success: false,
      error: 'Formato não aceito. Use PDF, DOC, DOCX, JPG ou PNG.'
    })
  }

  const result = await extrairContrato(file.buffer, file.originalname, file.mimetype)

  console.log('[contratos.controller] resultado da extracao', {
    success: result.success,
    manualRequired: result.data?.manual_required ?? null,
    sourceType: result.data?.document_meta?.source_type ?? null,
    warningsCount: result.data?.warnings?.length ?? 0
  })

  if (!result.success) {
    return res.status(422).json(result)
  }

  return res.status(200).json(result)
}

module.exports = {
  extrairContratoHandler
}
