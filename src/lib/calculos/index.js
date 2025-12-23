/**
 * Módulo centralizado de cálculos de comissões
 * 
 * Exporta todas as funções de cálculo para uso em todo o sistema
 */

// Exportar funções de comissões
export { calcularComissoesDinamicas } from './comissoes.js'

// Exportar funções de pro-soluto
export { calcularValorProSoluto, calcularFatorComissao } from './proSoluto.js'

// Exportar funções de pagamentos (será implementado na próxima etapa)
// export { 
//   calcularComissaoPorCargoPagamento,
//   calcularComissaoTotalPagamento,
//   calcularComissaoProporcional
// } from './pagamentos.js'