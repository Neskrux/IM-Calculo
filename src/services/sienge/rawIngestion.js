/**
 * Serviço de Ingestão RAW do Sienge
 * 
 * Camada 1: Persiste 100% dos dados do Sienge em sienge_raw.objects
 * Sem regras, sem FK, sem Auth - apenas JSON bruto
 * 
 * Endpoints:
 * - GET /creditors (filtra broker="S" no lado do cliente)
 * - GET /customers?enterpriseId=X
 * - GET /sales-contracts?enterpriseId=X
 */

import { supabase } from '../../lib/supabase'
import { getSiengeUrl, getSiengeAuth, SIENGE_CONFIG } from '../../lib/sienge'

/**
 * Calcula hash MD5 de um objeto (para detectar mudanças)
 */
const calcHash = async (obj) => {
  const str = JSON.stringify(obj)
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32)
}

/**
 * Faz requisição GET para API do Sienge
 */
const siengeGet = async (endpoint, params = {}) => {
  const baseUrl = getSiengeUrl(endpoint)
  const url = new URL(baseUrl)
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.append(key, value)
    }
  })

  // Em desenvolvimento, usar proxy do Vite
  const isDev = import.meta.env.DEV
  let requestUrl = url.toString()
  
  if (isDev) {
    requestUrl = url.toString().replace('https://api.sienge.com.br', '/api/sienge')
  }

  const response = await fetch(requestUrl, {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'authorization': getSiengeAuth()
    }
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Sienge API Error ${response.status}: ${text.substring(0, 200)}`)
  }

  return await response.json()
}

/**
 * Cria um novo run de sincronização
 */
const createRun = async (params = {}) => {
  const { data, error } = await supabase
    .schema('sienge_raw')
    .from('runs')
    .insert({
      status: 'RUNNING',
      params: params
    })
    .select('id')
    .single()

  if (error) {
    console.error('Erro ao criar run:', error)
    // Continuar mesmo sem run (fallback)
    return null
  }

  return data.id
}

/**
 * Finaliza um run de sincronização
 */
const finishRun = async (runId, status, metrics, error = null) => {
  if (!runId) return

  await supabase
    .schema('sienge_raw')
    .from('runs')
    .update({
      finished_at: new Date().toISOString(),
      status,
      metrics,
      error: error ? { message: error.message, stack: error.stack } : null
    })
    .eq('id', runId)
}

/**
 * Upsert de objeto RAW no Supabase
 */
const upsertRawObject = async (entity, siengeId, payload, enterpriseId = null, sourceUrl = null, runId = null) => {
  const hash = await calcHash(payload)
  
  const { data, error } = await supabase
    .schema('sienge_raw')
    .from('objects')
    .upsert({
      entity,
      sienge_id: String(siengeId),
      enterprise_id: enterpriseId ? String(enterpriseId) : null,
      payload,
      payload_hash: hash,
      source_url: sourceUrl,
      run_id: runId,
      synced_at: new Date().toISOString()
    }, {
      onConflict: 'entity,sienge_id'
    })
    .select('sienge_id')

  if (error) {
    console.error(`Erro ao upsert ${entity}/${siengeId}:`, error)
    return { success: false, error }
  }

  return { success: true, data }
}

/**
 * Ingestão RAW de Credores (Corretores)
 * Filtra broker="S" após receber os dados
 */
export const ingestCreditors = async (options = {}) => {
  const {
    onProgress = null,
    runId = null
  } = options

  const stats = {
    total: 0,
    corretores: 0,
    inserted: 0,
    updated: 0,
    errors: 0
  }

  let offset = 0
  const limit = 200
  let hasMore = true

  console.log('📥 [RAW] Iniciando ingestão de creditors...')

  while (hasMore) {
    try {
      const sourceUrl = getSiengeUrl('/creditors') + `?limit=${limit}&offset=${offset}`
      const response = await siengeGet('/creditors', { limit, offset })
      
      const creditors = response.results || []
      const metadata = response.resultSetMetadata || {}

      if (offset === 0) {
        console.log(`📊 [RAW] Total de credores na API: ${metadata.count || creditors.length}`)
      }

      for (const creditor of creditors) {
        stats.total++
        
        // Filtrar apenas corretores
        if (creditor.broker !== 'S') continue
        
        stats.corretores++

        const result = await upsertRawObject(
          'creditors',
          creditor.id,
          creditor,
          null, // creditors não têm enterpriseId
          sourceUrl,
          runId
        )

        if (result.success) {
          stats.inserted++ // Simplificado - upsert conta como inserted
        } else {
          stats.errors++
        }

        if (onProgress) {
          onProgress({
            entity: 'creditors',
            current: stats.corretores,
            total: metadata.count || stats.total
          })
        }
      }

      offset += limit
      hasMore = creditors.length === limit && (metadata.count === null || offset < metadata.count)

    } catch (error) {
      console.error('❌ [RAW] Erro na ingestão de creditors:', error)
      stats.errors++
      break
    }
  }

  console.log(`✅ [RAW] Creditors: ${stats.corretores} corretores de ${stats.total} credores`)
  return stats
}

/**
 * Ingestão RAW de Clientes
 */
export const ingestCustomers = async (options = {}) => {
  const {
    enterpriseId = SIENGE_CONFIG.enterpriseId,
    onProgress = null,
    runId = null
  } = options

  const stats = {
    total: 0,
    inserted: 0,
    updated: 0,
    errors: 0
  }

  let offset = 0
  const limit = 200
  let hasMore = true

  console.log(`📥 [RAW] Iniciando ingestão de customers (enterpriseId: ${enterpriseId})...`)

  while (hasMore) {
    try {
      const params = { limit, offset }
      if (enterpriseId) params.enterpriseId = enterpriseId

      const sourceUrl = getSiengeUrl('/customers') + `?${new URLSearchParams(params)}`
      const response = await siengeGet('/customers', params)
      
      const customers = response.results || []
      const metadata = response.resultSetMetadata || {}

      if (offset === 0) {
        console.log(`📊 [RAW] Total de clientes na API: ${metadata.count || customers.length}`)
      }

      for (const customer of customers) {
        stats.total++

        const result = await upsertRawObject(
          'customers',
          customer.id,
          customer,
          enterpriseId,
          sourceUrl,
          runId
        )

        if (result.success) {
          stats.inserted++
        } else {
          stats.errors++
        }

        if (onProgress) {
          onProgress({
            entity: 'customers',
            current: stats.total,
            total: metadata.count || stats.total
          })
        }
      }

      offset += limit
      hasMore = customers.length === limit && (metadata.count === null || offset < metadata.count)

    } catch (error) {
      console.error('❌ [RAW] Erro na ingestão de customers:', error)
      stats.errors++
      break
    }
  }

  console.log(`✅ [RAW] Customers: ${stats.total} clientes`)
  return stats
}

/**
 * Ingestão RAW de Contratos de Venda
 */
export const ingestSalesContracts = async (options = {}) => {
  const {
    enterpriseId = SIENGE_CONFIG.enterpriseId,
    onProgress = null,
    runId = null
  } = options

  const stats = {
    total: 0,
    inserted: 0,
    updated: 0,
    errors: 0
  }

  let offset = 0
  const limit = 200
  let hasMore = true

  console.log(`📥 [RAW] Iniciando ingestão de sales-contracts (enterpriseId: ${enterpriseId})...`)

  while (hasMore) {
    try {
      const params = { limit, offset }
      if (enterpriseId) params.enterpriseId = enterpriseId

      const sourceUrl = getSiengeUrl('/sales-contracts') + `?${new URLSearchParams(params)}`
      const response = await siengeGet('/sales-contracts', params)
      
      const contracts = response.results || []
      const metadata = response.resultSetMetadata || {}

      if (offset === 0) {
        console.log(`📊 [RAW] Total de contratos na API: ${metadata.count || contracts.length}`)
      }

      for (const contract of contracts) {
        stats.total++

        const result = await upsertRawObject(
          'sales-contracts',
          contract.id,
          contract,
          contract.enterpriseId || enterpriseId,
          sourceUrl,
          runId
        )

        if (result.success) {
          stats.inserted++
        } else {
          stats.errors++
        }

        if (onProgress) {
          onProgress({
            entity: 'sales-contracts',
            current: stats.total,
            total: metadata.count || stats.total
          })
        }
      }

      offset += limit
      hasMore = contracts.length === limit && (metadata.count === null || offset < metadata.count)

    } catch (error) {
      console.error('❌ [RAW] Erro na ingestão de sales-contracts:', error)
      stats.errors++
      break
    }
  }

  console.log(`✅ [RAW] Sales-contracts: ${stats.total} contratos`)
  return stats
}

/**
 * Ingestão RAW completa (todos os endpoints)
 */
export const ingestAll = async (options = {}) => {
  const {
    enterpriseId = SIENGE_CONFIG.enterpriseId,
    onProgress = null
  } = options

  const runId = await createRun({
    entities: ['creditors', 'customers', 'sales-contracts'],
    enterpriseId
  })

  const metrics = {
    creditors: { total: 0, corretores: 0, errors: 0 },
    customers: { total: 0, errors: 0 },
    salesContracts: { total: 0, errors: 0 }
  }

  let status = 'OK'
  let error = null

  try {
    console.log('🚀 [RAW] Iniciando ingestão completa...')
    console.log(`   Enterprise ID: ${enterpriseId}`)
    console.log(`   Run ID: ${runId}`)

    // 1. Creditors (corretores)
    if (onProgress) onProgress({ phase: 'creditors', message: 'Buscando corretores...' })
    const creditorsStats = await ingestCreditors({
      runId,
      onProgress: (p) => onProgress?.({ ...p, phase: 'creditors' })
    })
    metrics.creditors = creditorsStats

    // 2. Customers (clientes)
    if (onProgress) onProgress({ phase: 'customers', message: 'Buscando clientes...' })
    const customersStats = await ingestCustomers({
      enterpriseId,
      runId,
      onProgress: (p) => onProgress?.({ ...p, phase: 'customers' })
    })
    metrics.customers = customersStats

    // 3. Sales Contracts (vendas)
    if (onProgress) onProgress({ phase: 'sales-contracts', message: 'Buscando contratos...' })
    const contractsStats = await ingestSalesContracts({
      enterpriseId,
      runId,
      onProgress: (p) => onProgress?.({ ...p, phase: 'sales-contracts' })
    })
    metrics.salesContracts = contractsStats

    // Verificar se houve erros parciais
    const totalErrors = creditorsStats.errors + customersStats.errors + contractsStats.errors
    if (totalErrors > 0) {
      status = 'PARTIAL'
    }

    console.log('✅ [RAW] Ingestão completa finalizada!')
    console.log(`   Corretores: ${metrics.creditors.corretores}`)
    console.log(`   Clientes: ${metrics.customers.total}`)
    console.log(`   Contratos: ${metrics.salesContracts.total}`)

  } catch (err) {
    console.error('❌ [RAW] Erro na ingestão:', err)
    status = 'ERROR'
    error = err
  }

  await finishRun(runId, status, metrics, error)

  return {
    runId,
    status,
    metrics
  }
}

/**
 * Busca objetos RAW do Supabase
 */
export const getRawObjects = async (entity, options = {}) => {
  const {
    limit = 100,
    offset = 0,
    enterpriseId = null
  } = options

  let query = supabase
    .schema('sienge_raw')
    .from('objects')
    .select('*')
    .eq('entity', entity)
    .order('synced_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (enterpriseId) {
    query = query.eq('enterprise_id', String(enterpriseId))
  }

  const { data, error } = await query

  if (error) {
    console.error('Erro ao buscar objetos RAW:', error)
    return []
  }

  return data
}

/**
 * Conta objetos RAW por entidade
 */
export const countRawObjects = async (entity = null) => {
  let query = supabase
    .schema('sienge_raw')
    .from('objects')
    .select('entity', { count: 'exact', head: true })

  if (entity) {
    query = query.eq('entity', entity)
  }

  const { count, error } = await query

  if (error) {
    console.error('Erro ao contar objetos RAW:', error)
    return 0
  }

  return count
}

export default {
  ingestCreditors,
  ingestCustomers,
  ingestSalesContracts,
  ingestAll,
  getRawObjects,
  countRawObjects
}
