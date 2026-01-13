/**
 * Configuração da API Sienge
 * Variáveis de ambiente no .env:
 * - VITE_SIENGE_BASE_URL
 * - VITE_SIENGE_SUBDOMAIN
 * - VITE_SIENGE_USERNAME
 * - VITE_SIENGE_PASSWORD
 * - VITE_SIENGE_ENTERPRISE_ID
 */

const SIENGE_CONFIG = {
  baseUrl: import.meta.env.VITE_SIENGE_BASE_URL || 'https://api.sienge.com.br',
  subdomain: import.meta.env.VITE_SIENGE_SUBDOMAIN || 'imincorporadora',
  username: import.meta.env.VITE_SIENGE_USERNAME || '',
  password: import.meta.env.VITE_SIENGE_PASSWORD || '',
  enterpriseId: import.meta.env.VITE_SIENGE_ENTERPRISE_ID,
  apiVersion: 'v1'
}

/**
 * Monta a URL completa da API do Sienge
 */
export const getSiengeUrl = (endpoint) => {
  const base = `${SIENGE_CONFIG.baseUrl}/${SIENGE_CONFIG.subdomain}/public/api/${SIENGE_CONFIG.apiVersion}`
  return `${base}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`
}

/**
 * Gera header de autenticação Basic Auth
 */
export const getSiengeAuth = () => {
  if (!SIENGE_CONFIG.username || !SIENGE_CONFIG.password) {
    throw new Error('Credenciais Sienge não configuradas. Verifique VITE_SIENGE_USERNAME e VITE_SIENGE_PASSWORD')
  }
  const authString = `${SIENGE_CONFIG.username}:${SIENGE_CONFIG.password}`
  return `Basic ${btoa(authString)}`
}

export { SIENGE_CONFIG }

