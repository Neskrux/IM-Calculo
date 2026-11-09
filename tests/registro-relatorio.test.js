import { describe, it, expect } from 'vitest'
import { montarRegistroEmissao, caminhoPdfRelatorio, filtrosVisiveis, FILTROS_RELATORIO_INICIAIS } from '../src/utils/registroRelatorio'

describe('montarRegistroEmissao', () => {
  const base = {
    origem: 'admin',
    corretorId: 'c1',
    filtros: { cargoId: 'Corretor', status: 'todos' },
    totais: { total: 100.005, pago: 60, pendente: 40.005 },
    parcelas: [
      { id: 'p1', venda_id: 'v1', valor: '1000', comissao: 60, status: 'pago' },
      { id: 'p2', venda_id: 'v1', valor: 1000, comissao: 40.004, status: 'pendente' },
    ],
    pdfPath: 'c1/r.pdf',
    pdfSha256: 'abc',
  }

  it('grava os totais impressos arredondados a centavo', () => {
    const r = montarRegistroEmissao(base)
    expect(r.total).toBe(100.01)
    expect(r.pago).toBe(60)
    expect(r.pendente).toBe(40.01)
  })

  it('normaliza parcelas e conta', () => {
    const r = montarRegistroEmissao(base)
    expect(r.qtd_parcelas).toBe(2)
    expect(r.parcelas[0]).toEqual({ id: 'p1', venda_id: 'v1', valor: 1000, comissao: 60, status: 'pago' })
    expect(r.parcelas[1].comissao).toBe(40)
  })

  it('relatorio geral grava corretor_id null', () => {
    expect(montarRegistroEmissao({ ...base, corretorId: '' }).corretor_id).toBeNull()
  })

  it('copia os filtros (nao referencia o estado)', () => {
    const r = montarRegistroEmissao(base)
    base.filtros.cargoId = 'X'
    expect(r.filtros.cargoId).toBe('Corretor')
  })

  it('rejeita origem invalida e parcela sem id', () => {
    expect(() => montarRegistroEmissao({ ...base, origem: 'x' })).toThrow()
    expect(() => montarRegistroEmissao({ ...base, parcelas: [{ valor: 1 }] })).toThrow()
  })
})

describe('caminhoPdfRelatorio', () => {
  it('pasta raiz = dono (chave da RLS do bucket)', () => {
    expect(caminhoPdfRelatorio('c1', 'r1')).toBe('c1/r1.pdf')
    expect(caminhoPdfRelatorio(null, 'r1')).toBe('geral/r1.pdf')
  })
})

describe('filtrosVisiveis', () => {
  const nomes = { corretores: [{ id: 'c1', nome: 'Ana' }], empreendimentos: [{ id: 'e1', nome: 'Figueira' }] }

  it('mostra cargo e empreendimento por extenso', () => {
    const f = filtrosVisiveis({ ...FILTROS_RELATORIO_INICIAIS, cargoId: '__total__', empreendimentoId: 'e1', corretorId: 'c1' }, nomes)
    expect(f.cargo).toBe('Total (todos os cargos somados)')
    expect(f.empreendimento).toBe('Figueira')
    expect(f.corretor).toBe('Ana')
    expect(f.alterado).toBe(true)
  })

  it('estado inicial nao conta como alterado', () => {
    const f = filtrosVisiveis(FILTROS_RELATORIO_INICIAIS, nomes)
    expect(f.cargo).toBe('Corretor')
    expect(f.empreendimento).toBe('Todos')
    expect(f.alterado).toBe(false)
  })
})
