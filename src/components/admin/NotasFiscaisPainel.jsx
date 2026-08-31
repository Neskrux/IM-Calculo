/**
 * Painel da controladoria: QUEM NAO MANDOU nota na competencia.
 *
 * Este e o produto da feature — o upload e o meio. A lista sai de
 * "corretores ativos MENOS notas da competencia" (D3), nunca de comissao paga:
 * distrato, baixa em massa e parcela fantasma nao tocam este numero.
 *
 * Spec: docs/specs/2026-08-31-spec-nota-fiscal-corretor.md
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, FileText, RefreshCw, Send, X } from 'lucide-react'
import {
  derivarSituacaoCompetencia,
  resumoCompetencia,
  normalizarCompetencia,
  competenciaPorExtenso,
} from '../../utils/notaFiscal'
import {
  listarCorretoresAtivos,
  listarNotasDaCompetencia,
  urlAssinadaDaNota,
} from '../../services/notasFiscais'
import NotaFiscalForm from '../NotaFiscalForm'
import '../NotaFiscalForm.css'

const mesCorrente = () => new Date().toISOString().slice(0, 7)

const dinheiro = (v) =>
  (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const dataBR = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')

export default function NotasFiscaisPainel({ adminId, comissaoDoCorretorNaCompetencia }) {
  const [mes, setMes] = useState(mesCorrente)
  const [corretores, setCorretores] = useState([])
  const [notas, setNotas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)
  const [enviandoPor, setEnviandoPor] = useState(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const [cs, ns] = await Promise.all([listarCorretoresAtivos(), listarNotasDaCompetencia(mes)])
      setCorretores(cs)
      setNotas(ns)
    } catch (e) {
      setErro(e.message || 'Nao foi possivel carregar as notas.')
    } finally {
      setCarregando(false)
    }
  }, [mes])

  useEffect(() => {
    carregar()
  }, [carregar])

  const situacao = useMemo(
    () => derivarSituacaoCompetencia({ competencia: mes, corretores, notas }),
    [mes, corretores, notas],
  )
  const resumo = useMemo(() => resumoCompetencia(situacao), [situacao])

  const comissaoDe = useCallback(
    (corretorId) =>
      typeof comissaoDoCorretorNaCompetencia === 'function'
        ? comissaoDoCorretorNaCompetencia(corretorId, normalizarCompetencia(mes))
        : null,
    [comissaoDoCorretorNaCompetencia, mes],
  )

  const abrirNota = async (path) => {
    try {
      const url = await urlAssinadaDaNota(path)
      if (url) window.open(url, '_blank', 'noopener')
    } catch (e) {
      setErro(e.message || 'Nao foi possivel abrir o arquivo.')
    }
  }

  const exportarCsv = () => {
    const cab = [
      'Corretor', 'Situacao', 'Valor declarado', 'Comissao no mes', 'Emissor',
      'Imobiliaria', 'Documento', 'PIX', 'Enviado em', 'Enviado por',
    ]
    const linha = ({ corretor, nota }) => {
      const comissao = comissaoDe(corretor.id)
      return [
        corretor.nome,
        nota ? 'Enviou' : 'NAO ENVIOU',
        nota ? String(nota.valor_declarado ?? '') : '',
        comissao == null ? '' : String(comissao.toFixed(2)),
        nota?.tipo_emissor ?? '',
        nota?.nome_imobiliaria ?? '',
        nota?.documento ?? '',
        nota?.chave_pix ?? '',
        nota ? dataBR(nota.created_at) : '',
        nota && nota.criado_por !== nota.corretor_id ? 'controladoria' : nota ? 'o proprio corretor' : '',
      ]
    }
    const escapar = (c) => `"${String(c ?? '').replace(/"/g, '""')}"`
    const linhas = [cab, ...situacao.naoEnviaram.map(linha), ...situacao.enviaram.map(linha)]
    // BOM pra o Excel abrir acentos corretamente
    const csv = '﻿' + linhas.map((l) => l.map(escapar).join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `notas-fiscais-${normalizarCompetencia(mes)?.slice(0, 7) ?? 'competencia'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="nf-painel">
      <div className="nf-card">
        <div className="nf-controles">
          <label className="nf-campo">
            <span>Competência</span>
            <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
          </label>
          <button type="button" className="nf-btn" onClick={carregar} disabled={carregando}>
            <RefreshCw size={16} className={carregando ? 'nf-girando' : undefined} /> Atualizar
          </button>
          <button type="button" className="nf-btn" onClick={exportarCsv} disabled={carregando}>
            <Download size={16} /> Exportar
          </button>
        </div>

        <div className="nf-resumo" style={{ marginTop: 16 }}>
          <div className="nf-metrica">
            <span>Corretores ativos</span>
            <strong>{resumo.totalObrigados}</strong>
          </div>
          <div className="nf-metrica ok">
            <span>Enviaram</span>
            <strong>{resumo.enviaram}</strong>
          </div>
          <div className="nf-metrica falta">
            <span>Não enviaram</span>
            <strong>{resumo.faltam}</strong>
          </div>
          <div className="nf-metrica">
            <span>Total declarado</span>
            <strong>{dinheiro(resumo.valorDeclarado)}</strong>
          </div>
        </div>
      </div>

      {erro && <p className="nf-falha">{erro}</p>}

      <div className="nf-card">
        <h3>Não enviaram — {competenciaPorExtenso(mes)} ({situacao.naoEnviaram.length})</h3>
        {carregando ? (
          <p className="nf-vazio">Carregando…</p>
        ) : situacao.naoEnviaram.length === 0 ? (
          <p className="nf-vazio">Todos os corretores ativos enviaram a nota desta competência.</p>
        ) : (
          <div className="nf-tabela-wrap">
            <table className="nf-tabela">
              <thead>
                <tr>
                  <th>Corretor</th>
                  <th>Tipo</th>
                  <th>Comissão no mês</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {situacao.naoEnviaram.map(({ corretor }) => {
                  const comissao = comissaoDe(corretor.id)
                  return (
                    <tr key={corretor.id}>
                      <td>
                        {corretor.nome}
                        <span className="nf-pill faltou" style={{ marginLeft: 8 }}>não enviou</span>
                      </td>
                      <td>{corretor.tipo_corretor ?? '—'}</td>
                      <td>{comissao == null ? '—' : dinheiro(comissao)}</td>
                      <td>
                        <button type="button" className="nf-link" onClick={() => setEnviandoPor(corretor)}>
                          <Send size={13} /> enviar por ele
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="nf-card">
        <h3>Enviaram ({situacao.enviaram.length})</h3>
        {situacao.enviaram.length === 0 ? (
          <p className="nf-vazio">Nenhuma nota recebida nesta competência.</p>
        ) : (
          <div className="nf-tabela-wrap">
            <table className="nf-tabela">
              <thead>
                <tr>
                  <th>Corretor</th>
                  <th>Emissor</th>
                  <th>Valor declarado</th>
                  <th>Comissão no mês</th>
                  <th>Enviado em</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {situacao.enviaram.map(({ corretor, nota }) => {
                  const comissao = comissaoDe(corretor.id)
                  const porTerceiro = nota.criado_por !== nota.corretor_id
                  return (
                    <tr key={corretor.id}>
                      <td>
                        {corretor.nome}
                        {porTerceiro && (
                          <span className="nf-pill terceiro" style={{ marginLeft: 8 }}>
                            enviada pela controladoria
                          </span>
                        )}
                        {nota.observacao && <span className="nf-obs">“{nota.observacao}”</span>}
                      </td>
                      <td>
                        {nota.tipo_emissor === 'imobiliaria'
                          ? `PJ — ${nota.nome_imobiliaria ?? 'imobiliária'}`
                          : 'PF — autônomo'}
                      </td>
                      <td>{dinheiro(nota.valor_declarado)}</td>
                      <td>{comissao == null ? '—' : dinheiro(comissao)}</td>
                      <td>{dataBR(nota.created_at)}</td>
                      <td>
                        <button type="button" className="nf-link" onClick={() => abrirNota(nota.arquivo_path)}>
                          <FileText size={13} /> abrir
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {enviandoPor && (
        <div className="nf-card">
          <h3>
            Enviar nota por {enviandoPor.nome}
            <button
              type="button"
              className="nf-link"
              style={{ float: 'right' }}
              onClick={() => setEnviandoPor(null)}
            >
              <X size={14} /> fechar
            </button>
          </h3>
          <NotaFiscalForm
            corretor={enviandoPor}
            criadoPor={adminId}
            competencia={mes}
            onCancelar={() => setEnviandoPor(null)}
            onEnviado={() => {
              setEnviandoPor(null)
              carregar()
            }}
          />
        </div>
      )}
    </div>
  )
}
