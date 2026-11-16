// Conferência diária parcela a parcela (IM × Sienge). Spec: docs/specs/2026-11-16-spec-conferencia-diaria-parcelas.md
import { describe, it, expect } from 'vitest'
import { conferirParcelas } from '../scripts/_conferencia-parcelas.mjs'

const rec = (operationTypeName, paymentDate, netAmount) => ({ operationTypeName, paymentDate, netAmount })
const inc = (billId, installmentId, originalAmount, dueDate, receipts = []) =>
  ({ billId, installmentId, originalAmount, dueDate, receipts })
const pag = (over = {}) => ({
  id: 'p1', venda_id: 'v1', sienge_bill_id: 178, sienge_installment_id: '15', valor: 2650,
  comissao_gerada: 504.72, status: 'pendente', data_prevista: '2026-11-10', data_pagamento: null, ...over,
})
const tipos = (r) => r.divergencias.map((d) => d.tipo)

describe('conferirParcelas', () => {
  it('parcela que bate com o Sienge não gera divergência', () => {
    const r = conferirParcelas([pag()], [inc(178, 15, 2650, '2026-11-10')])
    expect(r.divergencias).toEqual([])
    expect(r.counts.conferidas).toBe(1)
  })

  it('valor de outra série (caso 803 D, 16/11)', () => {
    const r = conferirParcelas([pag({ valor: 1500, comissao_gerada: 285.69 })], [inc(178, 15, 2650, '2026-11-10')])
    expect(tipos(r)).toEqual(['valor'])
    expect(r.divergencias[0]).toMatchObject({ im: 1500, sienge: 2650 })
  })

  it('pago no IM com baixa de Distrato no Sienge = pago sem dinheiro', () => {
    const r = conferirParcelas(
      [pag({ status: 'pago', data_pagamento: '2026-09-09' })],
      [inc(178, 15, 2650, '2026-11-10', [rec('Distrato', '2026-09-09', 2650)])],
    )
    expect(tipos(r)).toEqual(['status_pago_sem_dinheiro'])
  })

  it('baixa recente no IM ainda sem baixa no Sienge = aguardando Sienge, não alarme', () => {
    const r = conferirParcelas([pag({ status: 'pago', data_pagamento: '2026-11-10' })], [inc(178, 15, 2650, '2026-11-10')], { hoje: '2026-11-16' })
    expect(tipos(r)).toEqual(['aguardando_sienge'])
  })

  it('baixa no IM há mais de 15 dias sem baixa no Sienge vira alarme', () => {
    const r = conferirParcelas([pag({ status: 'pago', data_pagamento: '2026-10-23' })], [inc(178, 15, 2650, '2026-11-10')], { hoje: '2026-11-16' })
    expect(tipos(r)).toEqual(['status_pago_sem_dinheiro'])
  })

  it('pendente no IM com recebimento em dinheiro no Sienge', () => {
    const r = conferirParcelas([pag()], [inc(178, 15, 2650, '2026-11-10', [rec('Recebimento', '2026-11-06', 2650)])])
    expect(tipos(r)).toEqual(['status_dinheiro_sem_pago'])
  })

  it('vencimento diferente', () => {
    const r = conferirParcelas([pag({ data_prevista: '2026-12-10' })], [inc(178, 15, 2650, '2026-11-10')])
    expect(tipos(r)).toEqual(['data_prevista'])
  })

  it('data de pagamento diferente do 1º recibo em dinheiro', () => {
    const r = conferirParcelas(
      [pag({ status: 'pago', data_pagamento: '2026-11-08' })],
      [inc(178, 15, 2650, '2026-11-10', [rec('Recebimento', '2026-11-06T00:00:00', 2650)])],
    )
    expect(tipos(r)).toEqual(['data_pagamento'])
  })

  it('âncora que não existe no Sienge', () => {
    const r = conferirParcelas([pag()], [])
    expect(tipos(r)).toEqual(['ancora_sem_sienge'])
  })

  it('parcela cancelada e parcela sem âncora ficam fora', () => {
    const r = conferirParcelas(
      [pag({ status: 'cancelado', valor: 1 }), pag({ id: 'p2', sienge_installment_id: null, valor: 1 })],
      [inc(178, 15, 2650, '2026-11-10')],
    )
    expect(r.divergencias).toEqual([])
    expect(r.counts.conferidas).toBe(0)
  })

  it('divergência já decidida aparece como conhecida, com o motivo', () => {
    const conhecidas = [{ sienge_bill_id: 178, sienge_installment_id: '15', tipo: 'valor', motivo: 'teste' }]
    const r = conferirParcelas([pag({ valor: 1500 })], [inc(178, 15, 2650, '2026-11-10')], { conhecidas })
    expect(r.divergencias[0]).toMatchObject({ tipo: 'valor', conhecida: true, motivo_conhecida: 'teste' })
    expect(r.counts.novas).toBe(0)
    expect(r.counts.conhecidas).toBe(1)
  })
})
