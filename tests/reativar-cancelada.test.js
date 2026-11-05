// Quando o reconciliador pode trazer de volta uma parcela cancelada que o Sienge mostra viva.
// Caso real 1408 C (c258, bill 255): o contrato foi cancelado no Sienge em 09/09/2026 junto com
// 3 distratos reais, o cron curou (51 parcelas -> cancelado motivo 'distrato') e depois o Sienge
// DESFEZ o cancelamento (contrato volta a Emitido, baixas de Distrato somem). O sync reverteu a
// venda (situacao '2', data_distrato nula), mas as parcelas ficaram canceladas para sempre,
// porque o reconciliador nunca reativa cancelada com motivo.
import { describe, it, expect } from 'vitest'
import { podeReativarCancelada } from '../scripts/_reativar-cancelada.mjs'

const rec = (operationTypeName, paymentDate) => ({ operationTypeName, paymentDate, netAmount: 100 })
const vendaAtiva = { situacao_contrato: '2', data_distrato: null }
const vendaDistrato = { situacao_contrato: '3', data_distrato: '2026-09-09' }

describe('podeReativarCancelada', () => {
  it('cancelada sem motivo e Sienge vivo: reativa (comportamento antigo)', () => {
    expect(podeReativarCancelada({ motivo_cancelamento_parcela: null }, vendaAtiva, { receipts: [] }, false)).toBe(true)
  })

  it('baixa de liquidacao de distrato: nunca reativa', () => {
    expect(podeReativarCancelada({ motivo_cancelamento_parcela: null }, vendaDistrato, { receipts: [] }, true)).toBe(false)
  })

  it('distrato DESFEITO no Sienge (venda voltou a ativa, parcela sem baixa): reativa — caso 1408 C', () => {
    expect(podeReativarCancelada({ motivo_cancelamento_parcela: 'distrato' }, vendaAtiva, { receipts: [] }, false)).toBe(true)
  })

  it('distrato desfeito e cliente pagou depois em dinheiro: reativa', () => {
    expect(podeReativarCancelada({ motivo_cancelamento_parcela: 'distrato' }, vendaAtiva,
      { receipts: [rec('Recebimento', '2026-10-20')] }, false)).toBe(true)
  })

  it('motivo distrato e venda AINDA em distrato: nao reativa', () => {
    expect(podeReativarCancelada({ motivo_cancelamento_parcela: 'distrato' }, vendaDistrato, { receipts: [] }, false)).toBe(false)
  })

  it('motivo distrato, venda com situacao stale (limbo) mas Sienge ainda com baixa de Distrato: nao reativa', () => {
    expect(podeReativarCancelada({ motivo_cancelamento_parcela: 'distrato' }, vendaAtiva,
      { receipts: [rec('Distrato', '2026-09-09')] }, false)).toBe(false)
  })

  it('motivo distrato com recibo misto (dinheiro + Distrato): nao reativa', () => {
    expect(podeReativarCancelada({ motivo_cancelamento_parcela: 'distrato' }, vendaAtiva,
      { receipts: [rec('Recebimento', '2026-08-20'), rec('Distrato', '2026-09-09')] }, false)).toBe(false)
  })

  it.each(['duplicata', 'cronograma_refeito', 'aditivo_renegociado'])(
    'cancelada de proposito (%s): nunca reativa', (motivo) => {
      expect(podeReativarCancelada({ motivo_cancelamento_parcela: motivo }, vendaAtiva, { receipts: [] }, false)).toBe(false)
    })
})
