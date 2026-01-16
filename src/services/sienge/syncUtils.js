/**
 * Utilitários para sincronização Sienge → Supabase
 * Mapeia dados da API para o formato do banco
 */

import { supabase } from '../../lib/supabase'

/**
 * Formata endereço completo a partir do objeto addresses do Sienge
 */
const formatarEndereco = (addresses) => {
  if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
    return null
  }

  // Pegar endereço principal (mail: true) ou o primeiro
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
 * Busca cliente no Supabase por ID do Sienge (SEM buscar na API)
 * Retorna o ID se existir, null se não existir
 * OTIMIZAÇÃO: Evita requisições desnecessárias à API
 */
export const findClienteBySiengeId = async (siengeCustomerId) => {
  if (!siengeCustomerId) return null

  const { data: existing } = await supabase
    .from('clientes')
    .select('id')
    .eq('sienge_customer_id', String(siengeCustomerId))
    .maybeSingle()

  return existing?.id || null
}

/**
 * Busca empreendimento no Supabase por ID do Sienge (SEM buscar na API)
 * Retorna o ID se existir, null se não existir
 * OTIMIZAÇÃO: Evita requisições desnecessárias à API
 */
export const findEmpreendimentoBySiengeId = async (siengeEnterpriseId) => {
  if (!siengeEnterpriseId) return null

  const { data: existing } = await supabase
    .from('empreendimentos')
    .select('id')
    .eq('sienge_enterprise_id', String(siengeEnterpriseId))
    .maybeSingle()

  return existing?.id || null
}

/**
 * Busca corretor no Supabase por ID do Sienge (SEM buscar na API)
 * Retorna o ID se existir, null se não existir
 * OTIMIZAÇÃO: Evita requisições desnecessárias à API
 * IMPORTANTE: Não cria corretor. Deve ser sincronizado via syncCorretores primeiro.
 */
export const findCorretorBySiengeId = async (siengeBrokerId) => {
  if (!siengeBrokerId) return null

  const { data: existing } = await supabase
    .from('usuarios')
    .select('id')
    .eq('sienge_broker_id', String(siengeBrokerId))
    .eq('tipo', 'corretor')
    .maybeSingle()

  return existing?.id || null
}

/**
 * Busca ou cria cliente no Supabase baseado no ID do Sienge
 */
export const findOrCreateCliente = async (siengeCustomerId, customerData = null) => {
  if (!siengeCustomerId) return null

  // Buscar por sienge_customer_id
  const { data: existing } = await supabase
    .from('clientes')
    .select('id')
    .eq('sienge_customer_id', String(siengeCustomerId))
    .maybeSingle()

  if (existing) {
    return existing.id
  }

  // Se não encontrou e tem dados, criar
  if (customerData) {
    // Pegar telefone principal
    const telefonePrincipal = customerData.phones?.find(p => p.main === true) || customerData.phones?.[0]
    const telefone = telefonePrincipal?.number || null

    // Formatar endereço
    const endereco = formatarEndereco(customerData.addresses)

    // Pegar CEP
    const enderecoComCep = customerData.addresses?.find(a => a.mail === true) || customerData.addresses?.[0]
    const cep = enderecoComCep?.zipCode || null

    const novoCliente = {
      sienge_customer_id: String(siengeCustomerId),
      nome_completo: customerData.name || 'Cliente Sienge',
      cpf: customerData.cpf || null,
      cnpj: customerData.cnpj || null,
      email: customerData.email || null,
      telefone: telefone || null,
      endereco: endereco || null,
      cep: cep || null,
      data_nascimento: customerData.birthDate || null,
      rg: customerData.numberIdentityCard || null,
      profissao: customerData.profession || null,
      sienge_updated_at: customerData.modifiedAt ? new Date(customerData.modifiedAt).toISOString() : null
    }

    const { data: clienteCriado, error } = await supabase
      .from('clientes')
      .insert([novoCliente])
      .select('id')
      .single()

    if (error) {
      console.error('Erro ao criar cliente:', error)
      return null
    }

    // Se tem cônjuge, criar em complementadores_renda
    if (customerData.spouse && clienteCriado.id) {
      await criarConjuge(clienteCriado.id, customerData.spouse)
    }

    return clienteCriado.id
  }

  return null
}

/**
 * Cria ou atualiza cônjuge em complementadores_renda
 */
const criarConjuge = async (clienteId, spouseData) => {
  if (!spouseData || !spouseData.name) return

  // Verificar se já existe
  const { data: existente } = await supabase
    .from('complementadores_renda')
    .select('id')
    .eq('cliente_id', clienteId)
    .eq('cpf', spouseData.cpf || '')
    .maybeSingle()

  const dadosConjuge = {
    cliente_id: clienteId,
    nome: spouseData.name,
    cpf: spouseData.cpf || null,
    email: spouseData.email || null,
    profissao: spouseData.profession || null,
    data_nascimento: spouseData.birthDate || null
  }

  if (existente) {
    // Atualizar
    await supabase
      .from('complementadores_renda')
      .update(dadosConjuge)
      .eq('id', existente.id)
  } else {
    // Criar
    await supabase
      .from('complementadores_renda')
      .insert([dadosConjuge])
  }
}

/**
 * Busca ou cria corretor no Supabase
 * Agora recebe dados completos do creditor (via API /creditors)
 */
export const findOrCreateCorretor = async (creditorData) => {
  if (!creditorData || !creditorData.id) return null

  const siengeBrokerId = String(creditorData.id)

  // Buscar por sienge_broker_id
  const { data: existing } = await supabase
    .from('usuarios')
    .select('id, nome, email, telefone')
    .eq('sienge_broker_id', siengeBrokerId)
    .eq('tipo', 'corretor')
    .maybeSingle()

  if (existing) {
    // Atualizar dados se necessário
    const updates = {}
    const nomeCompleto = creditorData.name || creditorData.tradeName
    
    if (nomeCompleto && nomeCompleto !== existing.nome) {
      updates.nome = nomeCompleto
    }
    if (creditorData.email && creditorData.email !== existing.email) {
      updates.email = creditorData.email
    }
    if (creditorData.phone && creditorData.phone !== existing.telefone) {
      updates.telefone = creditorData.phone
    }
    // Atualizar CPF e CNPJ se fornecidos e diferentes
    if (creditorData.cpf && creditorData.cpf !== existing.cpf) {
      updates.cpf = creditorData.cpf
    }
    if (creditorData.cnpj && creditorData.cnpj !== existing.cnpj) {
      updates.cnpj = creditorData.cnpj
    }
    // Atualizar status ativo
    if (creditorData.active !== undefined && creditorData.active !== existing.ativo) {
      updates.ativo = creditorData.active
    }
    
    if (Object.keys(updates).length > 0) {
      await supabase
        .from('usuarios')
        .update(updates)
        .eq('id', existing.id)
    }
    
    return existing.id
  }

  // Se não encontrou, criar novo corretor
  // NOTA: Isso cria um corretor sem usuário de auth. Você pode precisar criar o usuário depois
  const nomeCompleto = creditorData.name || creditorData.tradeName || `Corretor Sienge ${siengeBrokerId}`
  // Se não tem email, usar placeholder (não usar email inválido)
  const email = creditorData.email || null
  
  const { data: novo, error } = await supabase
    .from('usuarios')
    .insert([{
      nome: nomeCompleto,
      email: email,
      tipo: 'corretor',
      tipo_corretor: 'externo', // Padrão, pode ajustar depois
      sienge_broker_id: siengeBrokerId,
      ativo: creditorData.active !== false,
      telefone: creditorData.phone || null,
      cpf: creditorData.cpf || null,
      cnpj: creditorData.cnpj || null
    }])
    .select('id')
    .single()

  if (error) {
    console.error('Erro ao criar corretor:', error)
    return null
  }

  return novo.id
}

/**
 * Busca ou cria empreendimento no Supabase
 */
export const findOrCreateEmpreendimento = async (siengeEnterpriseId, enterpriseData = null) => {
  if (!siengeEnterpriseId) return null

  // Buscar por sienge_enterprise_id
  const { data: existing } = await supabase
    .from('empreendimentos')
    .select('id')
    .eq('sienge_enterprise_id', String(siengeEnterpriseId))
    .maybeSingle()

  if (existing) {
    return existing.id
  }

  // Se não encontrou e tem dados, criar
  if (enterpriseData) {
    const { data: novo, error } = await supabase
      .from('empreendimentos')
      .insert([{
        sienge_enterprise_id: String(siengeEnterpriseId),
        nome: enterpriseData.name || `Empreendimento ${siengeEnterpriseId}`,
        ativo: true
      }])
      .select('id')
      .single()

    if (error) {
      console.error('Erro ao criar empreendimento:', error)
      return null
    }

    return novo.id
  }

  return null
}

/**
 * Calcula total de parcelas somando todas as condições de pagamento
 * paymentConditions é um ARRAY de condições
 */
const calcularTotalParcelas = (paymentConditions) => {
  if (!paymentConditions || !Array.isArray(paymentConditions) || paymentConditions.length === 0) {
    return null
  }
  
  // Soma todas as parcelas de todas as condições
  return paymentConditions.reduce((total, condicao) => {
    return total + (condicao.installmentsNumber || 0)
  }, 0) || null
}

/**
 * Calcula valor pro-soluto somando todas as condições de pagamento
 * paymentConditions é um ARRAY de condições
 */
const calcularProSoluto = (paymentConditions) => {
  if (!paymentConditions || !Array.isArray(paymentConditions) || paymentConditions.length === 0) {
    return null
  }
  
  // Soma todos os valores de todas as condições
  return paymentConditions.reduce((total, condicao) => {
    return total + (parseFloat(condicao.totalValue) || 0)
  }, 0) || null
}

/**
 * Normaliza dados de contrato do Sienge para formato do Supabase
 */
export const normalizeVendaData = (siengeContract, mappings = {}) => {
  // Pegar cliente principal
  const clientePrincipal = siengeContract.salesContractCustomers?.find(c => c.main === true) || 
                          siengeContract.salesContractCustomers?.[0]

  // Pegar unidade principal
  const unidadePrincipal = siengeContract.salesContractUnits?.find(u => u.main === true) || 
                           siengeContract.salesContractUnits?.[0]

  // Pegar corretor principal
  const corretorPrincipal = siengeContract.brokers?.find(b => b.main === true) || 
                           siengeContract.brokers?.[0]

  // Converter situação: 0=Solicitado, 1=Autorizado, 2=Emitido, 3=Cancelado
  const situacaoMap = {
    '0': 'Solicitado',
    '1': 'Autorizado',
    '2': 'Emitido',
    '3': 'Cancelado'
  }
  const situacao = situacaoMap[siengeContract.situation] || siengeContract.situation

  // Determinar status (pendente/pago) baseado na situação
  const status = (situacao === 'Emitido' || situacao === '2') ? 'pago' : 'pendente'

  return {
    // Chave de sincronização
    sienge_contract_id: String(siengeContract.id),
    
    // Relacionamentos
    corretor_id: mappings.corretorId || null,
    cliente_id: mappings.clienteId || null,
    empreendimento_id: mappings.empreendimentoId || null,
    
    // Dados básicos
    numero_contrato: siengeContract.number || null,
    valor_venda: parseFloat(siengeContract.value || 0),
    valor_venda_total: parseFloat(siengeContract.totalSellingValue || siengeContract.value || 0),
    data_venda: siengeContract.contractDate || null,
    data_emissao: siengeContract.issueDate || null,
    descricao: `Contrato ${siengeContract.number || siengeContract.id}`,
    status: status,
    situacao_contrato: situacao,
    
    // IDs do Sienge
    sienge_broker_id: corretorPrincipal?.id ? String(corretorPrincipal.id) : null,
    sienge_unit_id: unidadePrincipal?.id ? String(unidadePrincipal.id) : null,
    
    // Unidade
    unidade: unidadePrincipal?.name || null,
    
    // Pro-soluto (do paymentConditions - é um ARRAY!)
    // Soma todas as condições de pagamento para calcular o pro-soluto
    qtd_parcelas: calcularTotalParcelas(siengeContract.paymentConditions),
    valor_pro_soluto: calcularProSoluto(siengeContract.paymentConditions),
    
    // Cancelamento
    data_cancelamento: siengeContract.cancellationDate || null,
    motivo_cancelamento: siengeContract.cancellationReason || null,
    
    // Sincronização
    sienge_updated_at: new Date().toISOString()
  }
}

