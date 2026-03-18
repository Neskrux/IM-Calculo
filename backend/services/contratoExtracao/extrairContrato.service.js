/**
 * Orquestrador da extração de contrato (SPEC: fluxo backend).
 * Responsável por: hash → cache? → extrair texto → LLM → normalizar → matching → cache.save → resposta.
 */

const { gerarHashArquivo } = require('../../utils/contrato/hash')
const cache = require('./cache.service')
const processarDocumento = require('./processarDocumento.service')
const llmExtracao = require('./llmExtracao.service')
const normalizacao = require('./normalizacao.service')
const matching = require('./matching.service')

/**
 * Extrai dados do contrato para pré-preenchimento do formulário de venda.
 *
 * @param {Buffer} buffer - Conteúdo do arquivo (PDF, DOC, DOCX, JPG, PNG)
 * @param {string} originalName - Nome original do arquivo
 * @param {string} mimetype - Tipo MIME (ex.: application/pdf)
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
async function extrairContrato(buffer, originalName, mimetype) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { success: false, error: 'Arquivo inválido ou vazio' }
  }

  const hash = gerarHashArquivo(buffer)

  console.log('[extrairContrato.service] inicio', {
    nome: originalName,
    mimetype,
    bytes: buffer.length,
    hash: hash.slice(0, 12)
  })

  try {
    const cached = await cache.get(hash)
    if (cached?.schema_extraido_json) {
      console.log('[extrairContrato.service] retorno via cache', {
        hash: hash.slice(0, 12),
        manualRequired: Boolean(cached.schema_extraido_json.manual_required),
        warningsCount: cached.schema_extraido_json.warnings?.length ?? 0
      })
      return buildResponse({
        saleForm: cached.schema_extraido_json.sale_form,
        valorProSolutoExtraido: cached.schema_extraido_json.valor_pro_soluto_extraido ?? null,
        entityMatches: cached.matching_json ?? {},
        confidence: cached.schema_extraido_json.confidence ?? {},
        warnings: cached.schema_extraido_json.warnings ?? [],
        manualRequired: Boolean(cached.schema_extraido_json.manual_required),
        documentMeta: {
          hash,
          source_type: cached.origem_texto ?? 'pdf_text'
        }
      })
    }

    const {
      text,
      sourceType,
      manualRequired: manualFromDocument = false,
      warnings: documentWarnings = []
    } = await processarDocumento.processar(buffer, mimetype, originalName)

    console.log('[extrairContrato.service] documento processado', {
      sourceType,
      manualFromDocument,
      extractedChars: text?.length ?? 0,
      documentWarnings: documentWarnings.length
    })

    if (manualFromDocument || !text || text.trim().length === 0) {
      console.log('[extrairContrato.service] encerrando com manual_required', {
        sourceType,
        warningsCount: documentWarnings.length
      })
      return buildResponse({
        saleForm: {},
        valorProSolutoExtraido: null,
        entityMatches: {},
        confidence: {},
        warnings: documentWarnings,
        manualRequired: true,
        documentMeta: { hash, source_type: sourceType }
      })
    }

    const rawJson = await llmExtracao.extrair(text)
    const { saleForm, valorProSolutoExtraido, confidence, warnings, rawSale } = normalizacao.normalizar(rawJson)

    console.log('[extrairContrato.service] normalizacao concluida', {
      saleFields: Object.keys(saleForm || {}).filter((key) => saleForm[key] !== '' && saleForm[key] != null).length,
      confidenceFields: Object.keys(confidence || {}).length,
      warningsCount: warnings.length,
      valorProSolutoExtraido
    })

    const matchingResult = await matching.resolver(saleForm, rawJson?.sale ?? rawSale)
    const entityMatches = {
      cliente: matchingResult.cliente,
      corretor: matchingResult.corretor,
      empreendimento: matchingResult.empreendimento
    }
    const mergedWarnings = [...warnings, ...(matchingResult.warnings ?? [])]

    console.log('[extrairContrato.service] payload final pronto', {
      status: mergedWarnings.length > 0 ? 'parcial' : 'ok',
      mergedWarnings: mergedWarnings.length,
      matches: {
        cliente: entityMatches.cliente?.status,
        corretor: entityMatches.corretor?.status,
        empreendimento: entityMatches.empreendimento?.status
      }
    })

    const payload = {
      arquivo_nome: originalName,
      schema_extraido_json: {
        sale_form: saleForm,
        valor_pro_soluto_extraido: valorProSolutoExtraido,
        confidence,
        warnings: mergedWarnings,
        manual_required: false
      },
      matching_json: entityMatches,
      status: mergedWarnings.length > 0 ? 'parcial' : 'ok',
      origem_texto: sourceType
    }
    await cache.save(hash, payload)

    return buildResponse({
      saleForm,
      valorProSolutoExtraido,
      entityMatches,
      confidence,
      warnings: mergedWarnings,
      manualRequired: false,
      documentMeta: { hash, source_type: sourceType }
    })
  } catch (err) {
    console.error('[extrairContrato]', err)
    return {
      success: false,
      error: err.message || 'Erro ao processar contrato'
    }
  }
}

function buildResponse({ saleForm, valorProSolutoExtraido, entityMatches, confidence, warnings, manualRequired, documentMeta }) {
  return {
    success: true,
    data: {
      sale_form: saleForm,
      valor_pro_soluto_extraido: valorProSolutoExtraido ?? null,
      entity_matches: entityMatches ?? {},
      confidence: confidence ?? {},
      warnings: warnings ?? [],
      manual_required: Boolean(manualRequired),
      document_meta: documentMeta ?? { hash: '', source_type: '' }
    }
  }
}

module.exports = {
  extrairContrato
}
