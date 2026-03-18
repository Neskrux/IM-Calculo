/**
 * Cache por hash do arquivo (SPEC: item 14).
 * Fase 1: em memória. Fase 2: persistir via repository (sem texto bruto).
 */

const cacheMemoria = new Map()

/**
 * Busca extração em cache pelo hash.
 * @param {string} hash
 * @returns {Promise<object|null>} Registro salvo ou null
 */
async function get(hash) {
  const cached = cacheMemoria.get(hash) ?? null
  console.log('[cache.service] lookup', {
    hash: hash?.slice(0, 12),
    hit: Boolean(cached)
  })
  return cached
}

/**
 * Salva resultado da extração (sem texto do contrato - decisão P4).
 * @param {string} hash
 * @param {object} payload - { arquivo_nome, schema_extraido_json, matching_json, status, origem_texto }
 */
async function save(hash, payload) {
  console.log('[cache.service] save', {
    hash: hash?.slice(0, 12),
    status: payload?.status,
    origem_texto: payload?.origem_texto
  })
  cacheMemoria.set(hash, {
    ...payload,
    arquivo_hash: hash,
    created_at: new Date().toISOString()
  })
}

module.exports = {
  get,
  save
}
