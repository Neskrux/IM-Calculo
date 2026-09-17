import { describe, it, expect } from 'vitest'
import {
  ehEmailPlaceholder, ehEmailValido, senhaValida, SENHA_MIN,
  podeRedefinirSenha, podeCriarAcesso, acaoDeAcesso, motivoBloqueioAcesso,
} from './acessoUsuario'

// Casos reais que motivaram estes guardas (04/09/2026):
//  - Carolina: cadastro com email placeholder do sync, SEM conta de Auth → 'criar'
//  - Jessica e Pires: conta de Auth existente, nunca usada → 'trocar_senha'
//  - Até aqui a tela só oferecia 'criar'; quem já tinha conta ficava sem caminho.

const carolina = { tipo: 'corretor', tem_acesso_sistema: false, email: 'corretor.129@sync.local' }
const jessica = { tipo: 'corretor', tem_acesso_sistema: true, email: 'jessica@imincorporadora.com.br' }
const nohros = { tipo: 'beneficiario', tem_acesso_sistema: true, email: 'nohros@exemplo.com.br' }

describe('ehEmailPlaceholder', () => {
  it('reconhece os dois placeholders que o sync inventa', () => {
    expect(ehEmailPlaceholder('corretor.129@sync.local')).toBe(true)
    expect(ehEmailPlaceholder('x@placeholder.local')).toBe(true)
  })
  it('email real não é placeholder; caixa alta e espaço não enganam', () => {
    expect(ehEmailPlaceholder('carolina@imincorporadora.com.br')).toBe(false)
    expect(ehEmailPlaceholder('  CORRETOR.129@SYNC.LOCAL ')).toBe(true)
  })
  it('vazio/nulo não quebra', () => {
    expect(ehEmailPlaceholder(null)).toBe(false)
    expect(ehEmailPlaceholder('')).toBe(false)
  })
})

describe('ehEmailValido', () => {
  it('aceita email real e recusa placeholder mesmo com formato válido', () => {
    expect(ehEmailValido('carolina@imincorporadora.com.br')).toBe(true)
    expect(ehEmailValido('corretor.129@sync.local')).toBe(false)
  })
  it('recusa formato quebrado', () => {
    expect(ehEmailValido('sem-arroba')).toBe(false)
    expect(ehEmailValido('sem@dominio')).toBe(false)
    expect(ehEmailValido(null)).toBe(false)
  })
})

describe('senhaValida', () => {
  it(`exige ${SENHA_MIN} caracteres, como a edge`, () => {
    expect(senhaValida('12345')).toBe(false)
    expect(senhaValida('123456')).toBe(true)
    expect(senhaValida(null)).toBe(false)
  })
})

describe('podeRedefinirSenha', () => {
  it('quem JÁ tem conta pode ter a senha redefinida (Jessica, Pires)', () => {
    expect(podeRedefinirSenha(jessica)).toBe(true)
  })
  it('beneficiário também — a edge aceita os dois tipos', () => {
    expect(podeRedefinirSenha(nohros)).toBe(true)
  })
  it('quem ainda não tem conta NÃO entra por aqui (o caminho é criar)', () => {
    expect(podeRedefinirSenha(carolina)).toBe(false)
  })
  it('tipo fora de corretor/beneficiario não passa', () => {
    expect(podeRedefinirSenha({ tipo: 'cliente', tem_acesso_sistema: true })).toBe(false)
    expect(podeRedefinirSenha({ tipo: 'admin', tem_acesso_sistema: true })).toBe(false)
  })
  it('nulo não quebra', () => {
    expect(podeRedefinirSenha(null)).toBe(false)
  })
})

describe('podeCriarAcesso', () => {
  it('Carolina só pode criar quando o email real é informado', () => {
    expect(podeCriarAcesso(carolina)).toBe(false) // usaria o placeholder do cadastro
    expect(podeCriarAcesso(carolina, 'carolina@imincorporadora.com.br')).toBe(true)
  })
  it('quem já tem conta não cria de novo', () => {
    expect(podeCriarAcesso(jessica, 'jessica@imincorporadora.com.br')).toBe(false)
  })
})

describe('acaoDeAcesso (uma fonte só pro rótulo e pra chamada da edge)', () => {
  it('conta existente → trocar_senha', () => {
    expect(acaoDeAcesso(jessica)).toBe('trocar_senha')
  })
  it('sem conta e com email real → criar', () => {
    expect(acaoDeAcesso(carolina, 'carolina@imincorporadora.com.br')).toBe('criar')
  })
  it('sem conta e com placeholder → bloqueado', () => {
    expect(acaoDeAcesso(carolina)).toBe('bloqueado')
  })
})

describe('motivoBloqueioAcesso (explica em vez de só desabilitar)', () => {
  it('placeholder do sync tem mensagem própria', () => {
    expect(motivoBloqueioAcesso(carolina)).toMatch(/tempor/i)
  })
  it('email quebrado pede email válido', () => {
    expect(motivoBloqueioAcesso(carolina, 'aaa')).toMatch(/v[áa]lido/i)
  })
  it('sem bloqueio devolve null', () => {
    expect(motivoBloqueioAcesso(jessica)).toBeNull()
    expect(motivoBloqueioAcesso(carolina, 'carolina@imincorporadora.com.br')).toBeNull()
  })
  it('tipo errado é explicado', () => {
    expect(motivoBloqueioAcesso({ tipo: 'cliente', tem_acesso_sistema: false })).toMatch(/cliente/)
  })
})
