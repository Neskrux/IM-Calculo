const path = require('path')
const dotenv = require('dotenv')

dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const llmConfig = {
  apiKey: process.env.OPENAI_API_KEY || '',
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  temperature: Number(process.env.OPENAI_TEMPERATURE || 0.1),
  maxInputChars: Number(process.env.OPENAI_MAX_INPUT_CHARS || 45000)
}

function ensureOpenAiConfig() {
  if (!llmConfig.apiKey) {
    const error = new Error('OPENAI_API_KEY nao configurada no ambiente')
    error.code = 'OPENAI_API_KEY_MISSING'
    throw error
  }
}

module.exports = {
  ensureOpenAiConfig,
  llmConfig
}
