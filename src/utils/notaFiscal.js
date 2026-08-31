/**
 * Regras de dominio da NOTA FISCAL DO CORRETOR.
 *
 * Modulo puro: sem Supabase, sem React, sem rede. E a unica seam de teste da
 * feature — as telas do corretor e do admin consomem daqui.
 *
 * Spec:  docs/specs/2026-08-31-spec-nota-fiscal-corretor.md
 * Termos: CONTEXT.md (competencia, emissor, obrigado, observacao da nota)
 * ADRs:  0001 (uma nota por competencia) · 0002 (bucket privado)
 */

/**
 * A competencia e um MES, nao uma data. Canonicamente representada pelo primeiro
 * dia do mes ('YYYY-MM-01'), pra que comparar mes seja comparar igualdade.
 * Aceita 'YYYY-MM' ou 'YYYY-MM-DD'. Retorna null quando nao e competencia.
 */
export function normalizarCompetencia(valor) {
  const texto = String(valor ?? '').trim()
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(texto)
  if (!m) return null
  const mes = Number(m[2])
  if (mes < 1 || mes > 12) return null
  return `${m[1]}-${m[2]}-01`
}

/**
 * OBRIGADO: quem deve uma nota em toda competencia. Corretor ativo, e so.
 * Admin, cliente e beneficiario nao emitem nota de corretor; inativo tambem nao.
 * Nao se deriva de comissao paga — logo distrato, baixa em massa e parcela
 * fantasma nao tocam este numero. Ver D3 do doc da feature.
 */
export const ehObrigado = (usuario) => usuario?.tipo === 'corretor' && usuario?.ativo === true

/**
 * O relatorio que e o produto: dada a lista de usuarios e as notas conhecidas,
 * quem enviou e quem nao enviou NAQUELA competencia.
 * Competencia invalida devolve vazio — nunca chuta um mes.
 */
export function derivarSituacaoCompetencia({ competencia, corretores = [], notas = [] } = {}) {
  const comp = normalizarCompetencia(competencia)
  if (!comp) return { competencia: null, totalObrigados: 0, enviaram: [], naoEnviaram: [] }

  const notaDoCorretor = new Map()
  for (const nota of notas) {
    if (normalizarCompetencia(nota?.competencia) !== comp) continue
    if (!notaDoCorretor.has(nota.corretor_id)) notaDoCorretor.set(nota.corretor_id, nota)
  }

  const enviaram = []
  const naoEnviaram = []
  for (const corretor of corretores.filter(ehObrigado)) {
    const nota = notaDoCorretor.get(corretor.id) ?? null
    ;(nota ? enviaram : naoEnviaram).push({ corretor, nota })
  }

  return { competencia: comp, totalObrigados: enviaram.length + naoEnviaram.length, enviaram, naoEnviaram }
}

// --------------------------------------------------------------------------
// EMISSOR e documento
// --------------------------------------------------------------------------

export const TIPOS_EMISSOR = Object.freeze(['autonomo', 'imobiliaria'])

/** Autonomo emite como PF (CPF); imobiliaria emite como PJ (CNPJ). */
export const documentoEsperado = (tipoEmissor) => (tipoEmissor === 'imobiliaria' ? 'cnpj' : 'cpf')

export const soDigitos = (valor) => String(valor ?? '').replace(/\D/g, '')

const digitosIguais = (d) => /^(\d)\1+$/.test(d)

export function cpfValido(valor) {
  const d = soDigitos(valor)
  if (d.length !== 11 || digitosIguais(d)) return false
  for (const [ate, pos] of [[9, 9], [10, 10]]) {
    let soma = 0
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i)
    const resto = (soma * 10) % 11
    if ((resto === 10 ? 0 : resto) !== Number(d[pos])) return false
  }
  return true
}

export function cnpjValido(valor) {
  const d = soDigitos(valor)
  if (d.length !== 14 || digitosIguais(d)) return false
  const calc = (ate) => {
    let soma = 0
    let peso = ate - 7
    for (let i = 0; i < ate; i++) {
      soma += Number(d[i]) * peso
      peso = peso === 2 ? 9 : peso - 1
    }
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13])
}

// --------------------------------------------------------------------------
// ARQUIVO da nota
// --------------------------------------------------------------------------

export const EXTENSOES_ACEITAS = Object.freeze(['pdf', 'xml', 'png', 'jpg', 'jpeg'])
export const TAMANHO_MAXIMO_BYTES = 10 * 1024 * 1024

export const extensaoDe = (nome) => String(nome ?? '').split('.').pop()?.toLowerCase() ?? ''

// --------------------------------------------------------------------------
// VALIDACAO DO ENVIO
// --------------------------------------------------------------------------

/**
 * Regras do formulario de envio, num lugar so — a tela do corretor e a do admin
 * (que envia em nome dele) chamam esta mesma funcao.
 * Nome, e-mail e CRECI nao entram: vem da sessao. Endereco nao entra: vem do contrato.
 * Retorna { valido, erros: [{ campo, mensagem }] }.
 */
export function validarEnvio(envio = {}) {
  const erros = []
  const exigir = (campo, mensagem) => erros.push({ campo, mensagem })
  const vazio = (v) => String(v ?? '').trim() === ''

  if (!normalizarCompetencia(envio.competencia)) {
    exigir('competencia', 'Informe o mes de competencia da nota.')
  }

  if (!TIPOS_EMISSOR.includes(envio.tipo_emissor)) {
    exigir('tipo_emissor', 'Informe se voce emite como autonomo ou pela imobiliaria.')
  } else {
    const esperado = documentoEsperado(envio.tipo_emissor)
    const ok = esperado === 'cnpj' ? cnpjValido(envio.documento) : cpfValido(envio.documento)
    if (!ok) {
      exigir('documento', esperado === 'cnpj'
        ? 'Informe um CNPJ valido — quem emite pela imobiliaria emite como pessoa juridica.'
        : 'Informe um CPF valido — quem emite como autonomo emite como pessoa fisica.')
    }
    if (envio.tipo_emissor === 'imobiliaria' && vazio(envio.nome_imobiliaria)) {
      exigir('nome_imobiliaria', 'Informe o nome da imobiliaria que esta emitindo.')
    }
  }

  if (vazio(envio.telefone)) exigir('telefone', 'Informe um telefone de contato.')
  if (vazio(envio.chave_pix)) exigir('chave_pix', 'Informe a chave PIX que recebe o repasse.')

  const valor = Number(envio.valor_declarado)
  if (!Number.isFinite(valor) || valor <= 0) {
    exigir('valor_declarado', 'Informe o valor da nota fiscal.')
  }

  const arquivo = envio.arquivo
  if (!arquivo) {
    exigir('arquivo', 'Anexe o arquivo da nota fiscal.')
  } else if (!EXTENSOES_ACEITAS.includes(extensaoDe(arquivo.name))) {
    exigir('arquivo', `Formato nao aceito. Use: ${EXTENSOES_ACEITAS.join(', ').toUpperCase()}.`)
  } else if (Number(arquivo.size) > TAMANHO_MAXIMO_BYTES) {
    exigir('arquivo', 'Arquivo muito grande. O limite e 10MB.')
  }

  return { valido: erros.length === 0, erros }
}

// --------------------------------------------------------------------------
// CAMINHO no bucket privado
// --------------------------------------------------------------------------

export const BUCKET_NOTAS = 'notas-fiscais'

/**
 * A pasta raiz dentro do bucket e o id do corretor — a policy do Storage valida
 * exatamente isso (molde da migration 024). O nome enviado pelo usuario NUNCA
 * compoe o caminho diretamente: so a extensao sobrevive. Ver ADR 0002.
 */
export function caminhoDoArquivo({ corretorId, competencia, nomeArquivo, sufixo } = {}) {
  const dono = String(corretorId ?? '').trim()
  const comp = normalizarCompetencia(competencia)
  if (!dono || !comp) return null
  const ext = EXTENSOES_ACEITAS.includes(extensaoDe(nomeArquivo)) ? extensaoDe(nomeArquivo) : 'pdf'
  const mes = comp.slice(0, 7)
  const nome = String(sufixo ?? `nota-${mes}`).replace(/[^a-zA-Z0-9_-]/g, '')
  return `${dono}/${mes}/${nome}.${ext}`
}

// --------------------------------------------------------------------------
// CORRECAO: nao e self-service (ADR 0001)
// --------------------------------------------------------------------------

export const WHATSAPP_CONTROLADORIA = '5541991667004'
export const WHATSAPP_CONTROLADORIA_EXIBICAO = '+55 41 9166-7004'

/** Mes canonico 'YYYY-MM-01' vira 'MM/YYYY' pra leitura humana. */
export const competenciaPorExtenso = (competencia) => {
  const comp = normalizarCompetencia(competencia)
  return comp ? `${comp.slice(5, 7)}/${comp.slice(0, 4)}` : ''
}

export function linkCorrecaoWhatsApp({ nomeCorretor, competencia } = {}) {
  const texto =
    `Ola! Sou ${nomeCorretor || 'corretor'} e preciso corrigir a nota fiscal ` +
    `da competencia ${competenciaPorExtenso(competencia)}.`
  return `https://wa.me/${WHATSAPP_CONTROLADORIA}?text=${encodeURIComponent(texto)}`
}

// --------------------------------------------------------------------------
// RESUMO da competencia (o numero de capa da controladoria)
// --------------------------------------------------------------------------

export function resumoCompetencia(situacao = {}) {
  const enviaram = situacao.enviaram ?? []
  const naoEnviaram = situacao.naoEnviaram ?? []
  const valorDeclarado = enviaram.reduce((acc, linha) => {
    const v = parseFloat(linha?.nota?.valor_declarado)
    return acc + (Number.isFinite(v) ? v : 0)
  }, 0)
  return {
    competencia: situacao.competencia ?? null,
    totalObrigados: situacao.totalObrigados ?? 0,
    enviaram: enviaram.length,
    faltam: naoEnviaram.length,
    valorDeclarado,
  }
}

// --------------------------------------------------------------------------
// DEVOLUCAO AO CADASTRO (D10)
// --------------------------------------------------------------------------

/**
 * O que o corretor digitou por falta volta pro cadastro — assim no mes seguinte
 * ja vem preenchido. Campo que o cadastro JA TEM nunca e sobrescrito pelo
 * formulario: corrigir cadastro e outro fluxo, com outra responsabilidade.
 * Devolve so o delta; objeto vazio significa "nada a atualizar".
 */
export function camposParaCadastro(envio = {}, cadastroAtual = {}) {
  const patch = {}
  const faltando = (campo) => String(cadastroAtual?.[campo] ?? '').trim() === ''
  const preencher = (campo, valor) => {
    if (valor && faltando(campo)) patch[campo] = valor
  }

  const doc = soDigitos(envio.documento)
  if (envio.tipo_emissor === 'imobiliaria') {
    preencher('cnpj', doc.length === 14 ? doc : '')
    preencher('imobiliaria', String(envio.nome_imobiliaria ?? '').trim())
  } else {
    preencher('cpf', doc.length === 11 ? doc : '')
  }

  preencher('telefone', String(envio.telefone ?? '').trim())
  preencher('chave_pix', String(envio.chave_pix ?? '').trim())

  const pixDigitos = soDigitos(envio.chave_pix)
  const tipoPix = pixDigitos.length === 14 ? 'cnpj' : pixDigitos.length === 11 ? 'cpf' : null
  if (tipoPix) preencher('tipo_chave_pix', tipoPix)

  return patch
}
