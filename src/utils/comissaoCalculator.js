/**
 * Calcula o fator de comissão conforme fator-comissao.mdc
 * fator_comissao_aplicado = (valorVenda * percentualTotal) / valorProSoluto
 */
export function calcularFatorComissao(valorVenda, valorProSoluto, percentualTotal) {
  const valorVendaNum = parseFloat(valorVenda) || 0
  const valorProSolutoNum = parseFloat(valorProSoluto) || 0
  const percentualTotalNum = parseFloat(percentualTotal) || 0
  if (valorProSolutoNum <= 0) return 0
  return (valorVendaNum * (percentualTotalNum / 100)) / valorProSolutoNum
}

/**
 * Calcula comissão da parcela: valorParcela * fator_comissao_aplicado
 */
export function calcularComissaoPagamento(valorParcela, fatorComissaoAplicado) {
  const valorParcelaNum = parseFloat(valorParcela) || 0
  const fatorComissaoAplicadoNum = parseFloat(fatorComissaoAplicado) || 0
  return valorParcelaNum * fatorComissaoAplicadoNum
}