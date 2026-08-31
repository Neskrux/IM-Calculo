/**
 * Formulario de envio da NOTA FISCAL DO CORRETOR.
 *
 * Usado pelas duas superficies: o corretor enviando a propria nota, e a
 * controladoria enviando em nome de um corretor (D11). As regras nao moram aqui —
 * moram em src/utils/notaFiscal.js, que e a seam de teste.
 *
 * Nome, e-mail e CRECI nao sao perguntados (vem da sessao / do cadastro).
 * Endereco nao e perguntado (vem do contrato — D9).
 *
 * Spec: docs/specs/2026-08-31-spec-nota-fiscal-corretor.md
 */
import { useMemo, useState } from 'react'
import { Upload, Loader2, AlertCircle } from 'lucide-react'
import {
  validarEnvio,
  documentoEsperado,
  competenciaPorExtenso,
  EXTENSOES_ACEITAS,
} from '../utils/notaFiscal'
import { enviarNota } from '../services/notasFiscais'
import './NotaFiscalForm.css'

const aceitaNoInput = EXTENSOES_ACEITAS.map((e) => `.${e}`).join(',')

export default function NotaFiscalForm({ corretor, criadoPor, competencia, onEnviado, onCancelar }) {
  // Prefill do que a IM ja sabe (D10). O que faltar, o corretor preenche —
  // e volta gravado no cadastro no envio.
  const inicial = useMemo(() => {
    const temCnpj = Boolean(corretor?.cnpj)
    return {
      tipo_emissor: temCnpj || corretor?.imobiliaria ? 'imobiliaria' : 'autonomo',
      documento: temCnpj ? corretor.cnpj : (corretor?.cpf ?? ''),
      nome_imobiliaria: corretor?.imobiliaria ?? '',
      telefone: corretor?.telefone ?? corretor?.celular ?? '',
      chave_pix: corretor?.chave_pix ?? '',
      valor_declarado: '',
      observacao: '',
      arquivo: null,
    }
  }, [corretor])

  const [form, setForm] = useState(inicial)
  const [erros, setErros] = useState([])
  const [enviando, setEnviando] = useState(false)
  const [falha, setFalha] = useState(null)

  const set = (campo) => (e) => {
    const valor = e?.target?.type === 'file' ? (e.target.files?.[0] ?? null) : e.target.value
    setForm((f) => ({ ...f, [campo]: valor }))
    setErros((es) => es.filter((x) => x.campo !== campo))
    setFalha(null)
  }

  const erroDe = (campo) => erros.find((e) => e.campo === campo)?.mensagem
  const ehPJ = form.tipo_emissor === 'imobiliaria'
  const rotuloDoc = documentoEsperado(form.tipo_emissor) === 'cnpj' ? 'CNPJ' : 'CPF'

  const trocarEmissor = (tipo) => {
    setForm((f) => ({
      ...f,
      tipo_emissor: tipo,
      // documento muda de natureza junto com o emissor: manter o antigo so confunde
      documento: tipo === 'imobiliaria' ? (corretor?.cnpj ?? '') : (corretor?.cpf ?? ''),
    }))
    setErros([])
  }

  const submeter = async (e) => {
    e.preventDefault()
    const envio = { ...form, competencia }
    const { valido, erros: achados } = validarEnvio(envio)
    setErros(achados)
    if (!valido) return

    setEnviando(true)
    setFalha(null)
    try {
      const nota = await enviarNota({
        corretorId: corretor.id,
        criadoPor,
        envio,
        cadastroAtual: corretor,
      })
      onEnviado?.(nota)
    } catch (err) {
      setFalha(err.message || 'Nao foi possivel enviar a nota.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="nf-form" onSubmit={submeter}>
      <p className="nf-competencia">
        Competência: <strong>{competenciaPorExtenso(competencia)}</strong>
        <span className="nf-hint"> — uma nota por mês</span>
      </p>

      <fieldset className="nf-campo">
        <legend>Você emite como</legend>
        <div className="nf-radios">
          <label>
            <input
              type="radio"
              name="tipo_emissor"
              checked={form.tipo_emissor === 'autonomo'}
              onChange={() => trocarEmissor('autonomo')}
            />
            Corretor autônomo
          </label>
          <label>
            <input
              type="radio"
              name="tipo_emissor"
              checked={ehPJ}
              onChange={() => trocarEmissor('imobiliaria')}
            />
            Corretor de uma imobiliária
          </label>
        </div>
        {erroDe('tipo_emissor') && <span className="nf-erro">{erroDe('tipo_emissor')}</span>}
      </fieldset>

      {ehPJ && (
        <label className="nf-campo">
          <span>Nome da imobiliária</span>
          <input
            type="text"
            value={form.nome_imobiliaria}
            onChange={set('nome_imobiliaria')}
            placeholder="Como está na nota"
          />
          {erroDe('nome_imobiliaria') && <span className="nf-erro">{erroDe('nome_imobiliaria')}</span>}
        </label>
      )}

      <label className="nf-campo">
        <span>{rotuloDoc} de quem emite</span>
        <input type="text" inputMode="numeric" value={form.documento} onChange={set('documento')} />
        {erroDe('documento') && <span className="nf-erro">{erroDe('documento')}</span>}
      </label>

      <div className="nf-linha">
        <label className="nf-campo">
          <span>Telefone</span>
          <input type="tel" value={form.telefone} onChange={set('telefone')} placeholder="(00) 00000-0000" />
          {erroDe('telefone') && <span className="nf-erro">{erroDe('telefone')}</span>}
        </label>

        <label className="nf-campo">
          <span>Valor da nota</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.valor_declarado}
            onChange={set('valor_declarado')}
            placeholder="0,00"
          />
          {erroDe('valor_declarado') && <span className="nf-erro">{erroDe('valor_declarado')}</span>}
        </label>
      </div>

      <label className="nf-campo">
        <span>Chave PIX para o pagamento</span>
        <input type="text" value={form.chave_pix} onChange={set('chave_pix')} />
        <span className="nf-hint">
          Pode ser diferente do documento de quem emite — é a chave que recebe o repasse.
        </span>
        {erroDe('chave_pix') && <span className="nf-erro">{erroDe('chave_pix')}</span>}
      </label>

      <label className="nf-campo">
        <span>Arquivo da nota fiscal</span>
        <input type="file" accept={aceitaNoInput} onChange={set('arquivo')} />
        <span className="nf-hint">{EXTENSOES_ACEITAS.join(', ').toUpperCase()} — até 10MB.</span>
        {erroDe('arquivo') && <span className="nf-erro">{erroDe('arquivo')}</span>}
      </label>

      <label className="nf-campo">
        <span>Observação desta nota</span>
        <textarea
          rows={3}
          value={form.observacao}
          onChange={set('observacao')}
          placeholder="Opcional — algo específico desta nota"
        />
      </label>

      {falha && (
        <p className="nf-falha">
          <AlertCircle size={16} /> {falha}
        </p>
      )}

      <div className="nf-acoes">
        {onCancelar && (
          <button type="button" className="nf-btn" onClick={onCancelar} disabled={enviando}>
            Cancelar
          </button>
        )}
        <button type="submit" className="nf-btn nf-btn-primario" disabled={enviando}>
          {enviando ? <Loader2 size={16} className="nf-girando" /> : <Upload size={16} />}
          {enviando ? 'Enviando…' : 'Enviar nota fiscal'}
        </button>
      </div>
    </form>
  )
}
