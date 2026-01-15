/**
 * Sincronização de Corretores V2 - SEM Supabase Auth
 * 
 * Camada 2: Processa dados RAW e popula public.usuarios
 * 
 * REGRAS:
 * - NUNCA chama Supabase Auth (auth.admin.createUser)
 * - Gera UUID no banco para corretores sincronizados
 * - Email fake determinístico se não tiver email real
 * - Upsert por sienge_broker_id
 */

import { supabase } from '../../lib/supabase'

/**
 * Extrai CPF de forma segura (pode vir como string ou objeto)
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
  const ddd = principal?.ddd || ''
  const number = principal?.number || ''
  return `${ddd}${number}`.replace(/\D/g, '') || null
}

/**
 * Extrai email de otherContactMethods
 */
const extractEmail = (otherContactMethods) => {
  if (!otherContactMethods || !Array.isArray(otherContactMethods)) return null
  const emailContact = otherContactMethods.find(c => 
    c.type === 1 || c.type === 2 || (c.address && c.address.includes('@'))
  )
  return emailContact?.address || null
}

/**
 * Formata endereço completo
 */
const formatarEndereco = (address) => {
  if (!address || !address.streetName) return null
  const partes = [
    address.streetName,
    address.number && `nº ${address.number}`,
    address.complement,
    address.neighborhood && `Bairro ${address.neighborhood}`,
    address.cityName && address.state 
      ? `${address.cityName} - ${address.state}`
      : address.cityName,
    address.zipCode
  ].filter(Boolean)
  return partes.length > 0 ? partes.join(', ') : null
}

/**
 * Mapeia corretor do Sienge para formato do Supabase
 */
const mapearCorretor = (creditor) => {
  const siengeBrokerId = String(creditor.id)
  const email = extractEmail(creditor.otherContactMethods)
  
  return {
    sienge_broker_id: siengeBrokerId,
    nome: creditor.name || creditor.tradeName || `Corretor Sienge #${siengeBrokerId}`,
    nome_fantasia: creditor.tradeName || null,
    email: email || `corretor.${siengeBrokerId}@sync.local`, // Email fake determinístico
    telefone: extractTelefone(creditor.phones),
    cpf: extractCpf(creditor.cpf),
    cnpj: extractCnpj(creditor.cnpj),
    endereco: formatarEndereco(creditor.address),
    tipo: 'corretor',
    tipo_corretor: 'externo', // Default, pode ser ajustado depois
    ativo: creditor.active !== false,
    origem: 'sienge'
  }
}

/**
 * Sincroniza corretores do RAW para public.usuarios
 * 
 * @param {Object} options
 * @param {Function} options.onProgress - Callback de progresso
 * @param {boolean} options.dryRun - Se true, não salva no banco
 * @returns {Object} Estatísticas da sincronização
 */
export const syncCorretoresFromRaw = async (options = {}) => {
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

  console.log('🔄 [SYNC] Iniciando sincronização de corretores (SEM Auth)...')
  console.log(`   Modo: ${dryRun ? 'DRY RUN' : 'PRODUÇÃO'}`)

  try {
    // Buscar todos os corretores do RAW
    const { data: rawCorretores, error: rawError } = await supabase
      .schema('sienge_raw')
      .from('objects')
      .select('sienge_id, payload')
      .eq('entity', 'creditors')
      .order('synced_at', { ascending: false })

    if (rawError) {
      throw new Error(`Erro ao buscar RAW: ${rawError.message}`)
    }

    if (!rawCorretores || rawCorretores.length === 0) {
      console.log('⚠️ [SYNC] Nenhum corretor no RAW. Execute ingestCreditors primeiro.')
      return stats
    }

    console.log(`📊 [SYNC] ${rawCorretores.length} corretores no RAW`)
    stats.total = rawCorretores.length

    // Buscar corretores existentes no Supabase
    const { data: existentes } = await supabase
      .from('usuarios')
      .select('id, sienge_broker_id, nome, email, updated_at')
      .eq('tipo', 'corretor')
      .not('sienge_broker_id', 'is', null)

    const existentesMap = new Map()
    if (existentes) {
      existentes.forEach(u => existentesMap.set(u.sienge_broker_id, u))
    }

    console.log(`📊 [SYNC] ${existentesMap.size} corretores já existem no Supabase`)

    // Processar cada corretor
    for (let i = 0; i < rawCorretores.length; i++) {
      const raw = rawCorretores[i]
      const creditor = raw.payload

      try {
        const dadosCorretor = mapearCorretor(creditor)
        const existente = existentesMap.get(dadosCorretor.sienge_broker_id)

        if (dryRun) {
          stats.detalhes.push({
            sienge_id: dadosCorretor.sienge_broker_id,
            nome: dadosCorretor.nome,
            email: dadosCorretor.email,
            acao: existente ? 'atualizaria' : 'criaria'
          })
          if (existente) stats.atualizados++
          else stats.criados++
          continue
        }

        if (existente) {
          // Atualizar existente
          const { error: updateError } = await supabase
            .from('usuarios')
            .update({
              nome: dadosCorretor.nome,
              nome_fantasia: dadosCorretor.nome_fantasia,
              // Não sobrescrever email se já tem um real
              email: existente.email?.includes('@sync.local') 
                ? dadosCorretor.email 
                : existente.email,
              telefone: dadosCorretor.telefone,
              cpf: dadosCorretor.cpf,
              cnpj: dadosCorretor.cnpj,
              endereco: dadosCorretor.endereco,
              ativo: dadosCorretor.ativo,
              updated_at: new Date().toISOString()
            })
            .eq('id', existente.id)

          if (updateError) throw updateError
          stats.atualizados++

        } else {
          // Criar novo (SEM Auth!)
          const { error: insertError } = await supabase
            .from('usuarios')
            .insert({
              // id será gerado pelo default uuid_generate_v4()
              ...dadosCorretor,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })

          if (insertError) throw insertError
          stats.criados++
        }

        if (onProgress) {
          onProgress({
            current: i + 1,
            total: rawCorretores.length,
            item: dadosCorretor.nome
          })
        }

      } catch (error) {
        console.error(`❌ [SYNC] Erro no corretor ${raw.sienge_id}:`, error.message)
        stats.erros++
        stats.detalhes.push({
          sienge_id: raw.sienge_id,
          erro: error.message
        })
      }
    }

    console.log(`✅ [SYNC] Corretores sincronizados:`)
    console.log(`   Total: ${stats.total}`)
    console.log(`   Criados: ${stats.criados}`)
    console.log(`   Atualizados: ${stats.atualizados}`)
    console.log(`   Erros: ${stats.erros}`)

    return stats

  } catch (error) {
    console.error('❌ [SYNC] Erro na sincronização de corretores:', error)
    throw error
  }
}

/**
 * Busca ou cria corretor placeholder (para vendas sem corretor)
 */
export const getOrCreateCorretorPlaceholder = async (siengeBrokerId, nome = null) => {
  if (!siengeBrokerId) return null

  const siengeBrokerIdStr = String(siengeBrokerId)

  // Tentar encontrar existente
  const { data: existente } = await supabase
    .from('usuarios')
    .select('id')
    .eq('sienge_broker_id', siengeBrokerIdStr)
    .maybeSingle()

  if (existente) {
    return existente.id
  }

  // Criar placeholder
  const { data: novo, error } = await supabase
    .from('usuarios')
    .insert({
      sienge_broker_id: siengeBrokerIdStr,
      nome: nome || `Corretor Sienge #${siengeBrokerIdStr}`,
      email: `corretor.${siengeBrokerIdStr}@placeholder.local`,
      tipo: 'corretor',
      tipo_corretor: 'externo',
      ativo: true,
      origem: 'sienge'
    })
    .select('id')
    .single()

  if (error) {
    console.error(`Erro ao criar placeholder para corretor ${siengeBrokerIdStr}:`, error)
    return null
  }

  return novo.id
}

/**
 * Busca corretor por sienge_broker_id
 */
export const findCorretorBySiengeId = async (siengeBrokerId) => {
  if (!siengeBrokerId) return null

  const { data } = await supabase
    .from('usuarios')
    .select('id, nome, tipo_corretor')
    .eq('sienge_broker_id', String(siengeBrokerId))
    .eq('tipo', 'corretor')
    .maybeSingle()

  return data
}

export default {
  syncCorretoresFromRaw,
  getOrCreateCorretorPlaceholder,
  findCorretorBySiengeId
}
