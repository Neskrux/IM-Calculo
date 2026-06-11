// Helpers de leitura paginada do Supabase/PostgREST.
// ver .claude/rules/leitura-de-listas-e-refetch.md
//
// O PostgREST corta toda resposta em 1000 linhas SILENCIOSAMENTE (db.max-rows).
// Toda lista potencialmente >1000 linhas DEVE ser lida por aqui.

const PAGE_SIZE = 1000

/**
 * Busca TODAS as linhas de uma query, paginando por .range até página incompleta.
 *
 * @param {(from: number, to: number) => PromiseLike<{data: Array|null, error: object|null}>} buildQuery
 *   FACTORY: recebe os índices da página e retorna um builder NOVO já com .range(from, to).
 *   Obrigatório construir query nova por página — builders do supabase-js são mutáveis.
 *   A query DEVE ter ordenação determinística (.order(..., ) + .order('id') como tiebreaker),
 *   senão a paginação por offset pode duplicar/perder linhas entre páginas.
 * @param {{ pageSize?: number }} [opts]
 * @returns {Promise<Array>} todas as linhas concatenadas
 * @throws erro do Supabase da primeira página que falhar — NUNCA retorna parcial silencioso
 */
export async function fetchAllPaginated(buildQuery, { pageSize = PAGE_SIZE } = {}) {
  const all = []
  for (let page = 0; ; page++) {
    const from = page * pageSize
    const to = from + pageSize - 1
    const { data, error } = await buildQuery(from, to)
    if (error) throw error
    if (data && data.length > 0) all.push(...data)
    if (!data || data.length < pageSize) break
  }
  return all
}
