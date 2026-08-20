import { describe, it, expect } from 'vitest'
import { somarComissao, isPago, isPendente, calcularComissaoPagamentoCompleto, percentualCorretorDaVenda } from './comissaoCalculator'

// Invariante financeiro dos 3 números do corretor (cenário BDD da spec mobile):
//  - totais vêm de somarComissao sobre pagamentos_prosoluto (nunca snapshot stale)
//  - parcela 'cancelado' NUNCA infla nenhum total
//  - total exibido = pago + pendente

const pag = (status, comissao) => ({ status, comissao_gerada: comissao, valor: comissao })

describe('calcularComissaoPagamentoCompleto', () => {
  it('usa comissao_gerada quando presente (fonte da verdade histórica)', () => {
    expect(calcularComissaoPagamentoCompleto({ comissao_gerada: 216.52, valor: 1292.67 })).toBeCloseTo(216.52, 2)
  })

  it('cai pra valor × fator_comissao_aplicado quando não há comissao_gerada', () => {
    expect(
      calcularComissaoPagamentoCompleto({ valor: 1000, fator_comissao_aplicado: 0.1675 }),
    ).toBeCloseTo(167.5, 2)
  })
})

describe('somarComissao — invariante dos 3 números', () => {
  const pagamentos = [
    pag('pago', 100),
    pag('pago', 50),
    pag('pendente', 200),
    pag('cancelado', 999), // NÃO pode entrar em nenhum total
  ]

  it('por padrão ignora canceladas (parcela cancelada não infla)', () => {
    // 100 + 50 + 200 = 350 (sem o 999 cancelado)
    expect(somarComissao(pagamentos)).toBeCloseTo(350, 2)
  })

  it('pago = soma das pagas', () => {
    expect(somarComissao(pagamentos, { predicate: isPago })).toBeCloseTo(150, 2)
  })

  it('pendente = soma das pendentes', () => {
    expect(somarComissao(pagamentos, { predicate: isPendente })).toBeCloseTo(200, 2)
  })

  it('total ativo == pago + pendente', () => {
    const pago = somarComissao(pagamentos, { predicate: isPago })
    const pendente = somarComissao(pagamentos, { predicate: isPendente })
    expect(somarComissao(pagamentos)).toBeCloseTo(pago + pendente, 2)
  })

  it('cancelar uma parcela não muda os totais ativos', () => {
    const antes = somarComissao(pagamentos)
    const comMaisCancelada = [...pagamentos, pag('cancelado', 12345)]
    expect(somarComissao(comMaisCancelada)).toBeCloseTo(antes, 2)
  })

  it('lista inválida → 0', () => {
    expect(somarComissao(null)).toBe(0)
    expect(somarComissao(undefined)).toBe(0)
  })
})

// Conta multi-tipo (caso Matheus Pires — cadastro interno, 32 vendas internas + 13 externas):
//  Dado um corretor com cadastro de um tipo e venda do OUTRO tipo
//  Então a fatia usa a taxa padrão do tipo DA VENDA, nunca a do perfil.
describe('percentualCorretorDaVenda (conta multi-tipo)', () => {
  const perfilInterno = { tipo_corretor: 'interno', percentual_corretor: null }

  it('venda do MESMO tipo do cadastro → taxa padrão do tipo (caso normal)', () => {
    expect(percentualCorretorDaVenda({ tipo_corretor: 'interno' }, perfilInterno)).toBe(2.5)
  })

  it('cadastro interno + venda EXTERNA → 4 (taxa do tipo da venda)', () => {
    expect(percentualCorretorDaVenda({ tipo_corretor: 'externo' }, perfilInterno)).toBe(4)
  })

  it('cadastro externo + venda INTERNA → 2,5', () => {
    expect(percentualCorretorDaVenda({ tipo_corretor: 'interno' }, { tipo_corretor: 'externo' })).toBe(2.5)
  })

  it('percentual negociado do PERFIL vale só pra venda do mesmo tipo', () => {
    const perfilNegociado = { tipo_corretor: 'interno', percentual_corretor: 3 }
    expect(percentualCorretorDaVenda({ tipo_corretor: 'interno' }, perfilNegociado)).toBe(3)
    // venda externa NÃO herda o 3% negociado do cadastro interno
    expect(percentualCorretorDaVenda({ tipo_corretor: 'externo' }, perfilNegociado)).toBe(4)
  })

  it('percentual snapshotado NA VENDA vence tudo', () => {
    expect(percentualCorretorDaVenda({ tipo_corretor: 'externo', percentual_corretor: 5 }, perfilInterno)).toBe(5)
  })

  it('venda sem tipo → herda o tipo do perfil; sem nada → externo (4)', () => {
    expect(percentualCorretorDaVenda({}, perfilInterno)).toBe(2.5)
    expect(percentualCorretorDaVenda({}, null)).toBe(4)
  })
})
