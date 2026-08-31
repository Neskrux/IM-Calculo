/**
 * Aba "Nota Fiscal" do corretor: envia a nota do mes e ve o proprio historico.
 *
 * Uma nota por mes (ADR 0001). Nao ha editar nem excluir: correcao passa pela
 * controladoria, pelo botao de WhatsApp.
 *
 * Spec: docs/specs/2026-08-31-spec-nota-fiscal-corretor.md
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, FileText, MessageCircle } from 'lucide-react'
import {
  normalizarCompetencia,
  competenciaPorExtenso,
  linkCorrecaoWhatsApp,
  WHATSAPP_CONTROLADORIA_EXIBICAO,
} from '../../utils/notaFiscal'
import { listarNotasDoCorretor, urlAssinadaDaNota } from '../../services/notasFiscais'
import NotaFiscalForm from '../NotaFiscalForm'
import '../NotaFiscalForm.css'

const mesCorrente = () => new Date().toISOString().slice(0, 7)

const dinheiro = (v) =>
  (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const dataBR = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')

export default function NotasFiscaisCorretor({ corretor }) {
  const [notas, setNotas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)
  const competencia = mesCorrente()

  const carregar = useCallback(async () => {
    if (!corretor?.id) return
    setCarregando(true)
    setErro(null)
    try {
      setNotas(await listarNotasDoCorretor(corretor.id))
    } catch (e) {
      setErro(e.message || 'Nao foi possivel carregar suas notas.')
    } finally {
      setCarregando(false)
    }
  }, [corretor?.id])

  useEffect(() => {
    carregar()
  }, [carregar])

  const notaDoMes = useMemo(
    () => notas.find((n) => normalizarCompetencia(n.competencia) === normalizarCompetencia(competencia)) ?? null,
    [notas, competencia],
  )

  const abrir = async (path) => {
    try {
      const url = await urlAssinadaDaNota(path)
      if (url) window.open(url, '_blank', 'noopener')
    } catch (e) {
      setErro(e.message || 'Nao foi possivel abrir o arquivo.')
    }
  }

  const linkCorrecao = linkCorrecaoWhatsApp({
    nomeCorretor: corretor?.nome,
    competencia: notaDoMes ? notaDoMes.competencia : competencia,
  })

  return (
    <div className="nf-painel">
      <div className="nf-card">
        <h3>Nota fiscal de {competenciaPorExtenso(competencia)}</h3>

        {carregando ? (
          <p className="nf-vazio">Carregando…</p>
        ) : notaDoMes ? (
          <>
            <p className="nf-vazio" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={18} color="#c9a962" />
              Nota deste mês recebida em {dataBR(notaDoMes.created_at)} — {dinheiro(notaDoMes.valor_declarado)}.
            </p>
            <div className="nf-correcao" style={{ marginTop: 12 }}>
              <button type="button" className="nf-btn" onClick={() => abrir(notaDoMes.arquivo_path)}>
                <FileText size={16} /> Ver a nota que enviei
              </button>
              <a className="nf-btn" href={linkCorrecao} target="_blank" rel="noopener noreferrer">
                <MessageCircle size={16} /> Preciso corrigir
              </a>
              <span>Se o link não abrir, chame a controladoria em {WHATSAPP_CONTROLADORIA_EXIBICAO}.</span>
            </div>
          </>
        ) : (
          <NotaFiscalForm
            corretor={corretor}
            criadoPor={corretor?.id}
            competencia={competencia}
            onEnviado={carregar}
          />
        )}

        {erro && <p className="nf-falha">{erro}</p>}
      </div>

      <div className="nf-card">
        <h3>Minhas notas enviadas</h3>
        {notas.length === 0 ? (
          <p className="nf-vazio">Você ainda não enviou nenhuma nota por aqui.</p>
        ) : (
          <div className="nf-tabela-wrap">
            <table className="nf-tabela">
              <thead>
                <tr>
                  <th>Competência</th>
                  <th>Valor</th>
                  <th>Emissor</th>
                  <th>Enviada em</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {notas.map((n) => (
                  <tr key={n.id}>
                    <td>
                      {competenciaPorExtenso(n.competencia)}
                      {n.criado_por !== n.corretor_id && (
                        <span className="nf-pill terceiro" style={{ marginLeft: 8 }}>
                          enviada pela controladoria
                        </span>
                      )}
                      {n.observacao && <span className="nf-obs">“{n.observacao}”</span>}
                    </td>
                    <td>{dinheiro(n.valor_declarado)}</td>
                    <td>
                      {n.tipo_emissor === 'imobiliaria'
                        ? `PJ — ${n.nome_imobiliaria ?? 'imobiliária'}`
                        : 'PF — autônomo'}
                    </td>
                    <td>{dataBR(n.created_at)}</td>
                    <td>
                      <button type="button" className="nf-link" onClick={() => abrir(n.arquivo_path)}>
                        <FileText size={13} /> abrir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
