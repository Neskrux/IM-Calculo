/**
 * Busca cliente, corretor e empreendimento no banco (SPEC: item 11).
 */

const { supabase } = require('../../lib/supabase')
const {
  buildCpfVariants,
  calculateTokenScore,
  normalizeText
} = require('../../utils/contrato/parsers')

async function resolver(_saleForm, rawSale = {}) {
  const empty = {
    cliente: { status: 'none', options: [] },
    corretor: { status: 'none', options: [] },
    empreendimento: { status: 'none', options: [] },
    warnings: []
  }

  if (!supabase) {
    return {
      ...empty,
      warnings: ['Supabase nao configurado no backend para matching.']
    }
  }

  console.log('[matching.service] iniciando matching', {
    clienteNome: Boolean(rawSale?.cliente_nome),
    clienteCpf: Boolean(rawSale?.cliente_cpf),
    corretorNome: Boolean(rawSale?.corretor_nome),
    empreendimentoNome: Boolean(rawSale?.empreendimento_nome)
  })

  try {
    const [cliente, corretor, empreendimento] = await Promise.all([
      resolverCliente(rawSale),
      resolverCorretor(rawSale),
      resolverEmpreendimento(rawSale)
    ])

    console.log('[matching.service] matching concluido', {
      cliente: cliente.status,
      corretor: corretor.status,
      empreendimento: empreendimento.status,
      clienteOptions: cliente.options?.length ?? 0,
      corretorOptions: corretor.options?.length ?? 0,
      empreendimentoOptions: empreendimento.options?.length ?? 0
    })

    return {
      cliente,
      corretor,
      empreendimento,
      warnings: []
    }
  } catch (error) {
    return {
      ...empty,
      warnings: ['Nao foi possivel consultar o banco para sugestoes de vinculo.']
    }
  }
}

async function resolverCliente(rawSale) {
  const cpfVariants = buildCpfVariants(rawSale?.cliente_cpf)
  if (cpfVariants.length > 0) {
    const { data, error } = await supabase
      .from('clientes')
      .select('id,nome_completo,cpf')
      .in('cpf', cpfVariants)
      .limit(10)

    if (!error && Array.isArray(data) && data.length > 0) {
      return mapMatches(data, (item) => ({
        id: item.id,
        nome_completo: item.nome_completo,
        cpf: item.cpf
      }))
    }
  }

  return resolverPorNome({
    table: 'clientes',
    select: 'id,nome_completo,cpf',
    rawValue: rawSale?.cliente_nome,
    getName: (item) => item.nome_completo,
    mapOption: (item) => ({
      id: item.id,
      nome_completo: item.nome_completo,
      cpf: item.cpf
    })
  })
}

async function resolverCorretor(rawSale) {
  return resolverPorNome({
    table: 'usuarios',
    select: 'id,nome',
    rawValue: rawSale?.corretor_nome,
    exactFilter: (query) => query.eq('tipo', 'corretor'),
    getName: (item) => item.nome,
    mapOption: (item) => ({
      id: item.id,
      nome: item.nome
    })
  })
}

async function resolverEmpreendimento(rawSale) {
  return resolverPorNome({
    table: 'empreendimentos',
    select: 'id,nome',
    rawValue: rawSale?.empreendimento_nome,
    getName: (item) => item.nome,
    mapOption: (item) => ({
      id: item.id,
      nome: item.nome
    })
  })
}

async function resolverPorNome({ table, select, rawValue, exactFilter, getName, mapOption }) {
  const normalizedTarget = normalizeText(rawValue)
  if (!normalizedTarget) {
    return { status: 'none', options: [] }
  }

  let query = supabase.from(table).select(select).limit(50)
  if (typeof exactFilter === 'function') {
    query = exactFilter(query)
  }

  const { data, error } = await query
  if (error || !Array.isArray(data) || data.length === 0) {
    return { status: 'none', options: [] }
  }

  const exact = data.filter((item) => normalizeText(getName(item)) === normalizedTarget)
  if (exact.length > 0) {
    return mapMatches(exact, mapOption)
  }

  const tolerant = data
    .map((item) => ({
      item,
      normalized: normalizeText(getName(item)),
      score: calculateTokenScore(getName(item), rawValue)
    }))
    .filter(({ normalized, score }) =>
      normalized.includes(normalizedTarget) ||
      normalizedTarget.includes(normalized) ||
      score >= 0.6
    )
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item)

  return mapMatches(tolerant.slice(0, 10), mapOption)
}

function mapMatches(data, mapOption) {
  const options = data.map(mapOption)
  if (options.length === 0) {
    return { status: 'none', options: [] }
  }
  if (options.length === 1) {
    return { status: 'single', options }
  }
  return { status: 'multiple', options }
}

module.exports = {
  resolver
}
