// Utilitários de busca reutilizáveis — usados pelo <Autocomplete> e por qualquer
// filtro de lista. Normaliza pra resolver as 2 dores históricas:
//  - ACENTO: "jo" acha "João", "tres" acha "três".
//  - FORMATAÇÃO de CPF/telefone: "12345678900" acha "123.456.789-00" (e vice-versa).

// minúsculo, sem acento, espaços colapsados
export function normalizar(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos (acentos) da forma decomposta
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// só dígitos — pra CPF/telefone/CEP casarem com ou sem máscara
export function soDigitos(s) {
  return String(s ?? '').replace(/\D/g, '')
}

// Casa UM item contra a query, em vários campos.
// fields: 'nome'  |  { key: 'cpf', tipo: 'numero' }   (tipo 'numero' = casa por dígitos)
export function casaBusca(item, query, fields = []) {
  const q = normalizar(query)
  if (!q) return true
  const qDig = soDigitos(query)
  return fields.some((f) => {
    const key = typeof f === 'string' ? f : f.key
    const tipo = typeof f === 'string' ? 'texto' : (f.tipo || 'texto')
    const val = item?.[key]
    if (val == null || val === '') return false
    if (tipo === 'numero') {
      return qDig.length > 0 && soDigitos(val).includes(qDig)
    }
    return normalizar(val).includes(q)
  })
}

// Filtra uma lista inteira (mantém a ordem original).
export function filtrarBusca(items = [], query, fields = []) {
  if (!query || !String(query).trim()) return items
  return items.filter((it) => casaBusca(it, query, fields))
}
