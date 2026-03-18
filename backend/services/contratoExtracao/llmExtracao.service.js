/**
 * Envia texto do contrato ao LLM e recebe JSON estruturado (SPEC: item 8).
 */

const OpenAI = require('openai')
const { zodResponseFormat } = require('openai/helpers/zod')
const { llmConfig, ensureOpenAiConfig } = require('../../config/llm.config')
const { contratoExtracaoSchema } = require('../../schemas/contratoExtracao.schema')
const { parseContratoExtracao } = require('../../utils/contrato/validators')

async function extrair(texto) {
  if (!texto || typeof texto !== 'string') {
    return {
      sale: {},
      pro_soluto: {},
      meta: { confidence: {}, warnings: ['Texto do contrato nao disponivel'], source_type: '' }
    }
  }

  ensureOpenAiConfig()

  const client = new OpenAI({ apiKey: llmConfig.apiKey })
  const safeText = texto.slice(0, llmConfig.maxInputChars)

  console.log('[llmExtracao.service] chamando OpenAI', {
    model: llmConfig.model,
    inputChars: safeText.length,
    truncated: texto.length > safeText.length
  })

  try {
    const completion = await client.beta.chat.completions.parse({
      model: llmConfig.model,
      temperature: llmConfig.temperature,
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt()
        },
        {
          role: 'user',
          content: [
            'Extraia os dados do contrato imobiliario abaixo e devolva somente a estrutura solicitada.',
            '',
            safeText
          ].join('\n')
        }
      ],
      response_format: zodResponseFormat(contratoExtracaoSchema, 'contrato_extracao')
    })

    const parsed = completion.choices?.[0]?.message?.parsed
    console.log('[llmExtracao.service] resposta estruturada recebida', {
      hasSale: Boolean(parsed?.sale),
      hasProSoluto: Boolean(parsed?.pro_soluto),
      warningCount: parsed?.meta?.warnings?.length ?? 0,
      fields: {
        cliente_nome: Boolean(parsed?.sale?.cliente_nome),
        corretor_nome: Boolean(parsed?.sale?.corretor_nome),
        empreendimento_nome: Boolean(parsed?.sale?.empreendimento_nome),
        valor_venda: parsed?.sale?.valor_venda != null
      }
    })
    return parseContratoExtracao(parsed)
  } catch (error) {
    console.log('[llmExtracao.service] falha ao estruturar retorno', {
      message: error.message,
      details: Array.isArray(error.details) ? error.details : []
    })
    const warnings = ['Nao foi possivel estruturar automaticamente todos os dados do contrato.']
    if (Array.isArray(error.details) && error.details.length > 0) {
      warnings.push(`Detalhes de validacao: ${error.details.join(', ')}`)
    }

    return {
      sale: {},
      pro_soluto: {},
      meta: {
        confidence: {},
        warnings,
        source_type: ''
      }
    }
  }
}

function buildSystemPrompt() {
  return [
    'Voce extrai dados de contratos imobiliarios para pre-preenchimento de vendas.',
    'Responda apenas no formato estruturado solicitado.',
    'Nao invente dados ausentes.',
    'Quando houver incerteza, deixe campos vazios/null e adicione avisos em meta.warnings.',
    "Considere as regras de negocio: status sempre sera normalizado para pendente; tipo_corretor sera normalizado para externo; valor_pro_soluto e apenas referencia; grupos devem refletir parcelas e baloes quando identificados."
  ].join(' ')
}

module.exports = {
  extrair
}
