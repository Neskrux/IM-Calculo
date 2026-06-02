/**
 * Sincronização de Empreendimentos do Sienge para Supabase
 * 
 * Fluxo:
 * 1. Busca empreendimentos na API do Sienge
 * 2. Salva no RAW (sienge_raw.objects)
 * 3. Sincroniza para public.empreendimentos
 */

import { supabase } from '../../lib/supabase'
import { getEnterprises, getEnterprise } from './siengeClient'

/**
 * Ingere empreendimentos do Sienge para RAW
 */
export const ingestEmpreendimentos = async (options = {}) => {
  const { onProgress = null } = options

  console.log('🏢 [EMPREENDIMENTOS] Iniciando ingestão...')

  try {
    // Buscar todos os empreendimentos do Sienge
    const response = await getEnterprises()
    
    // A API pode retornar { results: [...] } ou array direto
    const enterprises = Array.isArray(response) 
      ? response 
      : (response.results || [])

    console.log(`📊 [EMPREENDIMENTOS] ${enterprises.length} empreendimentos encontrados no Sienge`)

    let ingeridos = 0
    let erros = 0

    for (const enterprise of enterprises) {
      try {
        const siengeId = String(enterprise.id)
        
        // Calcular hash do payload
        const payloadStr = JSON.stringify(enterprise)
        const encoder = new TextEncoder()
        const data = encoder.encode(payloadStr)
        const hashBuffer = await crypto.subtle.digest('SHA-256', data)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        const payloadHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32)

        // Upsert no RAW
        const { error } = await supabase
          .schema('sienge_raw')
          .from('objects')
          .upsert({
            entity: 'enterprises',
            sienge_id: siengeId,
            enterprise_id: siengeId,
            payload: enterprise,
            payload_hash: payloadHash,
            source_url: '/enterprises',
            synced_at: new Date().toISOString()
          }, {
            onConflict: 'entity,sienge_id'
          })

        if (error) {
          console.error(`❌ [EMPREENDIMENTOS] Erro ao ingerir ${siengeId}:`, error.message)
          erros++
        } else {
          ingeridos++
        }

        if (onProgress) {
          onProgress({
            current: ingeridos + erros,
            total: enterprises.length,
            item: enterprise.name || `Empreendimento ${siengeId}`
          })
        }
      } catch (err) {
        console.error(`❌ [EMPREENDIMENTOS] Erro no empreendimento ${enterprise.id}:`, err.message)
        erros++
      }
    }

    console.log(`✅ [EMPREENDIMENTOS] Ingestão concluída: ${ingeridos} ingeridos, ${erros} erros`)

    return {
      total: enterprises.length,
      ingeridos,
      erros
    }
  } catch (error) {
    console.error('❌ [EMPREENDIMENTOS] Erro na ingestão:', error)
    throw error
  }
}

/**
 * Sincroniza empreendimentos do RAW para public.empreendimentos
 */
export const syncEmpreendimentosFromRaw = async (options = {}) => {
  const { dryRun = false, onProgress = null } = options

  console.log(`🏢 [SYNC EMPREENDIMENTOS] Iniciando... (dryRun: ${dryRun})`)

  const resultado = {
    total: 0,
    criados: 0,
    atualizados: 0,
    erros: 0,
    detalhes: []
  }

  try {
    // Buscar empreendimentos do RAW
    const { data: rawEmpreendimentos, error: rawError } = await supabase
      .schema('sienge_raw')
      .from('objects')
      .select('sienge_id, payload')
      .eq('entity', 'enterprises')

    if (rawError) {
      throw new Error(`Erro ao buscar RAW: ${rawError.message}`)
    }

    if (!rawEmpreendimentos || rawEmpreendimentos.length === 0) {
      console.log('⚠️ [SYNC EMPREENDIMENTOS] Nenhum empreendimento no RAW. Execute ingestão primeiro.')
      return resultado
    }

    resultado.total = rawEmpreendimentos.length
    console.log(`📊 [SYNC EMPREENDIMENTOS] ${resultado.total} empreendimentos no RAW`)

    // Buscar empreendimentos existentes no Supabase
    const { data: existentes } = await supabase
      .from('empreendimentos')
      .select('id, sienge_enterprise_id, nome, comissao_total_externo, comissao_total_interno, cargos')

    const mapaSiengeId = new Map()
    const mapaNome = new Map()
    
    // Função para normalizar nome para comparação
    const normalizarNome = (nome) => {
      if (!nome) return ''
      return nome
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove acentos
        .replace(/\s+/g, ' ') // Normaliza espaços
    }
    
    for (const emp of (existentes || [])) {
      if (emp.sienge_enterprise_id) {
        mapaSiengeId.set(emp.sienge_enterprise_id, emp)
      }
      if (emp.nome) {
        mapaNome.set(normalizarNome(emp.nome), emp)
      }
    }

    console.log(`📊 [SYNC EMPREENDIMENTOS] ${existentes?.length || 0} empreendimentos existentes no Supabase`)
    console.log(`📊 [SYNC EMPREENDIMENTOS] ${mapaSiengeId.size} já têm sienge_enterprise_id`)
    
    // Debug: mostrar nomes existentes
    console.log('📋 [DEBUG] Empreendimentos existentes:')
    existentes?.forEach(e => {
      console.log(`   - "${e.nome}" (sienge_id: ${e.sienge_enterprise_id || 'N/A'})`)
    })

    // Processar cada empreendimento
    for (let i = 0; i < rawEmpreendimentos.length; i++) {
      const raw = rawEmpreendimentos[i]
      const payload = raw.payload

      try {
        const siengeId = String(raw.sienge_id)
        const nome = payload.name || `Empreendimento ${siengeId}`
        const nomeNormalizado = normalizarNome(nome)
        
        console.log(`\n🔍 [DEBUG] Processando: "${nome}" (sienge_id: ${siengeId})`)
        console.log(`   Nome normalizado: "${nomeNormalizado}"`)

        // Verificar se já existe por sienge_id
        let existente = mapaSiengeId.get(siengeId)
        
        // Se não existe por sienge_id, tentar por nome (match flexível)
        if (!existente) {
          existente = mapaNome.get(nomeNormalizado)
          
          // Tentar match parcial se não encontrou exato
          if (!existente) {
            for (const [nomeExistente, emp] of mapaNome) {
              // Match se um contém o outro
              if (nomeExistente.includes(nomeNormalizado) || nomeNormalizado.includes(nomeExistente)) {
                existente = emp
                console.log(`   🔍 Match parcial: "${nome}" → "${emp.nome}"`)
                break
              }
            }
          }
        }

        if (dryRun) {
          console.log(`[DRY RUN] ${existente ? 'Atualizaria' : 'Criaria'}: ${nome}`)
          if (existente) {
            resultado.atualizados++
          } else {
            resultado.criados++
          }
          continue
        }

        if (existente) {
          // Atualizar existente - APENAS adiciona sienge_enterprise_id, não sobrescreve outros campos
          const updateData = {
            sienge_enterprise_id: siengeId
          }
          
          // Só atualiza o nome se o existente não tiver nome ou for placeholder
          if (!existente.nome || existente.nome.startsWith('Empreendimento ')) {
            updateData.nome = nome
          }
          
          const { error: updateError } = await supabase
            .from('empreendimentos')
            .update(updateData)
            .eq('id', existente.id)

          if (updateError) {
            console.error(`❌ [SYNC EMPREENDIMENTOS] Erro ao atualizar ${existente.nome}:`, updateError.message)
            resultado.erros++
            resultado.detalhes.push({ sienge_id: siengeId, nome: existente.nome, erro: updateError.message })
          } else {
            resultado.atualizados++
            console.log(`   ✏️ Vinculado: ${existente.nome} ← sienge_id: ${siengeId}`)
          }
        } else {
          // Criar novo empreendimento (só se não existir)
          console.log(`   ➕ Novo empreendimento do Sienge: ${nome}`)
          
          // Dados completos para novo empreendimento
          const novoEmpreendimento = {
            sienge_enterprise_id: siengeId,
            nome: nome,
            descricao: payload.description || '',
            comissao_total_externo: 7, // Valor padrão
            comissao_total_interno: 6.5, // Valor padrão
            cargos: [] // Será configurado manualmente depois
          }
          
          const { error: insertError } = await supabase
            .from('empreendimentos')
            .insert(novoEmpreendimento)

          if (insertError) {
            console.error(`❌ [SYNC EMPREENDIMENTOS] Erro ao criar ${nome}:`, insertError.message)
            resultado.erros++
            resultado.detalhes.push({ sienge_id: siengeId, nome, erro: insertError.message })
          } else {
            resultado.criados++
            console.log(`   ➕ Criado: ${nome} (sienge_id: ${siengeId})`)
          }
        }

        if (onProgress) {
          onProgress({
            current: i + 1,
            total: rawEmpreendimentos.length,
            item: nome
          })
        }
      } catch (err) {
        console.error(`❌ [SYNC EMPREENDIMENTOS] Erro no empreendimento ${raw.sienge_id}:`, err.message)
        resultado.erros++
        resultado.detalhes.push({ sienge_id: raw.sienge_id, erro: err.message })
      }
    }

    console.log(`\n✅ [SYNC EMPREENDIMENTOS] Sincronização concluída:`)
    console.log(`   Total: ${resultado.total}`)
    console.log(`   Criados: ${resultado.criados}`)
    console.log(`   Atualizados: ${resultado.atualizados}`)
    console.log(`   Erros: ${resultado.erros}`)

    return resultado
  } catch (error) {
    console.error('❌ [SYNC EMPREENDIMENTOS] Erro:', error)
    throw error
  }
}

export default {
  ingestEmpreendimentos,
  syncEmpreendimentosFromRaw
}
