import { describe, it, expect } from 'vitest'
import {
  somarComissao, isPago, isPendente, calcularComissaoPagamentoCompleto,
  taxaCoordenadoraDaVenda, taxaCoordenadoraPorCutover, CUTOVER_TAXA_COORDENADORA,
  fatiaCargoDoPagamento,
  percentualCorretorDaVenda,
} from './comissaoCalculator'

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

// Taxa da coordenadora por venda (relatório coordenadoras):
//  Dado uma venda direcionada a uma coordenadora
//  Quando ela tem taxa snapshotada (vendas.coordenadora_taxa, migration 040)
//  Então o relatório usa o snapshot — a taxa vigente da coordenadora nunca
//  reescreve mês antigo (mesma filosofia do fator_comissao_aplicado).
describe('taxaCoordenadoraDaVenda', () => {
  const coordenadoras = [
    { id: 'c1', nome: 'Carol', percentual_padrao: 0.5 },
    { id: 'c2', nome: 'Jessica', percentual_padrao: 1 },
  ]

  it('snapshot da venda vence a taxa vigente da coordenadora', () => {
    const venda = { coordenadora_id: 'c1', coordenadora_taxa: 1 } // contrato pré-cutover
    expect(taxaCoordenadoraDaVenda(venda, coordenadoras)).toBe(1)
  })

  it('sem snapshot cai na taxa negociada vigente (percentual_padrao)', () => {
    expect(taxaCoordenadoraDaVenda({ coordenadora_id: 'c2' }, coordenadoras)).toBe(1)
    expect(taxaCoordenadoraDaVenda({ coordenadora_id: 'c1' }, coordenadoras)).toBe(0.5)
  })

  it('venda sem coordenadora → null (relatório usa o percentual do cargo)', () => {
    expect(taxaCoordenadoraDaVenda({ coordenadora_id: null }, coordenadoras)).toBeNull()
    expect(taxaCoordenadoraDaVenda(null, coordenadoras)).toBeNull()
  })

  it('snapshot inválido/zerado não vale — cai no fallback', () => {
    expect(taxaCoordenadoraDaVenda({ coordenadora_id: 'c1', coordenadora_taxa: 0 }, coordenadoras)).toBe(0.5)
    expect(taxaCoordenadoraDaVenda({ coordenadora_id: 'c1', coordenadora_taxa: 'x' }, coordenadoras)).toBe(0.5)
  })

  it('coordenadora desconhecida sem snapshot → null', () => {
    expect(taxaCoordenadoraDaVenda({ coordenadora_id: 'c9' }, coordenadoras)).toBeNull()
  })
})

// Regra do cutover (fonte: repasse-mensal-coordenadora.mjs, aprovada pela gestão):
//  contrato assinado ANTES de 15/07/2025 → 1,0% · a partir de 15/07/2025 → 0,5%.
describe('taxaCoordenadoraPorCutover (regra do backfill)', () => {
  it('cutover é 2025-07-15', () => {
    expect(CUTOVER_TAXA_COORDENADORA).toBe('2025-07-15')
  })

  it('contrato antes do cutover → 1,0', () => {
    expect(taxaCoordenadoraPorCutover('2025-07-14')).toBe(1)
    expect(taxaCoordenadoraPorCutover('2024-12-01T00:00:00')).toBe(1)
  })

  it('contrato no dia do cutover ou depois → 0,5', () => {
    expect(taxaCoordenadoraPorCutover('2025-07-15')).toBe(0.5)
    expect(taxaCoordenadoraPorCutover('2026-08-01')).toBe(0.5)
  })

  it('sem data_venda → null (não chutar: vai pra revisão, nunca gravar)', () => {
    expect(taxaCoordenadoraPorCutover(null)).toBeNull()
    expect(taxaCoordenadoraPorCutover('')).toBeNull()
  })
})

// Visão do beneficiário (Nohros e afins): fatia de UM cargo por parcela.
//  Dado uma parcela com comissão total e o cargo do beneficiário
//  Então a fatia = comissao_gerada × (pct_cargo / pct_total), pelo TIPO da venda.
describe('fatiaCargoDoPagamento (visão beneficiário)', () => {
  const cargos = [
    { nome_cargo: 'Corretor', tipo_corretor: 'externo', percentual: 4 },
    { nome_cargo: 'Nohros', tipo_corretor: 'externo', percentual: 0.5 },
    { nome_cargo: 'Coordenadora', tipo_corretor: 'externo', percentual: 0.5 },
    { nome_cargo: 'Corretor', tipo_corretor: 'interno', percentual: 2.5 },
    { nome_cargo: 'Nohros', tipo_corretor: 'interno', percentual: 1.25 },
  ]
  const vendaExt = { id: 'v1', tipo_corretor: 'externo' }
  const vendaInt = { id: 'v2', tipo_corretor: 'interno' }

  it('externo: Nohros = comissao × 0,5/7', () => {
    const pag = { venda_id: 'v1', status: 'pago', comissao_gerada: 700, valor: 1000, percentual_comissao_total: 7 }
    expect(fatiaCargoDoPagamento(pag, vendaExt, 'Nohros', cargos)).toBeCloseTo(50, 2)
  })

  it('interno: Nohros = comissao × 1,25/6,5 (tipo DA VENDA decide a tabela)', () => {
    const pag = { venda_id: 'v2', status: 'pago', comissao_gerada: 650, valor: 1000, percentual_comissao_total: 6.5 }
    expect(fatiaCargoDoPagamento(pag, vendaInt, 'Nohros', cargos)).toBeCloseTo(125, 2)
  })

  it('sem snapshot de pct_total cai na soma dos cargos do tipo', () => {
    const pag = { venda_id: 'v1', status: 'pago', comissao_gerada: 450 } // externo: 4+0,5+0,5 = 5
    expect(fatiaCargoDoPagamento(pag, vendaExt, 'Nohros', cargos)).toBeCloseTo(45, 2)
  })

  it('parcela cancelada → 0 (nunca infla)', () => {
    const pag = { venda_id: 'v1', status: 'cancelado', comissao_gerada: 700, percentual_comissao_total: 7 }
    expect(fatiaCargoDoPagamento(pag, vendaExt, 'Nohros', cargos)).toBe(0)
  })

  it('cargo Coordenadora usa a taxa por venda (snapshot do cutover)', () => {
    const venda = { id: 'v1', tipo_corretor: 'externo', coordenadora_id: 'c1', coordenadora_taxa: 1 }
    const pag = { venda_id: 'v1', status: 'pago', comissao_gerada: 700, percentual_comissao_total: 7 }
    expect(fatiaCargoDoPagamento(pag, venda, 'Coordenadora', cargos, [])).toBeCloseTo(100, 2)
  })

  it('cargo Coordenadora em venda SEM coordenadora → 0', () => {
    const pag = { venda_id: 'v1', status: 'pago', comissao_gerada: 700, percentual_comissao_total: 7 }
    expect(fatiaCargoDoPagamento(pag, vendaExt, 'Coordenadora', cargos, [])).toBe(0)
  })

  it('cargo inexistente no tipo → 0', () => {
    const pag = { venda_id: 'v1', status: 'pago', comissao_gerada: 700, percentual_comissao_total: 7 }
    expect(fatiaCargoDoPagamento(pag, vendaExt, 'Inexistente', cargos)).toBe(0)
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
