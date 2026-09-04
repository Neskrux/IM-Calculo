import { describe, it, expect } from 'vitest'
import {
  somarComissao, isPago, isPendente, calcularComissaoPagamentoCompleto,
  taxaCoordenadoraDaVenda, taxaCoordenadoraPorCutover, CUTOVER_TAXA_COORDENADORA,
  fatiaCargoDoPagamento,
  percentualCorretorDaVenda,
  contarVendas,
  isVendaAtiva,
  ehBaixaFalsaDeDistrato,
  comissaoHeaderVenda,
  coordenadoraDoUsuario,
  papeisDisponiveis,
  vendasDaCoordenacao,
  resumoCoordenacao,
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

// ─────────────────────────────────────────────────────────────────────────────
// Régua única das telas do corretor + cura de distrato
// Spec: docs/specs/2026-08-28-spec-regua-unica-telas-distrato.md
// ─────────────────────────────────────────────────────────────────────────────

describe('contarVendas (régua única de contagem — D2)', () => {
  const vendas = [
    { status: 'pago', excluido: false },
    { status: 'pendente', excluido: null },
    { status: 'distrato', excluido: false },
    { status: 'distrato', excluido: false },
    { status: 'pago', excluido: true },      // soft-deletada: fora de tudo
  ]
  it('separa ativas, distratos e total visível', () => {
    expect(contarVendas(vendas)).toEqual({ ativas: 2, distratos: 2, total: 4 })
  })
  it('lista vazia → tudo zero', () => {
    expect(contarVendas([])).toEqual({ ativas: 0, distratos: 0, total: 0 })
  })
  it('venda sem status conta como ativa (não some do painel)', () => {
    expect(contarVendas([{ excluido: false }]).ativas).toBe(1)
  })
})

describe('ehBaixaFalsaDeDistrato (régua física da cura — D4)', () => {
  const distratada = { status: 'distrato', situacao_contrato: '3', data_distrato: '2026-08-25' }
  it('paga com VENCIMENTO após o distrato = falsa (caso 1002 D)', () => {
    expect(ehBaixaFalsaDeDistrato(
      { status: 'pago', data_prevista: '2027-08-10', data_pagamento: '2026-08-25' }, distratada
    )).toBe(true)
  })
  it('paga com vencimento até a data do distrato = dinheiro real, preserva', () => {
    expect(ehBaixaFalsaDeDistrato(
      { status: 'pago', data_prevista: '2026-08-10', data_pagamento: '2026-08-11' }, distratada
    )).toBe(false)
  })
  it('data_pagamento NÃO decide (a baixa em massa reescreve a data das legítimas)', () => {
    expect(ehBaixaFalsaDeDistrato(
      { status: 'pago', data_prevista: '2026-07-10', data_pagamento: '2026-08-25' }, distratada
    )).toBe(false)
  })
  it('parcela futura paga ANTES do distrato = antecipação real, preserva (lição 412 B)', () => {
    expect(ehBaixaFalsaDeDistrato(
      { status: 'pago', data_prevista: '2027-01-10', data_pagamento: '2026-05-02' }, distratada
    )).toBe(false)
  })
  it('aceita venda com situacao_contrato=3 antes do status=distrato (janela do sync)', () => {
    expect(ehBaixaFalsaDeDistrato(
      { status: 'pago', data_prevista: '2027-08-10', data_pagamento: '2026-08-25' },
      { status: 'pago', situacao_contrato: '3', data_distrato: '2026-08-25' }
    )).toBe(true)
  })
  it('venda ativa nunca tem baixa falsa por esta régua', () => {
    expect(ehBaixaFalsaDeDistrato(
      { status: 'pago', data_prevista: '2030-01-10' }, { status: 'pago' }
    )).toBe(false)
  })
  it('distrato sem data_distrato → false (S6 do reconciliador cobre essa janela)', () => {
    expect(ehBaixaFalsaDeDistrato(
      { status: 'pago', data_prevista: '2030-01-10' }, { status: 'distrato', data_distrato: null }
    )).toBe(false)
  })
  it('parcela pendente/cancelada não é baixa', () => {
    expect(ehBaixaFalsaDeDistrato({ status: 'pendente', data_prevista: '2030-01-10' }, distratada)).toBe(false)
    expect(ehBaixaFalsaDeDistrato({ status: 'cancelado', data_prevista: '2030-01-10' }, distratada)).toBe(false)
  })
})

describe('comissaoHeaderVenda (header do PDF = mesma régua das linhas — D6)', () => {
  // calcPorCargo injetado: devolve a decomposição por cargo de uma parcela
  const calcPorCargo = (pag) => [
    { nome_cargo: 'Corretor', valor: (parseFloat(pag.comissao_gerada) || 0) * 4 / 7 },
    { nome_cargo: 'Ferretti Consultoria', valor: (parseFloat(pag.comissao_gerada) || 0) * 1 / 7 },
  ]
  const pags = [
    { status: 'pago', comissao_gerada: 70 },
    { status: 'pendente', comissao_gerada: 35 },
    { status: 'cancelado', comissao_gerada: 999 },  // nunca entra
  ]
  it('filtro de cargo → soma a fatia DAQUELE cargo (não o total)', () => {
    const r = comissaoHeaderVenda(pags, { cargoId: 'Corretor', mostrarTotal: false }, calcPorCargo)
    expect(r.valor).toBeCloseTo((70 + 35) * 4 / 7, 2)
    expect(r.rotulo).toBe('Comissão (Corretor)')
  })
  it('filtro Total → soma comissao_gerada e ROTULA como total de todos os cargos', () => {
    const r = comissaoHeaderVenda(pags, { cargoId: '__total__', mostrarTotal: true }, calcPorCargo)
    expect(r.valor).toBeCloseTo(105, 2)
    expect(r.rotulo).toBe('Comissão total (todos os cargos)')
  })
  it('sem filtro de cargo → total rotulado', () => {
    const r = comissaoHeaderVenda(pags, { cargoId: '', mostrarTotal: false }, calcPorCargo)
    expect(r.valor).toBeCloseTo(105, 2)
    expect(r.rotulo).toBe('Comissão total (todos os cargos)')
  })
  it('parcela cancelada nunca infla o header', () => {
    const r = comissaoHeaderVenda(pags, { cargoId: 'Corretor', mostrarTotal: false }, calcPorCargo)
    expect(r.valor).toBeLessThan(999 * 4 / 7)
  })
})

describe('somarComissao é agnóstica a status de venda (o recorte é de quem chama)', () => {
  it('soma o que recebe e ignora canceladas — nunca olha a venda', () => {
    const pagos = [
      { status: 'pago', comissao_gerada: 100 },
      { status: 'pago', comissao_gerada: 50 },
      { status: 'cancelado', comissao_gerada: 77 }, // baixa falsa já curada
    ]
    expect(somarComissao(pagos.filter(isPago))).toBeCloseTo(150, 2)
    expect(somarComissao(pagos)).toBeCloseTo(150, 2)
  })
})

describe('isVendaAtiva — o recorte das telas do corretor (decisão 2026-08-28)', () => {
  it('distratada e excluída ficam FORA; ativa entra', () => {
    expect(isVendaAtiva({ status: 'pago', excluido: false })).toBe(true)
    expect(isVendaAtiva({ status: 'pendente', excluido: null })).toBe(true)
    expect(isVendaAtiva({ status: 'distrato', excluido: false })).toBe(false)
    expect(isVendaAtiva({ status: 'pago', excluido: true })).toBe(false)
  })
  it('o VGV exibido e a comissão exibida usam o MESMO recorte (o teste dos 4%)', () => {
    // Caso real: VGV com distratos 12.194.701,91 → 4% = 487.788,08, mas a comissão
    // exibida era 390.240,58 (= 4% de 9.756.014,26, só ativas). Quem conferisse não fechava.
    const vendas = [
      { id: 'a', status: 'pago', excluido: false, valor_venda: 9756014.26 },
      { id: 'b', status: 'distrato', excluido: false, valor_venda: 2438687.65 },
    ]
    const vgvExibido = vendas.filter(isVendaAtiva).reduce((s, v) => s + v.valor_venda, 0)
    expect(vgvExibido).toBeCloseTo(9756014.26, 2)
    expect(vgvExibido * 0.04).toBeCloseTo(390240.57, 2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Papel COORDENADOR na conta do corretor (Pires, Carolina, Jessica).
// Spec: docs/specs/2026-09-04-spec-papel-coordenador.md
//
// Os três acumulam papel: corretor (carteira própria) + coordenador (vendas
// direcionadas via vendas.coordenadora_id). UM login por pessoa; o papel troca na
// tela. O vínculo pessoa→coordenação é coordenadoras.usuario_id (migration 030/031).
// ─────────────────────────────────────────────────────────────────────────────

const CAROL = {
  id: 'co-carol', nome: 'Carol', ativo: true,
  usuario_id: 'u-carolina', percentual_padrao: 0.5,
}
const JESSICA = {
  id: 'co-jessica', nome: 'Jessica', ativo: true,
  usuario_id: 'u-jessica', percentual_padrao: 1.0,
}
const PIRES_COORD = {
  id: 'co-pires', nome: 'Pires', ativo: true,
  usuario_id: 'u-pires', percentual_padrao: 0.5,
}
const COORDS = [CAROL, JESSICA, PIRES_COORD]

// Cargo Coordenadora só existe pra venda EXTERNA (verificado em produção: 0,5%,
// num único empreendimento). Venda interna não tem coordenadora.
const CARGOS_EXT = [
  { nome_cargo: 'Corretor', tipo_corretor: 'externo', percentual: 4 },
  { nome_cargo: 'Coordenadora', tipo_corretor: 'externo', percentual: 0.5 },
  { nome_cargo: 'Nohros', tipo_corretor: 'externo', percentual: 0.5 },
]

describe('coordenadoraDoUsuario (o vínculo que liga a pessoa ao papel)', () => {
  it('usuário com linha ativa devolve a linha', () => {
    expect(coordenadoraDoUsuario({ id: 'u-carolina' }, COORDS)).toBe(CAROL)
  })

  it('corretor sem linha em coordenadoras devolve null', () => {
    expect(coordenadoraDoUsuario({ id: 'u-qualquer' }, COORDS)).toBeNull()
  })

  it('linha INATIVA não vira papel', () => {
    const inativa = [{ ...CAROL, ativo: false }]
    expect(coordenadoraDoUsuario({ id: 'u-carolina' }, inativa)).toBeNull()
  })

  it('compara id como string dos dois lados (id do banco vs id do perfil)', () => {
    expect(coordenadoraDoUsuario({ id: 7 }, [{ ...CAROL, usuario_id: '7' }])).toBeTruthy()
  })

  it('perfil nulo ou lista vazia devolve null, sem lançar', () => {
    expect(coordenadoraDoUsuario(null, COORDS)).toBeNull()
    expect(coordenadoraDoUsuario({ id: 'u-carolina' }, [])).toBeNull()
    expect(coordenadoraDoUsuario({ id: 'u-carolina' }, undefined)).toBeNull()
  })
})

describe('papeisDisponiveis (um login, dois papéis)', () => {
  it('corretor comum tem só o papel corretor', () => {
    expect(papeisDisponiveis({ id: 'u-qualquer' }, COORDS)).toEqual(['corretor'])
  })

  it('quem coordena acumula os dois — corretor sempre primeiro (default)', () => {
    expect(papeisDisponiveis({ id: 'u-jessica' }, COORDS)).toEqual(['corretor', 'coordenacao'])
  })

  it('Pires sem linha ainda: só corretor (papel não se inventa)', () => {
    expect(papeisDisponiveis({ id: 'u-pires' }, [CAROL, JESSICA])).toEqual(['corretor'])
  })
})

describe('vendasDaCoordenacao (escopo do papel de coordenação)', () => {
  const vendas = [
    { id: 'v1', corretor_id: 'u-outro', coordenadora_id: 'co-carol', status: 'pago', excluido: false },
    { id: 'v2', corretor_id: 'u-outro2', coordenadora_id: 'co-carol', status: 'pendente', excluido: false },
    // venda que a PRÓPRIA Carol vendeu: não entra no papel de coordenação
    { id: 'v3', corretor_id: 'u-carolina', coordenadora_id: 'co-carol', status: 'pago', excluido: false },
    { id: 'v4', corretor_id: 'u-outro', coordenadora_id: 'co-carol', status: 'distrato', excluido: false },
    { id: 'v5', corretor_id: 'u-outro', coordenadora_id: 'co-carol', status: 'pago', excluido: true },
    { id: 'v6', corretor_id: 'u-outro', coordenadora_id: 'co-jessica', status: 'pago', excluido: false },
  ]

  it('traz só as direcionadas a ela', () => {
    expect(vendasDaCoordenacao(vendas, CAROL).map(v => v.id)).toEqual(['v1', 'v2'])
  })

  it('exclui a venda que ela mesma vendeu (regra da migration 031)', () => {
    expect(vendasDaCoordenacao(vendas, CAROL).some(v => v.id === 'v3')).toBe(false)
  })

  it('exclui distratada e excluída — mesma régua única das telas do corretor', () => {
    const ids = vendasDaCoordenacao(vendas, CAROL).map(v => v.id)
    expect(ids).not.toContain('v4')
    expect(ids).not.toContain('v5')
  })

  it('não vaza a coordenação de outra pessoa', () => {
    expect(vendasDaCoordenacao(vendas, JESSICA).map(v => v.id)).toEqual(['v6'])
  })

  it('sem coordenadora ou sem vendas devolve lista vazia', () => {
    expect(vendasDaCoordenacao(vendas, null)).toEqual([])
    expect(vendasDaCoordenacao(null, CAROL)).toEqual([])
  })
})

describe('resumoCoordenacao (o número do coordenador + macro neutro)', () => {
  const vDirecionada = {
    id: 'v1', corretor_id: 'u-outro', coordenadora_id: 'co-carol',
    tipo_corretor: 'externo', status: 'pago', excluido: false, coordenadora_taxa: 0.5,
  }
  const parcela = (over = {}) => ({
    venda_id: 'v1', status: 'pago', valor: 1000,
    comissao_gerada: 700, percentual_comissao_total: 7,
    data_prevista: '2026-05-20', data_pagamento: '2026-05-20', ...over,
  })
  const base = { coordenadora: CAROL, cargos: CARGOS_EXT, coordenadoras: COORDS }

  it('fatia paga = comissao_gerada × taxa/percentual_total (0,5/7 de 700 = 50)', () => {
    const r = resumoCoordenacao({ ...base, vendas: [vDirecionada], pagamentos: [parcela()] })
    expect(r.fatiaPaga).toBeCloseTo(50, 2)
    expect(r.fatiaPendente).toBeCloseTo(0, 2)
  })

  it('snapshot da venda vence a taxa vigente (contrato pré-cutover a 1,0%)', () => {
    const preCutover = { ...vDirecionada, coordenadora_taxa: 1 }
    const r = resumoCoordenacao({ ...base, vendas: [preCutover], pagamentos: [parcela()] })
    // 700 × 1/7 = 100 (não 50, que seria a taxa vigente da Carol)
    expect(r.fatiaPaga).toBeCloseTo(100, 2)
  })

  it('sem snapshot cai na taxa vigente da coordenadora (Jessica = 1,0%)', () => {
    const semSnap = { ...vDirecionada, coordenadora_id: 'co-jessica', coordenadora_taxa: null }
    const r = resumoCoordenacao({
      ...base, coordenadora: JESSICA, vendas: [semSnap], pagamentos: [parcela()],
    })
    expect(r.fatiaPaga).toBeCloseTo(100, 2)
  })

  it('parcela cancelada NUNCA infla nenhum número', () => {
    const r = resumoCoordenacao({
      ...base, vendas: [vDirecionada],
      pagamentos: [parcela(), parcela({ status: 'cancelado', comissao_gerada: 7000 })],
    })
    expect(r.fatiaPaga).toBeCloseTo(50, 2)
    expect(r.nParcelasPagas).toBe(1)
  })

  it('pagamento de venda fora do escopo é ignorado', () => {
    const r = resumoCoordenacao({
      ...base, vendas: [vDirecionada],
      pagamentos: [parcela(), parcela({ venda_id: 'v-outra', comissao_gerada: 7000 })],
    })
    expect(r.fatiaPaga).toBeCloseTo(50, 2)
  })

  it('pendente entra na fatia a receber, nunca na recebida', () => {
    const r = resumoCoordenacao({
      ...base, vendas: [vDirecionada],
      pagamentos: [parcela({ status: 'pendente', data_pagamento: null })],
    })
    expect(r.fatiaPaga).toBeCloseTo(0, 2)
    expect(r.fatiaPendente).toBeCloseTo(50, 2)
  })

  it('CARTEIRA VAZIA (caso Pires): vazio=true, zeros, e não lança', () => {
    const r = resumoCoordenacao({ ...base, coordenadora: PIRES_COORD, vendas: [], pagamentos: [] })
    expect(r.vazio).toBe(true)
    expect(r.nVendas).toBe(0)
    expect(r.fatiaPaga).toBe(0)
    expect(r.fatiaPendente).toBe(0)
    expect(r.pctRecebido).toBe(0)
    expect(r.serieMensal).toEqual([])
  })

  it('com venda no escopo, vazio=false', () => {
    const r = resumoCoordenacao({ ...base, vendas: [vDirecionada], pagamentos: [parcela()] })
    expect(r.vazio).toBe(false)
    expect(r.nVendas).toBe(1)
  })

  it('macro neutro usa valor de PARCELA, nunca comissão de outro cargo', () => {
    const r = resumoCoordenacao({
      ...base, vendas: [vDirecionada],
      pagamentos: [
        parcela(),
        parcela({ status: 'pendente', valor: 3000, data_pagamento: null, data_prevista: '2099-01-20' }),
      ],
    })
    expect(r.nParcelasPagas).toBe(1)
    expect(r.nParcelasPendentes).toBe(1)
    expect(r.pctRecebido).toBeCloseTo(25, 2) // 1000 pago de 4000 previstos
  })

  it('vencida em aberto = pendente com data_prevista no passado', () => {
    const r = resumoCoordenacao({
      ...base, vendas: [vDirecionada], hoje: '2026-06-01',
      pagamentos: [
        parcela({ status: 'pendente', data_pagamento: null, data_prevista: '2026-05-20', valor: 1000 }),
        parcela({ status: 'pendente', data_pagamento: null, data_prevista: '2099-01-20', valor: 1000 }),
      ],
    })
    expect(r.nVencidasAbertas).toBe(1)
    expect(r.valorVencidoAberto).toBeCloseTo(1000, 2)
  })

  it('filtro por mês usa a data efetiva do pagamento', () => {
    const pags = [parcela({ data_pagamento: '2026-05-20' }), parcela({ data_pagamento: '2026-06-20' })]
    const r = resumoCoordenacao({ ...base, vendas: [vDirecionada], pagamentos: pags, mes: '2026-05' })
    expect(r.fatiaPaga).toBeCloseTo(50, 2)
  })

  it('série mensal agrega a fatia paga por mês, mais recente primeiro', () => {
    const pags = [
      parcela({ data_pagamento: '2026-05-20' }),
      parcela({ data_pagamento: '2026-06-20' }),
      parcela({ data_pagamento: '2026-06-25' }),
    ]
    const r = resumoCoordenacao({ ...base, vendas: [vDirecionada], pagamentos: pags })
    expect(r.serieMensal[0][0]).toBe('2026-06')
    expect(r.serieMensal[0][1]).toBeCloseTo(100, 2)
    expect(r.serieMensal[1][0]).toBe('2026-05')
  })

  it('sem coordenadora devolve resumo vazio em vez de lançar', () => {
    const r = resumoCoordenacao({ ...base, coordenadora: null, vendas: [vDirecionada], pagamentos: [parcela()] })
    expect(r.vazio).toBe(true)
    expect(r.fatiaPaga).toBe(0)
  })
})
