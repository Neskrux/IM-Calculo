import { describe, it, expect } from 'vitest'
import { normalizar, soDigitos, casaBusca, filtrarBusca } from './searchUtils'

// Formaliza os casos que antes rodávamos ad-hoc. Cobre as 2 dores históricas
// de busca: ACENTO ("jo"→"João") e FORMATAÇÃO de CPF/telefone (com/sem máscara).

describe('normalizar', () => {
  it('remove acento e baixa caixa', () => {
    expect(normalizar('João')).toBe('joao')
    expect(normalizar('TRÊS')).toBe('tres')
    expect(normalizar('Conceição')).toBe('conceicao')
  })

  it('colapsa espaços e apara', () => {
    expect(normalizar('  Ana   Maria  ')).toBe('ana maria')
  })

  it('tolera null/undefined/número', () => {
    expect(normalizar(null)).toBe('')
    expect(normalizar(undefined)).toBe('')
    expect(normalizar(123)).toBe('123')
  })
})

describe('soDigitos', () => {
  it('extrai só dígitos de CPF/telefone com máscara', () => {
    expect(soDigitos('123.456.789-00')).toBe('12345678900')
    expect(soDigitos('(11) 98888-7777')).toBe('11988887777')
  })
})

describe('casaBusca', () => {
  const cliente = {
    nome_completo: 'João da Conceição',
    cpf: '123.456.789-00',
    telefone: '(11) 98888-7777',
  }
  const FIELDS = ['nome_completo', { key: 'cpf', tipo: 'numero' }, { key: 'telefone', tipo: 'numero' }]

  it('acha por trecho de nome ignorando acento e caixa', () => {
    expect(casaBusca(cliente, 'jo', FIELDS)).toBe(true)
    expect(casaBusca(cliente, 'JOAO', FIELDS)).toBe(true)
    expect(casaBusca(cliente, 'conceic', FIELDS)).toBe(true)
  })

  it('acha CPF digitado SEM máscara', () => {
    expect(casaBusca(cliente, '12345678900', FIELDS)).toBe(true)
    expect(casaBusca(cliente, '123456', FIELDS)).toBe(true)
  })

  it('acha CPF digitado COM máscara', () => {
    expect(casaBusca(cliente, '123.456', FIELDS)).toBe(true)
  })

  it('acha por telefone parcial em dígitos', () => {
    expect(casaBusca(cliente, '98888', FIELDS)).toBe(true)
  })

  it('não acha o que não existe', () => {
    expect(casaBusca(cliente, 'pedro', FIELDS)).toBe(false)
    expect(casaBusca(cliente, '00000000000', FIELDS)).toBe(false)
  })

  it('query vazia casa tudo', () => {
    expect(casaBusca(cliente, '', FIELDS)).toBe(true)
    expect(casaBusca(cliente, '   ', FIELDS)).toBe(true)
  })

  it('campo numero não casa com query de texto puro', () => {
    // 'abc' vira '' em soDigitos → campo numero não dispara
    expect(casaBusca({ cpf: '12345678900' }, 'abc', [{ key: 'cpf', tipo: 'numero' }])).toBe(false)
  })
})

describe('filtrarBusca', () => {
  const lista = [
    { id: 1, nome_completo: 'João Silva' },
    { id: 2, nome_completo: 'Maria Souza' },
    { id: 3, nome_completo: 'Joana Lima' },
  ]

  it('filtra mantendo a ordem original', () => {
    const r = filtrarBusca(lista, 'jo', ['nome_completo'])
    expect(r.map((x) => x.id)).toEqual([1, 3])
  })

  it('query vazia devolve a lista inteira (mesma referência de itens)', () => {
    expect(filtrarBusca(lista, '', ['nome_completo'])).toBe(lista)
  })
})
