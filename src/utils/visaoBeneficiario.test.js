// Visão do BENEFICIÁRIO v2 (mesmo formato da Coordenação).
// Spec: docs/specs/2026-08-20-spec-visao-beneficiario.md (§ v2, 2026-09-25)
import { describe, it, expect } from 'vitest'
import {
  pctCargoDaVenda,
  resumoFatiaCargo,
  vendasDoBeneficiario,
  resumoPorVendaDoCargo,
  recorteRelatorioCargo,
  fatiaCargoDoPagamento,
} from './comissaoCalculator'

const CARGOS = [
  { nome_cargo: 'Corretor', tipo_corretor: 'externo', percentual: 4 },
  { nome_cargo: 'Nohros', tipo_corretor: 'externo', percentual: 0.5 },
  { nome_cargo: 'Coordenadora', tipo_corretor: 'externo', percentual: 0.5 },
  { nome_cargo: 'Corretor', tipo_corretor: 'interno', percentual: 2.5 },
  { nome_cargo: 'Nohros', tipo_corretor: 'interno', percentual: 1.25 },
]
const vExt = { id: 'v1', unidade: '101 A', empreendimento_id: 'e1', tipo_corretor: 'externo', status: 'pendente', excluido: false }
const vInt = { id: 'v2', unidade: '202 B', empreendimento_id: 'e2', tipo_corretor: 'interno', status: 'pendente', excluido: false }
// parcela externa: 700 de comissão total a 7% → Nohros = 700 × 0,5/7 = 50
const parc = (over = {}) => ({
  id: 'p1', venda_id: 'v1', tipo: 'parcela_entrada', numero_parcela: 1, status: 'pago', valor: 1000,
  comissao_gerada: 700, percentual_comissao_total: 7,
  data_prevista: '2026-05-20', data_pagamento: '2026-05-21', ...over,
})
// parcela interna: 650 a 6,5% → Nohros = 650 × 1,25/6,5 = 125
const parcInt = (over = {}) => parc({ id: 'pi', venda_id: 'v2', comissao_gerada: 650, percentual_comissao_total: 6.5, ...over })
const base = { cargo: 'Nohros', cargos: CARGOS, coordenadoras: [] }

describe('pctCargoDaVenda (o % do cargo naquela venda)', () => {
  it('o TIPO da venda decide a tabela: Nohros 0,5 externo / 1,25 interno', () => {
    expect(pctCargoDaVenda(vExt, 'Nohros', CARGOS)).toBe(0.5)
    expect(pctCargoDaVenda(vInt, 'Nohros', CARGOS)).toBe(1.25)
  })

  it('cargo que não existe no tipo da venda vale 0', () => {
    expect(pctCargoDaVenda(vInt, 'Coordenadora', CARGOS)).toBe(0)
  })

  it('Coordenadora usa a taxa snapshotada da venda', () => {
    const v = { ...vExt, coordenadora_id: 'co1', coordenadora_taxa: 1 }
    expect(pctCargoDaVenda(v, 'Coordenadora', CARGOS, [])).toBe(1)
  })

  it('Coordenadora sem coordenadora na venda vale 0', () => {
    expect(pctCargoDaVenda(vExt, 'Coordenadora', CARGOS, [])).toBe(0)
  })

  it('o % vem da tabela do EMPREENDIMENTO da venda, nunca de outro', () => {
    const cargosDoisEmps = [
      { empreendimento_id: 'e9', nome_cargo: 'Nohros', tipo_corretor: 'externo', percentual: 0.9 },
      { empreendimento_id: 'e1', nome_cargo: 'Nohros', tipo_corretor: 'externo', percentual: 0.5 },
      { empreendimento_id: 'e1', nome_cargo: 'Corretor', tipo_corretor: 'externo', percentual: 4 },
    ]
    expect(pctCargoDaVenda(vExt, 'Nohros', cargosDoisEmps)).toBe(0.5)
    const semPctTotal = parc({ comissao_gerada: 450, percentual_comissao_total: null }) // e1 externo: 0,5 + 4 = 4,5
    expect(fatiaCargoDoPagamento(semPctTotal, vExt, 'Nohros', cargosDoisEmps)).toBeCloseTo(50, 2)
  })

  it('bate com a fatia: fatia = comissão total × pct/pct_total', () => {
    const p = parc()
    expect(fatiaCargoDoPagamento(p, vExt, 'Nohros', CARGOS)).toBeCloseTo(700 * pctCargoDaVenda(vExt, 'Nohros', CARGOS) / 7, 6)
  })
})

describe('vendasDoBeneficiario (escopo: só vendas ativas)', () => {
  it('mantém a ativa e tira distrato, excluída, situação 3 e data de distrato', () => {
    const vendas = [
      vExt,
      { ...vExt, id: 'd1', status: 'distrato' },
      { ...vExt, id: 'd2', excluido: true },
      { ...vExt, id: 'd3', situacao_contrato: '3' }, // limbo: status ainda não virou distrato
      { ...vExt, id: 'd4', data_distrato: '2026-05-10' },
    ]
    expect(vendasDoBeneficiario(vendas).map(v => v.id)).toEqual(['v1'])
  })

  it('lista vazia ou ausente não lança', () => {
    expect(vendasDoBeneficiario()).toEqual([])
  })
})

describe('resumoFatiaCargo (o número do painel, genérico por cargo)', () => {
  it('fatia paga e a receber do cargo, pelo tipo de cada venda', () => {
    const r = resumoFatiaCargo({
      ...base, vendas: [vExt, vInt],
      pagamentos: [parc(), parcInt({ status: 'pendente', data_pagamento: null })],
    })
    expect(r.fatiaPaga).toBeCloseTo(50, 2)
    expect(r.fatiaPendente).toBeCloseTo(125, 2)
    expect(r.nVendas).toBe(2)
    expect(r.nParcelasPagas).toBe(1)
    expect(r.nParcelasPendentes).toBe(1)
  })

  it('cancelada NUNCA infla nenhum número', () => {
    const r = resumoFatiaCargo({
      ...base, vendas: [vExt],
      pagamentos: [parc(), parc({ id: 'px', status: 'cancelado', comissao_gerada: 70000, valor: 100000 })],
    })
    expect(r.fatiaPaga).toBeCloseTo(50, 2)
    expect(r.pctRecebido).toBeCloseTo(100, 2)
  })

  it('parcela de venda fora do escopo é ignorada', () => {
    const r = resumoFatiaCargo({ ...base, vendas: [vExt], pagamentos: [parc(), parcInt()] })
    expect(r.fatiaPaga).toBeCloseTo(50, 2)
  })

  it('o mês recorta a fatia (pela data efetiva) e a série mensal usa a data de pagamento', () => {
    const r = resumoFatiaCargo({
      ...base, vendas: [vExt], mes: '2026-06',
      pagamentos: [parc(), parc({ id: 'p2', data_prevista: '2026-06-20', data_pagamento: '2026-06-19' })],
    })
    expect(r.fatiaPaga).toBeCloseTo(50, 2)
    expect(r.serieMensal.map(([ym]) => ym)).toEqual(['2026-06', '2026-05'])
    expect(r.serieMensal[0][1]).toBeCloseTo(50, 2)
  })

  it('vencida em aberto = pendente com vencimento antes de hoje (valor de PARCELA)', () => {
    const r = resumoFatiaCargo({
      ...base, vendas: [vExt], hoje: '2026-09-25',
      pagamentos: [parc({ status: 'pendente', data_pagamento: null, data_prevista: '2026-09-20' })],
    })
    expect(r.nVencidasAbertas).toBe(1)
    expect(r.valorVencidoAberto).toBe(1000)
  })

  it('sem vendas: vazio=true e zeros, sem lançar', () => {
    const r = resumoFatiaCargo({ ...base, vendas: [], pagamentos: [] })
    expect(r.vazio).toBe(true)
    expect(r.fatiaPaga).toBe(0)
    expect(r.serieMensal).toEqual([])
  })
})

describe('resumoPorVendaDoCargo (lista de vendas do beneficiário)', () => {
  it('uma linha por venda com fatia do cargo, pró-soluto das parcelas e % recebido', () => {
    const linhas = resumoPorVendaDoCargo({
      ...base, vendas: [vExt],
      pagamentos: [parc(), parc({ id: 'p2', status: 'pendente', data_pagamento: null })],
    })
    expect(linhas).toHaveLength(1)
    const l = linhas[0]
    expect(l.venda.id).toBe('v1')
    expect(l.pctCargo).toBe(0.5)
    expect(l.valorParcelas).toBe(2000)
    expect(l.valorRecebido).toBe(1000)
    expect(l.pctRecebido).toBeCloseTo(50, 2)
    expect(l.fatiaPaga).toBeCloseTo(50, 2)
    expect(l.fatiaPendente).toBeCloseTo(50, 2)
    expect(l.fatiaTotal).toBeCloseTo(100, 2)
    expect(l.nParcelas).toBe(2)
    expect(l.nPagas).toBe(1)
  })

  it('cancelada não entra em nada da venda', () => {
    const [l] = resumoPorVendaDoCargo({
      ...base, vendas: [vExt], pagamentos: [parc(), parc({ id: 'px', status: 'cancelado' })],
    })
    expect(l.nParcelas).toBe(1)
    expect(l.valorParcelas).toBe(1000)
  })

  it('venda sem parcela aparece zerada (não some da lista)', () => {
    const [l] = resumoPorVendaDoCargo({ ...base, vendas: [vExt], pagamentos: [] })
    expect(l.nParcelas).toBe(0)
    expect(l.pctRecebido).toBe(0)
  })

  it('ordena por unidade em ordem natural (101 antes de 1002)', () => {
    const linhas = resumoPorVendaDoCargo({
      ...base, pagamentos: [],
      vendas: [{ ...vExt, id: 'a', unidade: '1002 B' }, { ...vExt, id: 'b', unidade: '101 A' }],
    })
    expect(linhas.map(l => l.venda.unidade)).toEqual(['101 A', '1002 B'])
  })

  it('NUNCA devolve comissão total nem fatia de outro cargo', () => {
    const [l] = resumoPorVendaDoCargo({ ...base, vendas: [vExt], pagamentos: [parc()] })
    expect(Object.keys(l).sort()).toEqual([
      'fatiaPaga', 'fatiaPendente', 'fatiaTotal', 'nPagas', 'nParcelas', 'pctCargo',
      'pctRecebido', 'valorParcelas', 'valorRecebido', 'venda',
    ])
  })
})

describe('recorteRelatorioCargo (Pagamentos, Relatórios e PDF usam o MESMO recorte)', () => {
  const pags = [
    parc({ id: 'a' }), // pago em 21/05
    parc({ id: 'b', status: 'pendente', data_pagamento: null, data_prevista: '2026-07-20' }),
    parc({ id: 'c', status: 'cancelado' }),
    parcInt({ id: 'd', data_pagamento: '2026-06-10', tipo: 'balao' }),
  ]

  it('sem filtro: todas as parcelas ativas, com a fatia de cada uma', () => {
    const r = recorteRelatorioCargo({ ...base, vendas: [vExt, vInt], pagamentos: pags })
    expect(r.linhas.map(l => l.pagamento.id)).toEqual(['a', 'd', 'b'])
    expect(r.totais.fatiaPaga).toBeCloseTo(175, 2)
    expect(r.totais.fatiaPendente).toBeCloseTo(50, 2)
    expect(r.totais.fatiaTotal).toBeCloseTo(225, 2)
    expect(r.totais.nParcelas).toBe(3)
    expect(r.totais.nVendas).toBe(2)
  })

  it('status pago tira as pendentes', () => {
    const r = recorteRelatorioCargo({ ...base, vendas: [vExt, vInt], pagamentos: pags, filtros: { status: 'pago' } })
    expect(r.linhas.map(l => l.pagamento.id)).toEqual(['a', 'd'])
    expect(r.totais.fatiaPendente).toBe(0)
  })

  it('período pela data efetiva: paga pela data de pagamento, pendente pelo vencimento', () => {
    const r = recorteRelatorioCargo({
      ...base, vendas: [vExt, vInt], pagamentos: pags,
      filtros: { dataInicio: '2026-06-01', dataFim: '2026-07-31' },
    })
    expect(r.linhas.map(l => l.pagamento.id)).toEqual(['d', 'b'])
  })

  it('filtra por empreendimento e por tipo de parcela', () => {
    const porEmp = recorteRelatorioCargo({ ...base, vendas: [vExt, vInt], pagamentos: pags, filtros: { empreendimentoId: 'e2' } })
    expect(porEmp.linhas.map(l => l.pagamento.id)).toEqual(['d'])
    const porTipo = recorteRelatorioCargo({ ...base, vendas: [vExt, vInt], pagamentos: pags, filtros: { tipoParcela: 'balao' } })
    expect(porTipo.linhas.map(l => l.pagamento.id)).toEqual(['d'])
  })

  it('parcela de venda fora do escopo não entra', () => {
    const r = recorteRelatorioCargo({ ...base, vendas: [vExt], pagamentos: pags })
    expect(r.linhas.map(l => l.pagamento.id)).toEqual(['a', 'b'])
  })
})
