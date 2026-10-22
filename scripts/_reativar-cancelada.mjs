// Decide se o reconciliador pode reativar uma parcela CANCELADA que o Sienge mostra viva.
// ver .claude/rules/sincronizacao-sienge.md
//
// Regra:
//   - baixa de liquidacao de distrato (ehBaixaDistrato) -> nunca
//   - cancelada sem motivo (engano)                     -> sim
//   - cancelada com motivo 'distrato'                   -> sim SO se o distrato foi DESFEITO:
//       venda nao esta mais em distrato (situacao != '3') E o Sienge nao tem baixa nao-dinheiro
//       na parcela (sem baixa ou so dinheiro). A segunda trava cobre o "limbo" (situacao stale
//       '2' no banco com o contrato ainda Cancelado no Sienge, baixa de Distrato presente).
//   - qualquer outro motivo (duplicata, cronograma_refeito, aditivo_renegociado...) -> nunca
//
// Caso real: 1408 C (c258) cancelado no Sienge em 09/09/2026 e reativado depois. A cura do cron
// cancelou 51 parcelas com motivo 'distrato'; sem esta regra elas ficavam canceladas para sempre.
import { classificarBaixa } from './_baixa-caixa.mjs'

export function podeReativarCancelada(cancelada, venda, inc, ehBaixaDistrato) {
  if (ehBaixaDistrato) return false
  const motivo = cancelada?.motivo_cancelamento_parcela ?? null
  if (!motivo) return true
  if (motivo !== 'distrato') return false
  if (venda?.situacao_contrato === '3') return false
  const { motivo: tipoBaixa } = classificarBaixa(inc || {})
  return tipoBaixa === 'sem_baixa' || tipoBaixa === 'caixa'
}
