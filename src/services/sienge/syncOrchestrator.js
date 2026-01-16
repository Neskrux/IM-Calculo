/**
 * Orquestrador de Sincronização Sienge V2
 * 
 * Fluxo completo:
 * 1. Ingestão RAW (100% dos dados)
 * 2. Sync Corretores (SEM Auth)
 * 3. Sync Clientes
 * 4. Sync Vendas (com fallbacks)
 * 
 * REGRA: Nunca chamar Supabase Auth
 */

import { ingestAll, ingestCreditors, ingestCustomers, ingestSalesContracts, ingestEnterprises } from './rawIngestion'
import { syncCorretoresFromRaw } from './syncCorretoresV2'
import { syncClientesFromRaw } from './syncClientesV2'
import { syncVendasFromRaw } from './syncVendasV2'
import { syncEmpreendimentosFromRaw } from './syncEmpreendimentosV2'
import { ingestUnidades, syncUnidadesFromRaw } from './syncUnidadesV2'
import { supabase } from '../../lib/supabase'
import { SIENGE_CONFIG } from '../../lib/sienge'

// Chave para armazenar última sincronização
const LAST_SYNC_KEY = 'sienge_last_sync_date'

/**
 * Obtém a data da última sincronização
 */
export const getLastSyncDate = () => {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(LAST_SYNC_KEY)
  }
  return null
}

/**
 * Salva a data da última sincronização
 */
export const setLastSyncDate = (date = null) => {
  if (typeof localStorage !== 'undefined') {
    const dateStr = date || new Date().toISOString().split('T')[0]
    localStorage.setItem(LAST_SYNC_KEY, dateStr)
    return dateStr
  }
  return null
}

/**
 * Executa sincronização completa (RAW + Core)
 * Suporta modo incremental usando modifiedAfter
 */
export const syncCompleto = async (options = {}) => {
  const {
    enterpriseId = SIENGE_CONFIG.enterpriseId,
    onProgress = null,
    dryRun = false,
    skipRaw = false, // Se true, pula ingestão RAW (usa dados existentes)
    incremental = true // Se true, usa modifiedAfter da última sync
  } = options

  // Determinar se é sync incremental
  const lastSync = getLastSyncDate()
  const isIncremental = incremental && lastSync && !skipRaw
  const modifiedAfter = isIncremental ? lastSync : null
  
  // Debug
  console.log('🔍 [DEBUG INCREMENTAL]')
  console.log(`   incremental param: ${incremental}`)
  console.log(`   lastSync from localStorage: ${lastSync}`)
  console.log(`   skipRaw: ${skipRaw}`)
  console.log(`   isIncremental: ${isIncremental}`)
  console.log(`   modifiedAfter: ${modifiedAfter}`)

  const resultado = {
    status: 'OK',
    etapas: {},
    metricas: {
      raw: { enterprises: 0, creditors: 0, customers: 0, contracts: 0, units: 0 },
      core: { empreendimentos: 0, corretores: 0, clientes: 0, vendas: 0, pagamentos: 0, unidades: 0, conjuges: 0 }
    },
    erros: [],
    iniciado: new Date().toISOString(),
    finalizado: null,
    incremental: isIncremental,
    modifiedAfter
  }

  try {
    const modoSync = isIncremental ? `INCREMENTAL (após ${modifiedAfter})` : 'COMPLETO'
    console.log(`🚀 [SYNC] Iniciando sincronização ${modoSync}...`)
    console.log(`   Enterprise ID: ${enterpriseId}`)
    console.log(`   Modo: ${dryRun ? 'DRY RUN' : 'PRODUÇÃO'}`)
    console.log(`   Skip RAW: ${skipRaw}`)
    if (isIncremental) {
      console.log(`   📅 Última sync: ${lastSync}`)
      console.log(`   ⚡ Buscando apenas dados modificados após esta data`)
    }

    // ========================================
    // ETAPA 1: Ingestão RAW
    // ========================================
    if (!skipRaw) {
      const rawMensagem = isIncremental 
        ? `Ingestão INCREMENTAL (modificados após ${modifiedAfter})...`
        : 'Ingestão COMPLETA...'
      
      if (onProgress) onProgress({ etapa: 'raw', fase: 'creditors', mensagem: rawMensagem })
      
      console.log(`\n📥 [ETAPA 1/5] ${rawMensagem}`)
      
      const rawResult = await ingestAll({
        enterpriseId,
        modifiedAfter, // ⚡ Sync incremental!
        onProgress: (p) => onProgress?.({ etapa: 'raw', ...p })
      })

      resultado.etapas.raw = rawResult
      resultado.metricas.raw = {
        enterprises: rawResult.metrics.enterprises?.total || 0,
        creditors: rawResult.metrics.creditors?.corretores || 0,
        customers: rawResult.metrics.customers?.total || 0,
        contracts: rawResult.metrics.salesContracts?.total || 0
      }

      console.log(`   ✅ RAW: ${resultado.metricas.raw.enterprises} empreendimentos, ${resultado.metricas.raw.creditors} corretores, ${resultado.metricas.raw.customers} clientes, ${resultado.metricas.raw.contracts} contratos`)
    } else {
      console.log('\n⏭️ [ETAPA 1/5] Ingestão RAW pulada (usando dados existentes)')
      
      // Contar dados existentes no RAW
      const { count: enterprisesCount } = await supabase
        .schema('sienge_raw')
        .from('objects')
        .select('*', { count: 'exact', head: true })
        .eq('entity', 'enterprises')

      const { count: creditorsCount } = await supabase
        .schema('sienge_raw')
        .from('objects')
        .select('*', { count: 'exact', head: true })
        .eq('entity', 'creditors')

      const { count: customersCount } = await supabase
        .schema('sienge_raw')
        .from('objects')
        .select('*', { count: 'exact', head: true })
        .eq('entity', 'customers')

      const { count: contractsCount } = await supabase
        .schema('sienge_raw')
        .from('objects')
        .select('*', { count: 'exact', head: true })
        .eq('entity', 'sales-contracts')

      resultado.metricas.raw = {
        enterprises: enterprisesCount || 0,
        creditors: creditorsCount || 0,
        customers: customersCount || 0,
        contracts: contractsCount || 0
      }

      console.log(`   📊 RAW existente: ${enterprisesCount} empreendimentos, ${creditorsCount} corretores, ${customersCount} clientes, ${contractsCount} contratos`)
    }

    // ========================================
    // ETAPA 2: Sync Empreendimentos
    // ========================================
    if (onProgress) onProgress({ etapa: 'empreendimentos', mensagem: 'Sincronizando empreendimentos...' })
    
    console.log('\n🏢 [ETAPA 2/5] Sync Empreendimentos...')
    
    const empreendimentosResult = await syncEmpreendimentosFromRaw({
      dryRun,
      onProgress: (p) => onProgress?.({ etapa: 'empreendimentos', ...p })
    })

    resultado.etapas.empreendimentos = empreendimentosResult
    resultado.metricas.core.empreendimentos = empreendimentosResult.criados + empreendimentosResult.atualizados

    if (empreendimentosResult.erros > 0) {
      resultado.erros.push(`${empreendimentosResult.erros} erros em empreendimentos`)
    }

    console.log(`   ✅ Empreendimentos: ${empreendimentosResult.criados} criados, ${empreendimentosResult.atualizados} atualizados`)

    // ========================================
    // ETAPA 3: Sync Corretores (SEM Auth!)
    // ========================================
    if (onProgress) onProgress({ etapa: 'corretores', mensagem: 'Sincronizando corretores...' })
    
    console.log('\n👥 [ETAPA 3/5] Sync Corretores (SEM Auth)...')
    
    const corretoresResult = await syncCorretoresFromRaw({
      dryRun,
      onProgress: (p) => onProgress?.({ etapa: 'corretores', ...p })
    })

    resultado.etapas.corretores = corretoresResult
    resultado.metricas.core.corretores = corretoresResult.criados + corretoresResult.atualizados

    if (corretoresResult.erros > 0) {
      resultado.erros.push(`${corretoresResult.erros} erros em corretores`)
    }

    console.log(`   ✅ Corretores: ${corretoresResult.criados} criados, ${corretoresResult.atualizados} atualizados`)

    // ========================================
    // ETAPA 4: Sync Clientes
    // ========================================
    if (onProgress) onProgress({ etapa: 'clientes', mensagem: 'Sincronizando clientes...' })
    
    console.log('\n👤 [ETAPA 4/5] Sync Clientes...')
    
    const clientesResult = await syncClientesFromRaw({
      dryRun,
      onProgress: (p) => onProgress?.({ etapa: 'clientes', ...p })
    })

    resultado.etapas.clientes = clientesResult
    resultado.metricas.core.clientes = clientesResult.criados + clientesResult.atualizados

    if (clientesResult.erros > 0) {
      resultado.erros.push(`${clientesResult.erros} erros em clientes`)
    }

    console.log(`   ✅ Clientes: ${clientesResult.criados} criados, ${clientesResult.atualizados} atualizados`)

    // ========================================
    // ETAPA 5: Sync Vendas + Pagamentos
    // ========================================
    if (onProgress) onProgress({ etapa: 'vendas', mensagem: 'Sincronizando vendas e pagamentos...' })
    
    console.log('\n📝 [ETAPA 5/7] Sync Vendas + Pagamentos Pro-Soluto...')
    
    const vendasResult = await syncVendasFromRaw({
      dryRun,
      criarPlaceholders: true,
      criarPagamentos: true, // Criar registros em pagamentos_prosoluto
      onProgress: (p) => onProgress?.({ etapa: 'vendas', ...p })
    })

    resultado.etapas.vendas = vendasResult
    resultado.metricas.core.vendas = vendasResult.criadas + vendasResult.atualizadas
    resultado.metricas.core.pagamentos = vendasResult.pagamentosCriados || 0

    if (vendasResult.erros > 0) {
      resultado.erros.push(`${vendasResult.erros} erros em vendas`)
    }
    if (vendasResult.puladas > 0) {
      resultado.erros.push(`${vendasResult.puladas} vendas puladas (sem corretor)`)
    }

    console.log(`   ✅ Vendas: ${vendasResult.criadas} criadas, ${vendasResult.atualizadas} atualizadas, ${vendasResult.puladas} puladas`)
    console.log(`   ✅ Pagamentos: ${vendasResult.pagamentosCriados || 0} criados`)
    
    // ========================================
    // ETAPA 6: Sync Unidades (opcional)
    // ========================================
    if (onProgress) onProgress({ etapa: 'unidades', mensagem: 'Sincronizando unidades...' })
    
    console.log('\n🏠 [ETAPA 6/7] Sync Unidades...')
    
    try {
      // Primeiro ingerir unidades (não está no ingestAll)
      if (!skipRaw) {
        await ingestUnidades({
          onProgress: (p) => onProgress?.({ etapa: 'unidades', fase: 'ingestao', ...p })
        })
      }
      
      const unidadesResult = await syncUnidadesFromRaw({
        dryRun,
        onProgress: (p) => onProgress?.({ etapa: 'unidades', ...p })
      })

      resultado.etapas.unidades = unidadesResult
      resultado.metricas.core.unidades = unidadesResult.criados + unidadesResult.atualizados

      if (unidadesResult.erros > 0) {
        resultado.erros.push(`${unidadesResult.erros} erros em unidades`)
      }

      console.log(`   ✅ Unidades: ${unidadesResult.criados} criadas, ${unidadesResult.atualizados} atualizadas`)
    } catch (unidadesError) {
      console.warn(`   ⚠️ Unidades: ${unidadesError.message} (continuando...)`)
      resultado.erros.push(`Unidades: ${unidadesError.message}`)
    }
    
    // ========================================
    // ETAPA 7: Contagem de cônjuges sincronizados
    // ========================================
    console.log('\n👫 [ETAPA 7/7] Verificando cônjuges sincronizados...')
    
    const { count: conjugesCount } = await supabase
      .from('complementadores_renda')
      .select('*', { count: 'exact', head: true })
      .eq('origem', 'sienge')
    
    resultado.metricas.core.conjuges = conjugesCount || 0
    console.log(`   ✅ Cônjuges do Sienge: ${conjugesCount || 0}`)

    // ========================================
    // Finalização
    // ========================================
    resultado.finalizado = new Date().toISOString()
    
    // Salvar data da última sync bem-sucedida
    if (!dryRun) {
      const novaDataSync = setLastSyncDate()
      resultado.proximaSyncIncremental = novaDataSync
      console.log(`   💾 Próxima sync usará modifiedAfter: ${novaDataSync}`)
    }
    
    if (resultado.erros.length > 0) {
      resultado.status = 'PARTIAL'
    }

    // Calcular taxa de sucesso
    const totalRaw = resultado.metricas.raw.contracts
    const totalCore = resultado.metricas.core.vendas
    const taxaSucesso = totalRaw > 0 ? ((totalCore / totalRaw) * 100).toFixed(1) : 0

    const tipoSync = isIncremental ? '⚡ INCREMENTAL' : '📦 COMPLETA'
    console.log('\n' + '='.repeat(50))
    console.log(`📊 RESUMO DA SINCRONIZAÇÃO ${tipoSync}`)
    console.log('='.repeat(50))
    console.log(`Status: ${resultado.status}`)
    if (isIncremental) {
      console.log(`📅 Dados modificados após: ${modifiedAfter}`)
    }
    console.log(`RAW: ${resultado.metricas.raw.enterprises} empreendimentos, ${resultado.metricas.raw.creditors} corretores, ${resultado.metricas.raw.customers} clientes, ${resultado.metricas.raw.contracts} contratos`)
    console.log(`Core: ${resultado.metricas.core.empreendimentos} empreendimentos, ${resultado.metricas.core.corretores} corretores, ${resultado.metricas.core.clientes} clientes, ${resultado.metricas.core.vendas} vendas`)
    console.log(`📦 Pagamentos pro-soluto: ${resultado.metricas.core.pagamentos || 0}`)
    console.log(`🏠 Unidades: ${resultado.metricas.core.unidades || 0}`)
    console.log(`👫 Cônjuges: ${resultado.metricas.core.conjuges || 0}`)
    console.log(`Taxa de sucesso (vendas): ${taxaSucesso}%`)
    if (resultado.erros.length > 0) {
      console.log(`Alertas: ${resultado.erros.join(', ')}`)
    }
    console.log('='.repeat(50))

    return resultado

  } catch (error) {
    console.error('❌ [SYNC COMPLETO] Erro:', error)
    resultado.status = 'ERROR'
    resultado.erros.push(error.message)
    resultado.finalizado = new Date().toISOString()
    throw error
  }
}

/**
 * Executa apenas ingestão RAW (sem sync para core)
 */
export const apenasIngestaoRaw = async (options = {}) => {
  const {
    enterpriseId = SIENGE_CONFIG.enterpriseId,
    onProgress = null
  } = options

  console.log('📥 [RAW ONLY] Iniciando ingestão RAW...')
  
  return await ingestAll({
    enterpriseId,
    onProgress
  })
}

/**
 * Executa apenas sync para core (usando RAW existente)
 */
export const apenasSyncCore = async (options = {}) => {
  const {
    dryRun = false,
    onProgress = null
  } = options

  console.log('🔄 [CORE ONLY] Iniciando sync para core...')
  
  return await syncCompleto({
    ...options,
    skipRaw: true,
    dryRun
  })
}

/**
 * Retorna estatísticas atuais
 */
export const getEstatisticas = async () => {
  const stats = {
    raw: { enterprises: 0, creditors: 0, customers: 0, contracts: 0 },
    core: { empreendimentos: 0, corretores: 0, clientes: 0, vendas: 0 },
    cobertura: { empreendimentos: 0, corretores: 0, clientes: 0, vendas: 0 }
  }

  // RAW
  const { count: rawEnterprises } = await supabase
    .schema('sienge_raw')
    .from('objects')
    .select('*', { count: 'exact', head: true })
    .eq('entity', 'enterprises')

  const { count: rawCreditors } = await supabase
    .schema('sienge_raw')
    .from('objects')
    .select('*', { count: 'exact', head: true })
    .eq('entity', 'creditors')

  const { count: rawCustomers } = await supabase
    .schema('sienge_raw')
    .from('objects')
    .select('*', { count: 'exact', head: true })
    .eq('entity', 'customers')

  const { count: rawContracts } = await supabase
    .schema('sienge_raw')
    .from('objects')
    .select('*', { count: 'exact', head: true })
    .eq('entity', 'sales-contracts')

  stats.raw = {
    enterprises: rawEnterprises || 0,
    creditors: rawCreditors || 0,
    customers: rawCustomers || 0,
    contracts: rawContracts || 0
  }

  // Core
  const { count: coreEmpreendimentos } = await supabase
    .from('empreendimentos')
    .select('*', { count: 'exact', head: true })
    .not('sienge_enterprise_id', 'is', null)

  const { count: coreCorretores } = await supabase
    .from('usuarios')
    .select('*', { count: 'exact', head: true })
    .eq('tipo', 'corretor')
    .not('sienge_broker_id', 'is', null)

  const { count: coreClientes } = await supabase
    .from('clientes')
    .select('*', { count: 'exact', head: true })
    .not('sienge_customer_id', 'is', null)

  const { count: coreVendas } = await supabase
    .from('vendas')
    .select('*', { count: 'exact', head: true })
    .not('sienge_contract_id', 'is', null)

  stats.core = {
    empreendimentos: coreEmpreendimentos || 0,
    corretores: coreCorretores || 0,
    clientes: coreClientes || 0,
    vendas: coreVendas || 0
  }

  // Cobertura (%)
  stats.cobertura = {
    empreendimentos: stats.raw.enterprises > 0 
      ? ((stats.core.empreendimentos / stats.raw.enterprises) * 100).toFixed(1) 
      : 0,
    corretores: stats.raw.creditors > 0 
      ? ((stats.core.corretores / stats.raw.creditors) * 100).toFixed(1) 
      : 0,
    clientes: stats.raw.customers > 0 
      ? ((stats.core.clientes / stats.raw.customers) * 100).toFixed(1) 
      : 0,
    vendas: stats.raw.contracts > 0 
      ? ((stats.core.vendas / stats.raw.contracts) * 100).toFixed(1) 
      : 0
  }

  return stats
}

/**
 * Retorna vendas não sincronizadas (no RAW mas não no core)
 */
export const getVendasNaoSincronizadas = async () => {
  // Buscar todos os sienge_contract_id do core
  const { data: vendasCore } = await supabase
    .from('vendas')
    .select('sienge_contract_id')
    .not('sienge_contract_id', 'is', null)

  const idsCore = new Set(vendasCore?.map(v => v.sienge_contract_id) || [])

  // Buscar todos os contratos do RAW
  const { data: rawContratos } = await supabase
    .schema('sienge_raw')
    .from('objects')
    .select('sienge_id, payload')
    .eq('entity', 'sales-contracts')

  // Filtrar os que não estão no core
  const naoSincronizados = (rawContratos || [])
    .filter(r => !idsCore.has(r.sienge_id))
    .map(r => ({
      sienge_id: r.sienge_id,
      numero: r.payload?.number,
      valor: r.payload?.value,
      data: r.payload?.contractDate,
      cliente: r.payload?.salesContractCustomers?.[0]?.name,
      corretor_id: r.payload?.brokers?.[0]?.id
    }))

  return naoSincronizados
}

export default {
  syncCompleto,
  apenasIngestaoRaw,
  apenasSyncCore,
  getEstatisticas,
  getVendasNaoSincronizadas,
  getLastSyncDate,
  setLastSyncDate
}
