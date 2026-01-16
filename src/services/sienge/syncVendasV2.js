/**
 * Sincronização de Vendas V2
 * 
 * Camada 2: Processa dados RAW e popula public.vendas + pagamentos_prosoluto
 * 
 * REGRAS:
 * - Upsert por sienge_contract_id
 * - Resolve cliente_id via sienge_customer_id
 * - Resolve corretor_id via sienge_broker_id
 * - Se corretor não existir: cria placeholder (SEM Auth)
 * - Se cliente não existir: pode deixar NULL ou criar placeholder
 * - Cria empreendimento se não existir
 * - MAPEIA paymentConditions → campos pro-soluto + pagamentos_prosoluto
 * 
 * MAPEAMENTO paymentConditions (baseado no payload real do Sienge):
 * 
 * PRO-SOLUTO (entram no cálculo de comissão):
 * - AT (Ato) = Sinal
 * - SN (Sinal) = Sinal
 * - PM (Parcelas Mensais) = Entrada parcelada
 * - EN (Entrada) = Entrada à vista
 * - BA (Balão Anual) = Balões
 * - B1, B2, B3, B4, B5 = Balões individuais
 * - BN (Bens) = Dação em pagamento
 * 
 * NÃO PRO-SOLUTO (financiamento/outros):
 * - CA (Crédito Associativo) = Financiamento bancário
 * - FI (Financiamento) = Financiamento
 * - CV (Comissão de Venda) = Não é pagamento do cliente
 */

import { supabase } from '../../lib/supabase'
import { findCorretorBySiengeId, getOrCreateCorretorPlaceholder } from './syncCorretoresV2'
import { findClienteBySiengeId, getOrCreateClientePlaceholder } from './syncClientesV2'

/**
 * Normaliza situação do contrato
 * 0=Solicitado, 1=Autorizado, 2=Emitido, 3=Cancelado
 */
const normalizarSituacao = (situation) => {
  if (typeof situation === 'string') {
    const map = {
      'Solicitado': '0',
      'Autorizado': '1',
      'Emitido': '2',
      'Cancelado': '3'
    }
    return map[situation] || situation
  }
  return String(situation)
}

/**
 * Mapeia paymentConditions do Sienge → campos da tabela vendas
 * 
 * TIPOS PRO-SOLUTO (entram no cálculo de comissão):
 * - AT (Ato) = Sinal
 * - SN (Sinal) = Sinal
 * - PM (Parcelas Mensais) = Entrada parcelada
 * - EN (Entrada) = Entrada à vista
 * - BA (Balão Anual) = Balões
 * - B1, B2, B3, B4, B5 = Balões individuais
 * - BN (Bens) = Dação em pagamento (pro-soluto)
 * 
 * TIPOS NÃO PRO-SOLUTO (financiamento/outros):
 * - CA (Crédito Associativo) = Financiamento bancário
 * - FI (Financiamento) = Financiamento
 * - CV (Comissão de Venda) = Não é pagamento do cliente
 */
const mapearPaymentConditions = (paymentConditions) => {
  const resultado = {
    // Sinal (AT, SN)
    teve_sinal: false,
    valor_sinal: null,
    // Entrada (PM = Parcelas Mensais = Entrada parcelada)
    teve_entrada: false,
    valor_entrada: null,
    parcelou_entrada: false,
    qtd_parcelas_entrada: null,
    valor_parcela_entrada: null,
    // Balão (BA, B1-B5)
    teve_balao: 'nao',
    qtd_balao: null,
    valor_balao: null,
    // Bens (BN)
    teve_bens: false,
    valor_bens: null,
    // Pro-soluto calculado
    valor_pro_soluto: 0,
    // Fator de comissão (será preenchido pelo empreendimento)
    fator_comissao: null,
    // Condições originais para criar pagamentos depois
    _condicoes_prosoluto: []
  }

  if (!Array.isArray(paymentConditions) || paymentConditions.length === 0) {
    return resultado
  }

  // Tipos que NÃO são pro-soluto
  const tiposNaoProsoluto = ['CA', 'FI', 'CV']

  for (const cond of paymentConditions) {
    const tipoId = (cond.conditionTypeId || '').toUpperCase()
    const totalValue = parseFloat(cond.totalValue) || 0
    const qtdParcelas = parseInt(cond.installmentsNumber) || 1
    const valorParcela = qtdParcelas > 0 ? totalValue / qtdParcelas : totalValue
    const primeiroVencimento = cond.firstPayment || null

    // Verificar se é tipo não pro-soluto
    if (tiposNaoProsoluto.includes(tipoId)) {
      console.log(`   [INFO] Condição ${tipoId} (${cond.conditionTypeName}) ignorada - não é pro-soluto`)
      continue
    }

    // SINAL: AT (Ato) ou SN (Sinal)
    if (tipoId === 'AT' || tipoId === 'SN') {
      resultado.teve_sinal = true
      resultado.valor_sinal = (resultado.valor_sinal || 0) + totalValue
      resultado.valor_pro_soluto += totalValue
      resultado._condicoes_prosoluto.push({
        tipo: 'sinal',
        valorTotal: totalValue,
        qtd: 1,
        valorParcela: totalValue,
        primeiroVencimento,
        conditionTypeName: cond.conditionTypeName
      })
      console.log(`   ✅ Sinal (${tipoId}): R$ ${totalValue.toFixed(2)}`)
      continue
    }

    // ENTRADA PARCELADA: PM (Parcelas Mensais)
    if (tipoId === 'PM') {
      resultado.teve_entrada = true
      resultado.parcelou_entrada = true
      resultado.qtd_parcelas_entrada = (resultado.qtd_parcelas_entrada || 0) + qtdParcelas
      resultado.valor_parcela_entrada = valorParcela
      resultado.valor_entrada = (resultado.valor_entrada || 0) + totalValue
      resultado.valor_pro_soluto += totalValue
      resultado._condicoes_prosoluto.push({
        tipo: 'parcela_entrada',
        valorTotal: totalValue,
        qtd: qtdParcelas,
        valorParcela,
        primeiroVencimento,
        conditionTypeName: cond.conditionTypeName
      })
      console.log(`   ✅ Entrada parcelada (PM): ${qtdParcelas}x R$ ${valorParcela.toFixed(2)} = R$ ${totalValue.toFixed(2)}`)
      continue
    }

    // ENTRADA À VISTA: EN
    if (tipoId === 'EN') {
      resultado.teve_entrada = true
      if (!resultado.parcelou_entrada) {
        resultado.parcelou_entrada = false
      }
      resultado.valor_entrada = (resultado.valor_entrada || 0) + totalValue
      resultado.valor_pro_soluto += totalValue
      resultado._condicoes_prosoluto.push({
        tipo: 'entrada',
        valorTotal: totalValue,
        qtd: 1,
        valorParcela: totalValue,
        primeiroVencimento,
        conditionTypeName: cond.conditionTypeName
      })
      console.log(`   ✅ Entrada à vista (EN): R$ ${totalValue.toFixed(2)}`)
      continue
    }

    // BALÕES: BA (Balão Anual) ou B1, B2, B3, B4, B5 (Balões individuais)
    if (tipoId === 'BA' || /^B[1-9]$/.test(tipoId)) {
      resultado.teve_balao = 'sim'
      resultado.qtd_balao = (resultado.qtd_balao || 0) + qtdParcelas
      // Atualiza valor_balao com média ponderada ou último valor
      resultado.valor_balao = valorParcela
      resultado.valor_pro_soluto += totalValue
      resultado._condicoes_prosoluto.push({
        tipo: 'balao',
        valorTotal: totalValue,
        qtd: qtdParcelas,
        valorParcela,
        primeiroVencimento,
        conditionTypeName: cond.conditionTypeName
      })
      console.log(`   ✅ Balão (${tipoId}): ${qtdParcelas}x R$ ${valorParcela.toFixed(2)} = R$ ${totalValue.toFixed(2)}`)
      continue
    }

    // BENS: BN (Dação em pagamento)
    if (tipoId === 'BN') {
      resultado.teve_bens = true
      resultado.valor_bens = (resultado.valor_bens || 0) + totalValue
      resultado.valor_pro_soluto += totalValue
      resultado._condicoes_prosoluto.push({
        tipo: 'bens',
        valorTotal: totalValue,
        qtd: 1,
        valorParcela: totalValue,
        primeiroVencimento,
        conditionTypeName: cond.conditionTypeName
      })
      console.log(`   ✅ Bens/Dação (BN): R$ ${totalValue.toFixed(2)}`)
      continue
    }

    // Tipo desconhecido - logar para análise
    console.log(`   ⚠️ Tipo desconhecido ${tipoId} (${cond.conditionTypeName}): R$ ${totalValue.toFixed(2)} - IGNORADO`)
  }

  return resultado
}

/**
 * Cria registros em pagamentos_prosoluto a partir das condições mapeadas
 * 
 * FÓRMULA CORRETA DO FATOR DE COMISSÃO:
 *   fator = (valor_venda × percentual_total) / pro_soluto
 *   comissao = parcela × fator
 * 
 * @param {string} vendaId - ID da venda
 * @param {Array} condicoesProsoluto - Condições de pagamento mapeadas
 * @param {number} fatorComissao - Fator já calculado: (valorVenda × percentual) / proSoluto
 * @param {string} dataVenda - Data da venda
 * @param {number} percentualTotal - Percentual total de comissão (ex: 7)
 */
const criarPagamentosProsoluto = async (vendaId, condicoesProsoluto, fatorComissao, dataVenda, percentualTotal = null) => {
  if (!vendaId || !condicoesProsoluto || condicoesProsoluto.length === 0) {
    return 0
  }

  const pagamentos = []

  for (const cond of condicoesProsoluto) {
    const { tipo, qtd, valorParcela, primeiroVencimento } = cond

    for (let i = 0; i < qtd; i++) {
      // Calcular data de vencimento
      let dataVencimento = null
      if (primeiroVencimento) {
        const data = new Date(primeiroVencimento)
        if (tipo === 'parcela_entrada') {
          // Parcelas mensais - incrementa mês
          data.setMonth(data.getMonth() + i)
        } else if (tipo === 'balao') {
          // Balões anuais - incrementa ano
          data.setFullYear(data.getFullYear() + i)
        }
        // Para sinal e entrada à vista, usa a data do primeiro vencimento
        dataVencimento = data.toISOString().split('T')[0]
      } else if (dataVenda) {
        // Fallback: usa data da venda
        dataVenda = dataVenda
      }

      // FÓRMULA CORRETA: comissão = parcela × fator
      // O fator já foi calculado como: (valorVenda × percentual) / proSoluto
      const comissaoGerada = valorParcela * (fatorComissao || 0)

      pagamentos.push({
        venda_id: vendaId,
        tipo: tipo,
        numero_parcela: (tipo === 'parcela_entrada' || tipo === 'balao') ? i + 1 : null,
        valor: valorParcela,
        data_prevista: dataVencimento,
        status: 'pendente',
        comissao_gerada: comissaoGerada,
        fator_comissao_aplicado: fatorComissao || null,
        percentual_comissao_total: percentualTotal || null
      })
    }
  }

  if (pagamentos.length > 0) {
    // Deletar pagamentos antigos desta venda (se houver)
    const { error: deleteError } = await supabase
      .from('pagamentos_prosoluto')
      .delete()
      .eq('venda_id', vendaId)

    if (deleteError) {
      console.warn(`   [WARN] Erro ao deletar pagamentos antigos: ${deleteError.message}`)
    }

    // Inserir novos pagamentos
    const { error: insertError } = await supabase
      .from('pagamentos_prosoluto')
      .insert(pagamentos)

    if (insertError) {
      console.error(`   [ERROR] Erro ao criar pagamentos para venda ${vendaId}:`, insertError.message)
      return 0
    }

    console.log(`   ✅ ${pagamentos.length} pagamentos criados para venda ${vendaId}`)
  }

  return pagamentos.length
}

/**
 * Busca percentual de comissão do empreendimento
 * 
 * IMPORTANTE: Esta função retorna o PERCENTUAL (ex: 7), não o fator!
 * O FATOR deve ser calculado como: (valorVenda × percentual) / proSoluto
 * 
 * @param {string} empreendimentoId - ID do empreendimento
 * @param {string} tipoCorretor - 'externo' ou 'interno'
 * @returns {number} Percentual de comissão (ex: 7 para 7%)
 */
const getPercentualComissaoEmpreendimento = async (empreendimentoId, tipoCorretor = 'externo') => {
  if (!empreendimentoId) {
    return 7 // Default 7%
  }

  const { data: emp } = await supabase
    .from('empreendimentos')
    .select('comissao_total_externo, comissao_total_interno')
    .eq('id', empreendimentoId)
    .maybeSingle()

  if (!emp) {
    return 7 // Default 7%
  }

  const percentual = tipoCorretor === 'interno' 
    ? (emp.comissao_total_interno || 6) 
    : (emp.comissao_total_externo || 7)

  return percentual // Retorna percentual (ex: 7), NÃO fator
}

/**
 * Calcula o FATOR DE COMISSÃO usando a fórmula correta
 * 
 * FÓRMULA: fator = (valorVenda × percentual) / proSoluto
 * 
 * @param {number} valorVenda - Valor total da venda
 * @param {number} percentual - Percentual de comissão (ex: 7 para 7%)
 * @param {number} valorProSoluto - Valor total do pro-soluto
 * @returns {number} Fator de comissão (ex: 0.2932 para 29,32%)
 */
const calcularFatorComissao = (valorVenda, percentual, valorProSoluto) => {
  if (!valorVenda || !valorProSoluto || valorProSoluto === 0) {
    return 0
  }
  
  // FÓRMULA CORRETA: (valor_venda × percentual%) / pro_soluto
  const fator = (valorVenda * (percentual / 100)) / valorProSoluto
  
  return fator
}

/**
 * @deprecated Use getPercentualComissaoEmpreendimento + calcularFatorComissao
 * Mantido para compatibilidade, mas retorna o fator calculado incorretamente
 */
const getFatorComissaoEmpreendimento = async (empreendimentoId, tipoCorretor = 'externo') => {
  const percentual = await getPercentualComissaoEmpreendimento(empreendimentoId, tipoCorretor)
  return percentual / 100 // ATENÇÃO: Este é o percentual/100, NÃO o fator correto!
}

/**
 * Busca ou cria empreendimento
 */
const findOrCreateEmpreendimento = async (siengeEnterpriseId, enterpriseName) => {
  if (!siengeEnterpriseId) return null

  const siengeEnterpriseIdStr = String(siengeEnterpriseId)

  // Buscar existente
  const { data: existente } = await supabase
    .from('empreendimentos')
    .select('id, nome')
    .eq('sienge_enterprise_id', siengeEnterpriseIdStr)
    .maybeSingle()

  if (existente) return existente.id

  // Criar novo
  const { data: novo, error } = await supabase
    .from('empreendimentos')
    .insert({
      sienge_enterprise_id: siengeEnterpriseIdStr,
      nome: enterpriseName || `Empreendimento ${siengeEnterpriseIdStr}`,
      ativo: true
    })
    .select('id')
    .single()

  if (error) {
    console.error('Erro ao criar empreendimento:', error)
    return null
  }

  return novo.id
}

/**
 * Mapeia contrato do Sienge para formato do Supabase
 */
const mapearVenda = (contract, mappings = {}, paymentData = {}) => {
  const clientePrincipal = contract.salesContractCustomers?.find(c => c.main === true) || 
                          contract.salesContractCustomers?.[0]
  const unidadePrincipal = contract.salesContractUnits?.find(u => u.main === true) || 
                           contract.salesContractUnits?.[0]
  const corretorPrincipal = contract.brokers?.find(b => b.main === true) || 
                           contract.brokers?.[0]

  const situacao = normalizarSituacao(contract.situation)
  const status = (situacao === '2' || situacao === 'Emitido') ? 'pago' : 'pendente'

  return {
    // Chave de sincronização
    sienge_contract_id: String(contract.id),
    
    // Relacionamentos (UUIDs do Supabase)
    corretor_id: mappings.corretorId || null,
    cliente_id: mappings.clienteId || null,
    empreendimento_id: mappings.empreendimentoId || null,
    
    // Dados básicos
    numero_contrato: contract.number || null,
    valor_venda: parseFloat(contract.value || 0),
    valor_venda_total: parseFloat(contract.totalSellingValue || contract.value || 0),
    data_venda: contract.contractDate || null,
    data_emissao: contract.issueDate || null,
    data_entrega_prevista: contract.expectedDeliveryDate || null,
    descricao: `Contrato ${contract.number || contract.id}`,
    status: status,
    situacao_contrato: situacao,
    tipo_corretor: mappings.tipoCorretor || 'externo',
    
    // IDs do Sienge (para referência)
    sienge_broker_id: corretorPrincipal?.id ? String(corretorPrincipal.id) : null,
    sienge_unit_id: unidadePrincipal?.id ? String(unidadePrincipal.id) : null,
    sienge_customer_id: clientePrincipal?.id ? String(clientePrincipal.id) : null,
    
    // Unidade
    unidade: unidadePrincipal?.name || null,
    
    // ===== CAMPOS PRO-SOLUTO (mapeados de paymentConditions) =====
    // Sinal
    teve_sinal: paymentData.teve_sinal || false,
    valor_sinal: paymentData.valor_sinal || null,
    
    // Entrada
    teve_entrada: paymentData.teve_entrada || false,
    valor_entrada: paymentData.valor_entrada || null,
    parcelou_entrada: paymentData.parcelou_entrada || false,
    qtd_parcelas_entrada: paymentData.qtd_parcelas_entrada || null,
    valor_parcela_entrada: paymentData.valor_parcela_entrada || null,
    
    // Balão
    teve_balao: paymentData.teve_balao || 'nao',
    qtd_balao: paymentData.qtd_balao || null,
    valor_balao: paymentData.valor_balao || null,
    
    // Pro-soluto total e fator
    valor_pro_soluto: paymentData.valor_pro_soluto || null,
    fator_comissao: paymentData.fator_comissao || null,
    
    // Cancelamento
    data_cancelamento: contract.cancellationDate || null,
    motivo_cancelamento: contract.cancellationReason || null,
    
    // Comissões zeradas (serão calculadas depois)
    comissao_total: 0,
    comissao_corretor: 0,
    comissao_diretor: 0,
    comissao_nohros_imobiliaria: 0,
    comissao_nohros_gestao: 0,
    comissao_wsc: 0,
    comissao_coordenadora: 0,
    
    // Sincronização
    sienge_updated_at: new Date().toISOString()
  }
}

/**
 * Sincroniza vendas do RAW para public.vendas + pagamentos_prosoluto
 */
export const syncVendasFromRaw = async (options = {}) => {
  const {
    onProgress = null,
    dryRun = false,
    criarPlaceholders = true, // Se true, cria corretor/cliente placeholder quando não existir
    criarPagamentos = true    // Se true, cria registros em pagamentos_prosoluto
  } = options

  const stats = {
    total: 0,
    criadas: 0,
    atualizadas: 0,
    puladas: 0,
    erros: 0,
    semCliente: 0,
    semCorretor: 0,
    clientesPlaceholder: 0,
    corretoresPlaceholder: 0,
    pagamentosCriados: 0,
    detalhes: []
  }

  console.log('🔄 [SYNC] Iniciando sincronização de vendas + pagamentos...')
  console.log(`   Modo: ${dryRun ? 'DRY RUN' : 'PRODUÇÃO'}`)
  console.log(`   Criar placeholders: ${criarPlaceholders}`)
  console.log(`   Criar pagamentos: ${criarPagamentos}`)

  try {
    // Buscar todos os contratos do RAW
    const { data: rawContratos, error: rawError } = await supabase
      .schema('sienge_raw')
      .from('objects')
      .select('sienge_id, payload, enterprise_id')
      .eq('entity', 'sales-contracts')
      .order('synced_at', { ascending: false })

    if (rawError) {
      throw new Error(`Erro ao buscar RAW: ${rawError.message}`)
    }

    if (!rawContratos || rawContratos.length === 0) {
      console.log('⚠️ [SYNC] Nenhum contrato no RAW. Execute ingestSalesContracts primeiro.')
      return stats
    }

    console.log(`📊 [SYNC] ${rawContratos.length} contratos no RAW`)
    stats.total = rawContratos.length

    // Buscar vendas existentes no Supabase
    const { data: existentes } = await supabase
      .from('vendas')
      .select('id, sienge_contract_id, sienge_updated_at')
      .not('sienge_contract_id', 'is', null)

    const existentesMap = new Map()
    if (existentes) {
      existentes.forEach(v => existentesMap.set(v.sienge_contract_id, v))
    }

    console.log(`📊 [SYNC] ${existentesMap.size} vendas já existem no Supabase`)

    // Processar cada contrato
    for (let i = 0; i < rawContratos.length; i++) {
      const raw = rawContratos[i]
      const contract = raw.payload

      try {
        // Extrair IDs principais do contrato
        const clientePrincipal = contract.salesContractCustomers?.find(c => c.main === true) || 
                                contract.salesContractCustomers?.[0]
        const corretorPrincipal = contract.brokers?.find(b => b.main === true) || 
                                contract.brokers?.[0]

        // Resolver cliente
        let clienteId = null
        let clienteNome = clientePrincipal?.name || 'N/A'
        
        if (clientePrincipal?.id) {
          const cliente = await findClienteBySiengeId(clientePrincipal.id)
          if (cliente) {
            clienteId = cliente.id
            clienteNome = cliente.nome_completo
          } else if (criarPlaceholders && !dryRun) {
            clienteId = await getOrCreateClientePlaceholder(clientePrincipal.id, clientePrincipal.name)
            stats.clientesPlaceholder++
          } else {
            stats.semCliente++
          }
        } else {
          stats.semCliente++
        }

        // Resolver corretor
        let corretorId = null
        let corretorNome = 'N/A'
        let tipoCorretor = 'externo'
        
        if (corretorPrincipal?.id) {
          const corretor = await findCorretorBySiengeId(corretorPrincipal.id)
          if (corretor) {
            corretorId = corretor.id
            corretorNome = corretor.nome
            tipoCorretor = corretor.tipo_corretor || 'externo'
          } else if (criarPlaceholders && !dryRun) {
            corretorId = await getOrCreateCorretorPlaceholder(corretorPrincipal.id)
            stats.corretoresPlaceholder++
          } else {
            stats.semCorretor++
          }
        } else {
          stats.semCorretor++
        }

        // Resolver empreendimento
        let empreendimentoId = null
        if (contract.enterpriseId && !dryRun) {
          empreendimentoId = await findOrCreateEmpreendimento(
            contract.enterpriseId, 
            contract.enterpriseName
          )
        }

        // ===== MAPEAR paymentConditions =====
        const paymentData = mapearPaymentConditions(contract.paymentConditions)
        
        // Buscar PERCENTUAL de comissão do empreendimento
        const percentualComissao = await getPercentualComissaoEmpreendimento(empreendimentoId, tipoCorretor)
        
        // Calcular FATOR usando a fórmula correta:
        // FATOR = (valorVenda × percentual) / proSoluto
        const valorVenda = parseFloat(contract.amount) || 0
        const valorProSoluto = paymentData.valor_pro_soluto || 0
        const fatorComissao = calcularFatorComissao(valorVenda, percentualComissao, valorProSoluto)
        
        paymentData.fator_comissao = fatorComissao
        paymentData.percentual_comissao = percentualComissao

        // Log de debug para verificar mapeamento
        if (i < 3) { // Mostrar apenas os 3 primeiros
          console.log(`\n📋 [DEBUG] Contrato ${contract.id} (${contract.number}):`)
          console.log(`   Valor Venda: R$ ${valorVenda.toFixed(2)}`)
          console.log(`   Sinal: ${paymentData.teve_sinal ? 'R$ ' + paymentData.valor_sinal : 'Não'}`)
          console.log(`   Entrada: ${paymentData.teve_entrada ? (paymentData.parcelou_entrada ? paymentData.qtd_parcelas_entrada + 'x R$ ' + paymentData.valor_parcela_entrada?.toFixed(2) : 'R$ ' + paymentData.valor_entrada) : 'Não'}`)
          console.log(`   Balão: ${paymentData.teve_balao === 'sim' ? paymentData.qtd_balao + 'x R$ ' + paymentData.valor_balao?.toFixed(2) : 'Não'}`)
          console.log(`   Pro-soluto: R$ ${paymentData.valor_pro_soluto?.toFixed(2)}`)
          console.log(`   Percentual comissão: ${percentualComissao}%`)
          console.log(`   FATOR comissão: ${(fatorComissao * 100).toFixed(2)}% (${valorVenda} × ${percentualComissao}% / ${valorProSoluto})`)
        }

        // Mapear dados da venda
        const vendaData = mapearVenda(contract, {
          clienteId,
          corretorId,
          empreendimentoId,
          tipoCorretor
        }, paymentData)

        const existente = existentesMap.get(vendaData.sienge_contract_id)

        if (dryRun) {
          stats.detalhes.push({
            sienge_id: vendaData.sienge_contract_id,
            numero: vendaData.numero_contrato,
            valor: vendaData.valor_venda,
            valor_pro_soluto: paymentData.valor_pro_soluto,
            cliente: clienteNome,
            corretor: corretorNome,
            clienteEncontrado: !!clienteId,
            corretorEncontrado: !!corretorId,
            teve_sinal: paymentData.teve_sinal,
            teve_entrada: paymentData.teve_entrada,
            teve_balao: paymentData.teve_balao,
            qtd_pagamentos: paymentData._condicoes_prosoluto.reduce((sum, c) => sum + c.qtd, 0),
            acao: existente ? 'atualizaria' : 'criaria'
          })
          if (existente) stats.atualizadas++
          else stats.criadas++
          continue
        }

        // Log se não tem corretor (mas não pula mais - corretor_id é nullable agora)
        if (!corretorId) {
          console.warn(`⚠️ [SYNC] Contrato ${contract.id}: Sem corretor (será criado com corretor_id NULL)`)
          stats.semCorretor++
        }

        let vendaId = null

        if (existente) {
          // Atualizar existente
          const { error: updateError } = await supabase
            .from('vendas')
            .update({
              ...vendaData,
              updated_at: new Date().toISOString()
            })
            .eq('id', existente.id)

          if (updateError) throw updateError
          vendaId = existente.id
          stats.atualizadas++

        } else {
          // Criar nova
          const { data: novaVenda, error: insertError } = await supabase
            .from('vendas')
            .insert({
              ...vendaData,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .select('id')
            .single()

          if (insertError) throw insertError
          vendaId = novaVenda.id
          stats.criadas++
        }

        // ===== CRIAR PAGAMENTOS PRO-SOLUTO =====
        if (criarPagamentos && vendaId && paymentData._condicoes_prosoluto.length > 0) {
          const qtdPagamentos = await criarPagamentosProsoluto(
            vendaId,
            paymentData._condicoes_prosoluto,
            fatorComissao,
            vendaData.data_venda,
            percentualComissao // Passar percentual para auditoria
          )
          stats.pagamentosCriados += qtdPagamentos
        }
        
        // ===== CRIAR/ATUALIZAR COMISSAO_VENDA =====
        if (vendaId && corretorId && paymentData.valor_pro_soluto > 0) {
          await criarOuAtualizarComissaoVenda(vendaId, corretorId, empreendimentoId, paymentData, fatorComissao)
        }

        if (onProgress) {
          onProgress({
            current: i + 1,
            total: rawContratos.length,
            item: `Contrato ${vendaData.numero_contrato || vendaData.sienge_contract_id}`
          })
        }

      } catch (error) {
        console.error(`❌ [SYNC] Erro no contrato ${raw.sienge_id}:`, error.message)
        stats.erros++
        stats.detalhes.push({
          sienge_id: raw.sienge_id,
          erro: error.message
        })
      }
    }

    console.log(`\n✅ [SYNC] Vendas sincronizadas:`)
    console.log(`   Total: ${stats.total}`)
    console.log(`   Criadas: ${stats.criadas}`)
    console.log(`   Atualizadas: ${stats.atualizadas}`)
    console.log(`   Puladas: ${stats.puladas}`)
    console.log(`   Sem cliente: ${stats.semCliente}`)
    console.log(`   Sem corretor: ${stats.semCorretor}`)
    console.log(`   Clientes placeholder: ${stats.clientesPlaceholder}`)
    console.log(`   Corretores placeholder: ${stats.corretoresPlaceholder}`)
    console.log(`   📊 Pagamentos criados: ${stats.pagamentosCriados}`)
    console.log(`   Erros: ${stats.erros}`)

    return stats

  } catch (error) {
    console.error('❌ [SYNC] Erro na sincronização de vendas:', error)
    throw error
  }
}

/**
 * Cria ou atualiza registro em comissoes_venda
 */
const criarOuAtualizarComissaoVenda = async (vendaId, corretorId, empreendimentoId, paymentData, fatorComissao) => {
  try {
    // Calcular comissão total
    const valorProSoluto = paymentData.valor_pro_soluto || 0
    const comissaoTotal = valorProSoluto * (fatorComissao || 0.07)
    
    // Verificar se já existe
    const { data: existente } = await supabase
      .from('comissoes_venda')
      .select('id')
      .eq('venda_id', vendaId)
      .eq('corretor_id', corretorId)
      .maybeSingle()
    
    const dadosComissao = {
      venda_id: vendaId,
      corretor_id: corretorId,
      empreendimento_id: empreendimentoId,
      valor_base: valorProSoluto,
      percentual: (fatorComissao || 0.07) * 100,
      valor_comissao: comissaoTotal,
      status: 'pendente',
      origem: 'sienge'
    }
    
    if (existente) {
      // Atualizar
      await supabase
        .from('comissoes_venda')
        .update({
          ...dadosComissao,
          updated_at: new Date().toISOString()
        })
        .eq('id', existente.id)
    } else {
      // Criar
      await supabase
        .from('comissoes_venda')
        .insert({
          ...dadosComissao,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
    }
  } catch (error) {
    console.warn(`⚠️ Erro ao criar comissao_venda para venda ${vendaId}:`, error.message)
  }
}

/**
 * Busca venda por sienge_contract_id
 */
export const findVendaBySiengeId = async (siengeContractId) => {
  if (!siengeContractId) return null

  const { data } = await supabase
    .from('vendas')
    .select('id, numero_contrato, valor_venda')
    .eq('sienge_contract_id', String(siengeContractId))
    .maybeSingle()

  return data
}

/**
 * Reprocessa pagamentos de uma venda específica (útil para correções)
 */
export const reprocessarPagamentosVenda = async (vendaId) => {
  // Buscar venda com dados do RAW
  const { data: venda } = await supabase
    .from('vendas')
    .select('id, sienge_contract_id, fator_comissao, data_venda, tipo_corretor, empreendimento_id')
    .eq('id', vendaId)
    .single()

  if (!venda || !venda.sienge_contract_id) {
    return { success: false, error: 'Venda não encontrada ou não sincronizada do Sienge' }
  }

  // Buscar dados RAW
  const { data: raw } = await supabase
    .schema('sienge_raw')
    .from('objects')
    .select('payload')
    .eq('entity', 'sales-contracts')
    .eq('sienge_id', venda.sienge_contract_id)
    .single()

  if (!raw) {
    return { success: false, error: 'Dados RAW não encontrados' }
  }

  // Mapear paymentConditions
  const paymentData = mapearPaymentConditions(raw.payload.paymentConditions)
  
  // Buscar fator de comissão atualizado
  const fatorComissao = venda.fator_comissao || await getFatorComissaoEmpreendimento(venda.empreendimento_id, venda.tipo_corretor)

  // Criar pagamentos
  const qtd = await criarPagamentosProsoluto(
    vendaId,
    paymentData._condicoes_prosoluto,
    fatorComissao,
    venda.data_venda
  )

  return { success: true, pagamentosCriados: qtd }
}

export default {
  syncVendasFromRaw,
  findVendaBySiengeId,
  reprocessarPagamentosVenda,
  mapearPaymentConditions
}
