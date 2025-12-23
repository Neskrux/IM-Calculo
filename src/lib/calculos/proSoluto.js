/**
 * Módulo de cálculos de pro-soluto
 * 
 * Funções centralizadas para calcular valores pro-soluto e fatores de comissão
 * Versão robusta com validações defensivas para garantir precisão financeira
 */

/**
 * Calcula o valor total do pro-soluto (sinal + entrada + balões)
 * 
 * Suporta dois formatos de entrada:
 * 1. Grupos (array de objetos {qtd, valor}) - usado no formulário
 * 2. Campos simples (qtd_parcelas_entrada, valor_parcela_entrada) - usado no banco
 * 
 * @param {Object} dadosVenda - Dados da venda
 * @param {boolean} dadosVenda.teve_sinal
 * @param {number|string} dadosVenda.valor_sinal
 * @param {boolean} dadosVenda.teve_entrada
 * @param {boolean} dadosVenda.parcelou_entrada
 * @param {number|string} dadosVenda.valor_entrada - Usado se não parcelou
 * @param {number|string} dadosVenda.qtd_parcelas_entrada - Usado se parcelou e não tem grupos
 * @param {number|string} dadosVenda.valor_parcela_entrada - Usado se parcelou e não tem grupos
 * @param {string} dadosVenda.teve_balao - 'sim', 'nao', 'pendente'
 * @param {number|string} dadosVenda.qtd_balao - Usado se não tem grupos
 * @param {number|string} dadosVenda.valor_balao - Usado se não tem grupos
 * @param {Array} gruposParcelasEntrada - Array de {qtd, valor} - Usado se parcelou (prioridade sobre campos simples)
 * @param {Array} gruposBalao - Array de {qtd, valor} - Usado se teve_balao='sim' (prioridade sobre campos simples)
 * @returns {number} Valor total do pro-soluto (nunca NaN)
 */
export function calcularValorProSoluto(dadosVenda, gruposParcelasEntrada = [], gruposBalao = []) {
  // Validação defensiva: garantir que dadosVenda é objeto válido
  if (!dadosVenda || typeof dadosVenda !== 'object') {
    console.warn('calcularValorProSoluto: dadosVenda inválido, retornando 0')
    return 0
  }

  // Sinal
  const valorSinal = dadosVenda.teve_sinal ? (parseFloat(dadosVenda.valor_sinal) || 0) : 0
  
  // Entrada
  let valorEntradaTotal = 0
  if (dadosVenda.teve_entrada) {
    if (dadosVenda.parcelou_entrada) {
      // Se tem grupos, usar grupos (prioridade)
      if (Array.isArray(gruposParcelasEntrada) && gruposParcelasEntrada.length > 0) {
        // Soma grupos de parcelas (com validação)
        valorEntradaTotal = gruposParcelasEntrada.reduce((sum, grupo) => {
          if (!grupo || typeof grupo !== 'object' || grupo === null) return sum
          const qtd = parseFloat(grupo.qtd) || 0
          const valor = parseFloat(grupo.valor) || 0
          return sum + (qtd * valor)
        }, 0)
      } else {
        // Se não tem grupos, usar campos simples (compatibilidade com banco)
        const qtd = parseFloat(dadosVenda.qtd_parcelas_entrada) || 0
        const valor = parseFloat(dadosVenda.valor_parcela_entrada) || 0
        valorEntradaTotal = qtd * valor
      }
    } else {
      // Entrada à vista
      valorEntradaTotal = parseFloat(dadosVenda.valor_entrada) || 0
    }
  }
  
  // Balões
  let valorTotalBalao = 0
  if (dadosVenda.teve_balao === 'sim') {
    // Se tem grupos, usar grupos (prioridade)
    if (Array.isArray(gruposBalao) && gruposBalao.length > 0) {
      valorTotalBalao = gruposBalao.reduce((sum, grupo) => {
        if (!grupo || typeof grupo !== 'object' || grupo === null) return sum
        const qtd = parseFloat(grupo.qtd) || 0
        const valor = parseFloat(grupo.valor) || 0
        return sum + (qtd * valor)
      }, 0)
    } else {
      // Se não tem grupos, usar campos simples (compatibilidade com banco)
      const qtd = parseFloat(dadosVenda.qtd_balao) || 0
      const valor = parseFloat(dadosVenda.valor_balao) || 0
      valorTotalBalao = qtd * valor
    }
  }
  
  // Pro-soluto = sinal + entrada + balões
  const resultado = valorSinal + valorEntradaTotal + valorTotalBalao
  
  // Garantir que nunca retorna NaN
  if (isNaN(resultado)) {
    console.warn('calcularValorProSoluto: resultado é NaN, retornando 0', {
      valorSinal,
      valorEntradaTotal,
      valorTotalBalao
    })
    return 0
  }
  
  return resultado
}

/**
 * Calcula o fator de comissão (percentual total / 100)
 * 
 * @param {number|string} percentualTotal - Percentual total de comissão (ex: 7 para 7%)
 * @returns {number} Fator de comissão (ex: 0.07 para 7%), nunca NaN
 */
export function calcularFatorComissao(percentualTotal) {
  // Validação defensiva
  if (percentualTotal === null || percentualTotal === undefined || isNaN(percentualTotal)) {
    return 0
  }
  
  const resultado = parseFloat(percentualTotal) / 100
  
  // Garantir que nunca retorna NaN
  if (isNaN(resultado)) {
    console.warn('calcularFatorComissao: resultado é NaN, retornando 0', { percentualTotal })
    return 0
  }
  
  return resultado
}




