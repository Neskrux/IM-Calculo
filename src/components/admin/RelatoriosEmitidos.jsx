// Relatórios emitidos — prova do que o IM Cálculo emitiu (migration 043).
// Spec: docs/specs/2026-11-09-spec-registro-relatorios.md
// Reclamação de valor se resolve aqui: abre o PDF emitido, vê os filtros, as parcelas
// com o valor de cada uma, e o histórico de mudança de cada parcela.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { urlPdfRelatorio } from '../../utils/registroRelatorioApi'
import { filtrosVisiveis } from '../../utils/registroRelatorio'

const LIMITE = 200 // lista dos mais recentes; filtrar por corretor para ir além
const brl = (n) => (parseFloat(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const quando = (ts) => new Date(ts).toLocaleString('pt-BR')
const ORIGEM = { admin: 'Admin', corretor: 'Corretor', admin_ver_pdf_corretor: 'Admin (PDF do corretor)' }

function HistoricoParcela({ pagamentoId }) {
  const [linhas, setLinhas] = useState(null)
  const [erro, setErro] = useState('')
  useEffect(() => {
    let vivo = true
    supabase.from('pagamentos_prosoluto_historico')
      .select('*').eq('pagamento_id', pagamentoId)
      .order('mudado_em', { ascending: false }).order('id', { ascending: false })
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setErro(error.message); else setLinhas(data || [])
      })
    return () => { vivo = false }
  }, [pagamentoId])
  if (erro) return <div className="re-erro">Erro ao ler histórico: {erro}</div>
  if (!linhas) return <div className="re-muted">Carregando histórico…</div>
  if (!linhas.length) return <div className="re-muted">Sem mudanças registradas desde a ativação do histórico.</div>
  const campo = (o, k) => (o?.[k] ?? '—')
  return (
    <table className="re-tabela re-historico">
      <thead><tr><th>Quando</th><th>Origem</th><th>Status</th><th>Valor</th><th>Comissão</th><th>Data pgto</th></tr></thead>
      <tbody>
        {linhas.map(l => (
          <tr key={l.id}>
            <td>{quando(l.mudado_em)}</td>
            <td>{l.origem}{l.operacao === 'DELETE' ? ' (excluída)' : ''}</td>
            <td>{campo(l.antes, 'status')} → {campo(l.depois, 'status')}</td>
            <td>{campo(l.antes, 'valor')} → {campo(l.depois, 'valor')}</td>
            <td>{campo(l.antes, 'comissao_gerada')} → {campo(l.depois, 'comissao_gerada')}</td>
            <td>{campo(l.antes, 'data_pagamento')} → {campo(l.depois, 'data_pagamento')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function RelatoriosEmitidos({ corretores = [], empreendimentos = [], versao = 0 }) {
  const [corretorId, setCorretorId] = useState('')
  const [lista, setLista] = useState([])
  const [chaveCarregada, setChaveCarregada] = useState(null)
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState(null)
  const [historicoDe, setHistoricoDe] = useState(null)

  useEffect(() => {
    let vivo = true
    let q = supabase.from('relatorios_emitidos')
      .select('*, emissor:usuarios!relatorios_emitidos_emitido_por_fkey(nome), corretor:usuarios!relatorios_emitidos_corretor_id_fkey(nome)')
      .order('emitido_em', { ascending: false }).order('id', { ascending: false })
      .range(0, LIMITE - 1)
    if (corretorId) q = q.eq('corretor_id', corretorId)
    q.then(({ data, error }) => {
      if (!vivo) return
      setErro(error ? error.message : '')
      if (!error) setLista(data || [])
      setChaveCarregada(`${corretorId}|${versao}`)
    })
    return () => { vivo = false }
  }, [corretorId, versao])

  const carregando = chaveCarregada !== `${corretorId}|${versao}`

  const abrirPdf = async (r) => {
    try {
      window.open(await urlPdfRelatorio(r.pdf_path), '_blank', 'noopener')
    } catch (e) { setErro(e.message) }
  }

  return (
    <div className="relatorios-emitidos">
      <div className="re-topo">
        <h3>Relatórios emitidos</h3>
        <select value={corretorId} onChange={e => setCorretorId(e.target.value)} aria-label="Filtrar por corretor">
          <option value="">Todos os corretores</option>
          {corretores.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </div>
      {erro && <div className="re-erro">{erro}</div>}
      {carregando && <div className="re-muted">Carregando…</div>}
      {!carregando && !lista.length && <div className="re-muted">Nenhum relatório emitido{corretorId ? ' para este corretor' : ''} ainda.</div>}
      {!!lista.length && (
        <div className="re-scroll">
          <table className="re-tabela">
            <thead>
              <tr><th>Emitido em</th><th>Por</th><th>Origem</th><th>Corretor</th><th>Cargo</th><th>Empreend.</th><th>Período</th><th>Total</th><th>Pago</th><th>Pendente</th><th></th></tr>
            </thead>
            <tbody>
              {lista.map(r => {
                const fv = filtrosVisiveis(r.filtros || {}, { corretores, empreendimentos })
                const ehPdfCorretor = r.origem !== 'admin'
                return [
                  <tr key={r.id}>
                    <td>{quando(r.emitido_em)}</td>
                    <td>{r.emissor?.nome || '—'}</td>
                    <td>{ORIGEM[r.origem] || r.origem}</td>
                    <td>{r.corretor?.nome || 'Geral'}</td>
                    <td>{ehPdfCorretor ? 'Corretor' : fv.cargo}</td>
                    <td>{ehPdfCorretor ? 'Todos' : fv.empreendimento}</td>
                    <td>{fv.periodo}</td>
                    <td>{brl(r.total)}</td>
                    <td>{brl(r.pago)}</td>
                    <td>{brl(r.pendente)}</td>
                    <td className="re-acoes">
                      <button type="button" onClick={() => abrirPdf(r)}>Abrir PDF</button>
                      <button type="button" onClick={() => { setAberto(aberto === r.id ? null : r.id); setHistoricoDe(null) }}>
                        {aberto === r.id ? 'Fechar' : `Parcelas (${r.qtd_parcelas})`}
                      </button>
                    </td>
                  </tr>,
                  aberto === r.id && (
                    <tr key={`${r.id}-p`} className="re-detalhe">
                      <td colSpan={11}>
                        <div className="re-muted">Status: {fv.status} · Distratos: {fv.distratos} · SHA-256 do PDF: <code>{r.pdf_sha256.slice(0, 16)}…</code></div>
                        <table className="re-tabela">
                          <thead><tr><th>Parcela</th><th>Valor</th><th>Comissão no relatório</th><th>Status no relatório</th><th></th></tr></thead>
                          <tbody>
                            {(r.parcelas || []).map(p => [
                              <tr key={p.id}>
                                <td><code>{String(p.id).slice(0, 8)}</code></td>
                                <td>{brl(p.valor)}</td>
                                <td>{brl(p.comissao)}</td>
                                <td>{p.status}</td>
                                <td><button type="button" onClick={() => setHistoricoDe(historicoDe === p.id ? null : p.id)}>Histórico</button></td>
                              </tr>,
                              historicoDe === p.id && (
                                <tr key={`${p.id}-h`}><td colSpan={5}><HistoricoParcela pagamentoId={p.id} /></td></tr>
                              ),
                            ])}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
          {lista.length === LIMITE && <div className="re-muted">Mostrando os {LIMITE} mais recentes — filtre por corretor para ver os anteriores.</div>}
        </div>
      )}
    </div>
  )
}

