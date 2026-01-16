/**
 * Backfill de Unidades
 * 
 * Busca unidades do Sienge e popula a tabela unidades
 * Apenas cria as que faltam (não duplica)
 */

import { supabase } from '../../lib/supabase'
import { getUnits } from './siengeClient'

/**
 * Mapeia status da unidade do Sienge
 */
const mapearStatusUnidade = (situacao) => {
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
  
  const codigo = parseInt(situacao)
  if (codigo === 0) return 'disponivel'
  if (codigo === 1) return 'reservada'
  if (codigo === 2) return 'vendida'
  
  return 'disponivel'
}

export const backfillUnidades = async (options = {}) => {
  const { onProgress = null, dryRun = false } = options

  console.log('🏠 [BACKFILL] Iniciando backfill de unidades...')
  console.log(`   Modo: ${dryRun ? 'DRY RUN' : 'PRODUÇÃO'}`)

  const stats = {
    total: 0,
    criadas: 0,
    jaExistentes: 0,
    erros: 0,
    detalhes: []
  }

  try {
    // Buscar empreendimentos que têm sienge_enterprise_id
    const { data: empreendimentos } = await supabase
      .from('empreendimentos')
      .select('id, sienge_enterprise_id, nome')
      .not('sienge_enterprise_id', 'is', null)

    if (!empreendimentos || empreendimentos.length === 0) {
      console.log('⚠️ [BACKFILL] Nenhum empreendimento com sienge_enterprise_id')
      return stats
    }

    console.log(`📊 [BACKFILL] ${empreendimentos.length} empreendimentos para processar`)

    // Buscar unidades já existentes
    const { data: unidadesExistentes } = await supabase
      .from('unidades')
      .select('sienge_unit_id')

    const unidadesMap = new Set()
    for (const u of (unidadesExistentes || [])) {
      if (u.sienge_unit_id) {
        unidadesMap.add(u.sienge_unit_id)
      }
    }

    console.log(`📊 [BACKFILL] ${unidadesMap.size} unidades já existem`)

    // Processar cada empreendimento
    let totalUnidades = 0

    for (let i = 0; i < empreendimentos.length; i++) {
      const emp = empreendimentos[i]
      const enterpriseId = emp.sienge_enterprise_id

      try {
        if (onProgress) {
          onProgress({
            current: i + 1,
            total: empreendimentos.length,
            item: `Empreendimento: ${emp.nome}`
          })
        }

        // Buscar unidades do Sienge
        let offset = 0
        const limit = 200
        let hasMore = true

        while (hasMore) {
          const response = await getUnits({ enterpriseId, limit, offset })
          const units = response.results || []

          if (units.length === 0) {
            hasMore = false
            break
          }

          totalUnidades += units.length

          // Processar cada unidade
          for (const unit of units) {
            try {
              const siengeUnitId = String(unit.id)

              // Verificar se já existe
              if (unidadesMap.has(siengeUnitId)) {
                stats.jaExistentes++
                continue
              }

              // Mapear dados
              const dadosUnidade = {
                sienge_unit_id: siengeUnitId,
                sienge_enterprise_id: enterpriseId,
                empreendimento_id: emp.id,
                nome: unit.name || unit.description || `Unidade ${siengeUnitId}`,
                bloco: unit.block || unit.blockName || null,
                andar: unit.floor ? String(unit.floor) : null,
                numero: unit.number || null,
                tipo: unit.type || unit.typeName || null,
                area_privativa: unit.privateArea || null,
                area_comum: unit.commonArea || null,
                area_total: unit.totalArea || (unit.privateArea && unit.commonArea ? unit.privateArea + unit.commonArea : null),
                status: mapearStatusUnidade(unit.situation || unit.status),
                valor_tabela: unit.tableValue || unit.value || null,
                sienge_updated_at: unit.modifiedAt || new Date().toISOString()
              }

              if (dryRun) {
                stats.detalhes.push({
                  empreendimento: emp.nome,
                  unidade: dadosUnidade.nome,
                  acao: 'criaria'
                })
                stats.criadas++
                continue
              }

              // Criar unidade
              const { error: insertError } = await supabase
                .from('unidades')
                .insert(dadosUnidade)

              if (insertError) {
                console.error(`❌ Erro ao criar unidade ${siengeUnitId}:`, insertError.message)
                stats.erros++
              } else {
                stats.criadas++
                unidadesMap.add(siengeUnitId) // Adicionar ao set para não duplicar
              }

            } catch (error) {
              console.error(`❌ Erro na unidade ${unit.id}:`, error.message)
              stats.erros++
            }
          }

          hasMore = units.length === limit
          offset += limit
        }

      } catch (error) {
        console.error(`❌ Erro no empreendimento ${emp.nome}:`, error.message)
        stats.erros++
      }
    }

    stats.total = totalUnidades

    console.log(`\n✅ [BACKFILL] Unidades concluído:`)
    console.log(`   Total encontradas: ${stats.total}`)
    console.log(`   Criadas: ${stats.criadas}`)
    console.log(`   Já existentes: ${stats.jaExistentes}`)
    console.log(`   Erros: ${stats.erros}`)

    return stats

  } catch (error) {
    console.error('❌ [BACKFILL] Erro:', error)
    throw error
  }
}

export default {
  backfillUnidades
}
