// Parse/format de colunas PostgreSQL `date` (sem timezone) de forma segura.
// new Date('2025-12-20') em JS = UTC midnight; em UTC-3 vira 2025-12-19 21:00
// local -> toLocaleDateString devolve '19/12/2025'. Ancorar em meio-dia UTC
// (T12:00:00) eh seguro pra qualquer timezone entre -11 e +11.

export const parseDataLocal = (str) => {
  if (!str) return null
  if (str instanceof Date) return str
  const s = String(str)
  if (s.length === 10 && s[4] === '-' && s[7] === '-') {
    return new Date(`${s}T12:00:00`)
  }
  return new Date(s)
}

export const formatDataBR = (str) => {
  const d = parseDataLocal(str)
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString('pt-BR') : '-'
}

export const formatDataBRCompleta = (str, opts) => {
  const d = parseDataLocal(str)
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString('pt-BR', opts) : '-'
}
