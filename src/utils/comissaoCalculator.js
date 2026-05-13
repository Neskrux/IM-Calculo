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
 * API simples usada pelo Admin quando o fator já está conhecido.
 */
export function calcularComissaoPagamento(valorParcela, fatorComissaoAplicado) {
  const valorParcelaNum = parseFloat(valorParcela) || 0
  const fatorComissaoAplicadoNum = parseFloat(fatorComissaoAplicado) || 0
  return valorParcelaNum * fatorComissaoAplicadoNum
}

/**
 * Status canônicos. Use sempre via constante pra evitar typo em string mágica.
 */
export const STATUS = Object.freeze({
  PAGO: 'pago',
  PENDENTE: 'pendente',
  CANCELADO: 'cancelado',
})

/**
 * Predicates de pagamento.
 */
export const isPago = (pag) => pag?.status === STATUS.PAGO
export const isPendente = (pag) => pag?.status === STATUS.PENDENTE
export const isCancelado = (pag) => pag?.status === STATUS.CANCELADO
export const isAtivo = (pag) => pag?.status !== STATUS.CANCELADO

/**
 * Data efetiva para relatórios e filtros temporais:
 * - Pago → usa data_pagamento (quando realmente ocorreu)
 * - Pendente/outros → usa data_prevista (quando deveria ocorrer)
 * Retorna string (YYYY-MM-DD) ou null.
 */
export const dataEfetiva = (pag) => {
  if (!pag) return null
  return pag.data_pagamento || pag.data_prevista || null
}

/**
 * Cascata completa de cálculo de comissão por pagamento.
 * Use quando não se tem o fator pré-calculado e precisa resolver do snapshot.
 *
 * Ordem de preferência (respeita R1 — fator-comissao.md):
 *  1) comissao_gerada no pagamento (snapshot definitivo — fonte da verdade histórica)
 *  2) fator_comissao_aplicado no pagamento × valor
 *  3) fator_comissao_corretor no pagamento × valor (legado)
 *  4) fator_comissao da venda × valor (fallback histórico)
 *  5) fator_comissao_corretor da venda × valor (legado)
 *  6) proporção comissao_corretor / valor_pro_soluto × valor (fallback grosseiro)
 *  7) último recurso — recalcula fator canônico a partir de valor_venda, pro-soluto e percentual informado
 *
 * NUNCA aplica (percentual/100) direto na parcela — isso viola R1.
 *
 * @param {object} pagamento - linha de pagamentos_prosoluto
 * @param {object} [opts]
 * @param {Array}  [opts.vendas] - coleção de vendas para lookup por pagamento.venda_id
 * @param {object} [opts.venda]  - venda já resolvida (pula o lookup se informada)
 * @param {number} [opts.percentualFallback] - usado só no passo 7 quando nada mais resolve
 * @returns {number}
 */
export function calcularComissaoPagamentoCompleto(pagamento, opts = {}) {
  if (!pagamento) return 0

  if (pagamento.comissao_gerada && parseFloat(pagamento.comissao_gerada) > 0) {
    return parseFloat(pagamento.comissao_gerada)
  }

  const valorParcela = parseFloat(pagamento.valor) || 0
  if (valorParcela <= 0) return 0

  if (pagamento.fator_comissao_aplicado && parseFloat(pagamento.fator_comissao_aplicado) > 0) {
    return valorParcela * parseFloat(pagamento.fator_comissao_aplicado)
  }

  if (pagamento.fator_comissao_corretor && parseFloat(pagamento.fator_comissao_corretor) > 0) {
    return valorParcela * parseFloat(pagamento.fator_comissao_corretor)
  }

  const venda = opts.venda || (Array.isArray(opts.vendas) ? opts.vendas.find((v) => v.id === pagamento.venda_id) : null)

  if (venda) {
    if (venda.fator_comissao && parseFloat(venda.fator_comissao) > 0) {
      return valorParcela * parseFloat(venda.fator_comissao)
    }
    if (venda.fator_comissao_corretor && parseFloat(venda.fator_comissao_corretor) > 0) {
      return valorParcela * parseFloat(venda.fator_comissao_corretor)
    }
    const comissaoVenda = parseFloat(venda.comissao_corretor) || 0
    const proSolutoVenda = parseFloat(venda.valor_pro_soluto) || 0
    if (comissaoVenda > 0 && proSolutoVenda > 0) {
      return valorParcela * (comissaoVenda / proSolutoVenda)
    }
    const percentual = parseFloat(opts.percentualFallback)
    if (percentual > 0 && proSolutoVenda > 0) {
      const fatorCanonico = calcularFatorComissao(venda.valor_venda, proSolutoVenda, percentual)
      return valorParcela * fatorCanonico
    }
  }

  return 0
}

/**
 * Soma comissão de uma lista de pagamentos aplicando um predicate opcional.
 * Evita repetir o padrão `reduce` em cada dashboard.
 *
 * @param {Array} pagamentos
 * @param {object} [opts]
 * @param {function} [opts.predicate] - ex: isPago, isPendente
 * @param {Array}    [opts.vendas]    - repassa pra calcularComissaoPagamentoCompleto
 * @param {number}   [opts.percentualFallback]
 * @returns {number}
 */
export function somarComissao(pagamentos, opts = {}) {
  if (!Array.isArray(pagamentos)) return 0
  const { predicate, vendas, percentualFallback } = opts
  // Default: ignora canceladas (parcela cancelada nao deve entrar em soma
  // financeira). Quem precisa do total bruto pra auditoria passa
  // predicate explicito (ex: () => true).
  const lista = predicate ? pagamentos.filter(predicate) : pagamentos.filter(isAtivo)
  return lista.reduce(
    (acc, pag) => acc + calcularComissaoPagamentoCompleto(pag, { vendas, percentualFallback }),
    0,
  )
}
