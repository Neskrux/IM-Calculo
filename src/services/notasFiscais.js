/**
 * Acesso a dados da NOTA FISCAL DO CORRETOR.
 *
 * Adapter fino: sem regra de negocio. Toda regra vive em src/utils/notaFiscal.js,
 * que e a seam de teste. Aqui so tem Supabase.
 *
 * Spec: docs/specs/2026-08-31-spec-nota-fiscal-corretor.md
 * Leitura de listas: .claude/rules/leitura-de-listas-e-refetch.md
 */
import { supabase } from '../lib/supabase'
import { fetchAllPaginated } from '../utils/supabaseQuery'
import {
  BUCKET_NOTAS,
  normalizarCompetencia,
  caminhoDoArquivo,
  camposParaCadastro,
  soDigitos,
} from '../utils/notaFiscal'

export const MSG_DUPLICADA =
  'Ja existe nota fiscal enviada para este mes. Uma nota nunca cobre mais de um mes — ' +
  'se precisa corrigir, fale com a controladoria.'

const CAMPOS_NOTA =
  'id, corretor_id, competencia, tipo_emissor, documento, nome_imobiliaria, telefone, ' +
  'chave_pix, valor_declarado, arquivo_path, arquivo_nome, observacao, criado_por, created_at'

/** Os OBRIGADOS: corretores ativos. Nao sai de pagamentos_prosoluto (D3). */
export async function listarCorretoresAtivos() {
  return fetchAllPaginated((from, to) =>
    supabase
      .from('usuarios')
      .select('id, nome, email, tipo, tipo_corretor, ativo, cpf, cnpj, creci, imobiliaria, telefone, celular, chave_pix, tipo_chave_pix')
      .eq('tipo', 'corretor')
      .eq('ativo', true)
      .order('nome', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )
}

export async function listarNotasDaCompetencia(competencia) {
  const comp = normalizarCompetencia(competencia)
  if (!comp) return []
  return fetchAllPaginated((from, to) =>
    supabase
      .from('notas_fiscais_corretor')
      .select(CAMPOS_NOTA)
      .eq('competencia', comp)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  )
}

export async function listarNotasDoCorretor(corretorId) {
  if (!corretorId) return []
  const { data, error } = await supabase
    .from('notas_fiscais_corretor')
    .select(CAMPOS_NOTA)
    .eq('corretor_id', corretorId)
    .order('competencia', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** URL de vida curta. O bucket e privado — nunca usar getPublicUrl aqui (ADR 0002). */
export async function urlAssinadaDaNota(path, segundos = 300) {
  if (!path) return null
  const { data, error } = await supabase.storage.from(BUCKET_NOTAS).createSignedUrl(path, segundos)
  if (error) throw error
  return data?.signedUrl ?? null
}

/**
 * Envia a nota: sobe o arquivo, grava a linha e devolve ao cadastro o que faltava.
 * Se a gravacao falhar (ex.: ja existe nota do mes), o arquivo recem-subido e
 * removido — nao fica arquivo orfao nem linha orfa.
 *
 * @param {object} p
 * @param {string} p.corretorId  dono da nota
 * @param {string} p.criadoPor   quem esta gravando (o proprio corretor, ou o admin)
 * @param {object} p.envio       ja validado por validarEnvio()
 * @param {object} [p.cadastroAtual] usuarios do corretor, pra decidir o que devolver
 */
export async function enviarNota({ corretorId, criadoPor, envio, cadastroAtual = {} }) {
  const competencia = normalizarCompetencia(envio.competencia)
  if (!competencia) throw new Error('Competencia invalida.')

  const arquivo = envio.arquivo
  const path = caminhoDoArquivo({
    corretorId,
    competencia,
    nomeArquivo: arquivo?.name,
    // Sufixo unico por tentativa: o bucket NAO tem policy de DELETE (nota enviada
    // nao se apaga pelo cliente), entao um arquivo orfao de uma tentativa que
    // falhou nunca pode travar a proxima com colisao de caminho.
    sufixo: `nota-${competencia.slice(0, 7)}-${Date.now()}`,
  })
  if (!path) throw new Error('Nao foi possivel montar o caminho do arquivo.')

  // upsert:false de proposito. Com upsert, o segundo envio do mesmo mes
  // sobrescreveria o arquivo da nota que ja existe — e o rollback logo abaixo
  // apagaria o arquivo legitimo. Sem upsert, o proprio Storage recusa e nada
  // do que ja esta la e tocado.
  const { error: erroUpload } = await supabase.storage
    .from(BUCKET_NOTAS)
    .upload(path, arquivo, { cacheControl: '3600', upsert: false, contentType: arquivo?.type || undefined })
  if (erroUpload) {
    const jaExiste = erroUpload.statusCode === '409' || /exists/i.test(erroUpload.message ?? '')
    throw jaExiste ? new Error(MSG_DUPLICADA) : erroUpload
  }

  const linha = {
    corretor_id: corretorId,
    criado_por: criadoPor,
    competencia,
    tipo_emissor: envio.tipo_emissor,
    documento: soDigitos(envio.documento),
    nome_imobiliaria: envio.tipo_emissor === 'imobiliaria' ? String(envio.nome_imobiliaria).trim() : null,
    telefone: String(envio.telefone).trim(),
    chave_pix: String(envio.chave_pix).trim(),
    valor_declarado: Number(envio.valor_declarado),
    arquivo_path: path,
    arquivo_nome: arquivo?.name ?? null,
    arquivo_tamanho: arquivo?.size ?? null,
    arquivo_tipo_mime: arquivo?.type ?? null,
    observacao: String(envio.observacao ?? '').trim() || null,
  }

  const { data: nota, error } = await supabase
    .from('notas_fiscais_corretor')
    .insert(linha)
    .select(CAMPOS_NOTA)
    .single()

  if (error) {
    // Seguro remover: o upload acima foi com upsert:false, entao este objeto
    // acabou de ser criado por nos e nao ha nota anterior apontando pra ele.
    try {
      await supabase.storage.from(BUCKET_NOTAS).remove([path])
    } catch {
      console.warn('Arquivo orfao em', path, '— remover na mao.')
    }
    if (error.code === '23505') throw new Error(MSG_DUPLICADA)
    throw error
  }

  // Devolucao ao cadastro (D10): so o que faltava, nunca sobrescreve.
  const patch = camposParaCadastro(envio, cadastroAtual)
  if (Object.keys(patch).length > 0) {
    const { error: erroCadastro } = await supabase.from('usuarios').update(patch).eq('id', corretorId)
    // Falhar aqui nao invalida a nota: o comprovante ja esta gravado.
    if (erroCadastro) console.warn('Nota gravada, mas o cadastro nao foi atualizado:', erroCadastro.message)
  }

  return nota
}
