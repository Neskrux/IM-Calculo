/**
 * Sincronização de Clientes V2
 * 
 * Camada 2: Processa dados RAW e popula public.clientes
 * 
 * REGRAS:
 * - Upsert por sienge_customer_id
 * - NÃO cria user_id no Auth (campo é NULLable)
 * - Mapeia todos os campos disponíveis
 */

import { supabase } from '../../lib/supabase'

/**
 * Extrai CPF de forma segura
 */
const extractCpf = (cpf) => {
  if (!cpf) return null
  if (typeof cpf === 'string') return cpf.replace(/\D/g, '')
  if (typeof cpf === 'object' && cpf.value) return String(cpf.value).replace(/\D/g, '')
  return null
}

/**
 * Extrai CNPJ de forma segura
 */
const extractCnpj = (cnpj) => {
  if (!cnpj) return null
  if (typeof cnpj === 'string') return cnpj.replace(/\D/g, '')
  if (typeof cnpj === 'object' && cnpj.value) return String(cnpj.value).replace(/\D/g, '')
  return null
}

/**
 * Extrai telefone principal
 */
const extractTelefone = (phones) => {
  if (!phones || !Array.isArray(phones) || phones.length === 0) return null
  const principal = phones.find(p => p.main === true) || phones[0]
  return principal?.number || null
}

/**
 * Formata endereço completo
 */
const formatarEndereco = (addresses) => {
  if (!addresses || !Array.isArray(addresses) || addresses.length === 0) return null
  const endereco = addresses.find(a => a.mail === true) || addresses[0]
  
  const partes = []
  if (endereco.streetName) partes.push(endereco.streetName)
  if (endereco.number) partes.push(`nº ${endereco.number}`)
  if (endereco.complement) partes.push(endereco.complement)
  if (endereco.neighborhood) partes.push(endereco.neighborhood)
  if (endereco.city) partes.push(endereco.city)
  if (endereco.state) partes.push(endereco.state)
  
  return partes.length > 0 ? partes.join(', ') : null
}

/**
 * Extrai CEP
 */
const extractCep = (addresses) => {
  if (!addresses || !Array.isArray(addresses) || addresses.length === 0) return null
  const endereco = addresses.find(a => a.mail === true) || addresses[0]
  return endereco?.zipCode || null
}

/**
 * Mapeia cliente do Sienge para formato do Supabase
 */
const mapearCliente = (customer) => {
  return {
    sienge_customer_id: String(customer.id),
    nome_completo: customer.name || 'Cliente Sienge',
    cpf: extractCpf(customer.cpf),
    cnpj: extractCnpj(customer.cnpj),
    email: customer.email || null,
    telefone: extractTelefone(customer.phones),
    endereco: formatarEndereco(customer.addresses),
    cep: extractCep(customer.addresses),
    data_nascimento: customer.birthDate || null,
    rg: customer.numberIdentityCard || null,
    profissao: customer.profession || null,
    // Campos extras do Sienge
    sexo: customer.sex || null,
    estado_civil: customer.civilStatus || null,
    nome_pai: customer.fatherName || null,
    nome_mae: customer.motherName || null,
    nacionalidade: customer.nationality || null,
    tipo_pessoa: customer.personType || 'Física',
    sienge_updated_at: customer.modifiedAt 
      ? new Date(customer.modifiedAt).toISOString() 
      : new Date().toISOString()
  }
}

/**
 * Sincroniza clientes do RAW para public.clientes
 */
export const syncClientesFromRaw = async (options = {}) => {
  const {
    onProgress = null,
    dryRun = false
  } = options

  const stats = {
    total: 0,
    criados: 0,
    atualizados: 0,
    inalterados: 0,
    erros: 0,
    detalhes: []
  }

  console.log('🔄 [SYNC] Iniciando sincronização de clientes...')
  console.log(`   Modo: ${dryRun ? 'DRY RUN' : 'PRODUÇÃO'}`)

  try {
    // Buscar todos os clientes do RAW
    const { data: rawClientes, error: rawError } = await supabase
      .schema('sienge_raw')
      .from('objects')
      .select('sienge_id, payload')
      .eq('entity', 'customers')
      .order('synced_at', { ascending: false })

    if (rawError) {
      throw new Error(`Erro ao buscar RAW: ${rawError.message}`)
    }

    if (!rawClientes || rawClientes.length === 0) {
      console.log('⚠️ [SYNC] Nenhum cliente no RAW. Execute ingestCustomers primeiro.')
      return stats
    }

    console.log(`📊 [SYNC] ${rawClientes.length} clientes no RAW`)
    stats.total = rawClientes.length

    // Buscar clientes existentes no Supabase
    const { data: existentes } = await supabase
      .from('clientes')
      .select('id, sienge_customer_id, nome_completo, sienge_updated_at')
      .not('sienge_customer_id', 'is', null)

    const existentesMap = new Map()
    if (existentes) {
      existentes.forEach(c => existentesMap.set(c.sienge_customer_id, c))
    }

    console.log(`📊 [SYNC] ${existentesMap.size} clientes já existem no Supabase`)

    // Processar cada cliente
    for (let i = 0; i < rawClientes.length; i++) {
      const raw = rawClientes[i]
      const customer = raw.payload

      try {
        const dadosCliente = mapearCliente(customer)
        const existente = existentesMap.get(dadosCliente.sienge_customer_id)

        if (dryRun) {
          stats.detalhes.push({
            sienge_id: dadosCliente.sienge_customer_id,
            nome: dadosCliente.nome_completo,
            cpf: dadosCliente.cpf,
            acao: existente ? 'atualizaria' : 'criaria'
          })
          if (existente) stats.atualizados++
          else stats.criados++
          continue
        }

        if (existente) {
          // Atualizar existente
          const { error: updateError } = await supabase
            .from('clientes')
            .update({
              ...dadosCliente,
              updated_at: new Date().toISOString()
            })
            .eq('id', existente.id)

          if (updateError) throw updateError
          stats.atualizados++

        } else {
          // Criar novo
          const { error: insertError } = await supabase
            .from('clientes')
            .insert({
              ...dadosCliente,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })

          if (insertError) throw insertError
          stats.criados++
        }

        if (onProgress) {
          onProgress({
            current: i + 1,
            total: rawClientes.length,
            item: dadosCliente.nome_completo
          })
        }

      } catch (error) {
        console.error(`❌ [SYNC] Erro no cliente ${raw.sienge_id}:`, error.message)
        stats.erros++
        stats.detalhes.push({
          sienge_id: raw.sienge_id,
          erro: error.message
        })
      }
    }

    console.log(`✅ [SYNC] Clientes sincronizados:`)
    console.log(`   Total: ${stats.total}`)
    console.log(`   Criados: ${stats.criados}`)
    console.log(`   Atualizados: ${stats.atualizados}`)
    console.log(`   Erros: ${stats.erros}`)

    return stats

  } catch (error) {
    console.error('❌ [SYNC] Erro na sincronização de clientes:', error)
    throw error
  }
}

/**
 * Busca cliente por sienge_customer_id
 */
export const findClienteBySiengeId = async (siengeCustomerId) => {
  if (!siengeCustomerId) return null

  const { data } = await supabase
    .from('clientes')
    .select('id, nome_completo')
    .eq('sienge_customer_id', String(siengeCustomerId))
    .maybeSingle()

  return data
}

/**
 * Busca ou cria cliente placeholder
 */
export const getOrCreateClientePlaceholder = async (siengeCustomerId, nome = null) => {
  if (!siengeCustomerId) return null

  const siengeCustomerIdStr = String(siengeCustomerId)

  // Tentar encontrar existente
  const { data: existente } = await supabase
    .from('clientes')
    .select('id')
    .eq('sienge_customer_id', siengeCustomerIdStr)
    .maybeSingle()

  if (existente) {
    return existente.id
  }

  // Criar placeholder
  const { data: novo, error } = await supabase
    .from('clientes')
    .insert({
      sienge_customer_id: siengeCustomerIdStr,
      nome_completo: nome || `Cliente Sienge #${siengeCustomerIdStr}`
    })
    .select('id')
    .single()

  if (error) {
    console.error(`Erro ao criar placeholder para cliente ${siengeCustomerIdStr}:`, error)
    return null
  }

  return novo.id
}

export default {
  syncClientesFromRaw,
  findClienteBySiengeId,
  getOrCreateClientePlaceholder
}
