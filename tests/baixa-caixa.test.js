// Regra "pago = baixa em DINHEIRO" (ver .claude/rules/sincronizacao-sienge.md, secao
// "Tipo da baixa"). Os dois escritores de status=pago usam a mesma regra: o reconciliador
// (scripts/_baixa-caixa.mjs) e a edge sienge-sync (lib/baixa-caixa.ts). Os casos abaixo sao
// formas reais do /bulk-data/v1/income medidas em 2026-10-05.
import { describe, it, expect } from 'vitest'
import { classificarBaixa as classificarMjs } from '../scripts/_baixa-caixa.mjs'
import { classificarBaixa as classificarTs } from '../supabase/functions/sienge-sync/lib/baixa-caixa.ts'

const rec = (operationTypeName, paymentDate, netAmount) => ({ operationTypeName, paymentDate, netAmount })

const casos = [
  {
    nome: 'Recebimento simples conta como pago',
    inc: { receipts: [rec('Recebimento', '2026-09-25', 1018.24)] },
    esperado: { pago: true, motivo: 'caixa', datas: ['2026-09-25'] },
  },
  {
    nome: 'Reparcelamento (aditivo) NAO e dinheiro — 501 A inst 5',
    inc: { receipts: [rec('Reparcelamento', '2026-08-20', 1018.24)] },
    esperado: { pago: false, motivo: 'nao_caixa', datas: [] },
  },
  {
    nome: 'Distrato NAO e dinheiro — baixa de liquidacao',
    inc: { receipts: [rec('Distrato', '2026-08-25', 1429.85)] },
    esperado: { pago: false, motivo: 'nao_caixa', datas: [] },
  },
  {
    nome: 'parcial em dinheiro + Reparcelamento NAO e pago inteiro — bill 247 inst 6',
    inc: { receipts: [rec('Recebimento', '2026-02-10', 155.19), rec('Reparcelamento', '2026-03-05', 1193.08)] },
    esperado: { pago: false, motivo: 'misto', datas: ['2026-02-10'] },
  },
  {
    nome: 'dois recibos em dinheiro (pagou em duas vezes) conta como pago — bill 455 inst 2',
    inc: { receipts: [rec('Recebimento', '2026-05-18', 674.35), rec('Recebimento', '2026-04-06', 1000)] },
    esperado: { pago: true, motivo: 'caixa', datas: ['2026-05-18', '2026-04-06'] },
  },
  {
    nome: 'Por Bens (dacao) e pagamento',
    inc: { receipts: [rec('Por Bens', '2025-11-13', 9000)] },
    esperado: { pago: true, motivo: 'caixa', datas: ['2025-11-13'] },
  },
  {
    nome: 'Adiantamento e pagamento',
    inc: { receipts: [rec('Adiantamento', '2025-12-02', 5000)] },
    esperado: { pago: true, motivo: 'caixa', datas: ['2025-12-02'] },
  },
  {
    nome: 'sem recibo = em aberto',
    inc: { receipts: [] },
    esperado: { pago: false, motivo: 'sem_baixa', datas: [] },
  },
  {
    nome: 'recibo em dinheiro com valor zero nao conta',
    inc: { receipts: [rec('Recebimento', '2026-01-10', 0)] },
    esperado: { pago: false, motivo: 'sem_baixa', datas: [] },
  },
  {
    nome: 'tipo desconhecido nao conta como dinheiro (falha segura)',
    inc: { receipts: [rec('TipoNovoQualquer', '2026-01-10', 100)] },
    esperado: { pago: false, motivo: 'nao_caixa', datas: [] },
  },
]

for (const [impl, classificar] of [['scripts/_baixa-caixa.mjs', classificarMjs], ['edge lib/baixa-caixa.ts', classificarTs]]) {
  describe(`classificarBaixa (${impl})`, () => {
    for (const c of casos) {
      it(c.nome, () => {
        const r = classificar(c.inc)
        expect(r.pago).toBe(c.esperado.pago)
        expect(r.motivo).toBe(c.esperado.motivo)
        expect(r.recibosCaixa.map((x) => x.paymentDate)).toEqual(c.esperado.datas)
      })
    }

    it('expõe os tipos nao-caixa pra o alerta de aditivo nao materializado', () => {
      const r = classificar({ receipts: [rec('Reparcelamento', '2026-08-20', 1018.24)] })
      expect(r.tiposNaoCaixa).toEqual(['Reparcelamento'])
    })
  })
}
