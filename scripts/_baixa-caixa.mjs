// Tipo da baixa no income do Sienge — o que conta como PAGAMENTO do cliente.
// ver .claude/rules/sincronizacao-sienge.md, secao "Tipo da baixa".
//
// O Sienge da baixa numa parcela por varios motivos, e so alguns sao dinheiro. Cada recibo traz
// `operationTypeName`. Medido no income de 2026-10-05: Recebimento 3209, Distrato 3170,
// Reparcelamento 194, Por Bens 1, Adiantamento 1.
//   - Reparcelamento = aditivo: a divida rolou pra uma grade nova. Nao entrou dinheiro.
//   - Distrato       = liquidacao do contrato cancelado. Nao entrou dinheiro.
// Contar esses como pago gerou comissao falsa (501 A: 4 parcelas, R$ 1.425,52, aditivo de 20/08).
//
// Regra: pago = ao menos um recibo em dinheiro com valor > 0 E nenhum recibo nao-dinheiro.
// Parcial em dinheiro + Reparcelamento NAO e pago inteiro (bill 247 inst 6: R$ 155 de R$ 1.348).
// Tipo desconhecido e tratado como nao-dinheiro: na duvida nao marca pago.
//
// ⚠️ Gemeo em supabase/functions/sienge-sync/lib/baixa-caixa.ts (Deno nao importa daqui).
// Mudou um, mude o outro — tests/baixa-caixa.test.js roda os mesmos casos nos dois.

export const TIPOS_CAIXA = new Set(['Recebimento', 'Adiantamento', 'Por Bens'])

// Retorna { pago, motivo, recibosCaixa, tiposNaoCaixa }.
// motivo: 'caixa' | 'nao_caixa' | 'misto' | 'sem_baixa'
// recibosCaixa preserva a ordem original do array (cada chamador escolhe a data como ja escolhia).
export function classificarBaixa(inc) {
  const recibos = Array.isArray(inc?.receipts) ? inc.receipts : []
  const recibosCaixa = recibos.filter((r) => TIPOS_CAIXA.has(r?.operationTypeName) && Number(r?.netAmount || 0) > 0 && r?.paymentDate)
  const tiposNaoCaixa = [...new Set(recibos.filter((r) => !TIPOS_CAIXA.has(r?.operationTypeName)).map((r) => r?.operationTypeName ?? '(sem tipo)'))]
  let motivo
  if (tiposNaoCaixa.length && recibosCaixa.length) motivo = 'misto'
  else if (tiposNaoCaixa.length) motivo = 'nao_caixa'
  else if (recibosCaixa.length) motivo = 'caixa'
  else motivo = 'sem_baixa'
  return { pago: motivo === 'caixa', motivo, recibosCaixa, tiposNaoCaixa }
}
