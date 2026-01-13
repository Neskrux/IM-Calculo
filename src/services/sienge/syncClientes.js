/**
 * Sincronização de Clientes do Sienge
 * GET /customers → Supabase.clientes
 */

import { getCustomers, getCustomer } from './siengeClient'
import { supabase } from '../../lib/supabase'
import { findOrCreateCliente } from './syncUtils'
import { SIENGE_CONFIG } from '../../lib/sienge'

/**
 * Sincroniza clientes do Sienge para o Supabase
 */
export const syncClientes = async (options = {}) => {
  const {
    enterpriseId = SIENGE_CONFIG.enterpriseId,
    onlyActive = true,
    modifiedAfter = null, // Sincronização incremental
    limit = 200, // Aumentado para 200 para economizar requisições
    dryRun = false,
    onProgress = null
  } = options

  const stats = {
    total: 0,
    criados: 0,
    atualizados: 0,
    erros: 0,
    pulados: 0
  }

  try {
    let offset = 0
    let hasMore = true

    while (hasMore) {
      // Buscar clientes do Sienge
      const response = await getCustomers({
        enterpriseId,
        onlyActive,
        modifiedAfter,
        limit,
        offset,
        dryRun
      })

      if (dryRun) {
        console.log('[DRY RUN] Processaria', response.results?.length || 0, 'clientes')
        stats.total = response.results?.length || 0
        break
      }

      const clientes = response.results || []
      const metadata = response.resultSetMetadata || {}

      stats.total += clientes.length

      for (let i = 0; i < clientes.length; i++) {
        const cliente = clientes[i]

        try {
          if (onProgress) {
            onProgress({
              current: offset + i + 1,
              total: metadata.count || stats.total,
              cliente: cliente.id
            })
          }

          // Buscar ou criar cliente
          const clienteId = await findOrCreateCliente(cliente.id, cliente)

          if (clienteId) {
            // Verificar se foi criado agora ou já existia
            const { data: existente } = await supabase
              .from('clientes')
              .select('created_at, sienge_updated_at')
              .eq('id', clienteId)
              .single()

            const foiCriadoAgora = existente?.sienge_updated_at === null || 
                                  new Date(existente?.created_at) > new Date(Date.now() - 1000)

            if (foiCriadoAgora) {
              stats.criados++
            } else {
              // Atualizar dados se necessário
              const telefonePrincipal = cliente.phones?.find(p => p.main === true) || cliente.phones?.[0]
              const enderecoComCep = cliente.addresses?.find(a => a.mail === true) || cliente.addresses?.[0]

              const dadosAtualizacao = {
                nome_completo: cliente.name || null,
                cpf: cliente.cpf || null,
                cnpj: cliente.cnpj || null,
                email: cliente.email || null,
                telefone: telefonePrincipal?.number || null,
                data_nascimento: cliente.birthDate || null,
                rg: cliente.numberIdentityCard || null,
                profissao: cliente.profession || null,
                cep: enderecoComCep?.zipCode || null,
                sienge_updated_at: cliente.modifiedAt ? new Date(cliente.modifiedAt).toISOString() : null
              }

              // Formatar endereço
              if (cliente.addresses && cliente.addresses.length > 0) {
                const endereco = cliente.addresses.find(a => a.mail === true) || cliente.addresses[0]
                const partes = []
                if (endereco.streetName) partes.push(endereco.streetName)
                if (endereco.number) partes.push(`nº ${endereco.number}`)
                if (endereco.complement) partes.push(endereco.complement)
                if (endereco.neighborhood) partes.push(endereco.neighborhood)
                if (endereco.city) partes.push(endereco.city)
                if (endereco.state) partes.push(endereco.state)
                dadosAtualizacao.endereco = partes.length > 0 ? partes.join(', ') : null
              }

              await supabase
                .from('clientes')
                .update(dadosAtualizacao)
                .eq('id', clienteId)

              stats.atualizados++
            }
          } else {
            stats.pulados++
          }
        } catch (error) {
          console.error(`Erro ao processar cliente ${cliente.id}:`, error)
          stats.erros++
        }
      }

      // Verificar se tem mais páginas
      offset += limit
      hasMore = clientes.length === limit && (metadata.count === null || offset < metadata.count)
    }

    return stats
  } catch (error) {
    console.error('Erro na sincronização de clientes:', error)
    throw error
  }
}

/**
 * Sincroniza um cliente específico por ID
 */
export const syncClienteById = async (customerId, dryRun = false) => {
  try {
    const cliente = await getCustomer(customerId, dryRun)
    
    if (!cliente) {
      return { error: 'Cliente não encontrado' }
    }

    if (dryRun) {
      return { cliente, dryRun: true }
    }

    const clienteId = await findOrCreateCliente(cliente.id, cliente)
    
    return { clienteId, cliente }
  } catch (error) {
    console.error('Erro ao sincronizar cliente:', error)
    return { error: error.message }
  }
}

