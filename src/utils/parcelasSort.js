const TIPO_ORDER = { sinal: 0, entrada: 1, parcela_entrada: 2, balao: 3, comissao_integral: 4 }

export function sortByContrato(a, b) {
  const ta = TIPO_ORDER[a.tipo] ?? 99
  const tb = TIPO_ORDER[b.tipo] ?? 99
  if (ta !== tb) return ta - tb
  if ((a.numero_parcela || 0) !== (b.numero_parcela || 0))
    return (a.numero_parcela || 0) - (b.numero_parcela || 0)
  return (a.id || '').localeCompare(b.id || '')
}

export function sortByCalendario(a, b) {
  const da = a.data_prevista || ''
  const db = b.data_prevista || ''
  if (!da && db) return 1
  if (da && !db) return -1
  if (da !== db) return da.localeCompare(db)
  if ((a.numero_parcela || 0) !== (b.numero_parcela || 0))
    return (a.numero_parcela || 0) - (b.numero_parcela || 0)
  return (a.id || '').localeCompare(b.id || '')
}

export function sortParcelas(list, mode) {
  return [...list].sort(mode === 'calendario' ? sortByCalendario : sortByContrato)
}
