const { contratoExtracaoSchema } = require('../../schemas/contratoExtracao.schema')

function parseContratoExtracao(data) {
  const result = contratoExtracaoSchema.safeParse(data)

  if (!result.success) {
    const errors = result.error.issues.map((issue) => issue.path.join('.') || issue.message)
    const error = new Error('Resposta estruturada invalida do LLM')
    error.details = errors
    throw error
  }

  return result.data
}

module.exports = {
  parseContratoExtracao
}
