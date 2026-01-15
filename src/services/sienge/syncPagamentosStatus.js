/**
 * Sincronização de Status de Pagamentos
 * 
 * Tenta buscar informações de parcelas pagas do Sienge
 * e atualizar o status dos pagamentos no Supabase
 */

import { supabase } from '../../lib/supabase'
import { getReceivableBills, getSalesContract } from './siengeClient'
import { SIENGE_CONFIG } from '../../lib/sienge'

/**
 * Tenta sincronizar status de pagamentos do Sienge
 * 
 * NOTA: Este é um recurso experimental que depende de endpoints
 * que podem não estar disponíveis em todas as versões do Sienge
 */
export const syncPagamentosStatus = async (options = {}) => {
  const {
    enterpriseId = SIENGE_CONFIG.enterpriseId,
    onProgress = null,
    dryRun = false
  } = options

  console.log('💰 [SYNC PAGAMENTOS STATUS] Iniciando...')
  console.log('⚠️ Este recurso é experimental e depende de endpoints específicos do Sienge')

  const resultado = {
    total: 0,
    atualizados: 0,
    erros: 0,
    naoDisponivel: false,
    detalhes: []
  }

  try {
    // Tentar buscar títulos a receber do Sienge
    console.log('🔍 Tentando buscar títulos a receber do Sienge...')
    
    const receivables = await getReceivableBills({
      enterpriseId,
      dryRun
    })

    if (!receivables.results || receivables.results.length === 0) {
      console.log('⚠️ Nenhum título a receber encontrado ou endpoint não disponível')
      console.log('💡 Dica: As parcelas precisam ser marcadas como pagas manualmente na aba Pagamentos')
      resultado.naoDisponivel = true
      return resultado
    }

    resultado.total = receivables.results.length
    console.log(`📊 ${resultado.total} títulos encontrados`)

    // Processar cada título
    for (const titulo of receivables.results) {
      try {
        // Verificar se o título está pago
        const isPago = titulo.status === 'paid' || 
                       titulo.situation === 'paid' ||
                       titulo.paidValue > 0 ||
                       titulo.paymentDate != null

        if (!isPago) continue

        // Buscar pagamento correspondente no Supabase
        // Tentar match por contrato + número da parcela
        const { data: pagamento } = await supabase
          .from('pagamentos_prosoluto')
          .select('id, status, venda_id')
          .eq('numero_parcela', titulo.installmentNumber || titulo.number)
          .maybeSingle()

        if (pagamento && pagamento.status !== 'pago') {
          if (!dryRun) {
            await supabase
              .from('pagamentos_prosoluto')
              .update({
                status: 'pago',
                data_pagamento: titulo.paymentDate || new Date().toISOString().split('T')[0]
              })
              .eq('id', pagamento.id)
          }
          
          resultado.atualizados++
          console.log(`   ✅ Parcela ${titulo.installmentNumber} marcada como paga`)
        }

        if (onProgress) {
          onProgress({
            current: resultado.atualizados + resultado.erros,
            total: resultado.total,
            item: `Parcela ${titulo.installmentNumber || titulo.number}`
          })
        }
      } catch (err) {
        console.error(`❌ Erro ao processar título:`, err.message)
        resultado.erros++
      }
    }

    console.log(`\n✅ [SYNC PAGAMENTOS STATUS] Concluído:`)
    console.log(`   Atualizados: ${resultado.atualizados}`)
    console.log(`   Erros: ${resultado.erros}`)

    return resultado

  } catch (error) {
    console.error('❌ [SYNC PAGAMENTOS STATUS] Erro:', error.message)
    console.log('💡 O endpoint de títulos a receber pode não estar disponível no seu plano do Sienge')
    resultado.naoDisponivel = true
    resultado.erros++
    return resultado
  }
}

/**
 * Marca parcelas como pagas baseado em regra de data
 * 
 * Útil quando não há integração direta com Sienge para status de pagamento
 * Marca como pago parcelas com data_prevista anterior a hoje
 */
export const marcarPagamentosVencidosComoPagos = async (options = {}) => {
  const {
    diasTolerancia = 0, // Dias após vencimento para considerar pago
    dryRun = false,
    onProgress = null
  } = options

  console.log('💰 [AUTO-PAGAR] Marcando parcelas vencidas como pagas...')
  console.log(`   Tolerância: ${diasTolerancia} dias após vencimento`)

  const dataLimite = new Date()
  dataLimite.setDate(dataLimite.getDate() - diasTolerancia)
  const dataLimiteStr = dataLimite.toISOString().split('T')[0]

  // Buscar parcelas pendentes com data_prevista <= dataLimite
  const { data: parcelas, error } = await supabase
    .from('pagamentos_prosoluto')
    .select('id, data_prevista, valor, numero_parcela, venda_id')
    .eq('status', 'pendente')
    .lte('data_prevista', dataLimiteStr)

  if (error) {
    console.error('❌ Erro ao buscar parcelas:', error.message)
    return { atualizados: 0, erros: 1 }
  }

  console.log(`📊 ${parcelas?.length || 0} parcelas vencidas encontradas`)

  let atualizados = 0
  let erros = 0

  for (const parcela of (parcelas || [])) {
    try {
      if (!dryRun) {
        await supabase
          .from('pagamentos_prosoluto')
          .update({
            status: 'pago',
            data_pagamento: parcela.data_prevista
          })
          .eq('id', parcela.id)
      }
      
      atualizados++
      
      if (onProgress) {
        onProgress({
          current: atualizados,
          total: parcelas.length,
          item: `Parcela ${parcela.numero_parcela || parcela.id}`
        })
      }
    } catch (err) {
      console.error(`❌ Erro ao atualizar parcela ${parcela.id}:`, err.message)
      erros++
    }
  }

  console.log(`\n✅ [AUTO-PAGAR] Concluído:`)
  console.log(`   Atualizados: ${atualizados}`)
  console.log(`   Erros: ${erros}`)

  return { atualizados, erros, total: parcelas?.length || 0 }
}

export default {
  syncPagamentosStatus,
  marcarPagamentosVencidosComoPagos
}
