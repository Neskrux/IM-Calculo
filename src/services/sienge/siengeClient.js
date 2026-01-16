/**
 * Cliente HTTP para API do Sienge
 * Trata autenticação, erros e retorna dados normalizados
 */

import { getSiengeUrl, getSiengeAuth } from '../../lib/sienge'

class SiengeAPIError extends Error {
  constructor(message, status, data) {
    super(message)
    this.status = status
    this.data = data
    this.name = 'SiengeAPIError'
  }
}

/**
 * Faz requisição GET para API do Sienge
 * Em desenvolvimento, usa proxy do Vite para evitar CORS
 */
const siengeGet = async (endpoint, params = {}) => {
  // Validar credenciais antes de fazer requisição
  try {
    getSiengeAuth()
  } catch (error) {
    throw new SiengeAPIError(
      `Credenciais não configuradas: ${error.message}. Verifique as variáveis de ambiente VITE_SIENGE_USERNAME e VITE_SIENGE_PASSWORD`,
      0,
      null
    )
  }

  const baseUrl = getSiengeUrl(endpoint)
  const url = new URL(baseUrl)
  
  // Adicionar parâmetros de query (remover null/undefined/vazios)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.append(key, value)
    }
  })

  // Em desenvolvimento, usar proxy do Vite para evitar CORS
  const isDev = import.meta.env.DEV
  let requestUrl = url.toString()
  
  if (isDev) {
    // Usar proxy: substituir o domínio base pelo proxy
    // https://api.sienge.com.br/imincorporadora/public/api/v1/creditors
    // -> /api/sienge/imincorporadora/public/api/v1/creditors
    requestUrl = url.toString().replace('https://api.sienge.com.br', '/api/sienge')
  }

  try {
    const response = await fetch(requestUrl, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'authorization': getSiengeAuth()
      }
    })

    // Verificar se a resposta é JSON antes de fazer parse
    const contentType = response.headers.get('content-type')
    let data
    
    if (contentType && contentType.includes('application/json')) {
      data = await response.json()
    } else {
      const text = await response.text()
      throw new SiengeAPIError(
        `Resposta não é JSON: ${text.substring(0, 200)}`,
        response.status,
        { raw: text }
      )
    }

    if (!response.ok) {
      throw new SiengeAPIError(
        data.message || data.error || `Erro ${response.status}: ${response.statusText}`,
        response.status,
        data
      )
    }

    return data
  } catch (error) {
    if (error instanceof SiengeAPIError) {
      throw error
    }
    
    // Melhorar mensagem de erro para CORS
    let errorMessage = error.message
    if (error.message === 'Failed to fetch' || error.message.includes('CORS')) {
      errorMessage = `Erro de conexão (CORS ou rede): Não foi possível conectar à API do Sienge. Verifique se as credenciais estão corretas e se o servidor permite requisições. URL tentada: ${requestUrl}`
    }
    
    throw new SiengeAPIError(
      errorMessage,
      0,
      { originalError: error.message, url: requestUrl }
    )
  }
}

/**
 * Busca lista de clientes
 * GET /customers
 */
export const getCustomers = async (options = {}) => {
  const {
    cpf = null,
    cnpj = null,
    enterpriseId = null,
    onlyActive = null,
    createdAfter = null,
    createdBefore = null,
    modifiedAfter = null,
    modifiedBefore = null,
    limit = 100,
    offset = 0,
    dryRun = false
  } = options

  if (dryRun) {
    console.log('[DRY RUN] Buscaria clientes:', { enterpriseId, limit, offset, modifiedAfter })
    return {
      resultSetMetadata: { count: 0, offset: 0, limit: 0 },
      results: []
    }
  }

  const params = {
    limit: Math.min(limit, 200), // Máximo 200
    offset
  }

  if (cpf) params.cpf = cpf
  if (cnpj) params.cnpj = cnpj
  if (enterpriseId) params.enterpriseId = enterpriseId
  if (onlyActive !== null) params.onlyActive = onlyActive
  if (createdAfter) params.createdAfter = createdAfter
  if (createdBefore) params.createdBefore = createdBefore
  if (modifiedAfter) params.modifiedAfter = modifiedAfter
  if (modifiedBefore) params.modifiedBefore = modifiedBefore

  return await siengeGet('/customers', params)
}

/**
 * Busca cliente por ID
 * GET /customers/{id}
 */
export const getCustomer = async (customerId, dryRun = false) => {
  if (dryRun) {
    console.log('[DRY RUN] Buscaria cliente:', customerId)
    return null
  }

  return await siengeGet(`/customers/${customerId}`)
}

/**
 * Busca lista de contratos de venda
 * GET /sales-contracts
 */
export const getSalesContracts = async (options = {}) => {
  const {
    enterpriseId = null,
    companyId = 0,
    customerId = null,
    unitId = null,
    number = null,
    situation = null,
    createdAfter = null,
    createdBefore = null,
    modifiedAfter = null,
    modifiedBefore = null,
    onlyContractsWithoutCommission = false,
    initialIssueDate = null,
    finalIssueDate = null,
    limit = 100,
    offset = 0,
    dryRun = false
  } = options

  if (dryRun) {
    console.log('[DRY RUN] Buscaria contratos:', { enterpriseId, limit, offset, modifiedAfter })
    return {
      resultSetMetadata: { count: 0, offset: 0, limit: 0 },
      results: []
    }
  }

  const params = {
    companyId,
    enterpriseId: enterpriseId || 0,
    limit: Math.min(limit, 200), // Máximo 200
    offset,
    onlyContractsWithoutCommission
  }

  if (customerId) params.customerId = customerId
  if (unitId) params.unitId = unitId
  if (number) params.number = number
  if (situation) params.situation = Array.isArray(situation) ? situation : [situation]
  if (createdAfter) params.createdAfter = createdAfter
  if (createdBefore) params.createdBefore = createdBefore
  if (modifiedAfter) params.modifiedAfter = modifiedAfter
  if (modifiedBefore) params.modifiedBefore = modifiedBefore
  if (initialIssueDate) params.initialIssueDate = initialIssueDate
  if (finalIssueDate) params.finalIssueDate = finalIssueDate

  return await siengeGet('/sales-contracts', params)
}

/**
 * Busca contrato de venda por ID (com detalhes completos)
 * GET /sales-contracts/{id}
 */
export const getSalesContract = async (contractId, dryRun = false) => {
  if (dryRun) {
    console.log('[DRY RUN] Buscaria contrato:', contractId)
    return null
  }

  return await siengeGet(`/sales-contracts/${contractId}`)
}

/**
 * Busca títulos/parcelas a receber de um contrato
 * GET /receivable-bills ou similar
 * Nota: Este endpoint pode variar dependendo da versão do Sienge
 */
export const getReceivableBills = async (options = {}) => {
  const {
    contractId = null,
    enterpriseId = null,
    customerId = null,
    status = null, // 'paid', 'pending', 'overdue'
    limit = 200,
    offset = 0,
    dryRun = false
  } = options

  if (dryRun) {
    console.log('[DRY RUN] Buscaria títulos a receber:', { contractId, enterpriseId })
    return { results: [] }
  }

  const params = { limit, offset }
  if (contractId) params.contractId = contractId
  if (enterpriseId) params.enterpriseId = enterpriseId
  if (customerId) params.customerId = customerId
  if (status) params.status = status

  try {
    // Tentar endpoint de títulos a receber
    return await siengeGet('/receivable-bills', params)
  } catch (error) {
    console.warn('Endpoint /receivable-bills não disponível:', error.message)
    // Fallback: tentar outro endpoint comum
    try {
      return await siengeGet('/accounts-receivable/installments', params)
    } catch (error2) {
      console.warn('Endpoint /accounts-receivable/installments não disponível:', error2.message)
      return { results: [] }
    }
  }
}

/**
 * Busca empreendimento por ID
 * GET /enterprises/{id}
 */
export const getEnterprise = async (enterpriseId, dryRun = false) => {
  if (dryRun) {
    console.log('[DRY RUN] Buscaria empreendimento:', enterpriseId)
    return null
  }

  return await siengeGet(`/enterprises/${enterpriseId}`)
}

/**
 * Busca lista de empreendimentos
 * GET /enterprises
 */
export const getEnterprises = async (dryRun = false) => {
  if (dryRun) {
    console.log('[DRY RUN] Buscaria empreendimentos')
    return []
  }

  return await siengeGet('/enterprises')
}

/**
 * Busca unidade por ID
 * GET /units/{id}
 */
export const getUnit = async (unitId, dryRun = false) => {
  if (dryRun) {
    console.log('[DRY RUN] Buscaria unidade:', unitId)
    return null
  }

  return await siengeGet(`/units/${unitId}`)
}

/**
 * Busca lista de unidades
 * GET /units
 */
export const getUnits = async (options = {}) => {
  const {
    enterpriseId = null,
    limit = 100,
    offset = 0,
    dryRun = false
  } = options

  if (dryRun) {
    console.log('[DRY RUN] Buscaria unidades:', { enterpriseId, limit, offset })
    return {
      resultSetMetadata: { count: 0, offset: 0, limit: 0 },
      results: []
    }
  }

  const params = {
    limit: Math.min(limit, 200),
    offset
  }

  if (enterpriseId) params.enterpriseId = enterpriseId

  return await siengeGet('/units', params)
}

/**
 * Busca lista de credores (corretores, fornecedores, colaboradores)
 * GET /creditors
 * Filtra apenas corretores (broker !== null/empty)
 */
export const getCreditors = async (options = {}) => {
  const {
    cpf = null,
    cnpj = null,
    creditor = null, // Nome, nome fantasia ou código
    limit = 200, // Aumentado para 200 para economizar requisições
    offset = 0,
    dryRun = false
  } = options

  if (dryRun) {
    console.log('[DRY RUN] Buscaria credores:', { creditor, limit, offset })
    return {
      resultSetMetadata: { count: 0, offset: 0, limit: 0 },
      results: []
    }
  }

  const params = {
    limit: Math.min(limit, 200), // Máximo 200
    offset
  }

  if (cpf) params.cpf = cpf
  if (cnpj) params.cnpj = cnpj
  if (creditor) params.creditor = creditor

  const response = await siengeGet('/creditors', params)
  
  // Filtrar apenas corretores
  // Baseado na análise dos dados brutos: broker é string "S" (corretor) ou "N" (não corretor)
  // Todos os corretores também são fornecedores (supplier: "S")
  if (response.results && Array.isArray(response.results)) {
    const antes = response.results.length
    
    // Filtro correto: broker === "S" (string "S", não boolean)
    response.results = response.results.filter(creditor => creditor.broker === "S")
    
    const depois = response.results.length
    if (offset === 0) {
      console.log(`📊 Filtro aplicado: ${antes} credores → ${depois} corretores (${antes - depois} removidos)`)
    }
    
    // Atualizar count após filtro
    if (response.resultSetMetadata) {
      response.resultSetMetadata.count = response.results.length
    }
  }

  return response
}

/**
 * Busca credor por ID
 * GET /creditors/{id}
 */
export const getCreditor = async (creditorId, dryRun = false) => {
  if (dryRun) {
    console.log('[DRY RUN] Buscaria credor:', creditorId)
    return null
  }

  return await siengeGet(`/creditors/${creditorId}`)
}

export { SiengeAPIError }

