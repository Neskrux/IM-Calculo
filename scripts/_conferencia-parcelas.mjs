// Conferência parcela a parcela IM × Sienge — lógica pura, sem I/O.
// Spec: docs/specs/2026-11-16-spec-conferencia-diaria-parcelas.md
// ver .claude/rules/sincronizacao-sienge.md e .claude/rules/numeracao-parcelas-sienge.md
//
// Casa SÓ pela âncora (sienge_bill_id, sienge_installment_id). Nunca por numero_parcela:
// é o que deixou o valor da 803 D trocar de série sem ninguém ver.
import { classificarBaixa } from './_baixa-caixa.mjs'

// Prazo para o Sienge registrar uma baixa feita no IM antes de virar alarme.
export const JANELA_SIENGE_DIAS = 15

const d10 = (x) => (x ? String(x).slice(0, 10) : null)
const chave = (bill, inst) => `${bill}|${inst}`

/**
 * @param {Array} pagamentos  linhas de pagamentos_prosoluto (id, venda_id, sienge_bill_id,
 *   sienge_installment_id, valor, comissao_gerada, status, data_prevista, data_pagamento)
 * @param {Array} income      linhas do /bulk-data/v1/income
 * @param {{conhecidas?: Array<{sienge_bill_id, sienge_installment_id, tipo, motivo}>}} [opts]
 */
export function conferirParcelas(pagamentos, income, { conhecidas = [], hoje = new Date().toISOString().slice(0, 10) } = {}) {
  const limite = new Date(new Date(hoje).getTime() - JANELA_SIENGE_DIAS * 86_400_000).toISOString().slice(0, 10)
  const recente = (data) => !!data && d10(data) >= limite
  const porAncora = new Map(income.map((i) => [chave(i.billId, i.installmentId), i]))
  const decididas = new Map(conhecidas.map((c) => [`${chave(c.sienge_bill_id, c.sienge_installment_id)}|${c.tipo}`, c.motivo]))
  const divergencias = []
  let conferidas = 0

  for (const p of pagamentos) {
    if (p.status === 'cancelado' || p.sienge_bill_id == null || p.sienge_installment_id == null) continue
    conferidas++
    const k = chave(p.sienge_bill_id, p.sienge_installment_id)
    const add = (tipo, im, sienge) => {
      const motivo = decididas.get(`${k}|${tipo}`)
      divergencias.push({
        tipo, pagamento_id: p.id, venda_id: p.venda_id,
        sienge_bill_id: p.sienge_bill_id, sienge_installment_id: String(p.sienge_installment_id),
        im, sienge, comissao: Number(p.comissao_gerada) || 0,
        conhecida: !!motivo, ...(motivo ? { motivo_conhecida: motivo } : {}),
      })
    }

    const i = porAncora.get(k)
    if (!i) { add('ancora_sem_sienge', `${p.status} ${p.valor}`, null); continue }

    if (Math.abs((Number(p.valor) || 0) - (Number(i.originalAmount) || 0)) > 0.01) {
      add('valor', Number(p.valor), Number(i.originalAmount))
    }
    if (d10(p.data_prevista) !== d10(i.dueDate)) add('data_prevista', d10(p.data_prevista), d10(i.dueDate))

    const baixa = classificarBaixa(i)
    const pagoSienge = d10(baixa.recibosCaixa.map((r) => d10(r.paymentDate)).sort()[0])
    if (p.status === 'pago' && !baixa.pago && baixa.motivo === 'sem_baixa' && recente(p.data_pagamento)) {
      // Baixa manual recente (ex.: boleto do IM pago no banco) que o Sienge ainda não registrou.
      // Informativo; vira alarme se passar de JANELA_SIENGE_DIAS sem baixa lá.
      add('aguardando_sienge', `pago ${d10(p.data_pagamento)}`, 'sem baixa (ainda)')
    } else if (p.status === 'pago' && !baixa.pago) {
      add('status_pago_sem_dinheiro', `pago ${d10(p.data_pagamento)}`,
        baixa.motivo === 'sem_baixa' ? 'sem baixa' : `baixa ${baixa.tiposNaoCaixa.join('+')} (não é dinheiro)`)
    } else if (p.status === 'pendente' && baixa.pago) {
      add('status_dinheiro_sem_pago', 'pendente', `pago ${pagoSienge}`)
    } else if (p.status === 'pago' && baixa.pago && d10(p.data_pagamento) !== pagoSienge) {
      add('data_pagamento', d10(p.data_pagamento), pagoSienge)
    }
  }

  // novas = alarmes (precisam de alguém); aguardando_sienge é informativo dentro da janela.
  const informativas = divergencias.filter((d) => d.tipo === 'aguardando_sienge').length
  const conhecidasN = divergencias.filter((d) => d.conhecida).length
  const novas = divergencias.filter((d) => !d.conhecida && d.tipo !== 'aguardando_sienge').length
  return { divergencias, counts: { conferidas, divergencias: divergencias.length, novas, conhecidas: conhecidasN, informativas } }
}
