/**
 * Calcula comissões dinâmicas baseado nos cargos do empreendimento
 * 
 * Versão segura baseada em AdminDashboard.jsx
 * - Usa parseFloat em todos os cálculos numéricos (evita bugs com strings)
 * - Validações defensivas com optional chaining e fallbacks
 * - Tratamento seguro de casos extremos
 * 
 * @param {number} valorVenda - Valor total da venda
 * @param {string} empreendimentoId - ID do empreendimento
 * @param {string} tipoCorretor - 'interno' ou 'externo'
 * @param {Array} empreendimentos - Lista de empreendimentos (com cargos)
 * @returns {Object} { cargos: Array, total: number, percentualTotal: number }
 */
export function calcularComissoesDinamicas(valorVenda, empreendimentoId, tipoCorretor, empreendimentos) {
  // Encontrar empreendimento
  const emp = empreendimentos.find(e => e.id === empreendimentoId)
  if (!emp) {
    return { cargos: [], total: 0, percentualTotal: 0 }
  }
  
  // Filtrar cargos pelo tipo de corretor (com optional chaining defensivo)
  const cargosDoTipo = emp.cargos?.filter(c => c.tipo_corretor === tipoCorretor) || []
  
  // Calcular percentual total primeiro (com parseFloat e fallback para evitar NaN)
  const percentualTotal = cargosDoTipo.reduce((acc, c) => acc + parseFloat(c.percentual || 0), 0)
  
  // Calcular comissão para cada cargo (com parseFloat em todos os cálculos)
  const comissoesPorCargo = cargosDoTipo.map(cargo => ({
    cargo_id: cargo.id,
    nome_cargo: cargo.nome_cargo,
    percentual: parseFloat(cargo.percentual),  // parseFloat garante que é número
    valor: (valorVenda * parseFloat(cargo.percentual)) / 100  // parseFloat evita bugs com strings
  }))
  
  // Total em reais
  const total = comissoesPorCargo.reduce((acc, c) => acc + c.valor, 0)
  
  return { 
    cargos: comissoesPorCargo, 
    total, 
    percentualTotal 
  }
}

