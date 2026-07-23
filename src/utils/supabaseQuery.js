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
 * @param {{ pageSize?: number, concurrency?: number }} [opts]
 *   concurrency > 1: depois da 1ª página, busca páginas em LOTES paralelos (menos
 *   round-trips em tabelas grandes; ~23k linhas caem de 24 viagens sequenciais pra ~4).
 *   O término continua SEMPRE por página incompleta (invariante da regra) — páginas do
 *   lote após a incompleta são descartadas, preservando a semântica sequencial.
 * @returns {Promise<Array>} todas as linhas concatenadas
 * @throws erro do Supabase da primeira página que falhar — NUNCA retorna parcial silencioso
 */
export async function fetchAllPaginated(buildQuery, { pageSize = PAGE_SIZE, concurrency = 1 } = {}) {
  const all = []
  let page = 0
  for (;;) {
    // 1ª página sempre sozinha: resolve o caso comum (lista < pageSize) em 1 viagem
    const batchSize = page === 0 ? 1 : Math.max(1, concurrency)
    const results = await Promise.all(
      Array.from({ length: batchSize }, (_, i) => {
        const from = (page + i) * pageSize
        return buildQuery(from, from + pageSize - 1)
      })
    )
    let incompleta = false
    for (const { data, error } of results) {
      if (error) throw error
      if (data && data.length > 0) all.push(...data)
      if (!data || data.length < pageSize) {
        incompleta = true
        break
      }
    }
    if (incompleta) break
    page += batchSize
  }
  return all
}
