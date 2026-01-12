/**
 * Módulo de formatação de dados
 * 
 * Funções centralizadas para formatação de valores (moeda, data, telefone)
 * Versão unificada e robusta com validações defensivas
 */

/**
 * Formata valor como moeda brasileira (R$)
 * 
 * @param {number|string} value - Valor a formatar
 * @param {Object} options - Opções de formatação
 * @param {number} options.minimumFractionDigits - Dígitos mínimos (padrão: 2)
 * @param {number} options.maximumFractionDigits - Dígitos máximos (padrão: 2)
 * @returns {string} Valor formatado (ex: "R$ 1.234,56")
 */
export function formatCurrency(value, options = {}) {
  // Validação robusta (como CorretorDashboard)
  if (value === null || value === undefined || isNaN(value)) {
    return 'R$ 0,00'
  }
  
  const {
    minimumFractionDigits = 2,  // Padrão: 2 decimais
    maximumFractionDigits = 2
  } = options
  
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits,
    maximumFractionDigits
  }).format(value)
}

/**
 * Formata valor como moeda para input (sem símbolo R$)
 * Usado em campos de formulário
 * 
 * @param {string|number} value - Valor a formatar
 * @returns {string} Valor formatado (ex: "1.234,56")
 */
export function formatCurrencyInput(value) {
  if (!value) return ''
  const num = parseFloat(value)
  if (isNaN(num)) return ''
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Formata telefone para formato brasileiro ((00) 00000-0000)
 * 
 * @param {string} value - Telefone a formatar
 * @returns {string} Telefone formatado
 */
export function formatTelefone(value) {
  if (!value) return ''
  const numbers = value.replace(/\D/g, '')
  const limited = numbers.slice(0, 11)
  if (limited.length <= 2) return `(${limited}`
  if (limited.length <= 7) return `(${limited.slice(0, 2)}) ${limited.slice(2)}`
  return `(${limited.slice(0, 2)}) ${limited.slice(2, 7)}-${limited.slice(7)}`
}

/**
 * Formata data para formato brasileiro (DD/MM/AAAA)
 * 
 * @param {string|Date} date - Data a formatar
 * @returns {string} Data formatada
 */
export function formatDate(date) {
  if (!date) return '-'
  
  // Se for string no formato YYYY-MM-DD
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)) {
    const [year, month, day] = date.split('T')[0].split('-')
    return `${day}/${month}/${year}`
  }
  
  // Se for Date object
  if (date instanceof Date) {
    return date.toLocaleDateString('pt-BR')
  }
  
  return '-'
}

