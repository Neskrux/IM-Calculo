// Merge de pagamentos do sync (sales-contracts). Spec: docs/specs/2026-11-10-spec-sync-merge-pagamentos.md
// Caso real 2026-11-10: 803 D tem duas séries PM (2.650 e 1.500) numeradas 1..n cada → chave repetida
// → o sync trocava valores entre linhas a cada rodada (canceladas e pendentes).
import { describe, it, expect } from 'vitest'
import { planejarMergePagamentos } from '../supabase/functions/sienge-sync/lib/merge-pagamentos.ts'

const des = (tipo, np, valor, extra = {}) => ({
  venda_id: 'v1', tipo, numero_parcela: np, valor, data_prevista: '2027-01-10',
  comissao_gerada: +(valor * 0.19).toFixed(2), fator_comissao_aplicado: 0.19, percentual_comissao_total: 7, ...extra,
})
const ex = (id, tipo, np, valor, status = 'pendente', extra = {}) => ({
  id, tipo, numero_parcela: np, status, valor, data_prevista: '2027-01-10',
  comissao_gerada: +(valor * 0.19).toFixed(2), fator_comissao_aplicado: 0.19, percentual_comissao_total: 7,
  sienge_installment_id: null, ...extra,
})

// aplica o plano num "banco" em memória, como o sync faria
function aplicar(existentes, plano) {
  const out = existentes.map((r) => ({ ...r }))
  for (const u of plano.updates) Object.assign(out.find((r) => r.id === u.id), u.body)
  for (const [i, r] of plano.inserts.entries()) out.push({ id: `novo${i}`, sienge_installment_id: null, ...r })
  return out
}

describe('planejarMergePagamentos', () => {
  it('duas séries do mesmo tipo (chave repetida) → nenhuma escrita na venda', () => {
    const desejados = [des('parcela_entrada', 1, 2650), des('parcela_entrada', 1, 1500)]
    const existentes = [ex('a', 'parcela_entrada', 1, 2650), ex('b', 'parcela_entrada', 1, 1500, 'cancelado')]
    const p = planejarMergePagamentos(desejados, existentes)
    expect(p.updates).toEqual([])
    expect(p.inserts).toEqual([])
    expect(p.motivoSkip).toBe('chave_repetida')
  })

  it('parcela cancelada nunca é reescrita nem substituída', () => {
    const p = planejarMergePagamentos([des('balao', 1, 1260)], [ex('c', 'balao', 1, 3780, 'cancelado')])
    expect(p.updates).toEqual([])
    expect(p.inserts).toEqual([])
  })

  it('parcela ancorada ao Sienge não é reescrita (dona = income)', () => {
    const p = planejarMergePagamentos(
      [des('balao', 1, 3780)],
      [ex('d', 'balao', 1, 1260, 'pendente', { sienge_installment_id: '6' })],
    )
    expect(p.updates).toEqual([])
    expect(p.inserts).toEqual([])
  })

  it('parcela paga segue intocada', () => {
    const p = planejarMergePagamentos([des('parcela_entrada', 1, 999)], [ex('e', 'parcela_entrada', 1, 500, 'pago')])
    expect(p.updates).toEqual([])
  })

  it('chave repetida entre existentes ativas → aquela chave não é escrita', () => {
    const p = planejarMergePagamentos(
      [des('parcela_entrada', 2, 800)],
      [ex('f', 'parcela_entrada', 2, 700), ex('g', 'parcela_entrada', 2, 701)],
    )
    expect(p.updates).toEqual([])
    expect(p.inserts).toEqual([])
  })

  it('série única pendente não ancorada → atualiza como antes', () => {
    const p = planejarMergePagamentos([des('parcela_entrada', 1, 1000)], [ex('h', 'parcela_entrada', 1, 900)])
    expect(p.updates).toHaveLength(1)
    expect(p.updates[0]).toMatchObject({ id: 'h', body: { valor: 1000 } })
  })

  it('venda nova → insere tudo', () => {
    const p = planejarMergePagamentos([des('sinal', null, 500), des('parcela_entrada', 1, 1000)], [])
    expect(p.inserts).toHaveLength(2)
  })

  it('duas rodadas seguidas: a segunda não escreve nada (idempotente)', () => {
    const desejados = [des('sinal', null, 500), des('parcela_entrada', 1, 1000), des('parcela_entrada', 2, 1000)]
    let banco = [ex('i', 'parcela_entrada', 1, 900), ex('j', 'parcela_entrada', 2, 1000, 'cancelado'),
      ex('k', 'sinal', null, 500, 'pendente', { sienge_installment_id: '1' })]
    banco = aplicar(banco, planejarMergePagamentos(desejados, banco))
    const r2 = planejarMergePagamentos(desejados, banco)
    expect(r2.updates).toEqual([])
    expect(r2.inserts).toEqual([])
    expect(banco.find((r) => r.id === 'j').valor).toBe(1000) // cancelada intacta
  })
})
