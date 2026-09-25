// Visão do BENEFICIÁRIO (Nohros, Beton, Ferretti, ... — genérica por cargo).
// Spec: docs/specs/2026-08-20-spec-visao-beneficiario.md (§ v2, 2026-09-25)
//
// O que esta tela mostra (decisão de negócio 20/08, mantida na v2):
//  - a FATIA DO PRÓPRIO CARGO (fatiaCargoDoPagamento — comissao_gerada × pct_cargo/pct_total)
//  - métricas MACRO NEUTRAS (nº de vendas, parcelas, % recebido do pró-soluto)
//  - NUNCA a fatia dos outros cargos, a comissão total, cliente, corretor ou valor de venda.
// Formato v2: a mesma moldura da Coordenação (barra lateral, faixa de números, abas
// Dashboard · Vendas · Pagamentos · Relatórios). A tela não faz conta: todo número vem
// dos helpers puros de comissaoCalculator (testados em visaoBeneficiario.test.js).
// Regras: totais SEMPRE de pagamentos_prosoluto (visualizacao-totais.md); listas >1000
// paginadas com ordenação determinística (leitura-de-listas-e-refetch.md).
import { useState, useEffect, useMemo } from 'react'
import {
  LayoutDashboard, Home, CreditCard, FileText, LogOut, Menu, X, ChevronLeft, ChevronRight,
  ChevronDown, Building, MapPin, CheckCircle, Clock, User,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { fetchAllPaginated } from '../utils/supabaseQuery'
import {
  resumoFatiaCargo, vendasDoBeneficiario, resumoPorVendaDoCargo, recorteRelatorioCargo,
} from '../utils/comissaoCalculator'
import { casaBusca } from '../utils/searchUtils'
import { formatDataBR } from '../utils/datas'
import { gerarRelatorioBeneficiarioPDF } from '../utils/relatorioBeneficiarioPDF'
import Ticker from '../components/Ticker'
import Autocomplete from '../components/Autocomplete'
import InputDataBR from '../components/InputDataBR'
import PainelCoordenacao from '../components/corretor/PainelCoordenacao'
import { labelTipoParcela } from '../components/corretor/ParcelaCard'
import logo from '../imgs/logo.png'
import '../styles/Dashboard.css'
import '../styles/CorretorDashboard.css'
import '../styles/BeneficiarioDashboard.css'

const fmt = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0)
const fmtPct = (v) => `${(Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesLabel = (ym) => {
  const [a, m] = String(ym || '').split('-')
  return MESES[Number(m) - 1] ? `${MESES[Number(m) - 1]}/${a}` : ym
}
const ultimoDia = (ym) => {
  const [a, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
}
// Mês corrente no relógio LOCAL (BRT): toISOString() é UTC e viraria o mês 3h antes.
const mesAtualLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const tipoVendaLabel = (v) => (v?.tipo_corretor === 'interno' ? 'Venda interna' : 'Venda externa')

const ABAS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'vendas', label: 'Vendas', icon: Home },
  { id: 'pagamentos', label: 'Pagamentos', icon: CreditCard },
  { id: 'relatorios', label: 'Relatórios', icon: FileText },
]
const FILTROS_VENDAS = { busca: '', situacao: 'todas', empreendimentoId: '', tipo: 'todos' }
const FILTROS_PAGAMENTOS = { status: 'todos', tipoParcela: 'todos', empreendimentoId: '', dataInicio: '', dataFim: '' }
const FILTROS_RELATORIO = { empreendimentoId: '', status: 'pago', mes: '', dataInicio: '', dataFim: '' }

const BeneficiarioDashboard = () => {
  const { userProfile, signOut } = useAuth()
  const cargo = userProfile?.cargo_beneficiario || ''

  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)
  const [vendas, setVendas] = useState([])
  const [pagamentos, setPagamentos] = useState([])
  const [cargos, setCargos] = useState([])
  const [coordenadoras, setCoordenadoras] = useState([])
  const [empreendimentos, setEmpreendimentos] = useState([])

  const [aba, setAba] = useState('dashboard')
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [empPainel, setEmpPainel] = useState('')
  const [mesPainel, setMesPainel] = useState('') // '' = tudo; 'YYYY-MM' = um mês
  const [filtrosVendas, setFiltrosVendas] = useState(FILTROS_VENDAS)
  const [filtrosPag, setFiltrosPag] = useState(FILTROS_PAGAMENTOS)
  const [filtrosRel, setFiltrosRel] = useState(FILTROS_RELATORIO)
  const [vendaAberta, setVendaAberta] = useState(null)
  const [gerandoPdf, setGerandoPdf] = useState(false)

  useEffect(() => {
    if (!cargo) { setCarregando(false); return }
    let vivo = true
    const carregar = async () => {
      try {
        // 1. Empreendimentos onde o cargo existe (escopo do beneficiário)
        const { data: cargosData, error: e1 } = await supabase
          .from('cargos_empreendimento')
          .select('empreendimento_id, nome_cargo, tipo_corretor, percentual')
        if (e1) throw e1
        const empIds = [...new Set((cargosData || []).filter(c => c.nome_cargo === cargo).map(c => c.empreendimento_id))]
        if (!empIds.length) throw new Error(`Cargo "${cargo}" não existe em nenhum empreendimento — verifique o cadastro.`)

        const [{ data: empsData, error: e2 }, { data: coordsData, error: e3 }] = await Promise.all([
          supabase.from('empreendimentos').select('id, nome').in('id', empIds),
          supabase.from('coordenadoras').select('*'),
        ])
        if (e2) throw e2
        if (e3) throw e3

        // 2. Vendas ativas do escopo (paginado, ordenação determinística)
        const vendasData = await fetchAllPaginated((from, to) =>
          supabase.from('vendas')
            .select('id, unidade, empreendimento_id, tipo_corretor, coordenadora_id, coordenadora_taxa, valor_pro_soluto, valor_venda, fator_comissao, status, situacao_contrato, data_distrato, excluido')
            .in('empreendimento_id', empIds)
            .or('excluido.eq.false,excluido.is.null')
            .order('id', { ascending: true })
            .range(from, to)
        )
        const ativas = vendasDoBeneficiario(vendasData)

        // 3. Parcelas das vendas ativas (paginado, concorrência — pode passar de 14k linhas)
        const vendaIds = ativas.map(v => v.id)
        const pags = []
        const LOTE = 100 // .in() com lista gigante estoura URL — fatiar por lote de vendas
        for (let i = 0; i < vendaIds.length; i += LOTE) {
          const ids = vendaIds.slice(i, i + LOTE)
          const parte = await fetchAllPaginated((from, to) =>
            supabase.from('pagamentos_prosoluto')
              .select('id, venda_id, tipo, numero_parcela, valor, status, data_prevista, data_pagamento, comissao_gerada, percentual_comissao_total, fator_comissao_aplicado, renegociacao_id')
              .in('venda_id', ids)
              .order('data_prevista', { ascending: true })
              .order('id', { ascending: true })
              .range(from, to),
            { concurrency: 4 }
          )
          pags.push(...parte)
        }
        if (!vivo) return
        setCargos(cargosData || [])
        setEmpreendimentos(empsData || [])
        setCoordenadoras(coordsData || [])
        setVendas(ativas)
        setPagamentos(pags)
      } catch (err) {
        if (vivo) setErro(err.message || String(err))
      } finally {
        if (vivo) setCarregando(false)
      }
    }
    carregar()
    return () => { vivo = false }
  }, [cargo])

  const nomeEmp = useMemo(() => new Map(empreendimentos.map(e => [String(e.id), e.nome])), [empreendimentos])
  const multiEmp = empreendimentos.length > 1
  const doEmp = (lista, empId) => (empId ? lista.filter(v => String(v.empreendimento_id) === String(empId)) : lista)

  // ── Números (todos dos helpers puros) ──────────────────────────────────────
  const resumoGeral = useMemo(
    () => resumoFatiaCargo({ vendas, pagamentos, cargo, cargos, coordenadoras }),
    [vendas, pagamentos, cargo, cargos, coordenadoras]
  )
  const recebidoNoMes = useMemo(
    () => resumoFatiaCargo({ vendas, pagamentos, cargo, cargos, coordenadoras, mes: mesAtualLocal() }).fatiaPaga,
    [vendas, pagamentos, cargo, cargos, coordenadoras]
  )
  const resumoPainel = useMemo(
    () => resumoFatiaCargo({ vendas: doEmp(vendas, empPainel), pagamentos, cargo, cargos, coordenadoras, mes: mesPainel }),
    [vendas, empPainel, pagamentos, cargo, cargos, coordenadoras, mesPainel]
  )
  const linhasVendas = useMemo(
    () => resumoPorVendaDoCargo({ vendas, pagamentos, cargo, cargos, coordenadoras }),
    [vendas, pagamentos, cargo, cargos, coordenadoras]
  )
  const vendasBusca = useMemo(
    () => vendas.map(v => ({ ...v, empreendimento_nome: nomeEmp.get(String(v.empreendimento_id)) || '' })),
    [vendas, nomeEmp]
  )
  const linhasVendasFiltradas = useMemo(() => {
    const f = filtrosVendas
    return linhasVendas.filter(l => {
      if (f.empreendimentoId && String(l.venda.empreendimento_id) !== String(f.empreendimentoId)) return false
      if (f.tipo !== 'todos' && (l.venda.tipo_corretor || 'externo') !== f.tipo) return false
      if (f.situacao === 'quitada' && !(l.nParcelas > 0 && l.nPagas === l.nParcelas)) return false
      if (f.situacao === 'parcial' && !(l.nPagas > 0 && l.nPagas < l.nParcelas)) return false
      if (f.situacao === 'a_receber' && l.nPagas > 0) return false
      if (f.busca && !casaBusca({ unidade: l.venda.unidade, empreendimento_nome: nomeEmp.get(String(l.venda.empreendimento_id)) }, f.busca, ['unidade', 'empreendimento_nome'])) return false
      return true
    })
  }, [linhasVendas, filtrosVendas, nomeEmp])
  // Resumo da lista filtrada = o mesmo recorte das outras abas (tela nunca faz conta).
  const resumoVendasFiltradas = useMemo(
    () => recorteRelatorioCargo({ vendas: linhasVendasFiltradas.map(l => l.venda), pagamentos, cargo, cargos, coordenadoras }).totais,
    [linhasVendasFiltradas, pagamentos, cargo, cargos, coordenadoras]
  )

  const recortePag = useMemo(
    () => recorteRelatorioCargo({ vendas, pagamentos, cargo, cargos, coordenadoras, filtros: filtrosPag }),
    [vendas, pagamentos, cargo, cargos, coordenadoras, filtrosPag]
  )
  const gruposPag = useMemo(() => {
    const vendasDoRecorte = [...new Map(recortePag.linhas.map(l => [String(l.venda.id), l.venda])).values()]
    return resumoPorVendaDoCargo({
      vendas: vendasDoRecorte, pagamentos: recortePag.linhas.map(l => l.pagamento), cargo, cargos, coordenadoras,
    })
  }, [recortePag, cargo, cargos, coordenadoras])
  const linhasDaVenda = useMemo(() => {
    const m = new Map()
    for (const l of recortePag.linhas) {
      const k = String(l.venda.id)
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(l)
    }
    return m
  }, [recortePag])

  const recorteRel = useMemo(
    () => recorteRelatorioCargo({ vendas, pagamentos, cargo, cargos, coordenadoras, filtros: filtrosRel }),
    [vendas, pagamentos, cargo, cargos, coordenadoras, filtrosRel]
  )

  const tickerData = [
    { name: `${cargo.toUpperCase()} RECEBIDO`, value: fmt(resumoGeral.fatiaPaga), change: '', type: 'positive' },
    { name: 'RECEBIDO NO MÊS', value: fmt(recebidoNoMes), change: '', type: 'positive' },
    { name: 'A RECEBER', value: fmt(resumoGeral.fatiaPendente), change: '', type: 'neutral' },
    { name: 'VENDAS ATIVAS', value: String(resumoGeral.nVendas), change: '', type: 'neutral' },
    { name: '% PRÓ-SOLUTO RECEBIDO', value: `${resumoGeral.pctRecebido.toFixed(1)}%`, change: '', type: 'neutral' },
    { name: 'VENCIDAS EM ABERTO', value: String(resumoGeral.nVencidasAbertas), change: '', type: 'neutral' },
  ]

  const irPara = (id) => { setAba(id); setMenuOpen(false) }
  const verParcelas = (vendaId) => {
    setFiltrosPag(FILTROS_PAGAMENTOS)
    setVendaAberta(vendaId)
    irPara('pagamentos')
    setTimeout(() => document.getElementById(`bnf-venda-${vendaId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  const gerarPdf = () => {
    setGerandoPdf(true)
    try {
      gerarRelatorioBeneficiarioPDF({
        cargo,
        nomeUsuario: userProfile?.nome || cargo,
        vendas, pagamentos, cargos, coordenadoras,
        filtros: filtrosRel,
        nomeEmpreendimento: filtrosRel.empreendimentoId
          ? (nomeEmp.get(String(filtrosRel.empreendimentoId)) || '')
          : 'Todos os empreendimentos',
      })
    } catch (err) {
      console.error('Erro ao gerar PDF:', err)
      alert('Erro ao gerar o relatório. Tente novamente.')
    } finally {
      setGerandoPdf(false)
    }
  }

  const titulo = { dashboard: `Painel ${cargo}`, vendas: 'Vendas', pagamentos: 'Pagamentos', relatorios: 'Relatórios' }[aba]

  const selectEmpreendimento = (valor, onChange, id, className = 'filter-select') => (
    <select id={id} value={valor} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">Todos</option>
      {empreendimentos.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
    </select>
  )

  const statusVenda = (l) => {
    if (l.nParcelas > 0 && l.nPagas === l.nParcelas) return { cls: 'pago', label: 'Quitada', Icon: CheckCircle }
    if (l.nPagas > 0) return { cls: 'parcial', label: `${Math.round(l.pctRecebido)}% recebido`, Icon: Clock }
    return { cls: 'pendente', label: 'A receber', Icon: Clock }
  }

  let conteudo
  if (!cargo) {
    conteudo = (
      <div className="empty-state-box">
        <User size={48} />
        <h3>Acesso sem cargo vinculado</h3>
        <p>Seu acesso de beneficiário ainda não tem um cargo definido. Fale com o Admin.</p>
      </div>
    )
  } else if (carregando) {
    conteudo = (
      <div className="loading-state">
        <div className="loading-spinner"></div>
        <p>Carregando as vendas e parcelas do cargo {cargo}…</p>
      </div>
    )
  } else if (erro) {
    conteudo = (
      <div className="empty-state-box">
        <X size={48} />
        <h3>Não foi possível carregar</h3>
        <p>{erro}</p>
        <button type="button" className="btn-clear-filters" onClick={() => window.location.reload()}>Tentar de novo</button>
      </div>
    )
  } else if (aba === 'dashboard') {
    conteudo = (
      <>
        {multiEmp && (
          <div className="coord-filtros bnf-filtro-emp">
            <label htmlFor="bnf-emp-painel">Empreendimento</label>
            {selectEmpreendimento(empPainel, (v) => { setEmpPainel(v); setMesPainel('') }, 'bnf-emp-painel', '')}
          </div>
        )}
        <PainelCoordenacao
          resumo={resumoPainel}
          carregando={false}
          erro={null}
          mes={mesPainel}
          setMes={setMesPainel}
          rotulos={{
            comissao: `Comissão ${cargo}`,
            vendas: 'Vendas ativas',
            semPagas: 'Nenhuma parcela paga ainda.',
            vazio: {
              titulo: 'Nenhuma venda ativa ainda',
              texto: `Assim que houver venda ativa num empreendimento com o cargo ${cargo}, a sua comissão e o resumo da carteira aparecem aqui.`,
            },
          }}
        />
      </>
    )
  } else if (aba === 'vendas') {
    conteudo = (
      <div className="content-section">
        <div className="filters-section">
          <Autocomplete
            items={vendasBusca}
            fields={['unidade', 'empreendimento_nome']}
            value={filtrosVendas.busca}
            onQueryChange={(q) => setFiltrosVendas({ ...filtrosVendas, busca: q })}
            onSelect={(v) => setFiltrosVendas({ ...filtrosVendas, busca: v.unidade || '' })}
            getLabel={(v) => `Unidade ${v.unidade || ''}`}
            getSub={(v) => v.empreendimento_nome}
            placeholder="Buscar unidade…"
          />
          <div className="filters-grid">
            <div className="filter-item">
              <label className="filter-label">Situação</label>
              <select value={filtrosVendas.situacao} onChange={(e) => setFiltrosVendas({ ...filtrosVendas, situacao: e.target.value })} className="filter-select">
                <option value="todas">Todas</option>
                <option value="a_receber">Nada recebido ainda</option>
                <option value="parcial">Recebendo</option>
                <option value="quitada">Quitadas</option>
              </select>
            </div>
            <div className="filter-item">
              <label className="filter-label">Tipo da venda</label>
              <select value={filtrosVendas.tipo} onChange={(e) => setFiltrosVendas({ ...filtrosVendas, tipo: e.target.value })} className="filter-select">
                <option value="todos">Todas</option>
                <option value="externo">Externa</option>
                <option value="interno">Interna</option>
              </select>
            </div>
            {multiEmp && (
              <div className="filter-item">
                <label className="filter-label">Empreendimento</label>
                {selectEmpreendimento(filtrosVendas.empreendimentoId, (v) => setFiltrosVendas({ ...filtrosVendas, empreendimentoId: v }))}
              </div>
            )}
          </div>
          <button className="btn-clear-filters" onClick={() => setFiltrosVendas(FILTROS_VENDAS)}>
            <X size={16} />
            Limpar Filtros
          </button>
        </div>

        <div className="pagamentos-resumo">
          <div className="resumo-card">
            <span className="resumo-label">Comissão {cargo} total</span>
            <span className="resumo-valor">{fmt(resumoVendasFiltradas.fatiaTotal)}</span>
          </div>
          <div className="resumo-card">
            <span className="resumo-label">Recebida</span>
            <span className="resumo-valor pago">{fmt(resumoVendasFiltradas.fatiaPaga)}</span>
          </div>
          <div className="resumo-card">
            <span className="resumo-label">A receber</span>
            <span className="resumo-valor pendente">{fmt(resumoVendasFiltradas.fatiaPendente)}</span>
          </div>
          <div className="resumo-card">
            <span className="resumo-label">Vendas</span>
            <span className="resumo-valor comissao">{linhasVendasFiltradas.length}</span>
          </div>
        </div>

        {linhasVendasFiltradas.length === 0 ? (
          <div className="empty-state-box">
            <Home size={48} />
            <h3>Nenhuma venda encontrada</h3>
            <p>Não há vendas que correspondam aos filtros selecionados.</p>
          </div>
        ) : (
          <div className="vendas-list">
            {linhasVendasFiltradas.map((l) => {
              const { cls, label, Icon } = statusVenda(l)
              return (
                <div key={l.venda.id} className="venda-card">
                  <div className="venda-main">
                    <div className="venda-info">
                      <h4>Unidade {l.venda.unidade || '—'}</h4>
                      <div className="venda-meta">
                        <span className="venda-empreendimento"><Building size={12} />{nomeEmp.get(String(l.venda.empreendimento_id))}</span>
                        <span className="venda-unidade"><MapPin size={12} />{tipoVendaLabel(l.venda)}</span>
                        <span className={`status-tag ${cls}`}><Icon size={12} />{label}</span>
                      </div>
                    </div>
                    <div className="venda-expand-btn-wrapper">
                      <button className="venda-expand-btn" onClick={() => verParcelas(l.venda.id)} title="Ver as parcelas desta venda">
                        <CreditCard size={16} />
                        <span>Ver parcelas</span>
                        <ChevronRight size={16} />
                      </button>
                    </div>
                    <div className="venda-values">
                      <div className="venda-valor">
                        <span className="label">Pró-soluto · {l.nPagas}/{l.nParcelas} pagas</span>
                        <span className="value">{fmt(l.valorParcelas)}</span>
                      </div>
                      <div className="venda-comissao">
                        <span className="label">{cargo} ({fmtPct(l.pctCargo)})</span>
                        <span className="value highlight">{fmt(l.fatiaTotal)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  } else if (aba === 'pagamentos') {
    conteudo = (
      <div className="content-section">
        <div className="filters-section">
          <div className="filters-grid">
            <div className="filter-item">
              <label className="filter-label">Status</label>
              <select value={filtrosPag.status} onChange={(e) => setFiltrosPag({ ...filtrosPag, status: e.target.value })} className="filter-select">
                <option value="todos">Todos</option>
                <option value="pendente">Pendente</option>
                <option value="pago">Pago</option>
              </select>
            </div>
            <div className="filter-item">
              <label className="filter-label">Tipo de Pagamento</label>
              <select value={filtrosPag.tipoParcela} onChange={(e) => setFiltrosPag({ ...filtrosPag, tipoParcela: e.target.value })} className="filter-select">
                <option value="todos">Todos</option>
                <option value="sinal">Sinal</option>
                <option value="entrada">Entrada</option>
                <option value="parcela_entrada">Parcela Entrada</option>
                <option value="balao">Balão</option>
              </select>
            </div>
            {multiEmp && (
              <div className="filter-item">
                <label className="filter-label">Empreendimento</label>
                {selectEmpreendimento(filtrosPag.empreendimentoId, (v) => setFiltrosPag({ ...filtrosPag, empreendimentoId: v }))}
              </div>
            )}
            <div className="filter-item">
              <label className="filter-label">Data Início</label>
              <InputDataBR type="date" value={filtrosPag.dataInicio} onChange={(e) => setFiltrosPag({ ...filtrosPag, dataInicio: e.target.value })} className="filter-input-date" />
            </div>
            <div className="filter-item">
              <label className="filter-label">Data Fim</label>
              <InputDataBR type="date" value={filtrosPag.dataFim} onChange={(e) => setFiltrosPag({ ...filtrosPag, dataFim: e.target.value })} className="filter-input-date" />
            </div>
          </div>
          <button className="btn-clear-filters" onClick={() => setFiltrosPag(FILTROS_PAGAMENTOS)}>
            <X size={16} />
            Limpar Filtros
          </button>
        </div>

        <div className="pagamentos-resumo">
          <div className="resumo-card">
            <span className="resumo-label">Comissão {cargo} a receber</span>
            <span className="resumo-valor pendente">{fmt(recortePag.totais.fatiaPendente)}</span>
          </div>
          <div className="resumo-card">
            <span className="resumo-label">Comissão {cargo} recebida</span>
            <span className="resumo-valor pago">{fmt(recortePag.totais.fatiaPaga)}</span>
          </div>
          <div className="resumo-card">
            <span className="resumo-label">Comissão {cargo} total</span>
            <span className="resumo-valor">{fmt(recortePag.totais.fatiaTotal)}</span>
          </div>
        </div>

        <div className="vendas-pagamentos-lista">
          {gruposPag.length === 0 ? (
            <div className="empty-state-box">
              <CreditCard size={48} />
              <h3>Nenhum pagamento encontrado</h3>
              <p>Não há parcelas que correspondam aos filtros selecionados.</p>
            </div>
          ) : gruposPag.map((g) => {
            const aberta = String(vendaAberta) === String(g.venda.id)
            return (
              <div key={g.venda.id} id={`bnf-venda-${g.venda.id}`} className="venda-pagamento-card">
                <div
                  className={`venda-pagamento-header ${aberta ? 'expanded' : ''}`}
                  onClick={() => setVendaAberta(aberta ? null : g.venda.id)}
                >
                  <div className="venda-info">
                    <div className="venda-titulo">
                      <Building size={18} />
                      <strong>{nomeEmp.get(String(g.venda.empreendimento_id)) || 'Empreendimento'}</strong>
                    </div>
                    <div className="venda-subtitulo">
                      <span>Unidade: {g.venda.unidade || '-'}</span>
                      <span className="separator">•</span>
                      <span>{g.nParcelas} parcelas</span>
                      <span className="separator">•</span>
                      <span>{tipoVendaLabel(g.venda)} ({fmtPct(g.pctCargo)})</span>
                    </div>
                  </div>
                  <div className="venda-valores">
                    <div className="valor-item">
                      <span className="valor-label">Parcelas</span>
                      <span className="valor-number">{fmt(g.valorParcelas)}</span>
                    </div>
                    <div className="valor-item">
                      <span className="valor-label">Comissão {cargo}</span>
                      <span className="valor-number comissao">{fmt(g.fatiaTotal)}</span>
                    </div>
                    <div className="valor-item">
                      <span className="valor-label">Recebido</span>
                      <span className="valor-number pago">{fmt(g.fatiaPaga)}</span>
                    </div>
                    <div className="valor-item">
                      <span className="valor-label">A receber</span>
                      <span className="valor-number pendente">{fmt(g.fatiaPendente)}</span>
                    </div>
                  </div>
                  <div className="header-actions-pagamento">
                    <button
                      type="button"
                      className="btn-ver-pagamentos"
                      onClick={(e) => { e.stopPropagation(); setVendaAberta(aberta ? null : g.venda.id) }}
                    >
                      {aberta ? 'Ocultar parcelas' : 'Ver parcelas'}
                      <ChevronDown size={16} className={aberta ? 'rotated' : ''} />
                    </button>
                  </div>
                </div>
                {aberta && (
                  <div className="table-container bnf-parcelas">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Vencimento</th>
                          <th>Pagamento</th>
                          <th>Parcela</th>
                          <th>Valor</th>
                          <th>Comissão {cargo}</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(linhasDaVenda.get(String(g.venda.id)) || []).map(({ pagamento: p, fatia }) => (
                          <tr key={p.id}>
                            <td>{formatDataBR(p.data_prevista)}</td>
                            <td>{p.data_pagamento ? formatDataBR(p.data_pagamento) : '—'}</td>
                            <td>{labelTipoParcela(p)}{p.renegociacao_id ? ' · aditivo' : ''}</td>
                            <td>{fmt(p.valor)}</td>
                            <td className="comissao-cell">{fmt(fatia)}</td>
                            <td><span className={`status-tag ${p.status === 'pago' ? 'pago' : 'pendente'}`}>{p.status === 'pago' ? 'Pago' : 'Pendente'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  } else if (aba === 'relatorios') {
    const setRel = (patch) => setFiltrosRel({ ...filtrosRel, ...patch })
    conteudo = (
      <div className="content-section">
        <div className="relatorio-gerador">
          <div className="gerador-header">
            <FileText size={24} />
            <div>
              <h3>Gerar Relatório em PDF</h3>
              <p>Escolha o recorte e gere o relatório da sua comissão {cargo}</p>
            </div>
          </div>
          <div className="gerador-filtros">
            {multiEmp && (
              <div className="filtro-grupo">
                <label><Building size={14} /> Empreendimento</label>
                <select value={filtrosRel.empreendimentoId} onChange={(e) => setRel({ empreendimentoId: e.target.value })}>
                  <option value="">Todos os empreendimentos</option>
                  {empreendimentos.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </div>
            )}
            <div className="filtro-grupo">
              <label>Status</label>
              <select value={filtrosRel.status} onChange={(e) => setRel({ status: e.target.value })}>
                <option value="pago">Pagos</option>
                <option value="pendente">Pendentes</option>
                <option value="todos">Todos</option>
              </select>
            </div>
            <div className="filtro-grupo">
              <label>Mês</label>
              <select
                value={filtrosRel.mes}
                onChange={(e) => {
                  const ym = e.target.value
                  setRel(ym ? { mes: ym, dataInicio: `${ym}-01`, dataFim: ultimoDia(ym) } : { mes: '', dataInicio: '', dataFim: '' })
                }}
              >
                <option value="">Todo o período</option>
                {resumoGeral.serieMensal.map(([ym]) => <option key={ym} value={ym}>{mesLabel(ym)}</option>)}
              </select>
            </div>
            <div className="filtro-grupo">
              <label>Data Início</label>
              <InputDataBR type="date" value={filtrosRel.dataInicio} onChange={(e) => setRel({ dataInicio: e.target.value, mes: '' })} />
            </div>
            <div className="filtro-grupo">
              <label>Data Fim</label>
              <InputDataBR type="date" value={filtrosRel.dataFim} onChange={(e) => setRel({ dataFim: e.target.value, mes: '' })} />
            </div>
          </div>
          {(filtrosRel.empreendimentoId || filtrosRel.status !== 'pago' || filtrosRel.dataInicio || filtrosRel.dataFim) && (
            <button className="btn-clear-filters" onClick={() => setFiltrosRel(FILTROS_RELATORIO)} style={{ marginBottom: '16px' }}>
              <X size={16} />
              Limpar Filtros
            </button>
          )}
          <button className="btn-gerar-pdf" onClick={gerarPdf} disabled={gerandoPdf || recorteRel.linhas.length === 0}>
            {gerandoPdf ? (<><Clock size={20} className="spinning" />Gerando...</>) : (<><FileText size={20} />Gerar PDF</>)}
          </button>
        </div>

        <div className="relatorio-resumo">
          <h3>O que vai no relatório</h3>
          <div className="resumo-cards">
            <div className="resumo-card-item">
              <span className="resumo-titulo">Vendas · parcelas</span>
              <span className="resumo-numero">{recorteRel.totais.nVendas} · {recorteRel.totais.nParcelas}</span>
            </div>
            <div className="resumo-card-item">
              <span className="resumo-titulo">Comissão {cargo}</span>
              <span className="resumo-numero verde">{fmt(recorteRel.totais.fatiaTotal)}</span>
            </div>
            <div className="resumo-card-item">
              <span className="resumo-titulo">Recebida</span>
              <span className="resumo-numero azul">{fmt(recorteRel.totais.fatiaPaga)}</span>
            </div>
            <div className="resumo-card-item">
              <span className="resumo-titulo">A receber</span>
              <span className="resumo-numero amarelo">{fmt(recorteRel.totais.fatiaPendente)}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`dashboard-container corretor-shell corretor-tab-${aba} beneficiario-shell`}>
      <div className={`sidebar-overlay ${menuOpen ? 'active' : ''}`} onClick={() => setMenuOpen(false)} />

      <aside className={`sidebar ${menuOpen ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="logo">
            <img src={logo} alt="IM Incorporadora" className="logo-sidebar" />
            <span className="logo-text">IM Incorporadora</span>
          </div>
          <button className="close-menu" onClick={() => setMenuOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {ABAS.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} className={`nav-item ${aba === item.id ? 'active' : ''}`} onClick={() => irPara(item.id)} title={item.label}>
                <Icon size={20} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <button className="collapse-btn" onClick={() => setSidebarCollapsed(c => !c)} title={sidebarCollapsed ? 'Expandir' : 'Recolher'}>
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
          <div className="user-info">
            <div className="user-avatar">
              <User size={20} />
            </div>
            <div className="user-details">
              <span className="user-name">{userProfile?.nome || cargo}</span>
              <span className="user-role">Beneficiário · {cargo}</span>
            </div>
          </div>
          <button className="logout-btn" onClick={signOut} title="Sair">
            <LogOut size={20} />
          </button>
        </div>
      </aside>

      <main className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <Ticker data={tickerData} />
        <header className="main-header">
          <button className="menu-toggle" onClick={() => setMenuOpen(true)}>
            <Menu size={24} />
          </button>
          <h1>{titulo}</h1>
        </header>
        <div className="content-section">
          {conteudo}
        </div>
      </main>
    </div>
  )
}

export default BeneficiarioDashboard
