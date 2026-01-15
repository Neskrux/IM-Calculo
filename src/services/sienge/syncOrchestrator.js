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

import { ingestAll, ingestCreditors, ingestCustomers, ingestSalesContracts } from './rawIngestion'
import { syncCorretoresFromRaw } from './syncCorretoresV2'
import { syncClientesFromRaw } from './syncClientesV2'
import { syncVendasFromRaw } from './syncVendasV2'
import { supabase } from '../../lib/supabase'
import { SIENGE_CONFIG } from '../../lib/sienge'

/**
 * Executa sincronização completa (RAW + Core)
 */
export const syncCompleto = async (options = {}) => {
  const {
    enterpriseId = SIENGE_CONFIG.enterpriseId,
    onProgress = null,
    dryRun = false,
    skipRaw = false // Se true, pula ingestão RAW (usa dados existentes)
  } = options

  const resultado = {
    status: 'OK',
    etapas: {},
    metricas: {
      raw: { creditors: 0, customers: 0, contracts: 0 },
      core: { corretores: 0, clientes: 0, vendas: 0, pagamentos: 0 }
    },
    erros: [],
    iniciado: new Date().toISOString(),
    finalizado: null
  }

  try {
    console.log('🚀 [SYNC COMPLETO] Iniciando...')
    console.log(`   Enterprise ID: ${enterpriseId}`)
    console.log(`   Modo: ${dryRun ? 'DRY RUN' : 'PRODUÇÃO'}`)
    console.log(`   Skip RAW: ${skipRaw}`)

    // ========================================
    // ETAPA 1: Ingestão RAW
    // ========================================
    if (!skipRaw) {
      if (onProgress) onProgress({ etapa: 'raw', fase: 'creditors', mensagem: 'Ingerindo corretores...' })
      
      console.log('\n📥 [ETAPA 1/4] Ingestão RAW...')
      
      const rawResult = await ingestAll({
        enterpriseId,
        onProgress: (p) => onProgress?.({ etapa: 'raw', ...p })
      })

      resultado.etapas.raw = rawResult
      resultado.metricas.raw = {
        creditors: rawResult.metrics.creditors?.corretores || 0,
        customers: rawResult.metrics.customers?.total || 0,
        contracts: rawResult.metrics.salesContracts?.total || 0
      }

      console.log(`   ✅ RAW: ${resultado.metricas.raw.creditors} corretores, ${resultado.metricas.raw.customers} clientes, ${resultado.metricas.raw.contracts} contratos`)
    } else {
      console.log('\n⏭️ [ETAPA 1/4] Ingestão RAW pulada (usando dados existentes)')
      
      // Contar dados existentes no RAW
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
        creditors: creditorsCount || 0,
        customers: customersCount || 0,
        contracts: contractsCount || 0
      }

      console.log(`   📊 RAW existente: ${creditorsCount} corretores, ${customersCount} clientes, ${contractsCount} contratos`)
    }

    // ========================================
    // ETAPA 2: Sync Corretores (SEM Auth!)
    // ========================================
    if (onProgress) onProgress({ etapa: 'corretores', mensagem: 'Sincronizando corretores...' })
    
    console.log('\n👥 [ETAPA 2/4] Sync Corretores (SEM Auth)...')
    
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
    // ETAPA 3: Sync Clientes
    // ========================================
    if (onProgress) onProgress({ etapa: 'clientes', mensagem: 'Sincronizando clientes...' })
    
    console.log('\n👤 [ETAPA 3/4] Sync Clientes...')
    
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
    // ETAPA 4: Sync Vendas + Pagamentos
    // ========================================
    if (onProgress) onProgress({ etapa: 'vendas', mensagem: 'Sincronizando vendas e pagamentos...' })
    
    console.log('\n📝 [ETAPA 4/4] Sync Vendas + Pagamentos Pro-Soluto...')
    
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
    // Finalização
    // ========================================
    resultado.finalizado = new Date().toISOString()
    
    if (resultado.erros.length > 0) {
      resultado.status = 'PARTIAL'
    }

    // Calcular taxa de sucesso
    const totalRaw = resultado.metricas.raw.contracts
    const totalCore = resultado.metricas.core.vendas
    const taxaSucesso = totalRaw > 0 ? ((totalCore / totalRaw) * 100).toFixed(1) : 0

    console.log('\n' + '='.repeat(50))
    console.log('📊 RESUMO DA SINCRONIZAÇÃO')
    console.log('='.repeat(50))
    console.log(`Status: ${resultado.status}`)
    console.log(`RAW: ${resultado.metricas.raw.creditors} corretores, ${resultado.metricas.raw.customers} clientes, ${resultado.metricas.raw.contracts} contratos`)
    console.log(`Core: ${resultado.metricas.core.corretores} corretores, ${resultado.metricas.core.clientes} clientes, ${resultado.metricas.core.vendas} vendas`)
    console.log(`📦 Pagamentos pro-soluto criados: ${resultado.metricas.core.pagamentos || 0}`)
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
    raw: { creditors: 0, customers: 0, contracts: 0 },
    core: { corretores: 0, clientes: 0, vendas: 0 },
    cobertura: { corretores: 0, clientes: 0, vendas: 0 }
  }

  // RAW
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
    creditors: rawCreditors || 0,
    customers: rawCustomers || 0,
    contracts: rawContracts || 0
  }

  // Core
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
    corretores: coreCorretores || 0,
    clientes: coreClientes || 0,
    vendas: coreVendas || 0
  }

  // Cobertura (%)
  stats.cobertura = {
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
  getVendasNaoSincronizadas
}
