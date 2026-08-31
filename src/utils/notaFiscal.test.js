import { describe, it, expect } from 'vitest'
import {
  normalizarCompetencia,
  derivarSituacaoCompetencia,
  validarEnvio,
  caminhoDoArquivo,
  linkCorrecaoWhatsApp,
  WHATSAPP_CONTROLADORIA,
  resumoCompetencia,
  camposParaCadastro,
} from './notaFiscal'

// Spec: docs/specs/2026-08-31-spec-nota-fiscal-corretor.md
// Glossario: CONTEXT.md — "Competencia: o mes a que uma nota se refere."

describe('competencia', () => {
  it('um mes vira o primeiro dia daquele mes', () => {
    expect(normalizarCompetencia('2026-08')).toBe('2026-08-01')
  })

  it('qualquer dia dentro do mes cai no primeiro dia (a competencia e o mes, nao a data)', () => {
    expect(normalizarCompetencia('2026-08-31')).toBe('2026-08-01')
    expect(normalizarCompetencia('2026-08-01')).toBe('2026-08-01')
  })

  it('mes fora do calendario nao vira competencia', () => {
    expect(normalizarCompetencia('2026-13')).toBeNull()
    expect(normalizarCompetencia('2026-00')).toBeNull()
  })

  it('lixo nao vira competencia', () => {
    expect(normalizarCompetencia('agosto')).toBeNull()
    expect(normalizarCompetencia('')).toBeNull()
    expect(normalizarCompetencia(null)).toBeNull()
    expect(normalizarCompetencia(undefined)).toBeNull()
  })
})

describe('quem enviou e quem nao enviou na competencia', () => {
  const corretores = [
    { id: 'c1', nome: 'Ana', tipo: 'corretor', ativo: true },
    { id: 'c2', nome: 'Bruno', tipo: 'corretor', ativo: true },
    { id: 'c3', nome: 'Carla sem venda', tipo: 'corretor', ativo: true },
    { id: 'c4', nome: 'Inativo', tipo: 'corretor', ativo: false },
    { id: 'a1', nome: 'Admin', tipo: 'admin', ativo: true },
    { id: 'b1', nome: 'Nohros', tipo: 'beneficiario', ativo: true },
  ]

  it('separa em enviaram e nao enviaram', () => {
    const r = derivarSituacaoCompetencia({
      competencia: '2026-08',
      corretores,
      notas: [{ corretor_id: 'c1', competencia: '2026-08-01', valor_declarado: 1200 }],
    })
    expect(r.enviaram.map((l) => l.corretor.id)).toEqual(['c1'])
    expect(r.naoEnviaram.map((l) => l.corretor.id)).toEqual(['c2', 'c3'])
  })

  it('so corretor ATIVO e obrigado — admin, beneficiario e inativo ficam de fora', () => {
    const r = derivarSituacaoCompetencia({ competencia: '2026-08', corretores, notas: [] })
    expect(r.totalObrigados).toBe(3)
    const ids = r.naoEnviaram.map((l) => l.corretor.id)
    expect(ids).not.toContain('c4')
    expect(ids).not.toContain('a1')
    expect(ids).not.toContain('b1')
  })

  it('corretor sem venda alguma continua sendo cobrado (a obrigacao e de todos)', () => {
    const r = derivarSituacaoCompetencia({ competencia: '2026-08', corretores, notas: [] })
    expect(r.naoEnviaram.map((l) => l.corretor.id)).toContain('c3')
  })

  it('as duas listas sempre somam o total de obrigados', () => {
    const r = derivarSituacaoCompetencia({
      competencia: '2026-08',
      corretores,
      notas: [{ corretor_id: 'c1', competencia: '2026-08-01' }],
    })
    expect(r.enviaram.length + r.naoEnviaram.length).toBe(r.totalObrigados)
  })

  it('nota de OUTRA competencia nao conta como enviada', () => {
    const r = derivarSituacaoCompetencia({
      competencia: '2026-08',
      corretores,
      notas: [{ corretor_id: 'c1', competencia: '2026-07-01' }],
    })
    expect(r.enviaram).toHaveLength(0)
    expect(r.naoEnviaram.map((l) => l.corretor.id)).toContain('c1')
  })

  it('nota de corretor que nao e mais obrigado nao inventa linha', () => {
    const r = derivarSituacaoCompetencia({
      competencia: '2026-08',
      corretores,
      notas: [{ corretor_id: 'c4', competencia: '2026-08-01' }],
    })
    expect(r.enviaram).toHaveLength(0)
    expect(r.totalObrigados).toBe(3)
  })

  it('competencia invalida devolve listas vazias em vez de chutar um mes', () => {
    const r = derivarSituacaoCompetencia({ competencia: 'agosto', corretores, notas: [] })
    expect(r.competencia).toBeNull()
    expect(r.totalObrigados).toBe(0)
    expect(r.naoEnviaram).toHaveLength(0)
  })
})

describe('validacao do envio', () => {
  // CPF/CNPJ validos conhecidos (fonte independente: digitos verificadores calculados a mao)
  const CPF_OK = '529.982.247-25'
  const CNPJ_OK = '11.222.333/0001-81'
  const arquivo = { name: 'nota.pdf', size: 200 * 1024 }

  const base = {
    competencia: '2026-08',
    tipo_emissor: 'autonomo',
    documento: CPF_OK,
    telefone: '(41) 99166-7004',
    chave_pix: CPF_OK,
    valor_declarado: 1234.56,
    arquivo,
  }
  const campos = (r) => r.erros.map((e) => e.campo)

  it('autonomo com CPF valido passa', () => {
    const r = validarEnvio(base)
    expect(r.valido).toBe(true)
    expect(r.erros).toEqual([])
  })

  it('imobiliaria exige CNPJ e o nome da imobiliaria', () => {
    const r = validarEnvio({ ...base, tipo_emissor: 'imobiliaria', documento: CNPJ_OK, nome_imobiliaria: 'Corazza' })
    expect(r.valido).toBe(true)
  })

  it('imobiliaria sem o nome da imobiliaria e recusada', () => {
    const r = validarEnvio({ ...base, tipo_emissor: 'imobiliaria', documento: CNPJ_OK, nome_imobiliaria: '   ' })
    expect(campos(r)).toContain('nome_imobiliaria')
  })

  it('autonomo NAO precisa do nome da imobiliaria', () => {
    const r = validarEnvio({ ...base, nome_imobiliaria: '' })
    expect(campos(r)).not.toContain('nome_imobiliaria')
  })

  it('autonomo com CNPJ e recusado — o documento tem que casar com o emissor', () => {
    expect(campos(validarEnvio({ ...base, documento: CNPJ_OK }))).toContain('documento')
  })

  it('imobiliaria com CPF e recusada', () => {
    const r = validarEnvio({ ...base, tipo_emissor: 'imobiliaria', nome_imobiliaria: 'Corazza', documento: CPF_OK })
    expect(campos(r)).toContain('documento')
  })

  it('documento com digito verificador errado e recusado', () => {
    expect(campos(validarEnvio({ ...base, documento: '529.982.247-26' }))).toContain('documento')
    expect(campos(validarEnvio({ ...base, documento: '111.111.111-11' }))).toContain('documento')
  })

  it('competencia, telefone, pix, valor e arquivo sao obrigatorios', () => {
    const r = validarEnvio({ tipo_emissor: 'autonomo' })
    expect(campos(r)).toEqual(
      expect.arrayContaining(['competencia', 'documento', 'telefone', 'chave_pix', 'valor_declarado', 'arquivo']),
    )
  })

  it('valor precisa ser maior que zero', () => {
    expect(campos(validarEnvio({ ...base, valor_declarado: 0 }))).toContain('valor_declarado')
    expect(campos(validarEnvio({ ...base, valor_declarado: -5 }))).toContain('valor_declarado')
  })

  it('arquivo de tipo nao aceito e recusado', () => {
    const r = validarEnvio({ ...base, arquivo: { name: 'nota.docx', size: 1024 } })
    expect(campos(r)).toContain('arquivo')
  })

  it('arquivo acima do limite e recusado', () => {
    const r = validarEnvio({ ...base, arquivo: { name: 'nota.pdf', size: 11 * 1024 * 1024 } })
    expect(campos(r)).toContain('arquivo')
  })

  it('tipo de emissor desconhecido e recusado', () => {
    expect(campos(validarEnvio({ ...base, tipo_emissor: 'pessoa juridica' }))).toContain('tipo_emissor')
  })

  it('cada erro traz mensagem legivel pro corretor', () => {
    const r = validarEnvio({ tipo_emissor: 'autonomo' })
    expect(r.erros.every((e) => typeof e.mensagem === 'string' && e.mensagem.length > 0)).toBe(true)
  })
})

describe('caminho do arquivo no bucket', () => {
  it('a pasta raiz e SEMPRE o id do corretor — e disso que a policy do bucket depende', () => {
    const p = caminhoDoArquivo({ corretorId: 'abc-123', competencia: '2026-08', nomeArquivo: 'nota.pdf' })
    expect(p.split('/')[0]).toBe('abc-123')
  })

  it('separa por competencia dentro da pasta do corretor', () => {
    const p = caminhoDoArquivo({ corretorId: 'abc-123', competencia: '2026-08-31', nomeArquivo: 'nota.pdf' })
    expect(p.startsWith('abc-123/2026-08/')).toBe(true)
    expect(p.endsWith('.pdf')).toBe(true)
  })

  it('nome de arquivo malicioso nao escapa da pasta do corretor', () => {
    const p = caminhoDoArquivo({
      corretorId: 'abc-123',
      competencia: '2026-08',
      nomeArquivo: '../../outro-corretor/nota.pdf',
    })
    expect(p.split('/')[0]).toBe('abc-123')
    expect(p).not.toContain('..')
  })

  it('sem corretor ou sem competencia nao ha caminho', () => {
    expect(caminhoDoArquivo({ competencia: '2026-08', nomeArquivo: 'n.pdf' })).toBeNull()
    expect(caminhoDoArquivo({ corretorId: 'abc', competencia: 'agosto', nomeArquivo: 'n.pdf' })).toBeNull()
  })
})

describe('correcao pelo WhatsApp da controladoria', () => {
  it('aponta para o numero da controladoria', () => {
    const url = linkCorrecaoWhatsApp({ nomeCorretor: 'Ana', competencia: '2026-08' })
    expect(WHATSAPP_CONTROLADORIA).toBe('5541991667004')
    expect(url.startsWith('https://wa.me/5541991667004?text=')).toBe(true)
  })

  it('a mensagem ja identifica corretor e competencia', () => {
    const url = linkCorrecaoWhatsApp({ nomeCorretor: 'Ana Paula', competencia: '2026-08' })
    const texto = decodeURIComponent(url.split('text=')[1])
    expect(texto).toContain('Ana Paula')
    expect(texto).toContain('08/2026')
  })
})

describe('resumo da competencia', () => {
  const situacao = {
    competencia: '2026-08-01',
    totalObrigados: 3,
    enviaram: [
      { corretor: { id: 'c1' }, nota: { valor_declarado: 1000 } },
      { corretor: { id: 'c2' }, nota: { valor_declarado: '250.50' } },
    ],
    naoEnviaram: [{ corretor: { id: 'c3' }, nota: null }],
  }

  it('conta quantos enviaram e quantos faltam', () => {
    const r = resumoCompetencia(situacao)
    expect(r.enviaram).toBe(2)
    expect(r.faltam).toBe(1)
    expect(r.totalObrigados).toBe(3)
  })

  it('soma o valor declarado, inclusive quando vem como texto do banco', () => {
    expect(resumoCompetencia(situacao).valorDeclarado).toBeCloseTo(1250.5, 2)
  })

  it('competencia vazia resume em zeros, nao em NaN', () => {
    const r = resumoCompetencia({ competencia: null, totalObrigados: 0, enviaram: [], naoEnviaram: [] })
    expect(r).toMatchObject({ enviaram: 0, faltam: 0, totalObrigados: 0, valorDeclarado: 0 })
  })
})

describe('devolucao ao cadastro do corretor', () => {
  const envio = {
    tipo_emissor: 'imobiliaria',
    documento: '11.222.333/0001-81',
    nome_imobiliaria: 'Corazza',
    telefone: '(41) 99166-7004',
    chave_pix: '11.222.333/0001-81',
  }

  it('preenche no cadastro so o que estava vazio', () => {
    const atual = { cnpj: null, telefone: null, imobiliaria: null, chave_pix: null }
    expect(camposParaCadastro(envio, atual)).toEqual({
      cnpj: '11222333000181',
      telefone: '(41) 99166-7004',
      imobiliaria: 'Corazza',
      chave_pix: '11.222.333/0001-81',
      tipo_chave_pix: 'cnpj',
    })
  })

  it('NUNCA sobrescreve campo que o cadastro ja tem', () => {
    const atual = { cnpj: '99999999000199', telefone: '(41) 3333-3333', imobiliaria: 'Outra', chave_pix: 'x@y.com' }
    expect(camposParaCadastro(envio, atual)).toEqual({ tipo_chave_pix: 'cnpj' })
  })

  it('autonomo popula CPF, nao CNPJ', () => {
    const r = camposParaCadastro(
      { tipo_emissor: 'autonomo', documento: '529.982.247-25', chave_pix: '529.982.247-25', telefone: '1' },
      {},
    )
    expect(r.cpf).toBe('52998224725')
    expect(r).not.toHaveProperty('cnpj')
  })

  it('cadastro ja completo nao gera atualizacao alguma', () => {
    const atual = { cpf: '52998224725', telefone: '1', chave_pix: '529.982.247-25', tipo_chave_pix: 'cpf' }
    const r = camposParaCadastro(
      { tipo_emissor: 'autonomo', documento: '529.982.247-25', chave_pix: '529.982.247-25', telefone: '1' },
      atual,
    )
    expect(r).toEqual({})
  })
})
