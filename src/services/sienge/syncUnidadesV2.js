/**
 * Sincronização de Unidades do Sienge para Supabase
 * 
 * Fluxo:
 * 1. Busca unidades na API do Sienge (por empreendimento)
 * 2. Salva no RAW (sienge_raw.objects)
 * 3. Sincroniza para public.unidades
 */

import { supabase } from '../../lib/supabase'
import { getUnits } from './siengeClient'

/**
 * Ingere unidades do Sienge para RAW
 */
export const ingestUnidades = async (options = {}) => {
  const { onProgress = null, enterpriseIds = [] } = options

  console.log('🏠 [UNIDADES] Iniciando ingestão...')

  try {
    let todasUnidades = []
    
    // Se não passou enterpriseIds, buscar dos empreendimentos existentes
    let idsParaBuscar = enterpriseIds
    
    if (idsParaBuscar.length === 0) {
      // Buscar empreendimentos do RAW para pegar os IDs
      const { data: empreendimentos } = await supabase
        .schema('sienge_raw')
        .from('objects')
        .select('sienge_id')
        .eq('entity', 'enterprises')
      
      idsParaBuscar = (empreendimentos || []).map(e => e.sienge_id)
      console.log(`📊 [UNIDADES] Buscando unidades de ${idsParaBuscar.length} empreendimentos`)
    }

    // Buscar unidades de cada empreendimento
    for (const enterpriseId of idsParaBuscar) {
      try {
        let offset = 0
        const limit = 200
        let hasMore = true

        while (hasMore) {
          const response = await getUnits({ enterpriseId, limit, offset })
          const units = response.results || []
          
          // Adicionar enterpriseId a cada unidade
          const unitsComEnterprise = units.map(u => ({
            ...u,
            enterpriseId: parseInt(enterpriseId)
          }))
          
          todasUnidades = [...todasUnidades, ...unitsComEnterprise]
          
          hasMore = units.length === limit
          offset += limit
          
          if (onProgress) {
            onProgress({
              current: todasUnidades.length,
              total: response.resultSetMetadata?.count || todasUnidades.length,
              item: `Empreendimento ${enterpriseId}`
            })
          }
        }
      } catch (err) {
        console.warn(`⚠️ [UNIDADES] Erro ao buscar unidades do empreendimento ${enterpriseId}:`, err.message)
      }
    }

    console.log(`📊 [UNIDADES] ${todasUnidades.length} unidades encontradas no Sienge`)

    let ingeridos = 0
    let erros = 0

    for (const unit of todasUnidades) {
      try {
        const siengeId = String(unit.id)
        
        // Calcular hash do payload
        const payloadStr = JSON.stringify(unit)
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
            entity: 'units',
            sienge_id: siengeId,
            enterprise_id: String(unit.enterpriseId),
            payload: unit,
            payload_hash: payloadHash,
            source_url: '/units',
            synced_at: new Date().toISOString()
          }, {
            onConflict: 'entity,sienge_id'
          })

        if (error) {
          console.error(`❌ [UNIDADES] Erro ao ingerir ${siengeId}:`, error.message)
          erros++
        } else {
          ingeridos++
        }
      } catch (err) {
        console.error(`❌ [UNIDADES] Erro na unidade ${unit.id}:`, err.message)
        erros++
      }
    }

    console.log(`✅ [UNIDADES] Ingestão concluída: ${ingeridos} ingeridos, ${erros} erros`)

    return {
      total: todasUnidades.length,
      ingeridos,
      erros
    }
  } catch (error) {
    console.error('❌ [UNIDADES] Erro na ingestão:', error)
    throw error
  }
}

/**
 * Sincroniza unidades do RAW para public.unidades
 */
export const syncUnidadesFromRaw = async (options = {}) => {
  const { dryRun = false, onProgress = null } = options

  console.log(`🏠 [SYNC UNIDADES] Iniciando... (dryRun: ${dryRun})`)

  const resultado = {
    total: 0,
    criados: 0,
    atualizados: 0,
    erros: 0,
    detalhes: []
  }

  try {
    // Buscar unidades do RAW
    const { data: rawUnidades, error: rawError } = await supabase
      .schema('sienge_raw')
      .from('objects')
      .select('sienge_id, enterprise_id, payload')
      .eq('entity', 'units')

    if (rawError) {
      throw new Error(`Erro ao buscar RAW: ${rawError.message}`)
    }

    if (!rawUnidades || rawUnidades.length === 0) {
      console.log('⚠️ [SYNC UNIDADES] Nenhuma unidade no RAW. Execute ingestão primeiro.')
      return resultado
    }

    resultado.total = rawUnidades.length
    console.log(`📊 [SYNC UNIDADES] ${resultado.total} unidades no RAW`)

    // Buscar empreendimentos para mapear IDs
    const { data: empreendimentos } = await supabase
      .from('empreendimentos')
      .select('id, sienge_enterprise_id')

    const mapaEmpreendimentos = new Map()
    for (const emp of (empreendimentos || [])) {
      if (emp.sienge_enterprise_id) {
        mapaEmpreendimentos.set(emp.sienge_enterprise_id, emp.id)
      }
    }

    // Buscar unidades existentes
    const { data: existentes } = await supabase
      .from('unidades')
      .select('id, sienge_unit_id')

    const mapaExistentes = new Map()
    for (const u of (existentes || [])) {
      if (u.sienge_unit_id) {
        mapaExistentes.set(u.sienge_unit_id, u)
      }
    }

    console.log(`📊 [SYNC UNIDADES] ${existentes?.length || 0} unidades existentes no Supabase`)

    // Processar cada unidade
    for (let i = 0; i < rawUnidades.length; i++) {
      const raw = rawUnidades[i]
      const payload = raw.payload

      try {
        const siengeId = String(raw.sienge_id)
        const enterpriseId = String(raw.enterprise_id)
        
        // Mapear dados
        const dadosUnidade = {
          sienge_unit_id: siengeId,
          sienge_enterprise_id: enterpriseId,
          empreendimento_id: mapaEmpreendimentos.get(enterpriseId) || null,
          nome: payload.name || payload.description || `Unidade ${siengeId}`,
          bloco: payload.block || payload.blockName || null,
          andar: payload.floor ? String(payload.floor) : null,
          numero: payload.number || null,
          tipo: payload.type || payload.typeName || null,
          area_privativa: payload.privateArea || null,
          area_comum: payload.commonArea || null,
          area_total: payload.totalArea || (payload.privateArea && payload.commonArea ? payload.privateArea + payload.commonArea : null),
          status: mapearStatusUnidade(payload.situation || payload.status),
          valor_tabela: payload.tableValue || payload.value || null,
          sienge_updated_at: payload.modifiedAt || new Date().toISOString()
        }

        if (dryRun) {
          console.log(`[DRY RUN] ${mapaExistentes.has(siengeId) ? 'Atualizaria' : 'Criaria'}: ${dadosUnidade.nome}`)
          if (mapaExistentes.has(siengeId)) {
            resultado.atualizados++
          } else {
            resultado.criados++
          }
          continue
        }

        const existente = mapaExistentes.get(siengeId)

        if (existente) {
          // Atualizar
          const { error: updateError } = await supabase
            .from('unidades')
            .update(dadosUnidade)
            .eq('id', existente.id)

          if (updateError) {
            console.error(`❌ [SYNC UNIDADES] Erro ao atualizar ${siengeId}:`, updateError.message)
            resultado.erros++
          } else {
            resultado.atualizados++
          }
        } else {
          // Criar
          const { error: insertError } = await supabase
            .from('unidades')
            .insert(dadosUnidade)

          if (insertError) {
            console.error(`❌ [SYNC UNIDADES] Erro ao criar ${siengeId}:`, insertError.message)
            resultado.erros++
          } else {
            resultado.criados++
          }
        }

        if (onProgress) {
          onProgress({
            current: i + 1,
            total: rawUnidades.length,
            item: dadosUnidade.nome
          })
        }
      } catch (err) {
        console.error(`❌ [SYNC UNIDADES] Erro na unidade ${raw.sienge_id}:`, err.message)
        resultado.erros++
      }
    }

    console.log(`\n✅ [SYNC UNIDADES] Sincronização concluída:`)
    console.log(`   Total: ${resultado.total}`)
    console.log(`   Criados: ${resultado.criados}`)
    console.log(`   Atualizados: ${resultado.atualizados}`)
    console.log(`   Erros: ${resultado.erros}`)

    return resultado
  } catch (error) {
    console.error('❌ [SYNC UNIDADES] Erro:', error)
    throw error
  }
}

/**
 * Mapeia status da unidade do Sienge para o sistema
 */
function mapearStatusUnidade(situacao) {
  if (!situacao) return 'disponivel'
  
  const situacaoLower = String(situacao).toLowerCase()
  
  if (situacaoLower.includes('vendid') || situacaoLower.includes('sold')) {
    return 'vendida'
  }
  if (situacaoLower.includes('reserv')) {
    return 'reservada'
  }
  if (situacaoLower.includes('disponivel') || situacaoLower.includes('available')) {
    return 'disponivel'
  }
  
  // Por código numérico
  const codigo = parseInt(situacao)
  if (codigo === 0) return 'disponivel'
  if (codigo === 1) return 'reservada'
  if (codigo === 2) return 'vendida'
  
  return 'disponivel'
}

export default {
  ingestUnidades,
  syncUnidadesFromRaw
}
