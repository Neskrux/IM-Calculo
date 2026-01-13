/**
 * Sincronização de Vendas/Contratos do Sienge
 * GET /sales-contracts → Supabase.vendas
 */

import { getSalesContracts, getCustomer, getEnterprise, getUnit } from './siengeClient'
import { supabase } from '../../lib/supabase'
import { 
  findOrCreateCliente, 
  findOrCreateEmpreendimento, 
  normalizeVendaData,
  findClienteBySiengeId,
  findEmpreendimentoBySiengeId,
  findCorretorBySiengeId
} from './syncUtils'
import { SIENGE_CONFIG } from '../../lib/sienge'

/**
 * Sincroniza vendas/contratos do Sienge para o Supabase
 */
export const syncVendas = async (options = {}) => {
  const {
    enterpriseId = SIENGE_CONFIG.enterpriseId,
    modifiedAfter = null, // Sincronização incremental
    limit = 200, // Aumentado para 200 para economizar requisições
    dryRun = false,
    onProgress = null
  } = options

  const stats = {
    total: 0,
    criadas: 0,
    atualizadas: 0,
    erros: 0,
    puladas: 0
  }

  try {
    let offset = 0
    let hasMore = true

    while (hasMore) {
      // Buscar contratos do Sienge
      const response = await getSalesContracts({
        enterpriseId,
        modifiedAfter,
        limit,
        offset,
        dryRun
      })

      if (dryRun) {
        console.log('[DRY RUN] Processaria', response.results?.length || 0, 'contratos')
        stats.total = response.results?.length || 0
        break
      }

      const contracts = response.results || []
      const metadata = response.resultSetMetadata || {}

      stats.total += contracts.length

      for (let i = 0; i < contracts.length; i++) {
        const contract = contracts[i]

        try {
          if (onProgress) {
            onProgress({
              current: offset + i + 1,
              total: metadata.count || stats.total,
              contract: contract.id
            })
          }

          // Verificar se venda já existe
          const { data: vendaExistente } = await supabase
            .from('vendas')
            .select('id')
            .eq('sienge_contract_id', String(contract.id))
            .maybeSingle()

          // Buscar/criar cliente (OTIMIZADO: verifica Supabase primeiro)
          let clienteId = null
          const clientePrincipal = contract.salesContractCustomers?.find(c => c.main === true) || 
                                  contract.salesContractCustomers?.[0]

          if (clientePrincipal?.id) {
            // PRIMEIRO: Verificar se já existe no Supabase (SEM requisição API)
            clienteId = await findClienteBySiengeId(clientePrincipal.id)
            
            // Se não existe, buscar na API e criar
            if (!clienteId) {
              const customer = await getCustomer(clientePrincipal.id, dryRun)
              clienteId = await findOrCreateCliente(clientePrincipal.id, customer)
            }
          }

          // Buscar/criar empreendimento (OTIMIZADO: verifica Supabase primeiro)
          let empreendimentoId = null
          if (contract.enterpriseId) {
            // PRIMEIRO: Verificar se já existe no Supabase (SEM requisição API)
            empreendimentoId = await findEmpreendimentoBySiengeId(contract.enterpriseId)
            
            // Se não existe, buscar na API e criar
            if (!empreendimentoId) {
              const enterprise = await getEnterprise(contract.enterpriseId, dryRun)
              empreendimentoId = await findOrCreateEmpreendimento(contract.enterpriseId, enterprise)
            }
          }

          // Buscar corretor existente (NÃO cria - deve ser sincronizado via syncCorretores primeiro)
          let corretorId = null
          const corretorPrincipal = contract.brokers?.find(b => b.main === true) || 
                                  contract.brokers?.[0]

          if (corretorPrincipal?.id) {
            // PRIMEIRO: Verificar se já existe no Supabase (SEM criar)
            corretorId = await findCorretorBySiengeId(corretorPrincipal.id)
            
            // Se não existe, pular venda (corretor deve ser sincronizado primeiro)
            if (!corretorId) {
              console.warn(`Contrato ${contract.id}: Corretor ID ${corretorPrincipal.id} não encontrado no Supabase. Execute syncCorretores primeiro.`)
              stats.puladas++
              continue
            }
          } else {
            // Se não tem corretor no contrato, pular
            console.warn(`Contrato ${contract.id} sem corretor no Sienge, pulando...`)
            stats.puladas++
            continue
          }

          // Normalizar dados
          const vendaData = normalizeVendaData(contract, {
            clienteId,
            corretorId,
            empreendimentoId
          })

          // Determinar tipo de corretor (buscar do corretor)
          if (!vendaData.tipo_corretor && corretorId) {
            const { data: corretor } = await supabase
              .from('usuarios')
              .select('tipo_corretor')
              .eq('id', corretorId)
              .single()

            vendaData.tipo_corretor = corretor?.tipo_corretor || 'externo'
          }

          // Calcular comissões (se necessário)
          // Por enquanto, vamos deixar vazio e calcular depois
          // ou usar os valores padrão
          if (!vendaData.comissao_total) {
            vendaData.comissao_total = 0
            vendaData.comissao_corretor = 0
            vendaData.comissao_diretor = 0
            vendaData.comissao_nohros_imobiliaria = 0
            vendaData.comissao_nohros_gestao = 0
            vendaData.comissao_wsc = 0
            vendaData.comissao_coordenadora = 0
          }

          if (vendaExistente) {
            // Atualizar venda existente
            const { error } = await supabase
              .from('vendas')
              .update(vendaData)
              .eq('id', vendaExistente.id)

            if (error) throw error
            stats.atualizadas++
          } else {
            // Criar nova venda
            const { error } = await supabase
              .from('vendas')
              .insert([vendaData])

            if (error) throw error
            stats.criadas++
          }
        } catch (error) {
          console.error(`Erro ao processar contrato ${contract.id}:`, error)
          stats.erros++
        }
      }

      // Verificar se tem mais páginas
      offset += limit
      hasMore = contracts.length === limit && (metadata.count === null || offset < metadata.count)
    }

    return stats
  } catch (error) {
    console.error('Erro na sincronização de vendas:', error)
    throw error
  }
}

