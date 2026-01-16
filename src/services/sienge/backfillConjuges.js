/**
 * Backfill de Cônjuges
 * 
 * Reprocessa clientes do RAW para criar cônjuges em complementadores_renda
 * Apenas cria os que faltam (não duplica)
 */

import { supabase } from '../../lib/supabase'

export const backfillConjuges = async (options = {}) => {
  const { onProgress = null, dryRun = false } = options

  console.log('👫 [BACKFILL] Iniciando backfill de cônjuges...')
  console.log(`   Modo: ${dryRun ? 'DRY RUN' : 'PRODUÇÃO'}`)

  const stats = {
    total: 0,
    comConjuge: 0,
    criados: 0,
    jaExistentes: 0,
    erros: 0,
    detalhes: []
  }

  try {
    // Buscar todos os clientes do RAW que têm spouse
    const { data: rawClientes, error: rawError } = await supabase
      .schema('sienge_raw')
      .from('objects')
      .select('sienge_id, payload')
      .eq('entity', 'customers')

    if (rawError) {
      throw new Error(`Erro ao buscar RAW: ${rawError.message}`)
    }

    if (!rawClientes || rawClientes.length === 0) {
      console.log('⚠️ [BACKFILL] Nenhum cliente no RAW')
      return stats
    }

    stats.total = rawClientes.length
    console.log(`📊 [BACKFILL] ${stats.total} clientes no RAW`)

    // Buscar clientes existentes no Supabase (para pegar o cliente_id)
    const { data: clientesCore } = await supabase
      .from('clientes')
      .select('id, sienge_customer_id')

    const mapaClientes = new Map()
    for (const c of (clientesCore || [])) {
      if (c.sienge_customer_id) {
        mapaClientes.set(c.sienge_customer_id, c.id)
      }
    }

    console.log(`📊 [BACKFILL] ${mapaClientes.size} clientes no Core`)

    // Buscar cônjuges já existentes
    const { data: conjugesExistentes } = await supabase
      .from('complementadores_renda')
      .select('cliente_id, sienge_spouse_id')
      .not('sienge_spouse_id', 'is', null)

    const conjugesMap = new Set()
    for (const conj of (conjugesExistentes || [])) {
      if (conj.cliente_id && conj.sienge_spouse_id) {
        conjugesMap.add(`${conj.cliente_id}_${conj.sienge_spouse_id}`)
      }
    }

    console.log(`📊 [BACKFILL] ${conjugesMap.size} cônjuges já existem`)

    // Processar cada cliente
    for (let i = 0; i < rawClientes.length; i++) {
      const raw = rawClientes[i]
      const customer = raw.payload

      try {
        // Verificar se tem spouse
        if (!customer.spouse || !customer.spouse.name) {
          continue
        }

        stats.comConjuge++

        // Encontrar cliente_id
        const clienteId = mapaClientes.get(String(customer.id))
        if (!clienteId) {
          console.warn(`⚠️ Cliente ${customer.id} não encontrado no Core`)
          continue
        }

        // Verificar se cônjuge já existe
        const chaveConjuge = `${clienteId}_${customer.id}`
        if (conjugesMap.has(chaveConjuge)) {
          stats.jaExistentes++
          continue
        }

        // Extrair dados do cônjuge
        const spouse = customer.spouse

        // Extrair CPF
        const extractCpf = (cpf) => {
          if (!cpf) return null
          if (typeof cpf === 'string') return cpf.replace(/\D/g, '')
          if (typeof cpf === 'object' && cpf.value) return String(cpf.value).replace(/\D/g, '')
          return null
        }

        // Extrair telefone
        const extractTelefone = (phones) => {
          if (!phones || !Array.isArray(phones) || phones.length === 0) return null
          const principal = phones.find(p => p.main === true) || phones[0]
          return principal?.number || null
        }

        const dadosConjuge = {
          cliente_id: clienteId,
          sienge_spouse_id: String(customer.id),
          nome: spouse.name,
          cpf: extractCpf(spouse.cpf),
          email: spouse.email || null,
          telefone: extractTelefone(spouse.phones),
          profissao: spouse.profession || null,
          data_nascimento: spouse.birthDate || null,
          rg: spouse.numberIdentityCard || null,
          parentesco: 'Cônjuge',
          origem: 'sienge'
        }

        if (dryRun) {
          stats.detalhes.push({
            cliente: customer.name,
            conjuge: spouse.name,
            acao: 'criaria'
          })
          stats.criados++
          continue
        }

        // Criar cônjuge
        const { error: insertError } = await supabase
          .from('complementadores_renda')
          .insert(dadosConjuge)

        if (insertError) {
          console.error(`❌ Erro ao criar cônjuge para cliente ${customer.id}:`, insertError.message)
          stats.erros++
          stats.detalhes.push({
            cliente: customer.name,
            conjuge: spouse.name,
            erro: insertError.message
          })
        } else {
          stats.criados++
          conjugesMap.add(chaveConjuge) // Adicionar ao set para não duplicar
        }

        if (onProgress) {
          onProgress({
            current: i + 1,
            total: rawClientes.length,
            item: `Cônjuge: ${spouse.name}`
          })
        }

      } catch (error) {
        console.error(`❌ Erro no cliente ${raw.sienge_id}:`, error.message)
        stats.erros++
      }
    }

    console.log(`\n✅ [BACKFILL] Cônjuges concluído:`)
    console.log(`   Total clientes: ${stats.total}`)
    console.log(`   Com cônjuge: ${stats.comConjuge}`)
    console.log(`   Criados: ${stats.criados}`)
    console.log(`   Já existentes: ${stats.jaExistentes}`)
    console.log(`   Erros: ${stats.erros}`)

    return stats

  } catch (error) {
    console.error('❌ [BACKFILL] Erro:', error)
    throw error
  }
}

export default {
  backfillConjuges
}
