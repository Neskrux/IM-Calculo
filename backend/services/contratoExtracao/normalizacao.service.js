/**
 * Normaliza saída do LLM para sale_form (SPEC: item 10, decisões P1/P2).
 * - status sempre 'pendente' (P1)
 * - tipo_corretor sempre 'externo' (P2)
 * - datas ISO, valores number, teve_balao 'sim'|'nao'|'pendente', grupos { qtd, valor }
 */

function normalizar(raw) {
  const sale = raw?.sale ?? {}
  const proSoluto = raw?.pro_soluto ?? {}
  const meta = raw?.meta ?? {}

  const saleForm = {
    status: 'pendente',
    tipo_corretor: 'externo',
    unidade: normalizeString(sale.unidade),
    bloco: normalizeString(sale.bloco),
    andar: normalizeString(sale.andar),
    valor_venda: normalizeNumber(sale.valor_venda),
    data_venda: normalizeDate(sale.data_venda),
    descricao: normalizeString(sale.descricao),
    teve_sinal: normalizeBoolean(proSoluto.teve_sinal),
    valor_sinal: normalizeNumber(proSoluto.valor_sinal),
    teve_entrada: normalizeBoolean(proSoluto.teve_entrada),
    valor_entrada: normalizeNumber(proSoluto.valor_entrada),
    parcelou_entrada: normalizeBoolean(proSoluto.parcelou_entrada),
    grupos_parcelas_entrada: normalizeGrupos(proSoluto.grupos_parcelas_entrada),
    teve_balao: normalizeTeveBalao(proSoluto.teve_balao),
    grupos_balao: normalizeGrupos(proSoluto.grupos_balao),
    teve_permuta: normalizeBoolean(proSoluto.teve_permuta),
    tipo_permuta: normalizeString(proSoluto.tipo_permuta),
    valor_permuta: normalizeNumber(proSoluto.valor_permuta)
  }

  const valorProSolutoExtraido = normalizeNumber(proSoluto.valor_pro_soluto) || null
  const confidence = { ...meta.confidence }
  const warnings = Array.isArray(meta.warnings) ? meta.warnings : []

  return {
    saleForm,
    valorProSolutoExtraido,
    confidence,
    warnings,
    rawSale: sale,
    rawProSoluto: proSoluto
  }
}

function normalizeString(v) {
  if (v == null) return ''
  return String(v).trim()
}

function normalizeNumber(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : null
  }

  const raw = String(v).trim().replace(/[^\d,.-]/g, '')
  const hasComma = raw.includes(',')
  const normalized = hasComma ? raw.replace(/\./g, '').replace(',', '.') : raw
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

function normalizeDate(v) {
  if (!v) return ''
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : ''
}

function normalizeTeveBalao(v) {
  if (v === true || v === 'sim' || String(v).toLowerCase() === 'sim') return 'sim'
  if (v === 'pendente' || String(v).toLowerCase() === 'pendente') return 'pendente'
  return 'nao'
}

function normalizeBoolean(v) {
  if (typeof v === 'boolean') return v
  const normalized = String(v ?? '').trim().toLowerCase()
  return ['true', 'sim', 's', 'yes', '1', 'ha'].includes(normalized)
}

function normalizeGrupos(arr) {
  if (!Array.isArray(arr)) return [{ qtd: '', valor: '' }]
  const normalized = arr.map((g) => ({
    qtd: String(g?.quantidade ?? g?.qtd ?? ''),
    valor: String(g?.valor_parcela ?? g?.valor ?? '')
  })).filter((g) => g.qtd !== '' || g.valor !== '')
  if (normalized.length === 0) return [{ qtd: '', valor: '' }]
  return normalized
}

module.exports = {
  normalizar
}
