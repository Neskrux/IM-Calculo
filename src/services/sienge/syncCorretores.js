/**
 * Sincronização de Corretores do Sienge
 * Agora usa GET /creditors e filtra apenas corretores (broker !== null)
 */

import { getCreditors } from './siengeClient'
import { findOrCreateCorretor } from './syncUtils'
import { SIENGE_CONFIG } from '../../lib/sienge'

/**
 * Sincroniza corretores do Sienge via API /creditors
 * Filtra automaticamente apenas credores que são corretores
 * 
 * Modos:
 * - dryRun=true: Não faz requisições, não salva nada (simulação completa)
 * - validate=true: Faz requisições reais, mostra dados, NÃO salva no banco
 * - dryRun=false, validate=false: Modo produção, salva tudo
 */
export const syncCorretores = async (options = {}) => {
  const {
    limit = 200, // Aumentado para 200 para economizar requisições
    dryRun = false,
    validate = false, // Modo validação: faz requisições reais mas não salva
    onProgress = null
  } = options

  const stats = {
    total: 0,
    criados: 0,
    atualizados: 0,
    erros: 0,
    dadosValidados: [] // Dados coletados em modo validação
  }

  try {
    let offset = 0
    let hasMore = true

    while (hasMore) {
      // Se validate=true, faz requisição real mesmo com dryRun=true
      const response = await getCreditors({
        limit,
        offset,
        dryRun: dryRun && !validate // Ignora dryRun se validate=true
      })

      // Modo dry-run puro: não faz requisições
      if (dryRun && !validate) {
        console.log('[DRY RUN] Processaria', response.results?.length || 0, 'corretores')
        stats.total = response.results?.length || 0
        break
      }

      const creditors = response.results || []
      const metadata = response.resultSetMetadata || {}

      stats.total += creditors.length

      for (let i = 0; i < creditors.length; i++) {
        const creditor = creditors[i]

        try {
          if (onProgress) {
            onProgress({
              current: offset + i + 1,
              total: metadata.count || stats.total,
              creditor: creditor.id
            })
          }

          // Nota: O filtro de corretores já é feito em getCreditors
          // Aqui apenas processamos os que passaram pelo filtro

          // Pegar telefone principal (baseado na análise: phones[].main === true)
          const telefonePrincipal = creditor.phones?.find(p => p.main === true) || 
                                   creditor.phones?.[0]
          const telefone = telefonePrincipal 
            ? `${telefonePrincipal.ddd || ''}${telefonePrincipal.number || ''}`.trim()
            : null

          // Pegar email de otherContactMethods (baseado na análise: emails estão aqui, não em contacts)
          // otherContactMethods[].type: 1 = email, 2 = outro tipo de contato
          const emailContact = creditor.otherContactMethods?.find(c => 
            c.type === 1 || c.type === 2 || c.address?.includes('@')
          )
          const email = emailContact?.address || null

          // Preparar dados que seriam salvos
          const dadosCorretor = {
            id: creditor.id,
            name: creditor.name || null,
            tradeName: creditor.tradeName || null,
            email: email,
            phone: telefone,
            cpf: creditor.cpf || null,
            cnpj: creditor.cnpj || null,
            active: creditor.active !== false
          }

          // MODO VALIDAÇÃO: apenas coleta dados, NÃO salva no banco
          if (validate) {
            stats.dadosValidados.push({
              siengeId: creditor.id,
              dados: dadosCorretor,
              raw: creditor // Dados brutos da API para debug
            })
            continue // Pula o salvamento
          }

          // MODO DRY-RUN: não salva
          if (dryRun) {
            continue
          }

          // MODO PRODUÇÃO: salva no banco
          const corretorId = await findOrCreateCorretor(dadosCorretor)

          if (corretorId) {
            stats.criados++
          } else {
            stats.erros++
          }
        } catch (error) {
          console.error(`Erro ao processar corretor ${creditor.id}:`, error)
          stats.erros++
        }
      }

      // Em modo validação, processa apenas primeira página para não sobrecarregar
      if (validate) {
        break
      }

      // Verificar se tem mais páginas
      offset += limit
      hasMore = creditors.length === limit && (metadata.count === null || offset < metadata.count)
    }

    return stats
  } catch (error) {
    console.error('Erro na sincronização de corretores:', error)
    throw error
  }
}

