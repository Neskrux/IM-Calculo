import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { deleteCliente } from '../services/adminClientes'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { 
  Users, DollarSign, TrendingUp, Plus, Edit2, Trash2, 
  Search, Filter, LogOut, Menu, X, ChevronDown, Save, Eye,
  Calculator, Calendar, User, Briefcase, CheckCircle, Clock, UserPlus, Mail, Lock, Percent, Building, PlusCircle, CreditCard, Check, Upload, FileText, Trash, UserCircle, Phone, MapPin, Camera, Download, FileDown, LayoutDashboard, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeft, AlertCircle, RefreshCw, ClipboardList, CheckCircle2, XCircle, MessageSquare
} from 'lucide-react'
import logo from '../imgs/logo.png'
import Ticker from '../components/Ticker'
import HomeDashboard from './HomeDashboard'
import EmpreendimentoGaleria from '../components/EmpreendimentoGaleria'
// import CadastrarCorretores from '../components/CadastrarCorretores'
// import ImportarVendas from '../components/ImportarVendas'
import '../styles/Dashboard.css'
import '../styles/EmpreendimentosPage.css'
import { LayoutGrid, List } from 'lucide-react'
import { safeGet, safeSet } from '../utils/storage'
import { calcularFatorComissao, calcularComissaoPagamento, dataEfetiva } from '../utils/comissaoCalculator'
import { parseDataLocal, formatDataBR } from '../utils/datas'
import { triggerFullSync, triggerNormalizeOnly, probeSienge, pollRunUntilDone } from '../lib/siengeSyncApi'
import { sortParcelas } from '../utils/parcelasSort'

// ─── SPEC: Preservação de pagamentos auditados ───────────────────────────────
// Ref: docs/SPEC_PRESERVACAO_PAGAMENTOS_AUDITADOS.md
//
// Campos da tabela "vendas" que NÃO disparam recriação da grade de pagamentos
// (edição puramente cadastral — RF-2 / §5.1).
const CAMPOS_CADASTRAIS_VENDA = new Set([
  'descricao',
  'bloco',
  'andar',
  'unidade',
  'contrato_url',
  'contrato_nome',
])

// Campos da grade financeira: qualquer mudança nesses campos pode exigir
// recriação / propagação de pagamentos (RF-3 / §5.2).
const CAMPOS_FINANCEIROS_VENDA = new Set([
  'valor_venda',
  'tipo_corretor',
  'data_venda',
  'data_entrada',
  'teve_sinal',
  'valor_sinal',
  'teve_entrada',
  'valor_entrada',
  'parcelou_entrada',
  'periodicidade_parcelas',
  'qtd_parcelas_entrada',
  'valor_parcela_entrada',
  'teve_balao',
  'periodicidade_balao',
  'qtd_balao',
  'valor_balao',
  'teve_permuta',
  'valor_permuta',
  'tipo_permuta',
  'valor_pro_soluto',
  'fator_comissao',
  'empreendimento_id',
  'corretor_id',
  'grupos_parcelas_entrada', // estado do form (não coluna direta)
  'grupos_balao',            // estado do form (não coluna direta)
  'datas_parcelas_override', // estado do form (não coluna direta)
  'datas_balao_override',    // estado do form (não coluna direta)
  'dia_pagamento_parcelas',
  'dia_pagamento_balao',
])

// Colunas imutáveis em linha pago (§B da SPEC).
// Migration 018 afrouxou a protecao: fator_comissao_aplicado e
// percentual_comissao_total sao snapshots/metadados (nao dinheiro) e ficaram
// editaveis em pago. Trigger 017/018 segue blindando os campos financeiros.
const COLUNAS_IMUTAVEIS_PAGO = [
  'tipo', 'status', 'comissao_gerada',
  'created_at', 'valor', 'data_pagamento',
]

/**
 * Verifica se uma venda possui ao menos uma parcela auditada (status='pago').
 * RF-1 da SPEC.
 */
async function verificarBaixasExistentes(supabaseClient, vendaId) {
  const { data, error } = await supabaseClient
    .from('pagamentos_prosoluto')
    .select('id')
    .eq('venda_id', vendaId)
    .eq('status', 'pago')
    .limit(1)
  if (error) throw error
  return (data?.length ?? 0) > 0
}

/**
 * Detecta se o formulário de venda mudou algum campo financeiro em relação
 * ao estado persistido (selectedItem). Usado para decidir entre caminho
 * cadastral (RF-2) e propagação/bloqueio (RF-3/RF-4).
 */
function detectarMudancaFinanceira(vendaForm, selectedItem, gruposParcelasEntrada, gruposBalao) {
  if (!selectedItem) return false

  const camposSimples = [
    'valor_venda', 'tipo_corretor', 'data_venda', 'data_entrada',
    'teve_sinal', 'valor_sinal', 'teve_entrada', 'valor_entrada',
    'parcelou_entrada', 'periodicidade_parcelas', 'qtd_parcelas_entrada',
    'valor_parcela_entrada', 'teve_balao', 'periodicidade_balao',
    'qtd_balao', 'valor_balao', 'teve_permuta', 'valor_permuta',
    'tipo_permuta', 'empreendimento_id', 'corretor_id',
    'dia_pagamento_parcelas', 'dia_pagamento_balao',
  ]

  for (const campo of camposSimples) {
    const formVal = vendaForm[campo] ?? null
    const dbVal   = selectedItem[campo] ?? null
    // Comparação tolerante a string vs number
    if (String(formVal ?? '') !== String(dbVal ?? '')) return true
  }

  // Overrides de datas (estado do form, não existe no selectedItem — qualquer
  // override não vazio é considerado mudança de cronograma)
  const temOverrideParcelas = Object.keys(vendaForm.datas_parcelas_override || {}).length > 0
  const temOverrideBalao    = Object.keys(vendaForm.datas_balao_override || {}).length > 0
  if (temOverrideParcelas || temOverrideBalao) return true

  return false
}

/**
 * Detecta se a mudança financeira é "estrutural" — ou seja, incompatível com
 * propagação cirúrgica (§G / RF-4): muda tipo de fluxo (integral ↔ parcelado)
 * quando já existem parcelas pago.
 *
 * Recebe a lista de pagamentos existentes da venda e o novo estado do form.
 */
function detectarMudancaEstrutural(pagamentosExistentes, vendaForm) {
  const temIntegralPago = pagamentosExistentes.some(
    p => p.status === 'pago' && p.tipo === 'comissao_integral'
  )
  const temParcelasPagas = pagamentosExistentes.some(
    p => p.status === 'pago' && p.tipo !== 'comissao_integral'
  )

  const valorEntradaParaCalculo =
    (vendaForm.teve_sinal ? (parseFloat(vendaForm.valor_sinal) || 0) : 0) +
    (vendaForm.teve_entrada && !vendaForm.parcelou_entrada
      ? (parseFloat(vendaForm.valor_entrada) || 0)
      : 0)
  const valorVenda = parseFloat(vendaForm.valor_venda) || 0
  const percentualEntrada = valorVenda > 0 ? (valorEntradaParaCalculo / valorVenda) * 100 : 0
  const novoSeriaIntegral = percentualEntrada >= 20 && !vendaForm.parcelou_entrada

  // Mudança de estrutura: tinha integral pago e agora seria parcelado (ou vice-versa)
  if (temIntegralPago && !novoSeriaIntegral) return true
  if (temParcelasPagas && novoSeriaIntegral) return true

  return false
}

/**
 * Propaga mudanças de cronograma (data_entrada, periodicidade, overrides)
 * para pagamentos existentes, atualizando APENAS data_prevista das linhas pago
 * e substituindo linhas pendente. RF-3 / §E da SPEC.
 */
async function propagarCronogramaCirurgico({
  supabaseClient,
  vendaId,
  pagamentosExistentes,
  pagamentosNovos, // grade teórica gerada pelo motor
}) {
  const chaveDe = (p) => `${p.tipo}__${p.numero_parcela ?? ''}`

  const pagos = pagamentosExistentes.filter(p => p.status === 'pago')
  const pendentes = pagamentosExistentes.filter(p => p.status !== 'pago')

  // 1) Linhas PAGAS: só atualizar data_prevista (demais campos bloqueados pelo trigger 018)
  for (const pago of pagos) {
    const correspondente = pagamentosNovos.find(
      n => n.tipo === pago.tipo &&
           (n.numero_parcela ?? null) === (pago.numero_parcela ?? null)
    )
    if (correspondente && correspondente.data_prevista !== pago.data_prevista) {
      await supabaseClient
        .from('pagamentos_prosoluto')
        .update({ data_prevista: correspondente.data_prevista })
        .eq('id', pago.id)
    }
  }

  // 2) Linhas PENDENTES: preservar IDs via UPDATE por chave (R6)
  //    - match por (tipo, numero_parcela): UPDATE
  //    - novos sem match: INSERT
  //    - pendentes antigos sem match: DELETE
  const chavesPagas = new Set(pagos.map(chaveDe))
  const pendentesPorChave = new Map(pendentes.map(p => [chaveDe(p), p]))

  // Novos que NÃO colidem com um pago (pago já foi tratado acima)
  const novosAplicaveis = pagamentosNovos.filter(n => !chavesPagas.has(chaveDe(n)))

  const chavesNovasAplicaveis = new Set(novosAplicaveis.map(chaveDe))
  const paraInserir = []

  for (const novo of novosAplicaveis) {
    const existente = pendentesPorChave.get(chaveDe(novo))
    if (existente) {
      // UPDATE preservando id
      const { error } = await supabaseClient
        .from('pagamentos_prosoluto')
        .update({
          valor: novo.valor,
          data_prevista: novo.data_prevista,
          comissao_gerada: novo.comissao_gerada,
          fator_comissao_aplicado: novo.fator_comissao_aplicado,
          percentual_comissao_total: novo.percentual_comissao_total,
        })
        .eq('id', existente.id)
      if (error) throw error
    } else {
      paraInserir.push(novo)
    }
  }

  // DELETE pendentes antigos sem correspondente no novo cronograma
  const idsParaRemover = pendentes
    .filter(p => !chavesNovasAplicaveis.has(chaveDe(p)))
    .map(p => p.id)
  if (idsParaRemover.length > 0) {
    const { error } = await supabaseClient
      .from('pagamentos_prosoluto')
      .delete()
      .in('id', idsParaRemover)
    if (error) throw error
  }

  if (paraInserir.length > 0) {
    const { error } = await supabaseClient
      .from('pagamentos_prosoluto')
      .insert(paraInserir)
    if (error) throw error
  }
}
// ─────────────────────────────────────────────────────────────────────────────

const AdminDashboard = () => {
  const { userProfile, signOut, loading: authLoading } = useAuth()
  const { tab } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  
  // Função de logout local para garantir funcionamento
  const handleLogout = async () => {
    try {
      await signOut()
    } catch (error) {
      console.error('Erro no logout:', error)
      // Fallback: forçar redirecionamento
      localStorage.clear()
      window.location.href = '/login'
    }
  }
  
  // Detectar activeTab baseado na URL
  // Se a URL é /admin/dashboard, activeTab é 'dashboard'
  // Se a URL é /admin/:tab, activeTab é o valor de tab
  // Se a URL é /admin (sem tab), activeTab é 'dashboard'
  let activeTab = 'dashboard'
  
  if (location.pathname === '/admin/dashboard') {
    activeTab = 'dashboard'
  } else if (tab) {
    activeTab = tab
  } else if (location.pathname === '/admin') {
    activeTab = 'dashboard'
  }
  
  const [corretores, setCorretores] = useState([])
  const [vendas, setVendas] = useState([])
  const [empreendimentos, setEmpreendimentos] = useState([])
  const [pagamentos, setPagamentos] = useState([])
  const [loading, setLoading] = useState(true)
  const dataLoadedRef = useRef(false)
  const messageTimeoutRef = useRef(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = safeGet('sidebar-collapsed')
    return saved === 'true'
  })
  const [searchTerm, setSearchTerm] = useState('')
  const [siengeSyncLoading, setSiengeSyncLoading] = useState(null)
  const [siengeSyncResult, setSiengeSyncResult] = useState(null)
  const [siengeSyncError, setSiengeSyncError] = useState(null)
  const [siengeSyncProgress, setSiengeSyncProgress] = useState(null)
  const dispararSiengeSync = async (entity) => {
    setSiengeSyncLoading(entity)
    setSiengeSyncResult(null)
    setSiengeSyncError(null)
    setSiengeSyncProgress(null)
    try {
      const useNormalizeOnly = entity === 'sales-contracts' || entity === 'receivable-bills'
      if (!useNormalizeOnly) {
        // v11+: handler retorna 202 com runId imediatamente. Worker processa em background (EdgeRuntime.waitUntil).
        // Cliente polla /runs/:id até status != RUNNING.
        const kick = await triggerFullSync([entity])
        setSiengeSyncProgress({ entity, status: 'queued', runId: kick.runId })
        const run = await pollRunUntilDone(kick.runId, { intervalMs: 3000, timeoutMs: 15 * 60 * 1000 })
        setSiengeSyncResult({ runId: run.id, status: run.status, metrics: run.metrics })
        return
      }

      // Chunking: cada invocação processa um slice do dataset pra caber no CPU budget do worker (~20s).
      // sales-contracts: sem API calls, pode ir mais largo.
      // receivable-bills: v12 usa /bulk-data/v1/income (sem quota 100/dia), apiBudget conta páginas (200 linhas cada).
      const chunkLimit = entity === 'sales-contracts' ? 40 : 15
      const apiBudgetPerChunk = entity === 'receivable-bills' ? 200 : undefined
      const maxChunks = entity === 'sales-contracts' ? 20 : 2 // receivable-bills faz sweep inteiro numa call

      let offset = 0
      let chunkIdx = 0
      const chunkResults = []
      let aggregate = { inserted: 0, updated: 0, errors: 0 }

      while (chunkIdx < maxChunks) {
        setSiengeSyncProgress({ entity, chunk: chunkIdx + 1, offset, limit: chunkLimit, status: 'rodando' })
        // v11+: kick retorna 202+runId; polla até worker terminar.
        const kick = await triggerNormalizeOnly([entity], { offset, limit: chunkLimit, apiBudget: apiBudgetPerChunk })
        const run = await pollRunUntilDone(kick.runId, { intervalMs: 3000, timeoutMs: 10 * 60 * 1000 })
        const data = { runId: run.id, status: run.status, metrics: run.metrics }
        chunkResults.push(data)

        const metrics = data?.metrics?.per_entity?.[entity]?.normalize
        if (metrics) {
          aggregate.inserted += Number(metrics.inserted || 0)
          aggregate.updated += Number(metrics.updated || 0)
          aggregate.errors += Number(metrics.errors || 0)
        }

        const extra = metrics?.extra || {}
        const hasMore = !!extra.hasMore
        const budgetExhausted = !!extra.budgetExhausted
        setSiengeSyncProgress({
          entity,
          chunk: chunkIdx + 1,
          offset,
          limit: chunkLimit,
          status: hasMore ? 'prosseguindo' : 'concluido',
          total: extra.total,
          fetched: extra.fetched,
          hasMore,
          budgetExhausted,
          apiCalls: extra.apiCalls,
          aggregate: { ...aggregate },
        })

        if (!hasMore) break
        if (budgetExhausted) break // bate no cap de API daquele chunk; usuário decide se roda mais (protege quota Sienge)
        offset += chunkLimit
        chunkIdx++
      }

      setSiengeSyncResult({ chunks: chunkResults.length, aggregate, lastChunk: chunkResults[chunkResults.length - 1] })
    } catch (e) {
      setSiengeSyncError(e?.message || String(e))
    } finally {
      setSiengeSyncLoading(null)
    }
  }
  const dispararProbeBulk = async () => {
    setSiengeSyncLoading('probe')
    setSiengeSyncResult(null)
    setSiengeSyncError(null)
    setSiengeSyncProgress(null)
    try {
      const r = await probeSienge('/bulk-data/v1/income', {
        startDate: '2026-03-22',
        endDate: '2026-04-22',
        selectionType: 'P',
        companyId: 5,
        limit: 10,
        offset: 0,
      })
      const payload = r?.data
      const results = Array.isArray(payload) ? payload : (payload?.results ?? payload?.data ?? [])
      setSiengeSyncResult({
        status: r?.status,
        url: r?.url,
        total: Array.isArray(results) ? results.length : null,
        metadata: payload?.resultSetMetadata ?? null,
        sample: Array.isArray(results) ? results.slice(0, 2) : payload,
      })
    } catch (e) {
      setSiengeSyncError(e?.message || String(e))
    } finally {
      setSiengeSyncLoading(null)
    }
  }
  const [showModal, setShowModal] = useState(false)
  const [modalType, setModalType] = useState('')
  const [selectedItem, setSelectedItem] = useState(null)
  const [filterTipo, setFilterTipo] = useState('todos')
  
  // Filtros para Vendas
  const [filtrosVendas, setFiltrosVendas] = useState({
    corretor: '',
    empreendimento: '',
    status: 'todos',
    bloco: '',
    dataInicio: '',
    dataFim: '',
    valorMin: '',
    valorMax: ''
  })
  
  // Filtros para Pagamentos
  const [filtrosPagamentos, setFiltrosPagamentos] = useState({
    status: 'todos',
    corretor: '',
    empreendimento: '',
    cliente: '',
    unidade: '',
    tipo: 'todos',
    dataInicio: '',
    dataFim: '',
    buscaVenda: ''
  })
  
  // Filtros para Corretores
  const [filtrosCorretores, setFiltrosCorretores] = useState({
    busca: '',
    tipo: 'todos',
    empreendimento: '',
    autonomo: 'todos' // todos, sim, nao
  })
  
  // Filtros para Empreendimentos
  const [filtrosEmpreendimentos, setFiltrosEmpreendimentos] = useState({
    busca: ''
  })
  
  // Visualização de Empreendimentos (grid ou lista)
  const [empViewMode, setEmpViewMode] = useState('grid')
  
  // Filtros para Clientes
  const [filtrosClientes, setFiltrosClientes] = useState({
    busca: '',
    possuiFgts: 'todos',
    temComplemento: 'todos'
  })
  
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  const [contratoFile, setContratoFile] = useState(null)
  const [uploadingContrato, setUploadingContrato] = useState(false)
  const [pagamentoDetalhe, setPagamentoDetalhe] = useState(null)
  const [vendaExpandida, setVendaExpandida] = useState(null)
  const [showModalConfirmarPagamento, setShowModalConfirmarPagamento] = useState(false)
  const [showModalExcluirBaixa, setShowModalExcluirBaixa] = useState(false)
  const [pagamentoParaExcluir, setPagamentoParaExcluir] = useState(null)
  const [excluindoBaixa, setExcluindoBaixa] = useState(false)
  const [pagamentoParaConfirmar, setPagamentoParaConfirmar] = useState(null)

  // Estados para modal de Exclusão/Distrato de Venda
  const [showModalExcluirVenda, setShowModalExcluirVenda] = useState(false)
  const [vendaParaExcluir, setVendaParaExcluir] = useState(null)
  const [modalExcluirVendaStep, setModalExcluirVendaStep] = useState(1) // 1: escolha, 2: data distrato
  const [dataDistrato, setDataDistrato] = useState('')
  const [processandoExclusaoVenda, setProcessandoExclusaoVenda] = useState(false)
  const [formConfirmarPagamento, setFormConfirmarPagamento] = useState({
    valorPersonalizado: '',
    dataPagamento: ''
  })
  const [confirmandoPagamento, setConfirmandoPagamento] = useState(false)
  // const [mostrarCadastroMassa, setMostrarCadastroMassa] = useState(false)
  // const [mostrarImportarVendas, setMostrarImportarVendas] = useState(false)
  const [cargoExpandido, setCargoExpandido] = useState(null) // Formato: "empreendimentoId-cargoId"
  const [cargosExpandidos, setCargosExpandidos] = useState({}) // Formato: { "empreendimentoId-externo": true, "empreendimentoId-interno": false }
  const [galeriaAberta, setGaleriaAberta] = useState(null) // ID do empreendimento com galeria aberta
  const [empreendimentoVisualizar, setEmpreendimentoVisualizar] = useState(null) // Empreendimento para visualização detalhada
  const [clientes, setClientes] = useState([])
  const [uploadingDoc, setUploadingDoc] = useState(false)

  // Estados para Renegociação de Parcelas
  const [pagamentosVendaEditando, setPagamentosVendaEditando] = useState([])
  const [parcelasSelecionadas, setParcelasSelecionadas] = useState([])
  const [showModalRenegociacao, setShowModalRenegociacao] = useState(false)
  const [renegociacaoForm, setRenegociacaoForm] = useState({
    motivo: '',
    distribuicoesNovas: [], // nova estrutura: { qtd, valor, data_prevista }
    totalSelecionado: 0,    // total consolidado das parcelas selecionadas
    quantidadeParcelas: 0   // quantidade de parcelas selecionadas
  })
  const [salvandoRenegociacao, setSalvandoRenegociacao] = useState(false)
  const [renegociacoesVenda, setRenegociacoesVenda] = useState([])
  const [loadingRenegociacoes, setLoadingRenegociacoes] = useState(false)
  const [abaVisualizarVenda, setAbaVisualizarVenda] = useState('detalhes')
  const [pagamentosVisualizacao, setPagamentosVisualizacao] = useState([])
  const [visaoParcelas, setVisaoParcelas] = useState('contrato')

  // Estados para solicitações
  const [solicitacoes, setSolicitacoes] = useState([])
  const [loadingSolicitacoes, setLoadingSolicitacoes] = useState(false)
  const [filtroSolicitacao, setFiltroSolicitacao] = useState('pendente') // pendente, aprovado, reprovado, todos
  const [solicitacaoSelecionada, setSolicitacaoSelecionada] = useState(null)
  const [respostaAdmin, setRespostaAdmin] = useState('')
  
  // Estados para relatórios
  const [relatorioFiltros, setRelatorioFiltros] = useState({
    tipo: 'pagamentos', // pagamentos, comissoes, vendas
    corretorId: '', // filtro por corretor
    vendaId: '',
    cargoId: 'Corretor', // Padrão: Corretor
    status: 'todos',
    dataInicio: '',
    dataFim: '',
    empreendimentoId: '', // filtro por empreendimento
    empreendimentoDetalhe: '' // para o card de detalhes por empreendimento
  })
  const [buscaCorretorRelatorio, setBuscaCorretorRelatorio] = useState('')
  const [gerandoPdf, setGerandoPdf] = useState(false)
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null) // Preview PDF (aba temporária para ajuste visual)

  // Toggle sidebar collapsed state
  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const newValue = !prev
      safeSet('sidebar-collapsed', String(newValue))
      return newValue
    })
  }

  // Helper para limpar mensagem após ms (com cleanup no unmount)
  const clearMessageAfter = (ms) => {
    if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current)
    messageTimeoutRef.current = setTimeout(() => {
      messageTimeoutRef.current = null
      setMessage({ type: '', text: '' })
    }, ms)
  }

  // Agrupar pagamentos por venda
  const pagamentosAgrupados = pagamentos.reduce((acc, pag) => {
    const vendaId = pag.venda_id
    if (!vendaId) return acc // Ignorar pagamentos sem venda_id
    
    // Comparação segura de IDs
    const vendaIdStr = String(vendaId)
    
    if (!acc[vendaIdStr]) {
      // Buscar venda completa se não estiver no pag.venda
      const vendaCompleta = pag.venda || vendas.find(v => String(v.id) === vendaIdStr)
      
      if (!vendaCompleta) {
        console.warn('⚠️ Venda não encontrada para pagamento:', vendaId)
        return acc
      }
      
      acc[vendaIdStr] = {
        venda_id: vendaId,
        venda: vendaCompleta,
        pagamentos: [],
        totalValor: 0,
        totalComissao: 0,
        totalPago: 0,
        totalPendente: 0
      }
    }
    acc[vendaIdStr].pagamentos.push(pag)
    acc[vendaIdStr].totalValor += parseFloat(pag.valor) || 0
    acc[vendaIdStr].totalComissao += parseFloat(pag.comissao_gerada) || 0
    if (pag.status === 'pago') {
      acc[vendaIdStr].totalPago += parseFloat(pag.comissao_gerada) || 0
    } else {
      acc[vendaIdStr].totalPendente += parseFloat(pag.comissao_gerada) || 0
    }
    return acc
  }, {})

  const listaVendasComPagamentos = Object.values(pagamentosAgrupados)
  
  /* DEBUG: Verificar quantas vendas aparecem na lista
  console.log('🔍 DEBUG listaVendasComPagamentos:', {
    totalVendas: vendas.length,
    totalPagamentos: pagamentos.length,
    vendasComPagamentos: listaVendasComPagamentos.length,
    vendasSemPagamentos: vendas.filter(v => {
      const temPagamento = pagamentos.some(p => String(p.venda_id) === String(v.id))
      return !temPagamento
    }).length
  })*/

  // Formulário de empreendimento
  const [empreendimentoForm, setEmpreendimentoForm] = useState({
    nome: '',
    descricao: '',
    total_unidades: '',
    comissao_total_externo: '7',
    comissao_total_interno: '6',
    cargos_externo: [{ nome_cargo: '', percentual: '' }],
    cargos_interno: [{ nome_cargo: '', percentual: '' }],
    logo_url: '',
    progresso_obra: '0'
  })
  const [uploadingLogo, setUploadingLogo] = useState(false)

  // Estados de edição de datas (sinal, parcelas, balões)
  const [editandoDataSinal, setEditandoDataSinal] = useState(false)
  const [dataSinalTemp, setDataSinalTemp] = useState('')
  const [editandoDataParcela, setEditandoDataParcela] = useState(null)
  const [dataParcelaTemp, setDataParcelaTemp] = useState('')
  const [editandoDataBalao, setEditandoDataBalao] = useState(null)
  const [dataBalaoTemp, setDataBalaoTemp] = useState('')

  // Dados do formulário de venda
  const [vendaForm, setVendaForm] = useState({
    corretor_id: '',
    empreendimento_id: '',
    cliente_id: '',
    unidade: '',
    bloco: '',
    andar: '',
    valor_venda: '',
    tipo_corretor: 'externo',
    data_venda: new Date().toISOString().split('T')[0],
    data_entrada: '',
    data_sinal: '',
    datas_parcelas_override: {},
    datas_balao_override: {},
    dia_pagamento_parcelas: 1,      // novo: dia fixo das parcelas (1-30, ou '0' para "Outro")
    dia_pagamento_parcelas_outro: '', // novo: dia customizado quando "Outro" é selecionado
    dia_pagamento_balao: 1,         // novo: dia fixo dos balões
    dia_pagamento_balao_outro: '',  // novo: dia customizado para balões
    descricao: '',
    status: 'pendente',
    // Campos pro-soluto
    teve_sinal: false,
    valor_sinal: '',
    teve_entrada: false,
    valor_entrada: '',
    parcelou_entrada: false,
    periodicidade_parcelas: 1,
    grupos_parcelas_entrada: [{ qtd: '', valor: '' }], // Array de grupos: [{ qtd: '4', valor: '500' }, { qtd: '5', valor: '1000' }]
    teve_balao: 'nao', // 'nao', 'sim', 'pendente'
    periodicidade_balao: 6,
    grupos_balao: [{ qtd: '', valor: '' }], // Array de grupos: [{ qtd: '2', valor: '10000' }, { qtd: '1', valor: '5000' }]
    teve_permuta: false,
    tipo_permuta: '',
    valor_permuta: '',
    valor_pro_soluto: '',
    contrato_url: '',
    contrato_nome: ''
  })

  // Dados do formulário de corretor
  const [corretorForm, setCorretorForm] = useState({
    nome: '',
    email: '',
    senha: '',
    tipo_corretor: 'externo',
    telefone: '',
    percentual_corretor: '',
    empreendimento_id: '',
    cargo_id: '',
    cnpj: '',
    imobiliaria: '',
    creci: '',
    is_autonomo: false, // Novo campo para identificar corretor autônomo
    tem_acesso_sistema: false, // Se já tem conta no Auth
    ativar_acesso: false // Se quer ativar acesso nesta edição
  })

  // Formulário de cliente
  const [clienteForm, setClienteForm] = useState({
    nome_completo: '',
    data_nascimento: '',
    cpf: '',
    rg: '',
    endereco: '',
    telefone: '',
    email: '',
    profissao: '',
    empresa_trabalho: '',
    renda_mensal: '',
    // Documentos
    rg_frente_url: '',
    rg_verso_url: '',
    cpf_url: '',
    comprovante_residencia_url: '',
    comprovante_renda_url: '',
    certidao_casamento_url: '',
    // FGTS
    possui_3_anos_fgts: false,
    beneficiado_subsidio_fgts: false,
    // Complemento
    tem_complemento_renda: false,
    complementadores: [],
    // Acesso ao sistema
    criar_acesso: false,
    senha: ''
  })

  const complementadorVazio = {
    nome: '',
    cpf: '',
    rg: '',
    data_nascimento: '',
    profissao: '',
    empresa_trabalho: '',
    valor_complemento: '',
    telefone: '',
    email: '',
    tipo_relacionamento: ''
  }

  // Cargos filtrados por empreendimento selecionado
  const [cargosDisponiveis, setCargosDisponiveis] = useState([])

  // Calcular comissões baseado nos cargos do empreendimento (DINÂMICO)
  const calcularComissoesDinamicas = (valorVenda, empreendimentoId, tipoCorretor) => {
    const emp = empreendimentos.find(e => e.id === empreendimentoId)
    if (!emp) return { cargos: [], total: 0, percentualTotal: 0 }
    
    // Filtrar cargos pelo tipo de corretor
    const cargosDoTipo = emp.cargos?.filter(c => c.tipo_corretor === tipoCorretor) || []
    
    // Calcular percentual total primeiro
    const percentualTotal = cargosDoTipo.reduce((acc, c) => acc + parseFloat(c.percentual || 0), 0)
    
    // Calcular comissão para cada cargo
    const comissoesPorCargo = cargosDoTipo.map(cargo => ({
      cargo_id: cargo.id,
      nome_cargo: cargo.nome_cargo,
      percentual: parseFloat(cargo.percentual),
      valor: (valorVenda * parseFloat(cargo.percentual)) / 100
    }))
    
    // Total em reais
    const total = comissoesPorCargo.reduce((acc, c) => acc + c.valor, 0)
    
    return { cargos: comissoesPorCargo, total, percentualTotal }
  }

  // Calcular valores por setor (cargo) para um empreendimento
  const calcularValoresPorSetor = (empreendimentoId) => {
    // Buscar todas as vendas deste empreendimento
    const vendasEmpreendimento = vendas.filter(v => v.empreendimento_id === empreendimentoId)
    
    // Buscar o empreendimento para pegar os cargos
    const emp = empreendimentos.find(e => e.id === empreendimentoId)
    if (!emp || !emp.cargos) return []
    
    // Agrupar cargos por tipo (externo/interno)
    const cargosExternos = emp.cargos.filter(c => c.tipo_corretor === 'externo')
    const cargosInternos = emp.cargos.filter(c => c.tipo_corretor === 'interno')
    const todosCargos = [...cargosExternos, ...cargosInternos]
    
    // Para cada cargo, calcular valores
    return todosCargos.map(cargo => {
      let valorTotal = 0
      let valorPago = 0
      
      // Para cada venda do empreendimento
      vendasEmpreendimento.forEach(venda => {
        // Verificar se a venda é do tipo correto (externo/interno)
        const tipoCorretor = venda.tipo_corretor || 'externo'
        if (cargo.tipo_corretor !== tipoCorretor) return
        
        // Buscar todos os pagamentos desta venda
        const pagamentosVenda = pagamentos.filter(p => p.venda_id === venda.id)
        
        // Para cada pagamento, calcular a comissão deste cargo
        pagamentosVenda.forEach(pag => {
          const comissoesCargo = calcularComissaoPorCargoPagamento(pag)
          const cargoEncontrado = comissoesCargo.find(c => c.nome_cargo === cargo.nome_cargo)
          
          if (cargoEncontrado) {
            valorTotal += cargoEncontrado.valor || 0
            
            // Se o pagamento está pago, adicionar ao valor pago
            if (pag.status === 'pago') {
              valorPago += cargoEncontrado.valor || 0
            }
          }
        })
      })
      
      const valorPendente = valorTotal - valorPago
      const percentualPago = valorTotal > 0 ? (valorPago / valorTotal) * 100 : 0
      
      return {
        cargo_id: cargo.id,
        nome_cargo: cargo.nome_cargo,
        tipo_corretor: cargo.tipo_corretor,
        percentual: cargo.percentual,
        valorTotal,
        valorPago,
        valorPendente,
        percentualPago: Math.round(percentualPago * 100) / 100
      }
    })
  }

  // Calcular comissão detalhada por cargo para um pagamento específico
  const calcularComissaoPorCargoPagamento = (pagamento) => {
    if (!pagamento?.venda_id) return []
    
    // Buscar a venda relacionada
    const venda = vendas.find(v => v.id === pagamento.venda_id)
    if (!venda) return []
    
    // Buscar o empreendimento da venda
    const emp = empreendimentos.find(e => e.id === venda.empreendimento_id)
    if (!emp || !emp.cargos) return []
    
    // Filtrar cargos pelo tipo de corretor
    const tipoCorretor = venda.tipo_corretor || 'externo'
    const cargosDoTipo = emp.cargos.filter(c => c.tipo_corretor === tipoCorretor)
    
    const valorPagamento = parseFloat(pagamento.valor) || 0
    
    // USAR A COMISSÃO JÁ CALCULADA E SALVA NO PAGAMENTO
    let comissaoTotalParcela = parseFloat(pagamento.comissao_gerada) || 0
    
    // Se não houver comissao_gerada salva, calcular via fator (fator_comissao_aplicado ou fórmula fator-comissao.mdc)
    if (comissaoTotalParcela === 0) {
      const percentualTotal = cargosDoTipo.reduce((acc, c) => acc + (parseFloat(c.percentual) || 0), 0)
      let fator
      if (pagamento.fator_comissao_aplicado != null && parseFloat(pagamento.fator_comissao_aplicado) > 0) {
        fator = parseFloat(pagamento.fator_comissao_aplicado)
      } else {
        const valorVenda = parseFloat(venda.valor_venda) || 0
        const valorProSoluto = parseFloat(venda.valor_pro_soluto) || 0
        fator = calcularFatorComissao(valorVenda, valorProSoluto, percentualTotal)
      }
      comissaoTotalParcela = calcularComissaoPagamento(valorPagamento, fator)
    }
    
    // Calcular percentual total dos cargos para distribuição
    const percentualTotal = cargosDoTipo.reduce((acc, c) => acc + (parseFloat(c.percentual) || 0), 0)
    
    // Distribuir entre os cargos proporcionalmente
    return cargosDoTipo.map(cargo => {
      const percentualCargo = parseFloat(cargo.percentual) || 0
      // Proporção deste cargo no total
      const proporcaoCargo = percentualTotal > 0 ? percentualCargo / percentualTotal : 0
      const valorComissaoCargo = comissaoTotalParcela * proporcaoCargo
      
      return {
        nome_cargo: cargo.nome_cargo,
        percentual: percentualCargo,
        valor: valorComissaoCargo
      }
    })
  }
  
  // Calcular comissão total de um pagamento (soma de todos os cargos)
  const calcularComissaoTotalPagamento = (pagamento) => {
    const comissoesPorCargo = calcularComissaoPorCargoPagamento(pagamento)
    return comissoesPorCargo.reduce((acc, c) => acc + c.valor, 0)
  }

  // Calcular comissão de uma venda a partir dos PAGAMENTOS (conforme comissao-corretor.mdc)
  // Retorna { comissaoTotal, comissaoCorretor }
  const calcularComissaoVendaPorPagamentos = (vendaId) => {
    const grupo = listaVendasComPagamentos.find(g => String(g.venda_id) === String(vendaId))
    if (!grupo?.pagamentos?.length) return { comissaoTotal: 0, comissaoCorretor: 0 }
    let comissaoTotal = 0
    let comissaoCorretor = 0
    grupo.pagamentos.forEach(pag => {
      comissaoTotal += parseFloat(pag.comissao_gerada) || 0
      const cargos = calcularComissaoPorCargoPagamento(pag)
      const cargoCorretor = cargos.find(c => c.nome_cargo === 'Corretor' || c.nome_cargo?.toLowerCase().includes('corretor'))
      comissaoCorretor += cargoCorretor?.valor ?? 0
    })
    return { comissaoTotal, comissaoCorretor }
  }

  // Calcular comissão do corretor a partir dos PAGAMENTOS (conforme comissao-corretor.mdc)
  // Retorna { total, pago, pendente }
  const calcularComissaoCorretorPorPagamentos = (corretorId) => {
    const gruposCorretor = listaVendasComPagamentos.filter(
      g => String(g.venda?.corretor_id || g.venda?.corretor?.id || '') === String(corretorId)
    )
    let total = 0
    let pago = 0
    let pendente = 0
    gruposCorretor.forEach(grupo => {
      grupo.pagamentos.forEach(pag => {
        const comissoesCargo = calcularComissaoPorCargoPagamento(pag)
        const cargoCorretor = comissoesCargo.find(c =>
          c.nome_cargo === 'Corretor' || c.nome_cargo?.toLowerCase().includes('corretor')
        )
        const valorCorretor = cargoCorretor?.valor ?? 0
        total += valorCorretor
        if (pag.status === 'pago') {
          pago += valorCorretor
        } else {
          pendente += valorCorretor
        }
      })
    })
    return { total, pago, pendente }
  }

  // Carregar dados apenas quando o perfil estiver pronto e for admin
  useEffect(() => {
    if (!authLoading && userProfile && userProfile.tipo === 'admin' && !dataLoadedRef.current) {
      dataLoadedRef.current = true // Marca ANTES de chamar para evitar duplicação
      console.log('✅ Condições atendidas, chamando fetchData...')
      fetchData()
      // Carregar solicitações para mostrar badge na navegação
      fetchSolicitacoes()
    }
  }, [authLoading, userProfile])

  // Redirecionar para dashboard se não houver tab
  useEffect(() => {
    if (!tab && window.location.pathname === '/admin') {
      navigate('/admin/dashboard', { replace: true })
    }
  }, [tab, navigate])

  // Inicializar sidebar como aberta em telas grandes
  useEffect(() => {
    const checkScreenSize = () => {
      if (window.innerWidth > 1024) {
        setMenuOpen(true)
      }
    }
    
    checkScreenSize()
    window.addEventListener('resize', checkScreenSize)
    
    return () => window.removeEventListener('resize', checkScreenSize)
  }, [])

  // Cleanup do timeout de mensagem no unmount
  useEffect(() => {
    return () => {
      if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current)
    }
  }, [])

  // Atualizar descrição automaticamente baseado em unidade, bloco e andar
  useEffect(() => {
    if (modalType === 'venda') {
      const partes = []
      
      if (vendaForm.unidade) {
        partes.push(`Unidade: ${vendaForm.unidade}`)
      }
      
      if (vendaForm.bloco) {
        partes.push(`Torre: ${vendaForm.bloco}`)
      }
      
      if (vendaForm.andar) {
        partes.push(`Andar: ${vendaForm.andar}`)
      }
      
      // Só atualiza se houver pelo menos um campo preenchido
      // e se a descrição atual estiver vazia ou seguir o padrão automático
      if (partes.length > 0) {
        const descricaoAutomatica = partes.join(' | ')
        const descricaoAtual = vendaForm.descricao || ''
        
        // Verifica se a descrição atual está vazia ou segue o padrão automático
        const seguePadrao = !descricaoAtual || 
          descricaoAtual.includes('Unidade:') || 
          descricaoAtual.includes('Torre:') || 
          descricaoAtual.includes('Andar:')
        
        if (seguePadrao && descricaoAutomatica !== descricaoAtual) {
          setVendaForm(prev => ({ ...prev, descricao: descricaoAutomatica }))
        }
      } else if (!vendaForm.descricao) {
        // Se não há campos preenchidos e descrição está vazia, limpa
        setVendaForm(prev => ({ ...prev, descricao: '' }))
      }
    }
  }, [vendaForm.unidade, vendaForm.bloco, vendaForm.andar, modalType])

  const fetchData = async () => {
    setLoading(true)
    
    try {
      // Buscar todos os dados em paralelo
      const [
        { data: corretoresData, error: corretoresError },
        { data: vendasData, error: vendasError },
        { data: empreendimentosData, error: empreendimentosError },
        { data: clientesData, error: clientesError }
      ] = await Promise.all([
        supabase.from('usuarios').select('*').eq('tipo', 'corretor'),
        supabase.from('vendas').select('*').or('excluido.eq.false,excluido.is.null'),
        supabase.from('empreendimentos').select('*'),
        supabase.from('clientes').select('*').or('ativo.eq.true,ativo.is.null')
      ])

      if (corretoresError) console.error('Erro ao buscar corretores:', corretoresError)
      if (vendasError) console.error('Erro ao buscar vendas:', vendasError)
      if (empreendimentosError) console.error('Erro ao buscar empreendimentos:', empreendimentosError)
      if (clientesError) console.error('Erro ao buscar clientes:', clientesError)

      // Buscar cargos separadamente
      const { data: cargosData, error: cargosError } = await supabase
        .from('cargos_empreendimento')
        .select('*')
      
      if (cargosError) {
        console.error('Erro ao buscar cargos:', cargosError)
      }

      // Buscar pagamentos pro-soluto (sem JOINs) - buscar todos sem limite
      // O Supabase tem limite padrão de 1000, então precisamos buscar em lotes ou aumentar o limite
      let pagamentosData = []
      let hasMore = true
      let page = 0
      const pageSize = 1000
      
      while (hasMore) {
        const { data: pageData, error: pagamentosError } = await supabase
          .from('pagamentos_prosoluto')
          .select('*')
          .range(page * pageSize, (page + 1) * pageSize - 1)
        
        if (pagamentosError) {
          console.error('Erro ao buscar pagamentos:', pagamentosError)
          break
        }
        
        if (pageData && pageData.length > 0) {
          pagamentosData = [...pagamentosData, ...pageData]
          hasMore = pageData.length === pageSize
          page++
        } else {
          hasMore = false
        }
      }
      
     // console.log('Pagamentos do banco:', pagamentosData.length, 'registros')
      
      // DEBUG: Verificar estrutura dos dados
      /*console.log('🔍 DEBUG fetchData:', {
        totalVendas: vendasData?.length || 0,
        totalPagamentos: pagamentosData?.length || 0,
        vendasComProSoluto: (vendasData || []).filter(v => {
          const valorProSoluto = parseFloat(v.valor_pro_soluto) || 0
          return valorProSoluto > 0
        }).length,
        // Verificar se há vendas sem pagamentos no banco
        vendasSemPagamentosNoBanco: (vendasData || []).filter(v => {
          const valorProSoluto = parseFloat(v.valor_pro_soluto) || 0
          if (valorProSoluto <= 0) return false
          const temPagamento = (pagamentosData || []).some(p => String(p.venda_id) === String(v.id))
          return !temPagamento
        }).length,
        // Verificar tipos de IDs
        tipoIdVenda: vendasData?.[0]?.id ? typeof vendasData[0].id : 'N/A',
        tipoIdPagamento: pagamentosData?.[0]?.venda_id ? typeof pagamentosData[0].venda_id : 'N/A'
      })
*/
      // Buscar fotos de fachada para cada empreendimento
      const { data: fotosData } = await supabase
        .from('empreendimento_fotos')
        .select('empreendimento_id, url, categoria, destaque, ordem')
        .in('categoria', ['fachada', 'logo'])
        .order('destaque', { ascending: false })
        .order('ordem', { ascending: true })

      // Associar cargos e fotos aos empreendimentos
      const empreendimentosComCargos = (empreendimentosData || []).map(emp => {
        // Buscar foto de fachada (prioridade: destaque > primeira)
        const fotosFachada = (fotosData || []).filter(f => f.empreendimento_id === emp.id && f.categoria === 'fachada')
        const fotoFachada = fotosFachada.find(f => f.destaque) || fotosFachada[0]
        
        // Buscar logo (se não tiver logo_url no empreendimento)
        let logoUrl = emp.logo_url
        if (!logoUrl) {
          const fotosLogo = (fotosData || []).filter(f => f.empreendimento_id === emp.id && f.categoria === 'logo')
          logoUrl = fotosLogo[0]?.url || null
        }
        
        return {
          ...emp,
          cargos: (cargosData || []).filter(c => c.empreendimento_id === emp.id),
          fachada_url: fotoFachada?.url || null,
          logo_url: logoUrl
        }
      })

      // Associar dados relacionados às vendas manualmente
      const vendasComRelacionamentos = (vendasData || []).map(venda => {
        const corretor = (corretoresData || []).find(c => c.id === venda.corretor_id)
        const empreendimento = (empreendimentosData || []).find(e => e.id === venda.empreendimento_id)
        const cliente = (clientesData || []).find(c => c.id === venda.cliente_id)
        return {
          ...venda,
          corretor: corretor ? { id: corretor.id, nome: corretor.nome, email: corretor.email, tipo_corretor: corretor.tipo_corretor, percentual_corretor: corretor.percentual_corretor } : null,
          empreendimento: empreendimento ? { id: empreendimento.id, nome: empreendimento.nome } : null,
          cliente: cliente ? { id: cliente.id, nome: cliente.nome_completo, cpf: cliente.cpf, cnpj: cliente.cnpj, email: cliente.email, telefone: cliente.telefone } : null
        }
      })

      // Associar dados relacionados aos pagamentos manualmente
      const pagamentosComRelacionamentos = (pagamentosData || []).map(pag => {
        // Comparação segura de IDs (convertendo para string)
        const venda = (vendasData || []).find(v => String(v.id) === String(pag.venda_id))
        const corretor = venda ? (corretoresData || []).find(c => String(c.id) === String(venda.corretor_id)) : null
        const empreendimento = venda ? (empreendimentosData || []).find(e => String(e.id) === String(venda.empreendimento_id)) : null
        const cliente = venda ? (clientesData || []).find(c => String(c.id) === String(venda.cliente_id)) : null
        
        return {
          ...pag,
          venda: venda ? {
            ...venda,
            id: venda.id,
            valor_venda: venda.valor_venda,
            comissao_total: venda.comissao_total,
            tipo_corretor: venda.tipo_corretor,
            empreendimento_id: venda.empreendimento_id,
            corretor_id: venda.corretor_id,
            cliente_id: venda.cliente_id,
            descricao: venda.descricao,
            bloco: venda.bloco,
            unidade: venda.unidade,
            nome_cliente: venda.nome_cliente,
            fator_comissao: venda.fator_comissao,
            qtd_parcelas_entrada: venda.qtd_parcelas_entrada,
            valor_parcela_entrada: venda.valor_parcela_entrada,
            valor_pro_soluto: venda.valor_pro_soluto,
            corretor: corretor ? { id: corretor.id, nome: corretor.nome, percentual_corretor: corretor.percentual_corretor } : null,
            empreendimento: empreendimento ? { id: empreendimento.id, nome: empreendimento.nome } : null,
            cliente: cliente ? { id: cliente.id, nome: cliente.nome_completo, cpf: cliente.cpf, cnpj: cliente.cnpj } : null
          } : null
        }
      })

      // DEBUG: Verificar quantos pagamentos não encontraram venda
      const pagamentosSemVenda = pagamentosComRelacionamentos.filter(p => !p.venda)
      if (pagamentosSemVenda.length > 0) {
        console.warn('⚠️ Pagamentos sem venda encontrada:', pagamentosSemVenda.length, pagamentosSemVenda.slice(0, 5).map(p => ({
          pagamento_id: p.id,
          venda_id: p.venda_id,
          tipo_id: typeof p.venda_id
        })))
      }

      // Associar empreendimento e cargo aos corretores
      const corretoresComRelacionamentos = (corretoresData || []).map(corretor => {
        const empreendimento = (empreendimentosData || []).find(e => e.id === corretor.empreendimento_id)
        const cargo = (cargosData || []).find(c => c.id === corretor.cargo_id)
        return {
          ...corretor,
          empreendimento: empreendimento ? { nome: empreendimento.nome } : null,
          cargo: cargo ? { nome_cargo: cargo.nome_cargo, percentual: cargo.percentual } : null
        }
      })

      // Buscar complementadores de renda
      const { data: complementadoresData, error: complementadoresError } = await supabase
        .from('complementadores_renda')
        .select('*')
      
      if (complementadoresError) {
        console.error('Erro ao buscar complementadores:', complementadoresError)
      }

      // Associar complementadores aos clientes
      const clientesComComplementadores = (clientesData || []).map(cliente => ({
        ...cliente,
        complementadores: (complementadoresData || []).filter(c => c.cliente_id === cliente.id)
      }))

      setCorretores(corretoresComRelacionamentos || [])
      setVendas(vendasComRelacionamentos || [])
      setEmpreendimentos(empreendimentosComCargos || [])
      setPagamentos(pagamentosComRelacionamentos || [])
      setClientes(clientesComComplementadores || [])
      
      /*console.log('✅ Dados carregados com sucesso:', {
        corretores: corretoresComRelacionamentos?.length || 0,
        vendas: vendasComRelacionamentos?.length || 0,
        empreendimentos: empreendimentosComCargos?.length || 0,
        pagamentos: pagamentosComRelacionamentos?.length || 0,
        clientes: clientesComComplementadores?.length || 0
      })*/
      
    } catch (error) {
      console.error('❌ Erro crítico ao carregar dados:', error)
      setMessage({ type: 'error', text: `Erro ao carregar dados: ${error.message || 'Erro desconhecido'}. Tente recarregar a página.` })
    } finally {
      setLoading(false)
     // console.log('🏁 fetchData finalizado')
    }
  }

  // Função para buscar solicitações
  const fetchSolicitacoes = async () => {
    setLoadingSolicitacoes(true)
    try {
      let query = supabase
        .from('solicitacoes')
        .select(`
          *,
          corretor:corretor_id(id, nome, email),
          admin:admin_id(id, nome)
        `)
        .order('created_at', { ascending: false })
      
      if (filtroSolicitacao !== 'todos') {
        query = query.eq('status', filtroSolicitacao)
      }
      
      const { data, error } = await query
      
      if (error) throw error
      setSolicitacoes(data || [])
    } catch (error) {
      console.error('Erro ao buscar solicitações:', error)
    } finally {
      setLoadingSolicitacoes(false)
    }
  }

  // Carregar solicitações quando mudar o filtro ou aba
  useEffect(() => {
    if (activeTab === 'solicitacoes') {
      fetchSolicitacoes()
    }
  }, [activeTab, filtroSolicitacao])

  // Função para aprovar solicitação
  const handleAprovarSolicitacao = async (solicitacao) => {
    try {
      setLoading(true)
      
      // Processar a solicitação baseado no tipo
      if (solicitacao.tipo === 'venda') {
        // Criar a venda
        const dadosVenda = solicitacao.dados
        const { error: vendaError } = await supabase
          .from('vendas')
          .insert([{
            corretor_id: dadosVenda.corretor_id,
            empreendimento_id: dadosVenda.empreendimento_id,
            cliente_id: dadosVenda.cliente_id,
            unidade: dadosVenda.unidade,
            bloco: dadosVenda.bloco,
            valor_venda: dadosVenda.valor_venda,
            data_venda: dadosVenda.data_venda,
            status: 'pendente',
            nome_cliente: dadosVenda.nome_cliente
          }])
        
        if (vendaError) throw vendaError
      } else if (solicitacao.tipo === 'cliente') {
        // Criar o cliente
        const dadosCliente = solicitacao.dados
        const { error: clienteError } = await supabase
          .from('clientes')
          .insert([{
            nome_completo: dadosCliente.nome_completo,
            cpf: dadosCliente.cpf,
            email: dadosCliente.email,
            telefone: dadosCliente.telefone,
            endereco: dadosCliente.endereco
          }])
        
        if (clienteError) throw clienteError
      }
      
      // Atualizar status da solicitação
      const { error: updateError } = await supabase
        .from('solicitacoes')
        .update({
          status: 'aprovado',
          admin_id: userProfile.id,
          resposta_admin: respostaAdmin || 'Solicitação aprovada',
          data_resposta: new Date().toISOString()
        })
        .eq('id', solicitacao.id)
      
      if (updateError) throw updateError
      
      setMessage({ type: 'success', text: 'Solicitação aprovada com sucesso!' })
      setSolicitacaoSelecionada(null)
      setRespostaAdmin('')
      fetchSolicitacoes()
      fetchData() // Recarregar dados principais
    } catch (error) {
      console.error('Erro ao aprovar solicitação:', error)
      setMessage({ type: 'error', text: 'Erro ao aprovar: ' + error.message })
    } finally {
      setLoading(false)
    }
  }

  // Função para reprovar solicitação
  const handleReprovarSolicitacao = async (solicitacao) => {
    if (!respostaAdmin.trim()) {
      setMessage({ type: 'error', text: 'Por favor, informe o motivo da reprovação' })
      return
    }
    
    try {
      setLoading(true)
      
      const { error } = await supabase
        .from('solicitacoes')
        .update({
          status: 'reprovado',
          admin_id: userProfile.id,
          resposta_admin: respostaAdmin,
          data_resposta: new Date().toISOString()
        })
        .eq('id', solicitacao.id)
      
      if (error) throw error
      
      setMessage({ type: 'success', text: 'Solicitação reprovada' })
      setSolicitacaoSelecionada(null)
      setRespostaAdmin('')
      fetchSolicitacoes()
    } catch (error) {
      console.error('Erro ao reprovar solicitação:', error)
      setMessage({ type: 'error', text: 'Erro ao reprovar: ' + error.message })
    } finally {
      setLoading(false)
    }
  }

  // Função para preview de comissões no modal
  const getPreviewComissoes = () => {
    if (!vendaForm.valor_venda || !vendaForm.corretor_id) {
      return { cargos: [], total: 0, percentualTotal: 0 }
    }

    const corretor = corretores.find(c => c.id === vendaForm.corretor_id)
    const isAutonomo = corretor && !corretor.empreendimento_id && corretor.percentual_corretor

    if (isAutonomo) {
      // Corretor autônomo
      const percentualCorretor = parseFloat(corretor.percentual_corretor) || 0
      const valorVenda = parseFloat(vendaForm.valor_venda || 0)
      const comissaoCorretor = (valorVenda * percentualCorretor) / 100
      return {
        cargos: [{
          cargo_id: null,
          nome_cargo: 'Corretor Autônomo',
          percentual: percentualCorretor,
          valor: comissaoCorretor
        }],
        total: comissaoCorretor,
        percentualTotal: percentualCorretor
      }
    }

    if (!vendaForm.empreendimento_id) {
      return { cargos: [], total: 0, percentualTotal: 0 }
    }

    return calcularComissoesDinamicas(
      parseFloat(vendaForm.valor_venda || 0),
      vendaForm.empreendimento_id,
      vendaForm.tipo_corretor
    )
  }

  const getCorretorPercentual = (corretorId) => {
    const corretor = corretores.find(c => c.id === corretorId)
    if (corretor?.percentual_corretor) {
      return corretor.percentual_corretor
    }
    return corretor?.tipo_corretor === 'interno' ? 2.5 : 4
  }

  // Função auxiliar para calcular a comissão do corretor
  const calcularComissaoCorretor = (comissoesDinamicas, corretorId, valorVenda) => {
    if (!comissoesDinamicas || !comissoesDinamicas.cargos || comissoesDinamicas.cargos.length === 0) {
      // Fallback: calcular baseado no percentual padrão
      const percentualCorretor = getCorretorPercentual(corretorId)
      return (valorVenda * percentualCorretor) / 100
    }

    // Procurar pelo cargo do corretor nos cargos calculados
    const cargoCorretor = comissoesDinamicas.cargos.find(c => 
      c.nome_cargo.toLowerCase().includes('corretor') || 
      c.nome_cargo.toLowerCase().includes('autônomo') ||
      c.nome_cargo.toLowerCase().includes('corretor interno') ||
      c.nome_cargo.toLowerCase().includes('corretor externo')
    )
    
    if (cargoCorretor) {
      return cargoCorretor.valor
    }

    // Se não encontrar, calcular baseado no percentual do corretor
    const percentualCorretor = getCorretorPercentual(corretorId)
    return (valorVenda * percentualCorretor) / 100
  }

  const handleSaveVenda = async () => {
    if (!vendaForm.corretor_id || !vendaForm.valor_venda) {
      setMessage({ type: 'error', text: 'Preencha todos os campos obrigatórios (Corretor e Valor)' })
      return
    }

    // Verificar se o corretor é autônomo
    const corretor = corretores.find(c => c.id === vendaForm.corretor_id)
    const isCorretorAutonomo = corretor && !corretor.empreendimento_id && corretor.percentual_corretor

    // Se não for autônomo, exige empreendimento
    if (!isCorretorAutonomo && !vendaForm.empreendimento_id) {
      setMessage({ type: 'error', text: 'Selecione o empreendimento ou use um corretor autônomo' })
      return
    }

    setSaving(true)
    
    try {
      const valorVenda = parseFloat(vendaForm.valor_venda)
      
      // Validar e garantir que grupos_parcelas_entrada seja um array válido de objetos válidos
      const gruposParcelasEntrada = Array.isArray(vendaForm.grupos_parcelas_entrada) 
        ? vendaForm.grupos_parcelas_entrada.filter(grupo => 
            grupo && typeof grupo === 'object' && grupo !== null && 
            (grupo.qtd !== undefined || grupo.valor !== undefined)
          )
        : []
      
      // Validar e garantir que grupos_balao seja um array válido de objetos válidos
      const gruposBalao = Array.isArray(vendaForm.grupos_balao) 
        ? vendaForm.grupos_balao.filter(grupo => 
            grupo && typeof grupo === 'object' && grupo !== null && 
            (grupo.qtd !== undefined || grupo.valor !== undefined)
          )
        : []
      
      // Calcular comissões: se autônomo, usa percentual personalizado; senão, usa cargos do empreendimento
      let comissoesDinamicas
      if (isCorretorAutonomo) {
        // Corretor autônomo: usa apenas o percentual do corretor
        const percentualCorretor = parseFloat(corretor.percentual_corretor) || 0
        const comissaoCorretor = (valorVenda * percentualCorretor) / 100
        comissoesDinamicas = {
          cargos: [{
            cargo_id: null,
            nome_cargo: 'Corretor Autônomo',
            percentual: percentualCorretor,
            valor: comissaoCorretor
          }],
          total: comissaoCorretor,
          percentualTotal: percentualCorretor
        }
      } else {
        // Corretor vinculado: usa cargos do empreendimento
        comissoesDinamicas = calcularComissoesDinamicas(
          valorVenda,
          vendaForm.empreendimento_id,
          vendaForm.tipo_corretor
        )
      }

      // Calcular valor pro-soluto e fator de comissão
      const valorSinal = vendaForm.teve_sinal ? (parseFloat(vendaForm.valor_sinal) || 0) : 0
      
      // Entrada: se parcelou, soma todos os grupos. Se não parcelou, usa valor_entrada
      let valorEntradaTotal = 0
      if (vendaForm.teve_entrada) {
        if (vendaForm.parcelou_entrada) {
          // Soma todos os grupos: cada grupo = qtd × valor (apenas grupos válidos)
          valorEntradaTotal = gruposParcelasEntrada.reduce((sum, grupo) => {
            // Garantir que grupo é um objeto válido
            if (!grupo || typeof grupo !== 'object' || grupo === null) return sum
            return sum + ((parseFloat(grupo.qtd) || 0) * (parseFloat(grupo.valor) || 0))
          }, 0)
        } else {
          valorEntradaTotal = parseFloat(vendaForm.valor_entrada) || 0
        }
      }
      
      // Balões: soma todos os grupos (apenas grupos válidos)
      let valorTotalBalao = 0
      if (vendaForm.teve_balao === 'sim') {
        valorTotalBalao = gruposBalao.reduce((sum, grupo) => {
          // Garantir que grupo é um objeto válido
          if (!grupo || typeof grupo !== 'object' || grupo === null) return sum
          return sum + ((parseFloat(grupo.qtd) || 0) * (parseFloat(grupo.valor) || 0))
        }, 0)
      }
    
    // Pro-soluto = sinal + entrada + balões
    const valorProSoluto = valorSinal + valorEntradaTotal + valorTotalBalao
    
    // Fator de comissão conforme fator-comissao.mdc: (valorVenda * percentual) / valorProSoluto
    const percentualTotal = comissoesDinamicas.percentualTotal
    const fatorTotal = calcularFatorComissao(valorVenda, valorProSoluto, percentualTotal)
    // Snapshot histórico (R9) — grava junto de cada parcela criada em handleSaveVenda
    const snapshotComissao = {
      fator_comissao_aplicado: fatorTotal,
      percentual_comissao_total: percentualTotal
    }

    // Calcular comissão do corretor
    const comissaoCorretor = calcularComissaoCorretor(comissoesDinamicas, vendaForm.corretor_id, valorVenda)
    
    /*console.log('Cálculo venda:', {
      valorVenda,
      valorSinal,
      valorEntradaTotal,
      valorTotalBalao,
      valorProSoluto,
      comissaoTotal: comissoesDinamicas.total,
      comissaoCorretor,
      fatorTotal,
      teveSinal: vendaForm.teve_sinal,
      teveEntrada: vendaForm.teve_entrada,
      parcelouEntrada: vendaForm.parcelou_entrada,
      teveBalao: vendaForm.teve_balao
    })
*/
    // Quando parcelou_entrada, preencher qtd e valor a partir do primeiro grupo válido
    let qtdParcelasEntradaPayload = parseInt(vendaForm.qtd_parcelas_entrada) || null
    let valorParcelaEntradaPayload = parseFloat(vendaForm.valor_parcela_entrada) || null
    if (vendaForm.parcelou_entrada && gruposParcelasEntrada.length > 0) {
      const primeiroGrupo = gruposParcelasEntrada[0]
      if (primeiroGrupo && (parseFloat(primeiroGrupo.qtd) || 0) > 0 && (parseFloat(primeiroGrupo.valor) || 0) > 0) {
        qtdParcelasEntradaPayload = parseInt(primeiroGrupo.qtd) || null
        valorParcelaEntradaPayload = parseFloat(primeiroGrupo.valor) || null
      }
    }

    // Extrai o valor de um cargo pelo nome (busca parcial, case-insensitive). Fallback: 0.
    const getComissaoCargo = (...termos) => {
      const cargo = comissoesDinamicas.cargos?.find(c =>
        termos.some(t => c.nome_cargo?.toLowerCase().includes(t.toLowerCase()))
      )
      return cargo?.valor ?? 0
    }

    const vendaData = {
      corretor_id: vendaForm.corretor_id,
      empreendimento_id: isCorretorAutonomo ? null : (vendaForm.empreendimento_id || null),
      cliente_id: vendaForm.cliente_id || null,
      unidade: vendaForm.unidade || null,
      bloco: vendaForm.bloco?.toUpperCase() || null,
      andar: vendaForm.andar || null,
      valor_venda: valorVenda,
      tipo_corretor: vendaForm.tipo_corretor,
      data_venda: vendaForm.data_venda,
      data_entrada: vendaForm.data_entrada || null,
      descricao: vendaForm.descricao,
      status: vendaForm.status,
      teve_sinal: vendaForm.teve_sinal,
      valor_sinal: valorSinal || null,
      teve_entrada: vendaForm.teve_entrada,
      valor_entrada: parseFloat(vendaForm.valor_entrada) || null,
      parcelou_entrada: vendaForm.parcelou_entrada,
      periodicidade_parcelas: parseInt(vendaForm.periodicidade_parcelas) || 1,
      qtd_parcelas_entrada: qtdParcelasEntradaPayload,
      valor_parcela_entrada: valorParcelaEntradaPayload,
      teve_balao: vendaForm.teve_balao,
      periodicidade_balao: parseInt(vendaForm.periodicidade_balao) || 6,
      qtd_balao: parseInt(vendaForm.qtd_balao) || null,
      valor_balao: parseFloat(vendaForm.valor_balao) || null,
      teve_permuta: vendaForm.teve_permuta,
      tipo_permuta: vendaForm.tipo_permuta || null,
      valor_permuta: parseFloat(vendaForm.valor_permuta) || null,
      valor_pro_soluto: valorProSoluto || null,
      fator_comissao: fatorTotal || null,
      comissao_total: comissoesDinamicas.total,
      comissao_corretor: comissaoCorretor,
      comissao_diretor: getComissaoCargo('diretor'),
      comissao_nohros_imobiliaria: getComissaoCargo('imobili'),
      comissao_nohros_gestao: getComissaoCargo('gest'),
      comissao_wsc: getComissaoCargo('wsc', 'beton'),
      comissao_coordenadora: getComissaoCargo('coordenad'),
      contrato_url: vendaForm.contrato_url || null,
      contrato_nome: vendaForm.contrato_nome || null
    }

    // Upload do contrato se houver arquivo novo
    if (contratoFile) {
      const resultado = await handleContratoUpload(contratoFile)
      if (resultado) {
        vendaData.contrato_url = resultado.url
        vendaData.contrato_nome = resultado.nome
      }
    }

    let error
    let vendaId = selectedItem?.id

    if (selectedItem) {
      const result = await supabase
        .from('vendas')
        .update(vendaData)
        .eq('id', selectedItem.id)
      error = result.error
    } else {
      const result = await supabase
        .from('vendas')
        .insert([vendaData])
        .select()
        .single()
      error = result.error
      vendaId = result.data?.id
    }

    if (error) {
      throw new Error(error.message || 'Erro ao salvar venda no banco de dados')
    }

    // ── SPEC RF-1 a RF-4: Edição de venda com proteção de pagamentos auditados ──
    // Ref: docs/SPEC_PRESERVACAO_PAGAMENTOS_AUDITADOS.md
    if (selectedItem && vendaId) {
      const temBaixas = await verificarBaixasExistentes(supabase, vendaId)
      const mudouFinanceiro = detectarMudancaFinanceira(vendaForm, selectedItem, gruposParcelasEntrada, gruposBalao)

      if (temBaixas && !mudouFinanceiro) {
        // RF-2: só campos cadastrais mudaram — atualiza apenas vendas, não toca em pagamentos
        console.log('✅ Edição cadastral com baixas: pagamentos preservados.')
        // (UPDATE em vendas já foi feito acima; nada a fazer em pagamentos)
      } else if (temBaixas && mudouFinanceiro) {
        // Buscar pagamentos existentes para checar mudança estrutural
        const { data: pagamentosAtuais } = await supabase
          .from('pagamentos_prosoluto')
          .select('*')
          .eq('venda_id', vendaId)

        const ehEstrutural = detectarMudancaEstrutural(pagamentosAtuais || [], vendaForm)

        if (ehEstrutural) {
          // RF-4 / §G: mudança incompatível com linhas pago — bloquear
          setSaving(false)
          setMessage({
            type: 'error',
            text: '⚠️ Esta venda possui parcelas já auditadas (pagas) e a alteração solicitada mudaria a estrutura dos pagamentos de forma incompatível. Para prosseguir, envie um print desta tela e uma descrição detalhada do que precisa ser alterado para o responsável pelo sistema.'
          })
          return
        }

        // RF-3 / §E: mudança de cronograma compatível — propagação cirúrgica
        console.log('✏️ Edição financeira com baixas: propagação cirúrgica de cronograma...')

        // Gerar grade teórica (mesmo motor de antes, sem deletar nada ainda)
        const pagamentosNovos = []
        const valorEntradaParaCalculo = valorSinal + valorEntradaTotal
        const percentualEntrada = valorVenda > 0 ? (valorEntradaParaCalculo / valorVenda) * 100 : 0
        const entradaNoAto = !vendaForm.parcelou_entrada
        const aplicarComissaoIntegral = percentualEntrada >= 20 && entradaNoAto
        const dataBaseCalculo = vendaForm.data_entrada || vendaForm.data_venda

        if (aplicarComissaoIntegral) {
          const comissaoTotal = comissoesDinamicas.total || (valorProSoluto * fatorTotal)
          pagamentosNovos.push({
            venda_id: vendaId,
            tipo: 'comissao_integral',
            valor: valorEntradaParaCalculo,
            data_prevista: dataBaseCalculo,
            comissao_gerada: comissaoTotal,
            ...snapshotComissao,
          })
        } else {
          if (valorSinal > 0) {
            pagamentosNovos.push({
              venda_id: vendaId,
              tipo: 'sinal',
              valor: valorSinal,
              data_prevista: vendaForm.data_sinal || dataBaseCalculo,
              comissao_gerada: calcularComissaoPagamento(valorSinal, fatorTotal),
              ...snapshotComissao,
            })
          }
          if (vendaForm.teve_entrada && !vendaForm.parcelou_entrada) {
            const valorEntradaAvista = parseFloat(vendaForm.valor_entrada) || 0
            if (valorEntradaAvista > 0) {
              pagamentosNovos.push({
                venda_id: vendaId,
                tipo: 'entrada',
                valor: valorEntradaAvista,
                data_prevista: dataBaseCalculo,
                comissao_gerada: calcularComissaoPagamento(valorEntradaAvista, fatorTotal),
                ...snapshotComissao,
              })
            }
          }
          if (vendaForm.teve_entrada && vendaForm.parcelou_entrada) {
            let numeroParcela = 1
            gruposParcelasEntrada.forEach((grupo) => {
              if (!grupo || typeof grupo !== 'object') return
              const qtd = parseInt(grupo.qtd) || 0
              const valor = parseFloat(grupo.valor) || 0
              if (qtd > 0 && valor > 0) {
                for (let i = 0; i < qtd; i++) {
                  const idxParcela = numeroParcela - 1
                  const dataOverride = (vendaForm.datas_parcelas_override || {})[idxParcela]
                  const periodicidade = parseInt(vendaForm.periodicidade_parcelas) || 1
                  const diaFixo = vendaForm.dia_pagamento_parcelas === 0
                    ? (parseInt(vendaForm.dia_pagamento_parcelas_outro) || 1)
                    : (vendaForm.dia_pagamento_parcelas || 1)
                  const dataPrevista = dataOverride || (dataBaseCalculo
                    ? getDataComDiaFixo(dataBaseCalculo, numeroParcela * periodicidade, diaFixo)
                    : undefined)
                  pagamentosNovos.push({
                    venda_id: vendaId,
                    tipo: 'parcela_entrada',
                    numero_parcela: numeroParcela,
                    valor,
                    data_prevista: dataPrevista,
                    comissao_gerada: calcularComissaoPagamento(valor, fatorTotal),
                    ...snapshotComissao,
                  })
                  numeroParcela++
                }
              }
            })
          }
          if (vendaForm.teve_balao === 'sim') {
            let numeroBalao = 1
            gruposBalao.forEach((grupo) => {
              if (!grupo || typeof grupo !== 'object') return
              const qtd = parseInt(grupo.qtd) || 0
              const valor = parseFloat(grupo.valor) || 0
              if (qtd > 0 && valor > 0) {
                for (let i = 0; i < qtd; i++) {
                  const dataOverrideBalao = (vendaForm.datas_balao_override || {})[numeroBalao - 1]
                  const periBalao = parseInt(vendaForm.periodicidade_balao) || 6
                  const diaFixoBalao = vendaForm.dia_pagamento_balao === 0
                    ? (parseInt(vendaForm.dia_pagamento_balao_outro) || 1)
                    : (vendaForm.dia_pagamento_balao || 1)
                  const dataAutoBalao = dataBaseCalculo
                    ? getDataComDiaFixo(dataBaseCalculo, numeroBalao * periBalao, diaFixoBalao)
                    : undefined
                  pagamentosNovos.push({
                    venda_id: vendaId,
                    tipo: 'balao',
                    numero_parcela: numeroBalao,
                    valor,
                    data_prevista: dataOverrideBalao || dataAutoBalao || undefined,
                    comissao_gerada: calcularComissaoPagamento(valor, fatorTotal),
                    ...snapshotComissao,
                  })
                  numeroBalao++
                }
              }
            })
          }
        }

        await propagarCronogramaCirurgico({
          supabaseClient: supabase,
          vendaId,
          pagamentosExistentes: pagamentosAtuais || [],
          pagamentosNovos,
        })

        // RF-5: recalcular totais no cabeçalho da venda a partir das linhas atuais
        const { data: linhasAtualizadas } = await supabase
          .from('pagamentos_prosoluto')
          .select('comissao_gerada')
          .eq('venda_id', vendaId)
        if (linhasAtualizadas) {
          const novaComissaoTotal = linhasAtualizadas.reduce(
            (s, p) => s + (parseFloat(p.comissao_gerada) || 0), 0
          )
          await supabase
            .from('vendas')
            .update({ comissao_total: novaComissaoTotal })
            .eq('id', vendaId)
        }

        console.log('✅ Propagação cirúrgica concluída.')
      } else {
        // Sem baixas: R6 — preservar IDs via UPDATE por chave (tipo, numero_parcela)
        console.log('✏️ Edição sem baixas: propagação cirúrgica (UPDATE por ID)...')

        // Buscar pagamentos existentes para fazer match por chave
        const { data: pagamentosAtuaisSemBaixa } = await supabase
          .from('pagamentos_prosoluto')
          .select('*')
          .eq('venda_id', vendaId)

        // Gerar grade teórica (mesmo motor)
        const pagamentosNovos = []
        const valorEntradaParaCalculo = valorSinal + valorEntradaTotal
        const percentualEntrada = valorVenda > 0 ? (valorEntradaParaCalculo / valorVenda) * 100 : 0
        const entradaNoAto = !vendaForm.parcelou_entrada
        const aplicarComissaoIntegral = percentualEntrada >= 20 && entradaNoAto
        const dataBaseCalculo = vendaForm.data_entrada || vendaForm.data_venda

        if (aplicarComissaoIntegral) {
          const comissaoTotal = comissoesDinamicas.total || (valorProSoluto * fatorTotal)
          pagamentosNovos.push({
            venda_id: vendaId,
            tipo: 'comissao_integral',
            valor: valorEntradaParaCalculo,
            data_prevista: dataBaseCalculo,
            comissao_gerada: comissaoTotal,
            ...snapshotComissao,
          })
          console.log(`✅ Edição: Entrada >= 20% no ato (${percentualEntrada.toFixed(1)}%). Comissão integral: R$ ${comissaoTotal.toFixed(2)}`)
        } else {
          if (valorSinal > 0) {
            pagamentosNovos.push({
              venda_id: vendaId,
              tipo: 'sinal',
              valor: valorSinal,
              data_prevista: vendaForm.data_sinal || dataBaseCalculo,
              comissao_gerada: calcularComissaoPagamento(valorSinal, fatorTotal),
              ...snapshotComissao,
            })
          }

          if (vendaForm.teve_entrada && !vendaForm.parcelou_entrada) {
            const valorEntradaAvista = parseFloat(vendaForm.valor_entrada) || 0
            if (valorEntradaAvista > 0) {
              pagamentosNovos.push({
                venda_id: vendaId,
                tipo: 'entrada',
                valor: valorEntradaAvista,
                data_prevista: dataBaseCalculo,
                comissao_gerada: calcularComissaoPagamento(valorEntradaAvista, fatorTotal),
                ...snapshotComissao,
              })
            }
          }

          if (vendaForm.teve_entrada && vendaForm.parcelou_entrada) {
            let numeroParcela = 1
            gruposParcelasEntrada.forEach((grupo) => {
              if (!grupo || typeof grupo !== 'object' || grupo === null) {
                console.warn('Grupo de parcela inválido ignorado:', grupo)
                return
              }
              const qtd = parseInt(grupo.qtd) || 0
              const valor = parseFloat(grupo.valor) || 0
              if (qtd > 0 && valor > 0) {
                for (let i = 0; i < qtd; i++) {
                  const idxParcela = numeroParcela - 1
                  const dataOverride = (vendaForm.datas_parcelas_override || {})[idxParcela]
                  let dataPrevistaParcela
                  if (dataOverride) {
                    dataPrevistaParcela = dataOverride
                  } else {
                    const periodicidade = parseInt(vendaForm.periodicidade_parcelas) || 1
                    const diaFixo = vendaForm.dia_pagamento_parcelas === 0
                      ? (parseInt(vendaForm.dia_pagamento_parcelas_outro) || 1)
                      : (vendaForm.dia_pagamento_parcelas || 1)
                    dataPrevistaParcela = getDataComDiaFixo(dataBaseCalculo, numeroParcela * periodicidade, diaFixo)
                  }

                  pagamentosNovos.push({
                    venda_id: vendaId,
                    tipo: 'parcela_entrada',
                    numero_parcela: numeroParcela,
                    valor: valor,
                    data_prevista: dataPrevistaParcela,
                    comissao_gerada: calcularComissaoPagamento(valor, fatorTotal),
                    ...snapshotComissao,
                  })
                  numeroParcela++
                }
              }
            })
          }

          if (vendaForm.teve_balao === 'sim') {
            let numeroBalao = 1
            gruposBalao.forEach((grupo) => {
              if (!grupo || typeof grupo !== 'object' || grupo === null) {
                console.warn('Grupo de balão inválido ignorado:', grupo)
                return
              }
              const qtd = parseInt(grupo.qtd) || 0
              const valor = parseFloat(grupo.valor) || 0
              if (qtd > 0 && valor > 0) {
                for (let i = 0; i < qtd; i++) {
                  const dataOverrideBalao = (vendaForm.datas_balao_override || {})[numeroBalao - 1]
                  const periBalao = parseInt(vendaForm.periodicidade_balao) || 6
                  const diaFixoBalao = vendaForm.dia_pagamento_balao === 0
                    ? (parseInt(vendaForm.dia_pagamento_balao_outro) || 1)
                    : (vendaForm.dia_pagamento_balao || 1)
                  const dataAutoBalao = dataBaseCalculo
                    ? getDataComDiaFixo(dataBaseCalculo, numeroBalao * periBalao, diaFixoBalao)
                    : undefined
                  pagamentosNovos.push({
                    venda_id: vendaId,
                    tipo: 'balao',
                    numero_parcela: numeroBalao,
                    valor: valor,
                    data_prevista: dataOverrideBalao || dataAutoBalao || undefined,
                    comissao_gerada: calcularComissaoPagamento(valor, fatorTotal),
                    ...snapshotComissao,
                  })
                  numeroBalao++
                }
              }
            })
          }
        }

        await propagarCronogramaCirurgico({
          supabaseClient: supabase,
          vendaId,
          pagamentosExistentes: pagamentosAtuaisSemBaixa || [],
          pagamentosNovos,
        })

        // Recalcular total da venda a partir das linhas atuais
        const { data: linhasAtualizadasSem } = await supabase
          .from('pagamentos_prosoluto')
          .select('comissao_gerada')
          .eq('venda_id', vendaId)
        if (linhasAtualizadasSem) {
          const novaComissaoTotalSem = linhasAtualizadasSem.reduce(
            (s, p) => s + (parseFloat(p.comissao_gerada) || 0), 0
          )
          await supabase
            .from('vendas')
            .update({ comissao_total: novaComissaoTotalSem })
            .eq('id', vendaId)
        }

        console.log('✅ Edição sem baixas: propagação concluída preservando IDs.')
      } // fecha else (sem baixas)
    } // fecha if (selectedItem && vendaId)

    // Se é nova venda, salvar comissões por cargo e pagamentos pro-soluto
    if (!selectedItem && vendaId) {
      console.log('🆕 Nova venda detectada. Salvando comissões e pagamentos...')
      // Salvar comissões por cargo
      if (comissoesDinamicas.cargos.length > 0) {
        const comissoesData = comissoesDinamicas.cargos.map(c => ({
          venda_id: vendaId,
          cargo_id: c.cargo_id,
          nome_cargo: c.nome_cargo,
          percentual: c.percentual,
          valor_comissao: c.valor
        }))
        await supabase.from('comissoes_venda').insert(comissoesData)
      }

      // Criar pagamentos pro-soluto
      // Fórmula: Comissão da Parcela = Valor da Parcela × Fcom
      const pagamentos = []

      console.log('📊 Iniciando criação de pagamentos. Sinal:', valorSinal, 'Entrada:', valorEntradaTotal, 'Balão:', valorTotalBalao, 'Pro-soluto:', valorProSoluto)
      
      // ===== REGRA ESPECIAL: ENTRADA >= 20% NO ATO (ver .cursor/rules/comissao-integral-20.mdc) =====
      const valorEntradaParaCalculo = valorSinal + valorEntradaTotal
      const percentualEntrada = valorVenda > 0 ? (valorEntradaParaCalculo / valorVenda) * 100 : 0
      const entradaNoAto = !vendaForm.parcelou_entrada
      const aplicarComissaoIntegral = percentualEntrada >= 20 && entradaNoAto
      
      const dataBaseCalculo2 = vendaForm.data_entrada || vendaForm.data_venda

      if (aplicarComissaoIntegral) {
        // Entrada >= 20% e paga no ato (não parcelada): 1 parcela com comissão total
        const comissaoTotal = comissoesDinamicas.total || (valorProSoluto * fatorTotal)
        const fatorIntegral = valorEntradaParaCalculo > 0 ? comissaoTotal / valorEntradaParaCalculo : 0

        pagamentos.push({
          venda_id: vendaId,
          tipo: 'comissao_integral',
          valor: valorEntradaParaCalculo,
          data_prevista: dataBaseCalculo2,
          comissao_gerada: comissaoTotal,
          numero_parcela: null,
          ...snapshotComissao,
        })

        console.log(`✅ Entrada >= 20% no ato (${percentualEntrada.toFixed(1)}%). Comissão integral: R$ ${comissaoTotal.toFixed(2)}`)
      } else {
        // Entrada < 20% ou entrada parcelada: gerar parcelas normalmente

        // Sinal
        if (valorSinal > 0) {
          pagamentos.push({
            venda_id: vendaId,
            tipo: 'sinal',
            valor: valorSinal,
            data_prevista: vendaForm.data_sinal || dataBaseCalculo2,
            comissao_gerada: calcularComissaoPagamento(valorSinal, fatorTotal),
            ...snapshotComissao,
          })
        }

        // Entrada (à vista) - só se teve entrada E não parcelou
        if (vendaForm.teve_entrada && !vendaForm.parcelou_entrada) {
          const valorEntradaAvista = parseFloat(vendaForm.valor_entrada) || 0
          if (valorEntradaAvista > 0) {
            pagamentos.push({
              venda_id: vendaId,
              tipo: 'entrada',
              valor: valorEntradaAvista,
              data_prevista: dataBaseCalculo2,
              comissao_gerada: calcularComissaoPagamento(valorEntradaAvista, fatorTotal),
              ...snapshotComissao,
            })
          }
        }

        // Parcelas da entrada - só se teve entrada E parcelou
        if (vendaForm.teve_entrada && vendaForm.parcelou_entrada) {
          let numeroParcela = 1
          // Iterar por cada grupo de parcelas (apenas grupos válidos)
          gruposParcelasEntrada.forEach((grupo) => {
            // Validar que grupo é um objeto válido antes de processar
            if (!grupo || typeof grupo !== 'object' || grupo === null) {
              console.warn('Grupo de parcela inválido ignorado:', grupo)
              return
            }

            const qtd = parseInt(grupo.qtd) || 0
            const valor = parseFloat(grupo.valor) || 0

            // Só processar se quantidade e valor forem válidos
            if (qtd > 0 && valor > 0) {
              for (let i = 0; i < qtd; i++) {
                const idxParcela2 = numeroParcela - 1
                const dataOverride2 = (vendaForm.datas_parcelas_override || {})[idxParcela2]
                let dataPrevistaParcela2
                if (dataOverride2) {
                  dataPrevistaParcela2 = dataOverride2
                } else {
                  const periodicidade2 = parseInt(vendaForm.periodicidade_parcelas) || 1
                  const diaFixo = vendaForm.dia_pagamento_parcelas === 0
                    ? (parseInt(vendaForm.dia_pagamento_parcelas_outro) || 1)
                    : (vendaForm.dia_pagamento_parcelas || 1)
                  dataPrevistaParcela2 = getDataComDiaFixo(dataBaseCalculo2, numeroParcela * periodicidade2, diaFixo)
                }

                pagamentos.push({
                  venda_id: vendaId,
                  tipo: 'parcela_entrada',
                  numero_parcela: numeroParcela,
                  valor: valor,
                  data_prevista: dataPrevistaParcela2,
                  comissao_gerada: calcularComissaoPagamento(valor, fatorTotal),
                  ...snapshotComissao,
                })
                numeroParcela++
              }
            }
          })
        }

        // Balões
        if (vendaForm.teve_balao === 'sim') {
          let numeroBalao = 1
          // Iterar por cada grupo de balões (apenas grupos válidos)
          gruposBalao.forEach((grupo) => {
            // Validar que grupo é um objeto válido antes de processar
            if (!grupo || typeof grupo !== 'object' || grupo === null) {
              console.warn('Grupo de balão inválido ignorado:', grupo)
              return
            }

            const qtd = parseInt(grupo.qtd) || 0
            const valor = parseFloat(grupo.valor) || 0

            // Só processar se quantidade e valor forem válidos
            if (qtd > 0 && valor > 0) {
              for (let i = 0; i < qtd; i++) {
                const dataOverrideBalao2 = (vendaForm.datas_balao_override || {})[numeroBalao - 1]
                const periBalao2 = parseInt(vendaForm.periodicidade_balao) || 6
                const diaFixoBalao = vendaForm.dia_pagamento_balao === 0
                  ? (parseInt(vendaForm.dia_pagamento_balao_outro) || 1)
                  : (vendaForm.dia_pagamento_balao || 1)
                const dataAutoBalao2 = dataBaseCalculo2
                  ? getDataComDiaFixo(dataBaseCalculo2, numeroBalao * periBalao2, diaFixoBalao)
                  : undefined
                pagamentos.push({
                  venda_id: vendaId,
                  tipo: 'balao',
                  numero_parcela: numeroBalao,
                  valor: valor,
                  data_prevista: dataOverrideBalao2 || dataAutoBalao2 || undefined,
                  comissao_gerada: calcularComissaoPagamento(valor, fatorTotal),
                  ...snapshotComissao,
                })
                numeroBalao++
              }
            }
          })
        }
      }

      if (pagamentos.length > 0) {
        const { error: pagError } = await supabase.from('pagamentos_prosoluto').insert(pagamentos)
        if (pagError) {
          console.error('❌ Erro ao criar pagamentos:', pagError)
        } else {
          console.log('✅ Pagamentos criados:', pagamentos.length)
        }
      } else {
        console.log('⚠️ Nenhum pagamento para criar. Pro-soluto:', valorProSoluto)
      }
    }

    // Se chegou até aqui, tudo deu certo
    setMessage({ type: 'success', text: 'Venda salva com sucesso!' })
    clearMessageAfter(3000)

    } catch (error) {
      console.error('Erro ao salvar venda:', error)
      setMessage({ type: 'error', text: 'Erro ao salvar venda: ' + (error.message || 'Erro desconhecido') })
      clearMessageAfter(5000)
    } finally {
      // Sempre fechar modal e resetar estado, mesmo em caso de erro
      setSaving(false)
      setShowModal(false)
      setSelectedItem(null)
      resetVendaForm()
      fetchData()
    }
  }

  const handleSaveCorretor = async () => {
    if (!corretorForm.nome || !corretorForm.email) {
      setMessage({ type: 'error', text: 'Preencha todos os campos obrigatórios' })
      return
    }

    // Validação diferente para autônomo
    if (corretorForm.is_autonomo) {
      if (!corretorForm.percentual_corretor || parseFloat(corretorForm.percentual_corretor) <= 0) {
        setMessage({ type: 'error', text: 'Informe a comissão do corretor autônomo' })
        return
      }
    } else {
      if (!corretorForm.empreendimento_id || !corretorForm.cargo_id) {
        setMessage({ type: 'error', text: 'Selecione o empreendimento e cargo' })
        return
      }
    }

    // Se é edição e quer ativar acesso, precisa de senha
    if (selectedItem && corretorForm.ativar_acesso && !corretorForm.senha) {
      setMessage({ type: 'error', text: 'Informe uma senha para ativar o acesso ao sistema' })
      return
    }

    if (selectedItem && corretorForm.ativar_acesso && corretorForm.senha.length < 6) {
      setMessage({ type: 'error', text: 'A senha deve ter no mínimo 6 caracteres' })
      return
    }

    // Se é novo corretor, precisa de senha
    if (!selectedItem && !corretorForm.senha) {
      setMessage({ type: 'error', text: 'A senha é obrigatória para novos corretores' })
      return
    }

    if (!selectedItem && corretorForm.senha.length < 6) {
      setMessage({ type: 'error', text: 'A senha deve ter no mínimo 6 caracteres' })
      return
    }

    // Validar email se for ativar acesso (não pode ser @sync.local ou @placeholder.local)
    if (selectedItem && corretorForm.ativar_acesso) {
      if (corretorForm.email?.includes('@sync.local') || corretorForm.email?.includes('@placeholder.local')) {
        setMessage({ type: 'error', text: 'Para ativar o acesso, informe um email válido (não pode ser @sync.local)' })
        return
      }
    }

    setSaving(true)
    setMessage({ type: '', text: '' })

    try {
      if (selectedItem) {
        // EDIÇÃO de corretor existente
        
        // Se quer ativar acesso ao sistema
        if (corretorForm.ativar_acesso && !corretorForm.tem_acesso_sistema) {
          // Criar conta no Supabase Auth
          const { data: authData, error: authError } = await supabase.auth.signUp({
            email: corretorForm.email,
            password: corretorForm.senha,
            options: {
              data: {
                nome: corretorForm.nome
              }
            }
          })

          if (authError) {
            // Se o email já existe no Auth, tentar outra abordagem
            if (authError.message?.includes('already registered')) {
              throw new Error('Este email já está cadastrado no sistema de autenticação. Use outro email ou entre em contato com o suporte.')
            }
            throw new Error(`Erro ao criar acesso: ${authError.message}`)
          }

          if (!authData.user) {
            throw new Error('Erro ao criar usuário no sistema de autenticação')
          }

          // Deletar o registro antigo (com ID gerado pelo banco)
          await supabase.from('usuarios').delete().eq('id', selectedItem.id)

          // Criar novo registro com o ID do Auth
          const { error: dbError } = await supabase
            .from('usuarios')
            .insert([{
              id: authData.user.id,
              email: corretorForm.email,
              nome: corretorForm.nome,
              tipo: 'corretor',
              tipo_corretor: corretorForm.tipo_corretor,
              telefone: corretorForm.telefone || null,
              percentual_corretor: corretorForm.is_autonomo ? parseFloat(corretorForm.percentual_corretor) : (parseFloat(corretorForm.percentual_corretor) || null),
              empreendimento_id: corretorForm.is_autonomo ? null : (corretorForm.empreendimento_id || null),
              cargo_id: corretorForm.is_autonomo ? null : (corretorForm.cargo_id || null),
              cnpj: corretorForm.cnpj || null,
              imobiliaria: corretorForm.imobiliaria || null,
              creci: corretorForm.creci || null,
              sienge_broker_id: selectedItem.sienge_broker_id || null,
              origem: selectedItem.origem || null,
              tem_acesso_sistema: true
            }])

          if (dbError) {
            throw new Error(dbError.message)
          }

          // Atualizar referências em vendas (corretor_id)
          if (selectedItem.id !== authData.user.id) {
            await supabase
              .from('vendas')
              .update({ corretor_id: authData.user.id })
              .eq('corretor_id', selectedItem.id)
            
            // Atualizar referências em comissoes_venda
            await supabase
              .from('comissoes_venda')
              .update({ corretor_id: authData.user.id })
              .eq('corretor_id', selectedItem.id)
          }

          setMessage({ type: 'success', text: `Acesso ativado para ${corretorForm.nome}! O corretor pode fazer login com o email ${corretorForm.email} e a senha definida.` })
        } else {
          // Apenas atualizar dados (sem ativar acesso)
          const { error: dbError } = await supabase
            .from('usuarios')
            .update({
              nome: corretorForm.nome,
              email: corretorForm.email,
              tipo_corretor: corretorForm.tipo_corretor,
              telefone: corretorForm.telefone || null,
              percentual_corretor: corretorForm.is_autonomo ? parseFloat(corretorForm.percentual_corretor) : (parseFloat(corretorForm.percentual_corretor) || null),
              empreendimento_id: corretorForm.is_autonomo ? null : (corretorForm.empreendimento_id || null),
              cargo_id: corretorForm.is_autonomo ? null : (corretorForm.cargo_id || null),
              cnpj: corretorForm.cnpj || null,
              imobiliaria: corretorForm.imobiliaria || null,
              creci: corretorForm.creci || null
            })
            .eq('id', selectedItem.id)

          if (dbError) {
            throw new Error(dbError.message)
          }

          setMessage({ type: 'success', text: `Corretor ${corretorForm.nome} atualizado com sucesso!` })
        }
      } else {
        // CRIAÇÃO de novo corretor
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: corretorForm.email,
          password: corretorForm.senha,
          options: {
            data: {
              nome: corretorForm.nome
            }
          }
        })

        if (authError) {
          throw new Error(authError.message)
        }

        if (!authData.user) {
          throw new Error('Erro ao criar usuário')
        }

        const { error: dbError } = await supabase
          .from('usuarios')
          .insert([{
            id: authData.user.id,
            email: corretorForm.email,
            nome: corretorForm.nome,
            tipo: 'corretor',
            tipo_corretor: corretorForm.tipo_corretor,
            telefone: corretorForm.telefone || null,
            percentual_corretor: corretorForm.is_autonomo ? parseFloat(corretorForm.percentual_corretor) : (parseFloat(corretorForm.percentual_corretor) || null),
            empreendimento_id: corretorForm.is_autonomo ? null : (corretorForm.empreendimento_id || null),
            cargo_id: corretorForm.is_autonomo ? null : (corretorForm.cargo_id || null),
            cnpj: corretorForm.cnpj || null,
            imobiliaria: corretorForm.imobiliaria || null,
            creci: corretorForm.creci || null,
            tem_acesso_sistema: true
          }])

        if (dbError) {
          throw new Error(dbError.message)
        }

        setMessage({ type: 'success', text: `Corretor ${corretorForm.nome} criado com sucesso!` })
      }

      setSaving(false)
      setShowModal(false)
      setSelectedItem(null)
      resetCorretorForm()
      fetchData()
      clearMessageAfter(5000)

    } catch (err) {
      setSaving(false)
      setMessage({ type: 'error', text: err.message })
    }
  }

  const handleDeleteVenda = (venda) => {
    const hoje = new Date().toISOString().split('T')[0]
    setVendaParaExcluir(venda)
    setDataDistrato(hoje)
    setModalExcluirVendaStep(1)
    setShowModalExcluirVenda(true)
  }

  const processarExclusaoVenda = async () => {
    if (!vendaParaExcluir) return
    setProcessandoExclusaoVenda(true)
    try {
      const { error } = await supabase
        .from('vendas')
        .update({ excluido: true })
        .eq('id', vendaParaExcluir.id)
      if (error) throw error
      setShowModalExcluirVenda(false)
      setVendaParaExcluir(null)
      fetchData()
      setMessage({ type: 'success', text: 'Venda excluída do sistema com sucesso!' })
      clearMessageAfter(3000)
    } catch (err) {
      setMessage({ type: 'error', text: 'Erro ao excluir venda: ' + err.message })
      clearMessageAfter(5000)
    } finally {
      setProcessandoExclusaoVenda(false)
    }
  }

  const processarDistratoVenda = async () => {
    if (!vendaParaExcluir || !dataDistrato) return
    setProcessandoExclusaoVenda(true)
    try {
      const { error } = await supabase
        .from('vendas')
        .update({ status: 'distrato', data_distrato: dataDistrato })
        .eq('id', vendaParaExcluir.id)
      if (error) throw error
      setShowModalExcluirVenda(false)
      setVendaParaExcluir(null)
      fetchData()
      setMessage({ type: 'success', text: 'Distrato registrado com sucesso!' })
      clearMessageAfter(3000)
    } catch (err) {
      setMessage({ type: 'error', text: 'Erro ao registrar distrato: ' + err.message })
      clearMessageAfter(5000)
    } finally {
      setProcessandoExclusaoVenda(false)
    }
  }

  // Calcula comissão de uma venda em distrato: considera apenas parcelas pagas
  // ou com data de vencimento <= data do distrato
  const calcularComissaoVendaDistrato = (vendaId, dataDistratoVenda) => {
    const grupo = listaVendasComPagamentos.find(g => String(g.venda_id) === String(vendaId))
    if (!grupo?.pagamentos?.length) return { comissaoTotal: 0, comissaoCorretor: 0 }
    const dataLimite = new Date(dataDistratoVenda + 'T23:59:59')
    let comissaoTotal = 0
    let comissaoCorretor = 0
    grupo.pagamentos.forEach(pag => {
      const isPago = pag.status === 'pago'
      const dataPrevista = parseDataLocal(pag.data_prevista)
      const isVencidoAteDistrato = dataPrevista && dataPrevista <= dataLimite
      if (isPago || isVencidoAteDistrato) {
        comissaoTotal += parseFloat(pag.comissao_gerada) || 0
        const cargos = calcularComissaoPorCargoPagamento(pag)
        const cargoCorretor = cargos.find(c => c.nome_cargo === 'Corretor' || c.nome_cargo?.toLowerCase().includes('corretor'))
        comissaoCorretor += cargoCorretor?.valor ?? 0
      }
    })
    return { comissaoTotal, comissaoCorretor }
  }

  const handleDeleteCorretor = async (corretor) => {
    if (confirm(`Tem certeza que deseja excluir o corretor ${corretor.nome}?`)) {
      const { error } = await supabase
        .from('usuarios')
        .delete()
        .eq('id', corretor.id)
      
      if (error) {
        setMessage({ type: 'error', text: 'Erro ao excluir corretor: ' + error.message })
        return
      }
      
      fetchData()
      setMessage({ type: 'success', text: 'Corretor excluído com sucesso!' })
      clearMessageAfter(3000)
    }
  }

  // Função para upload de logo do empreendimento
  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validar tipo de arquivo
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
    if (!allowedTypes.includes(file.type)) {
      setMessage({ type: 'error', text: 'Tipo de arquivo não permitido. Use JPG, PNG, WEBP ou SVG.' })
      return
    }

    // Validar tamanho (máx 5MB para logos)
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'Arquivo muito grande. Máximo 5MB para logos.' })
      return
    }

    setUploadingLogo(true)
    setMessage({ type: '', text: '' })

    try {
      // Gerar nome único para o arquivo
      const fileExt = file.name.split('.').pop()
      const fileName = `logo_${Date.now()}.${fileExt}`
      const filePath = `logos/${fileName}`

      // Upload para o bucket empreendimentos-fotos
      const { error: uploadError } = await supabase.storage
        .from('empreendimentos-fotos')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) throw uploadError

      // Obter URL pública
      const { data: urlData } = supabase.storage
        .from('empreendimentos-fotos')
        .getPublicUrl(filePath)

      setEmpreendimentoForm(prev => ({ ...prev, logo_url: urlData.publicUrl }))
      setMessage({ type: 'success', text: 'Logo enviada com sucesso!' })
      clearMessageAfter(2000)
    } catch (error) {
      console.error('Erro ao fazer upload da logo:', error)
      setMessage({ type: 'error', text: 'Erro ao enviar logo: ' + error.message })
    } finally {
      setUploadingLogo(false)
    }
  }

  // Funções de Empreendimento
  const handleSaveEmpreendimento = async () => {
    if (!empreendimentoForm.nome) {
      setMessage({ type: 'error', text: 'Nome do empreendimento é obrigatório' })
      return
    }

    setSaving(true)
    setMessage({ type: '', text: '' })

    try {
      let empreendimentoId = selectedItem?.id

      if (selectedItem) {
        // Atualizar empreendimento existente
        const { error } = await supabase
          .from('empreendimentos')
          .update({
            nome: empreendimentoForm.nome,
            descricao: empreendimentoForm.descricao,
            total_unidades: empreendimentoForm.total_unidades ? parseInt(empreendimentoForm.total_unidades) : null,
            comissao_total_externo: parseFloat(empreendimentoForm.comissao_total_externo) || 7,
            comissao_total_interno: parseFloat(empreendimentoForm.comissao_total_interno) || 6,
            logo_url: empreendimentoForm.logo_url || null,
            progresso_obra: parseInt(empreendimentoForm.progresso_obra) || 0
          })
          .eq('id', selectedItem.id)

        if (error) throw new Error(error.message)

        // Deletar cargos antigos PRIMEIRO
        const { error: deleteError } = await supabase
          .from('cargos_empreendimento')
          .delete()
          .eq('empreendimento_id', selectedItem.id)
        
        if (deleteError) {
          console.error('Erro ao deletar cargos antigos:', deleteError)
          throw new Error('Erro ao atualizar cargos: ' + deleteError.message)
        }

      } else {
        // Criar novo empreendimento
        const { data, error } = await supabase
          .from('empreendimentos')
          .insert([{
            nome: empreendimentoForm.nome,
            descricao: empreendimentoForm.descricao,
            total_unidades: empreendimentoForm.total_unidades ? parseInt(empreendimentoForm.total_unidades) : null,
            comissao_total_externo: parseFloat(empreendimentoForm.comissao_total_externo) || 7,
            comissao_total_interno: parseFloat(empreendimentoForm.comissao_total_interno) || 6,
            logo_url: empreendimentoForm.logo_url || null,
            progresso_obra: parseInt(empreendimentoForm.progresso_obra) || 0
          }])
          .select()
          .single()

        if (error) throw new Error(error.message)
        empreendimentoId = data.id
      }

      // Inserir cargos EXTERNOS
      const cargosExternoValidos = empreendimentoForm.cargos_externo.filter(c => c.nome_cargo && c.percentual)
      if (cargosExternoValidos.length > 0) {
        const cargosData = cargosExternoValidos.map((cargo, idx) => ({
          empreendimento_id: empreendimentoId,
          tipo_corretor: 'externo',
          nome_cargo: cargo.nome_cargo,
          percentual: parseFloat(cargo.percentual),
          ordem: idx
        }))

        const { error: cargosError } = await supabase
          .from('cargos_empreendimento')
          .insert(cargosData)

        if (cargosError) throw new Error(cargosError.message)
      }

      // Inserir cargos INTERNOS
      const cargosInternoValidos = empreendimentoForm.cargos_interno.filter(c => c.nome_cargo && c.percentual)
      if (cargosInternoValidos.length > 0) {
        const cargosData = cargosInternoValidos.map((cargo, idx) => ({
          empreendimento_id: empreendimentoId,
          tipo_corretor: 'interno',
          nome_cargo: cargo.nome_cargo,
          percentual: parseFloat(cargo.percentual),
          ordem: idx
        }))

        const { error: cargosError } = await supabase
          .from('cargos_empreendimento')
          .insert(cargosData)

        if (cargosError) throw new Error(cargosError.message)
      }

      setSaving(false)
      setShowModal(false)
      setSelectedItem(null)
      fetchData()
      setMessage({ type: 'success', text: `Empreendimento ${selectedItem ? 'atualizado' : 'criado'} com sucesso!` })
      clearMessageAfter(3000)

    } catch (err) {
      setSaving(false)
      setMessage({ type: 'error', text: err.message })
    }
  }

  const handleDeleteEmpreendimento = async (emp) => {
    // Verificar se há corretores vinculados a este empreendimento
    const { data: corretoresVinculados, error: errorCheck } = await supabase
      .from('usuarios')
      .select('id, nome')
      .eq('empreendimento_id', emp.id)
    
    if (errorCheck) {
      setMessage({ type: 'error', text: 'Erro ao verificar vínculos: ' + errorCheck.message })
      return
    }

    if (corretoresVinculados && corretoresVinculados.length > 0) {
      const nomes = corretoresVinculados.slice(0, 5).map(c => c.nome).join(', ')
      const maisTexto = corretoresVinculados.length > 5 ? ` e mais ${corretoresVinculados.length - 5} outros` : ''
      
      setMessage({ 
        type: 'error', 
        text: `Não é possível excluir "${emp.nome}". Existem ${corretoresVinculados.length} corretor(es) vinculado(s): ${nomes}${maisTexto}. Desvincule os corretores primeiro.`
      })
      clearMessageAfter(8000)
      return
    }

    // Verificar se há vendas vinculadas
    const { data: vendasVinculadas, error: errorVendas } = await supabase
      .from('vendas')
      .select('id')
      .eq('empreendimento_id', emp.id)
      .limit(1)
    
    if (vendasVinculadas && vendasVinculadas.length > 0) {
      setMessage({ 
        type: 'error', 
        text: `Não é possível excluir "${emp.nome}". Existem vendas registradas neste empreendimento.`
      })
      clearMessageAfter(5000)
      return
    }

    if (confirm(`Tem certeza que deseja excluir o empreendimento "${emp.nome}"?\n\nEsta ação não pode ser desfeita.`)) {
      const { error } = await supabase
        .from('empreendimentos')
        .delete()
        .eq('id', emp.id)
      
      if (error) {
        // Mensagem mais amigável para erros de FK
        if (error.message.includes('foreign key') || error.message.includes('violates')) {
          setMessage({ type: 'error', text: `Não é possível excluir "${emp.nome}". Existem registros vinculados a este empreendimento.` })
        } else {
          setMessage({ type: 'error', text: 'Erro ao excluir: ' + error.message })
        }
        return
      }
      
      fetchData()
      setMessage({ type: 'success', text: 'Empreendimento excluído com sucesso!' })
      clearMessageAfter(3000)
    }
  }

  // Abrir modal de confirmação de pagamento
  const confirmarPagamento = (pagamento) => {
    setPagamentoParaConfirmar(pagamento)
    const hoje = new Date().toISOString().split('T')[0]
    const dataPrevista = pagamento.data_prevista ? new Date(pagamento.data_prevista).toISOString().split('T')[0] : hoje
    setFormConfirmarPagamento({
      valorPersonalizado: '',
      dataPagamento: dataPrevista
    })
    setShowModalConfirmarPagamento(true)
  }

  // Abrir modal para editar baixa (parcela já paga)
  const editarBaixa = (pagamento) => {
    setPagamentoParaConfirmar(pagamento)
    const dataPag = pagamento.data_pagamento ? new Date(pagamento.data_pagamento).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
    setFormConfirmarPagamento({
      valorPersonalizado: pagamento.comissao_gerada != null ? String(pagamento.comissao_gerada) : '',
      dataPagamento: dataPag
    })
    setShowModalConfirmarPagamento(true)
  }

  // Abrir modal para excluir (reverter) baixa
  const excluirBaixa = (pagamento) => {
    setPagamentoParaExcluir(pagamento)
    setShowModalExcluirBaixa(true)
  }

  // Reverter baixa: status pendente, data_pagamento null
  const processarExcluirBaixa = async () => {
    if (!pagamentoParaExcluir || excluindoBaixa) return
    setExcluindoBaixa(true)
    try {
      const { error } = await supabase
        .from('pagamentos_prosoluto')
        .update({ status: 'pendente', data_pagamento: null })
        .eq('id', pagamentoParaExcluir.id)
      if (error) {
        setMessage({ type: 'error', text: 'Erro ao reverter baixa: ' + error.message })
        setExcluindoBaixa(false)
        return
      }
      setShowModalExcluirBaixa(false)
      setPagamentoParaExcluir(null)
      setExcluindoBaixa(false)
      fetchData()
      setMessage({ type: 'success', text: 'Baixa revertida. Parcela voltou a Pendente.' })
      clearMessageAfter(3000)
    } catch (err) {
      console.error('Erro ao reverter baixa:', err)
      setMessage({ type: 'error', text: 'Erro ao reverter baixa' })
      setExcluindoBaixa(false)
    }
  }

  // Confirmar pagamento pro-soluto com valores personalizados
  const processarConfirmarPagamento = async () => {
    if (!pagamentoParaConfirmar || confirmandoPagamento) return

    setConfirmandoPagamento(true)

    try {
      // Data em que o pagamento foi efetivamente feito (pode ser antes ou depois do previsto)
      const dataPagamento = formConfirmarPagamento.dataPagamento?.trim() || new Date().toISOString().split('T')[0]
      const comissaoAtual = parseFloat(pagamentoParaConfirmar.comissao_gerada) || 0
      const valorComissao = formConfirmarPagamento.valorPersonalizado
        ? parseFloat(formConfirmarPagamento.valorPersonalizado) || 0
        : comissaoAtual

      // Trigger 017 imutabiliza comissao_gerada quando status='pago'.
      // Aplicar qualquer alteração de comissao_gerada no mesmo UPDATE que transita pra pago.
      const updateData = {
        status: 'pago',
        data_pagamento: dataPagamento,
      }
      if (formConfirmarPagamento.valorPersonalizado && Math.abs(valorComissao - comissaoAtual) > 0.01) {
        updateData.comissao_gerada = valorComissao
      }

      const { error } = await supabase
        .from('pagamentos_prosoluto')
        .update(updateData)
        .eq('id', pagamentoParaConfirmar.id)

      if (error) {
        setMessage({ type: 'error', text: 'Erro ao confirmar: ' + error.message })
        setConfirmandoPagamento(false)
        return
      }

      setShowModalConfirmarPagamento(false)
      setPagamentoParaConfirmar(null)
      setConfirmandoPagamento(false)
      fetchData()
      setMessage({ type: 'success', text: pagamentoParaConfirmar.status === 'pago' ? 'Baixa atualizada!' : 'Pagamento confirmado!' })
      clearMessageAfter(3000)
    } catch (error) {
      console.error('Erro ao processar confirmação:', error)
      setMessage({ type: 'error', text: 'Erro ao confirmar pagamento' })
      setConfirmandoPagamento(false)
    }
  }

  // Identificar vendas sem pagamentos (APENAS as que têm valor_pro_soluto > 0)
  const vendasSemPagamentos = vendas.filter(v => {
    // Só considerar vendas que têm valor pro-soluto > 0
    const valorProSoluto = parseFloat(v.valor_pro_soluto) || 0
    if (valorProSoluto <= 0) return false // Ignorar vendas sem pro-soluto
    
    // Verificar se tem pagamentos (comparação segura de IDs)
    const temPagamento = pagamentos.some(p => String(p.venda_id) === String(v.id))
    return !temPagamento
  })

  // DEBUG: Adicionar log detalhado para investigar
  /*console.log('🔍 DEBUG vendasSemPagamentos:', {
    totalVendas: vendas.length,
    vendasComProSoluto: vendas.filter(v => {
      const valorProSoluto = parseFloat(v.valor_pro_soluto) || 0
      return valorProSoluto > 0
    }).length,
    totalPagamentos: pagamentos.length,
    vendasSemPagamentos: vendasSemPagamentos.length,
    // Verificar tipos de IDs
    tipoIdVenda: vendas.length > 0 ? typeof vendas[0].id : 'N/A',
    tipoIdPagamento: pagamentos.length > 0 ? typeof pagamentos[0].venda_id : 'N/A',
    // Verificar se há IDs diferentes
    primeirasVendasIds: vendas.slice(0, 5).map(v => ({ 
      id: v.id, 
      tipo: typeof v.id, 
      valorProSoluto: v.valor_pro_soluto,
      temPagamento: pagamentos.some(p => String(p.venda_id) === String(v.id))
    })),
    primeirosPagamentosVendaIds: pagamentos.slice(0, 5).map(p => ({ 
      venda_id: p.venda_id, 
      tipo: typeof p.venda_id 
    }))
  })
*/
  // Gerar pagamentos para uma venda específica
  const gerarPagamentosVenda = async (venda) => {
    setSaving(true)
    
    // Calcular fator de comissão
    const valorVenda = parseFloat(venda.valor_venda) || 0
    
    // Verificar se o corretor é autônomo
    const corretor = corretores.find(c => c.id === venda.corretor_id)
    const isCorretorAutonomo = corretor && !corretor.empreendimento_id && corretor.percentual_corretor
    
    let comissoesDinamicas
    if (isCorretorAutonomo) {
      // Corretor autônomo: usa apenas o percentual do corretor
      const percentualCorretor = parseFloat(corretor.percentual_corretor) || 0
      const comissaoCorretor = (valorVenda * percentualCorretor) / 100
      comissoesDinamicas = {
        cargos: [{
          cargo_id: null,
          nome_cargo: 'Corretor Autônomo',
          percentual: percentualCorretor,
          valor: comissaoCorretor
        }],
        total: comissaoCorretor,
        percentualTotal: percentualCorretor
      }
    } else {
      // Corretor vinculado: usa cargos do empreendimento
      comissoesDinamicas = calcularComissoesDinamicas(
        valorVenda,
        venda.empreendimento_id,
        venda.tipo_corretor
      )
    }
    
    const valorSinal = venda.teve_sinal ? (parseFloat(venda.valor_sinal) || 0) : 0
    
    let valorEntradaTotal = 0
    if (venda.teve_entrada) {
      if (venda.parcelou_entrada) {
        valorEntradaTotal = (parseFloat(venda.qtd_parcelas_entrada) || 0) * (parseFloat(venda.valor_parcela_entrada) || 0)
      } else {
        valorEntradaTotal = parseFloat(venda.valor_entrada) || 0
      }
    }
    
    const valorTotalBalao = venda.teve_balao === 'sim' 
      ? (parseFloat(venda.qtd_balao) || 0) * (parseFloat(venda.valor_balao) || 0)
      : 0
    
    const valorProSoluto = valorSinal + valorEntradaTotal + valorTotalBalao
    // Fator de comissão conforme fator-comissao.mdc
    const percentualTotal = comissoesDinamicas.percentualTotal
    const fatorTotal = calcularFatorComissao(valorVenda, valorProSoluto, percentualTotal)
    // Snapshot histórico (R9) — sempre gravar junto com o pagamento
    const snapshotComissao = {
      fator_comissao_aplicado: fatorTotal,
      percentual_comissao_total: percentualTotal
    }
    
    // Calcular e atualizar comissão do corretor na venda se não estiver preenchida
    const comissaoCorretor = calcularComissaoCorretor(comissoesDinamicas, venda.corretor_id, valorVenda)
    if (!venda.comissao_corretor || venda.comissao_corretor === 0) {
      await supabase
        .from('vendas')
        .update({
          comissao_corretor: comissaoCorretor,
          comissao_total: comissoesDinamicas.total,
          fator_comissao: fatorTotal
        })
        .eq('id', venda.id)
    }
    
    const novosPagamentos = []
    
    // ===== REGRA ESPECIAL: ENTRADA >= 20% NO ATO (ver .cursor/rules/comissao-integral-20.mdc) =====
    const valorEntradaParaCalculo = valorSinal + valorEntradaTotal
    const percentualEntrada = valorVenda > 0 ? (valorEntradaParaCalculo / valorVenda) * 100 : 0
    const entradaNoAto = !venda.parcelou_entrada
    const aplicarComissaoIntegral = percentualEntrada >= 20 && entradaNoAto
    
    if (aplicarComissaoIntegral) {
      // Entrada >= 20% e paga no ato (não parcelada): 1 parcela com comissão total
      const comissaoTotal = comissoesDinamicas.total || (valorProSoluto * fatorTotal)
      const fatorIntegral = valorEntradaParaCalculo > 0 ? comissaoTotal / valorEntradaParaCalculo : 0
      
      novosPagamentos.push({
        venda_id: venda.id,
        tipo: 'comissao_integral',
        valor: valorEntradaParaCalculo, // Valor da entrada
        data_prevista: venda.data_venda,
        comissao_gerada: comissaoTotal, // Comissão TOTAL do corretor
        ...snapshotComissao,
      })
      
      console.log(`✅ Entrada >= 20% no ato (${percentualEntrada.toFixed(1)}%). Comissão integral: R$ ${comissaoTotal.toFixed(2)}`)
    } else {
      // Entrada < 20% ou entrada parcelada: gerar parcelas normalmente
      
      // Sinal
      if (valorSinal > 0) {
        novosPagamentos.push({
          venda_id: venda.id,
          tipo: 'sinal',
          valor: valorSinal,
          data_prevista: venda.data_venda,
          comissao_gerada: calcularComissaoPagamento(valorSinal, fatorTotal),
          ...snapshotComissao,
        })
      }

      // Entrada à vista
      if (venda.teve_entrada && !venda.parcelou_entrada) {
        const valorEntradaAvista = parseFloat(venda.valor_entrada) || 0
        if (valorEntradaAvista > 0) {
          novosPagamentos.push({
            venda_id: venda.id,
            tipo: 'entrada',
            valor: valorEntradaAvista,
            data_prevista: venda.data_venda,
            comissao_gerada: calcularComissaoPagamento(valorEntradaAvista, fatorTotal),
            ...snapshotComissao,
          })
        }
      }

      // Parcelas da entrada
      if (venda.teve_entrada && venda.parcelou_entrada) {
        const qtdParcelas = parseInt(venda.qtd_parcelas_entrada) || 0
        const valorParcelaEnt = parseFloat(venda.valor_parcela_entrada) || 0

        for (let i = 1; i <= qtdParcelas; i++) {
          const dataParcela = parseDataLocal(venda.data_venda)
          dataParcela.setMonth(dataParcela.getMonth() + i)

          novosPagamentos.push({
            venda_id: venda.id,
            tipo: 'parcela_entrada',
            numero_parcela: i,
            valor: valorParcelaEnt,
            data_prevista: dataParcela.toISOString().split('T')[0],
            comissao_gerada: calcularComissaoPagamento(valorParcelaEnt, fatorTotal),
            ...snapshotComissao,
          })
        }
      }

      // Balões
      if (venda.teve_balao === 'sim') {
        const qtdBalao = parseInt(venda.qtd_balao) || 0
        const valorBalaoUnit = parseFloat(venda.valor_balao) || 0
        for (let i = 1; i <= qtdBalao; i++) {
          novosPagamentos.push({
            venda_id: venda.id,
            tipo: 'balao',
            numero_parcela: i,
            valor: valorBalaoUnit,
            comissao_gerada: calcularComissaoPagamento(valorBalaoUnit, fatorTotal),
            ...snapshotComissao,
          })
        }
      }
    }

    if (novosPagamentos.length > 0) {
      const { error } = await supabase.from('pagamentos_prosoluto').insert(novosPagamentos)
      if (error) {
        setMessage({ type: 'error', text: 'Erro ao gerar pagamentos: ' + error.message })
      } else {
        const msgExtra = aplicarComissaoIntegral ? ' (Comissão integral - entrada ≥ 20% no ato)' : ''
        setMessage({ type: 'success', text: `${novosPagamentos.length} pagamentos gerados!${msgExtra}` })
        fetchData()
      }
    } else {
      setMessage({ type: 'warning', text: 'Esta venda não tem parcelas pro-soluto configuradas (sinal, entrada ou balão)' })
    }
    
    setSaving(false)
    clearMessageAfter(3000)
  }

  // Gerar pagamentos para todas as vendas sem pagamentos
  const gerarTodosPagamentos = async () => {
    if (vendasSemPagamentos.length === 0) return
    
    setSaving(true)
    let totalGerados = 0
    
    for (const venda of vendasSemPagamentos) {
      await gerarPagamentosVenda(venda)
      totalGerados++
    }
    
    setSaving(false)
    fetchData()
    setMessage({ type: 'success', text: `Pagamentos gerados para ${totalGerados} vendas!` })
    clearMessageAfter(3000)
  }

  const addCargo = (tipo) => {
    const key = tipo === 'externo' ? 'cargos_externo' : 'cargos_interno'
    setEmpreendimentoForm({
      ...empreendimentoForm,
      [key]: [...empreendimentoForm[key], { nome_cargo: '', percentual: '' }]
    })
  }

  const removeCargo = (tipo, index) => {
    const key = tipo === 'externo' ? 'cargos_externo' : 'cargos_interno'
    const newCargos = empreendimentoForm[key].filter((_, i) => i !== index)
    setEmpreendimentoForm({
      ...empreendimentoForm,
      [key]: newCargos.length > 0 ? newCargos : [{ nome_cargo: '', percentual: '' }]
    })
  }

  const updateCargo = (tipo, index, field, value) => {
    const key = tipo === 'externo' ? 'cargos_externo' : 'cargos_interno'
    const newCargos = [...empreendimentoForm[key]]
    newCargos[index][field] = value
    setEmpreendimentoForm({ ...empreendimentoForm, [key]: newCargos })
  }

  // Quando seleciona empreendimento no formulário de corretor
  const handleEmpreendimentoChange = (empId) => {
    if (empId === 'autonomo') {
      // Corretor autônomo
      setCargosDisponiveis([])
      setCorretorForm({ 
        ...corretorForm, 
        empreendimento_id: '',
        cargo_id: '',
        is_autonomo: true,
        percentual_corretor: ''
      })
    } else {
      // Corretor vinculado a empreendimento
      const emp = empreendimentos.find(e => e.id === empId)
      // Filtra cargos pelo tipo de corretor selecionado
      const cargosFiltrados = emp?.cargos?.filter(c => c.tipo_corretor === corretorForm.tipo_corretor) || []
      setCargosDisponiveis(cargosFiltrados)
      setCorretorForm({ 
        ...corretorForm, 
        empreendimento_id: empId, 
        cargo_id: '',
        is_autonomo: false,
        percentual_corretor: ''
      })
    }
  }

  // Quando muda o tipo de corretor, atualiza os cargos disponíveis
  const handleTipoCorretorChangeEmp = (tipo) => {
    const emp = empreendimentos.find(e => e.id === corretorForm.empreendimento_id)
    const cargosFiltrados = emp?.cargos?.filter(c => c.tipo_corretor === tipo) || []
    setCargosDisponiveis(cargosFiltrados)
    setCorretorForm({ 
      ...corretorForm, 
      tipo_corretor: tipo,
      cargo_id: '',
      percentual_corretor: ''
    })
  }

  // Quando seleciona cargo, atualiza o percentual
  const handleCargoChange = (cargoId) => {
    const cargo = cargosDisponiveis.find(c => c.id === cargoId)
    setCorretorForm({ 
      ...corretorForm, 
      cargo_id: cargoId,
      percentual_corretor: cargo?.percentual?.toString() || ''
    })
  }

  const openEditCorretor = (corretor) => {
    setSelectedItem(corretor)
    
    // Detectar se é autônomo (não tem empreendimento mas tem percentual)
    const isAutonomo = !corretor.empreendimento_id && corretor.percentual_corretor
    
    // Detectar se já tem acesso ao sistema
    // Corretores sincronizados do Sienge têm email @sync.local ou @placeholder.local
    // e não têm conta no Auth (id gerado pelo banco, não pelo Auth)
    const emailFake = corretor.email?.includes('@sync.local') || corretor.email?.includes('@placeholder.local')
    const temAcessoSistema = corretor.tem_acesso_sistema === true || (!emailFake && corretor.origem !== 'sienge')
    
    // Carregar cargos do empreendimento filtrados pelo tipo (externo/interno)
    const tipoCorretor = corretor.tipo_corretor || 'externo'
    if (corretor.empreendimento_id) {
      const emp = empreendimentos.find(e => e.id === corretor.empreendimento_id)
      const cargosFiltrados = emp?.cargos?.filter(c => c.tipo_corretor === tipoCorretor) || []
      setCargosDisponiveis(cargosFiltrados)
    } else {
      setCargosDisponiveis([])
    }

    setCorretorForm({
      nome: corretor.nome,
      email: corretor.email,
      senha: '',
      tipo_corretor: corretor.tipo_corretor || 'externo',
      telefone: corretor.telefone || '',
      percentual_corretor: corretor.percentual_corretor?.toString() || '',
      empreendimento_id: corretor.empreendimento_id || '',
      cargo_id: corretor.cargo_id || '',
      is_autonomo: isAutonomo,
      cnpj: corretor.cnpj || '',
      imobiliaria: corretor.imobiliaria || '',
      creci: corretor.creci || '',
      tem_acesso_sistema: temAcessoSistema,
      ativar_acesso: false
    })
    setModalType('corretor')
    setShowModal(true)
  }

  const resetVendaForm = () => {
    setVendaForm({
      corretor_id: '',
      empreendimento_id: '',
      cliente_id: '',
      unidade: '',
      bloco: '',
      andar: '',
      valor_venda: '',
      tipo_corretor: 'externo',
      data_venda: new Date().toISOString().split('T')[0],
      data_entrada: '',
      data_sinal: '',
      datas_parcelas_override: {},
      datas_balao_override: {},
      descricao: '',
      status: 'pendente',
      teve_sinal: false,
      valor_sinal: '',
      teve_entrada: false,
      valor_entrada: '',
      parcelou_entrada: false,
      periodicidade_parcelas: 1,
      grupos_parcelas_entrada: [{ qtd: '', valor: '' }],
      dia_pagamento_parcelas: 1,
      dia_pagamento_parcelas_outro: '',
      teve_balao: 'nao',
      periodicidade_balao: 6,
      grupos_balao: [{ qtd: '', valor: '' }],
      dia_pagamento_balao: 1,
      dia_pagamento_balao_outro: '',
      teve_permuta: false,
      tipo_permuta: '',
      valor_permuta: '',
      valor_pro_soluto: '',
      contrato_url: '',
      contrato_nome: ''
    })
    setContratoFile(null)
  }

  const resetCorretorForm = () => {
    setCorretorForm({
      nome: '',
      email: '',
      senha: '',
      tipo_corretor: 'externo',
      telefone: '',
      percentual_corretor: '',
      empreendimento_id: '',
      cargo_id: '',
      is_autonomo: false,
      cnpj: '',
      imobiliaria: '',
      creci: '',
      tem_acesso_sistema: false,
      ativar_acesso: false
    })
    setCargosDisponiveis([])
  }

  const resetClienteForm = () => {
    setClienteForm({
      nome_completo: '',
      data_nascimento: '',
      cpf: '',
      rg: '',
      endereco: '',
      telefone: '',
      email: '',
      profissao: '',
      empresa_trabalho: '',
      renda_mensal: '',
      rg_frente_url: '',
      rg_verso_url: '',
      cpf_url: '',
      comprovante_residencia_url: '',
      comprovante_renda_url: '',
      certidao_casamento_url: '',
      possui_3_anos_fgts: false,
      beneficiado_subsidio_fgts: false,
      tem_complemento_renda: false,
      complementadores: []
    })
  }

  // Upload de documento do cliente
  const uploadDocumentoCliente = async (file, tipo) => {
    setUploadingDoc(true)
    try {
      // Verificar sessão
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      
      if (sessionError || !session) {
        throw new Error('Sessão não encontrada. Por favor, faça login novamente.')
      }

      const fileExt = file.name.split('.').pop()
      const fileName = `${tipo}_${Date.now()}.${fileExt}`
      const filePath = `clientes/${fileName}`

      if (import.meta.env.DEV) {
        console.log('=== DEBUG UPLOAD (ADMIN) ===')
        console.log('User ID:', session?.user?.id)
        console.log('File Path:', filePath)
        console.log('File Name:', fileName)
        console.log('File Size:', file.size)
        console.log('File Type:', file.type)
      }

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('documentos')
        .upload(filePath, file)

      if (uploadError) {
        if (import.meta.env.DEV) {
          console.error('=== ERRO NO UPLOAD (ADMIN) ===')
          console.error('Upload Error:', uploadError)
          console.error('Error Message:', uploadError.message)
          console.error('Error Status:', uploadError.statusCode)
        }
        throw uploadError
      }

      const { data: { publicUrl } } = supabase.storage
        .from('documentos')
        .getPublicUrl(uploadData?.path || filePath)

      setClienteForm(prev => ({ ...prev, [`${tipo}_url`]: publicUrl }))
      return publicUrl
    } catch (error) {
      console.error('Erro no upload:', error)
      setMessage({ type: 'error', text: 'Erro ao fazer upload do documento' })
      return null
    } finally {
      setUploadingDoc(false)
    }
  }

  // Salvar cliente
  const handleSaveCliente = async () => {
    if (!clienteForm.nome_completo) {
      setMessage({ type: 'error', text: 'Nome completo é obrigatório' })
      return
    }
    
    // Validar se está criando acesso
    if (clienteForm.criar_acesso && !selectedItem?.user_id) {
      if (!clienteForm.email) {
        setMessage({ type: 'error', text: 'E-mail é obrigatório para criar acesso' })
        return
      }
      if (!clienteForm.senha || clienteForm.senha.length < 6) {
        setMessage({ type: 'error', text: 'Senha deve ter no mínimo 6 caracteres' })
        return
      }
    }

    setSaving(true)
    try {
      // Primeiro salvar o cliente SEM user_id
      const clienteData = {
        nome_completo: clienteForm.nome_completo,
        data_nascimento: clienteForm.data_nascimento || null,
        cpf: clienteForm.cpf,
        rg: clienteForm.rg,
        endereco: clienteForm.endereco,
        telefone: clienteForm.telefone,
        email: clienteForm.email,
        profissao: clienteForm.profissao,
        empresa_trabalho: clienteForm.empresa_trabalho,
        renda_mensal: clienteForm.renda_mensal ? parseFloat(clienteForm.renda_mensal.replace(/[^\d,]/g, '').replace(',', '.')) : null,
        rg_frente_url: clienteForm.rg_frente_url,
        rg_verso_url: clienteForm.rg_verso_url,
        cpf_url: clienteForm.cpf_url,
        comprovante_residencia_url: clienteForm.comprovante_residencia_url,
        comprovante_renda_url: clienteForm.comprovante_renda_url,
        certidao_casamento_url: clienteForm.certidao_casamento_url,
        possui_3_anos_fgts: clienteForm.possui_3_anos_fgts,
        beneficiado_subsidio_fgts: clienteForm.beneficiado_subsidio_fgts,
        tem_complemento_renda: clienteForm.tem_complemento_renda
      }

      let clienteId = selectedItem?.id

      if (selectedItem) {
        // Atualizar cliente existente
        const { error } = await supabase
          .from('clientes')
          .update(clienteData)
          .eq('id', clienteId)
        if (error) throw error

        // Deletar complementadores antigos
        await supabase
          .from('complementadores_renda')
          .delete()
          .eq('cliente_id', clienteId)
      } else {
        // Criar novo cliente
        const { data, error } = await supabase
          .from('clientes')
          .insert([clienteData])
          .select()
          .single()
        if (error) throw error
        clienteId = data.id
      }

      // Inserir complementadores
      if (clienteForm.tem_complemento_renda && clienteForm.complementadores.length > 0) {
        const complementadores = clienteForm.complementadores.map(c => ({
          cliente_id: clienteId,
          nome: c.nome,
          cpf: c.cpf,
          rg: c.rg,
          data_nascimento: c.data_nascimento || null,
          profissao: c.profissao,
          empresa_trabalho: c.empresa_trabalho,
          valor_complemento: c.valor_complemento ? parseFloat(c.valor_complemento.replace(/[^\d,]/g, '').replace(',', '.')) : null,
          telefone: c.telefone,
          email: c.email,
          tipo_relacionamento: c.tipo_relacionamento || null
        }))

        const { error: compError } = await supabase
          .from('complementadores_renda')
          .insert(complementadores)
        if (compError) throw compError
      }

      // Criar acesso ao sistema (após salvar cliente)
      let acessoCriado = false
      if (clienteForm.criar_acesso && !selectedItem?.user_id) {
        try {
          // Criar usuário na autenticação
          // Nota: Para sistemas internos, é recomendado desabilitar a confirmação de email
          // no painel do Supabase (Authentication > Settings > Email Auth > Confirm email)
          const { data: authData, error: authError } = await supabase.auth.signUp({
            email: clienteForm.email,
            password: clienteForm.senha,
            options: {
              data: {
                nome: clienteForm.nome_completo,
                role: 'cliente'
              },
              emailRedirectTo: undefined // Não redirecionar para confirmação
            }
          })
          
          if (authError) {
            // Se o erro for sobre email já existente, tentar fazer login
            if (authError.message && authError.message.includes('already registered')) {
              // Tentar fazer login para obter o user_id
              const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
                email: clienteForm.email,
                password: clienteForm.senha
              })
              
              if (!loginError && loginData?.user?.id) {
                // Usar o user_id do login
                const userId = loginData.user.id
                
                // Atualizar cliente com user_id
                await supabase
                  .from('clientes')
                  .update({ user_id: userId })
                  .eq('id', clienteId)
                
                // Criar/atualizar registro na tabela usuarios
                await supabase
                  .from('usuarios')
                  .upsert({
                    id: userId,
                    nome: clienteForm.nome_completo,
                    email: clienteForm.email,
                    tipo: 'cliente',
                    ativo: true
                  }, { onConflict: 'id' })
                
                acessoCriado = true
              } else {
                throw new Error('Email já cadastrado, mas não foi possível fazer login. Verifique a senha ou peça ao administrador para redefinir.')
              }
            } else {
              throw authError
            }
          }
          
          const userId = authData.user?.id
          
          if (userId) {
            // Atualizar cliente com user_id
            await supabase
              .from('clientes')
              .update({ user_id: userId })
              .eq('id', clienteId)
            
            // Criar registro na tabela usuarios
            await supabase
              .from('usuarios')
              .insert([{
                id: userId,
                nome: clienteForm.nome_completo,
                email: clienteForm.email,
                tipo: 'cliente',
                ativo: true
              }])
            
            acessoCriado = true
          }
        } catch (acessoError) {
          console.error('Erro ao criar acesso:', acessoError)
          // Não impede o salvamento do cliente, apenas mostra aviso
        }
      }

      let successMsg = selectedItem ? 'Cliente atualizado!' : 'Cliente cadastrado!'
      if (acessoCriado) {
        successMsg += ' Acesso criado com sucesso!'
      } else if (clienteForm.criar_acesso && !selectedItem?.user_id) {
        successMsg += ' (Erro ao criar acesso - verifique se o e-mail já existe)'
      }
      
      setMessage({ type: 'success', text: successMsg })
      setShowModal(false)
      resetClienteForm()
      fetchData()
    } catch (error) {
      console.error('Erro ao salvar cliente:', error)
      setMessage({ type: 'error', text: 'Erro ao salvar cliente: ' + error.message })
    } finally {
      setSaving(false)
    }
  }

  // Adicionar complementador
  const addComplementador = () => {
    setClienteForm(prev => ({
      ...prev,
      complementadores: [...prev.complementadores, { ...complementadorVazio }]
    }))
  }

  // Remover complementador
  const removeComplementador = (index) => {
    setClienteForm(prev => ({
      ...prev,
      complementadores: prev.complementadores.filter((_, i) => i !== index)
    }))
  }

  // Atualizar complementador
  const updateComplementador = (index, field, value) => {
    setClienteForm(prev => ({
      ...prev,
      complementadores: prev.complementadores.map((c, i) => 
        i === index ? { ...c, [field]: value } : c
      )
    }))
  }

  // Deletar cliente (soft delete) — lógica em adminClientes.js (testada)
  // Atualiza só o estado local para o card sumir na hora; evita fetchData() pesado e [Violation] click handler
  const handleDeleteCliente = async (clienteId) => {
    if (!window.confirm('Tem certeza que deseja excluir este cliente?')) return
    try {
      await deleteCliente(supabase, clienteId)
      setMessage({ type: 'success', text: 'Cliente excluído!' })
      setClientes((prev) =>
        prev.map((c) => (c.id === clienteId ? { ...c, ativo: false } : c))
      )
    } catch (error) {
      setMessage({ type: 'error', text: 'Erro ao excluir: ' + error.message })
    }
  }

  const openEditModal = async (venda) => {
    console.log('📝 Abrindo edição de venda:', venda.id)
    setSelectedItem(venda)
    setParcelasSelecionadas([]) // Reset de parcelas selecionadas
    setRenegociacaoForm({
      motivo: '',
      distribuicoesNovas: [],
      totalSelecionado: 0,
      quantidadeParcelas: 0
    }) // Reset de form de renegociação

    try {
      // Buscar pagamentos da venda para detectar grupos
      const { data: pagamentosVenda, error } = await supabase
        .from('pagamentos_prosoluto')
        .select('*')
        .eq('venda_id', venda.id)
        .order('numero_parcela', { ascending: true })

      console.log('💰 Pagamentos buscados:', pagamentosVenda?.length || 0, 'erro:', error?.message)

      if (error) {
        console.error('❌ Erro ao buscar pagamentos:', error)
        setPagamentosVendaEditando([])
      } else {
        const pags = pagamentosVenda || []
        console.log('✅ SetPagamentosVendaEditando com', pags.length, 'pagamentos')
        setPagamentosVendaEditando(pags)
      }

      // Continuar com o resto do carregamento mesmo se houver erro nos pagamentos
      const actualPagamentos = pagamentosVenda || []

      // Agrupar parcelas de entrada por valor
      let gruposParcelasEntrada = [{ qtd: '', valor: '' }]
      if (venda.parcelou_entrada && actualPagamentos) {
        const parcelasEntrada = actualPagamentos
          .filter(p => p.tipo === 'parcela_entrada')
          .sort((a, b) => (a.numero_parcela || 0) - (b.numero_parcela || 0))

        if (parcelasEntrada.length > 0) {
          const grupos = {}
          parcelasEntrada.forEach(p => {
            const valor = parseFloat(p.valor) || 0
            const key = valor.toFixed(2)
            if (!grupos[key]) {
              grupos[key] = { valor: valor.toString(), qtd: 0 }
            }
            grupos[key].qtd++
          })

          gruposParcelasEntrada = Object.values(grupos).map(g => ({
            qtd: g.qtd.toString(),
            valor: g.valor
          }))
        }
      } else if (venda.parcelou_entrada) {
        gruposParcelasEntrada = [{
          qtd: venda.qtd_parcelas_entrada?.toString() || '',
          valor: venda.valor_parcela_entrada?.toString() || ''
        }]
      }

      // Agrupar balões por valor
      let gruposBalao = [{ qtd: '', valor: '' }]
      if (venda.teve_balao === 'sim' && actualPagamentos) {
        const baloes = actualPagamentos
          .filter(p => p.tipo === 'balao')
          .sort((a, b) => (a.numero_parcela || 0) - (b.numero_parcela || 0))

        if (baloes.length > 0) {
          const grupos = {}
          baloes.forEach(p => {
            const valor = parseFloat(p.valor) || 0
            const key = valor.toFixed(2)
            if (!grupos[key]) {
              grupos[key] = { valor: valor.toString(), qtd: 0 }
            }
            grupos[key].qtd++
          })

          gruposBalao = Object.values(grupos).map(g => ({
            qtd: g.qtd.toString(),
            valor: g.valor
          }))
        }
      } else if (venda.teve_balao === 'sim') {
        gruposBalao = [{
          qtd: venda.qtd_balao?.toString() || '',
          valor: venda.valor_balao?.toString() || ''
        }]
      }

      // Extrair datas dos pagamentos
      let dataSinalCarregada = ''
      const datasParcelasOverride = {}
      const datasBalaoOverride = {}
      if (actualPagamentos) {
        const pagSinal = actualPagamentos.find(p => p.tipo === 'sinal')
        if (pagSinal?.data_prevista) dataSinalCarregada = pagSinal.data_prevista

        const parcelasOrdenadas = actualPagamentos
          .filter(p => p.tipo === 'parcela_entrada')
          .sort((a, b) => (a.numero_parcela || 0) - (b.numero_parcela || 0))
        parcelasOrdenadas.forEach((p, i) => {
          if (p.data_prevista) datasParcelasOverride[i] = p.data_prevista
        })

        const baloesOrdenados = actualPagamentos
          .filter(p => p.tipo === 'balao')
          .sort((a, b) => (a.numero_parcela || 0) - (b.numero_parcela || 0))
        baloesOrdenados.forEach((p, i) => {
          if (p.data_prevista) datasBalaoOverride[i] = p.data_prevista
        })
      }

      setVendaForm({
        corretor_id: venda.corretor_id,
        empreendimento_id: venda.empreendimento_id || '',
        cliente_id: venda.cliente_id || '',
        unidade: venda.unidade || '',
        bloco: venda.bloco || '',
        andar: venda.andar || '',
        valor_venda: venda.valor_venda?.toString() || '',
        tipo_corretor: venda.tipo_corretor || 'externo',
        data_venda: venda.data_venda || new Date().toISOString().split('T')[0],
        data_entrada: venda.data_entrada || venda.data_venda || '',
        data_sinal: dataSinalCarregada,
        datas_parcelas_override: datasParcelasOverride,
        datas_balao_override: datasBalaoOverride,
        descricao: venda.descricao || '',
        status: venda.status || 'pendente',
        teve_sinal: venda.teve_sinal || false,
        valor_sinal: venda.valor_sinal?.toString() || '',
        teve_entrada: venda.teve_entrada || false,
        valor_entrada: venda.valor_entrada?.toString() || '',
        parcelou_entrada: venda.parcelou_entrada || false,
        periodicidade_parcelas: venda.periodicidade_parcelas || 1,
        grupos_parcelas_entrada: gruposParcelasEntrada,
        dia_pagamento_parcelas: venda.dia_pagamento_parcelas || 1,
        dia_pagamento_parcelas_outro: venda.dia_pagamento_parcelas_outro || '',
        teve_balao: venda.teve_balao || 'nao',
        periodicidade_balao: venda.periodicidade_balao || 6,
        grupos_balao: gruposBalao,
        dia_pagamento_balao: venda.dia_pagamento_balao || 1,
        dia_pagamento_balao_outro: venda.dia_pagamento_balao_outro || '',
        teve_permuta: venda.teve_permuta || false,
        tipo_permuta: venda.tipo_permuta || '',
        valor_permuta: venda.valor_permuta?.toString() || '',
        valor_pro_soluto: venda.valor_pro_soluto?.toString() || '',
        contrato_url: venda.contrato_url || '',
        contrato_nome: venda.contrato_nome || ''
      })
      setContratoFile(null)
      setModalType('venda')
      console.log('🔓 Modal aberto. selectedItem:', !!venda, 'pagamentosVendaEditando será populado...')
      setShowModal(true)
    } catch (err) {
      console.error('❌ Erro ao abrir modal de edição:', err)
      setMessage({ type: 'error', text: 'Erro ao carregar dados da venda.' })
      clearMessageAfter(4000)
    }
  }

  // Buscar pagamentos de uma venda para exibir na aba de visualização (Condições de Pagamento)
  const fetchPagamentosVisualizacao = async (vendaId) => {
    try {
      const { data } = await supabase
        .from('pagamentos_prosoluto')
        .select('*')
        .eq('venda_id', vendaId)
        .order('numero_parcela', { ascending: true })
      setPagamentosVisualizacao(data || [])
    } catch (err) {
      console.error('Erro ao buscar pagamentos para visualização:', err)
      setPagamentosVisualizacao([])
    }
  }

  // Buscar renegociações de uma venda para a aba de visualização
  const fetchRenegociacoes = async (vendaId) => {
    setLoadingRenegociacoes(true)
    try {
      const { data, error } = await supabase
        .from('renegociacoes')
        .select('*')
        .eq('venda_id', vendaId)
        .order('data_renegociacao', { ascending: false })
      if (!error) setRenegociacoesVenda(data || [])
    } catch (err) {
      console.error('Erro ao buscar renegociações:', err)
    } finally {
      setLoadingRenegociacoes(false)
    }
  }

  // Abre o modal de renegociação inicializando novasCondicoes a partir das parcelas selecionadas
  // Helper: calcular o total da distribuição nova
  const calcularTotalDistribuicao = (distribuicoes) => {
    return distribuicoes.reduce((s, d) => s + (parseInt(d.qtd) || 0) * (parseFloat(d.valor) || 0), 0)
  }

  // Helper: verificar se totais batem
  const totalDistribuicaoAtual = calcularTotalDistribuicao(renegociacaoForm.distribuicoesNovas)
  const totalsFechados = Math.abs(totalDistribuicaoAtual - renegociacaoForm.totalSelecionado) <= 0.01
  const diferenca = totalDistribuicaoAtual - renegociacaoForm.totalSelecionado

  const abrirModalRenegociacao = () => {
    // Calcular totais consolidados
    const totalSelecionado = parcelasSelecionadas.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0)
    const quantidadeParcelas = parcelasSelecionadas.length

    // ✨ Sugestão automática inteligente:
    // Manter a mesma quantidade de parcelas, distribuindo o total igualmente
    const distribuicoesNovas = []

    if (quantidadeParcelas > 0 && totalSelecionado > 0) {
      const valorPorParcela = totalSelecionado / quantidadeParcelas
      const valorUnitario = parseFloat(valorPorParcela.toFixed(2))

      // Criar (N-1) parcelas com valor unitário igual
      for (let i = 0; i < quantidadeParcelas - 1; i++) {
        distribuicoesNovas.push({
          qtd: '1',
          valor: String(valorUnitario.toFixed(2)),
          data_prevista: parcelasSelecionadas[i]?.data_prevista || ''
        })
      }

      // Última parcela ajustada para fechar o total exatamente (evita problemas de arredondamento)
      const somaAntes = distribuicoesNovas.reduce((s, d) => s + (parseInt(d.qtd) || 1) * (parseFloat(d.valor) || 0), 0)
      const ultimoValor = parseFloat((totalSelecionado - somaAntes).toFixed(2))
      distribuicoesNovas.push({
        qtd: '1',
        valor: String(ultimoValor.toFixed(2)),
        data_prevista: parcelasSelecionadas[quantidadeParcelas - 1]?.data_prevista || ''
      })
    }

    console.log('📋 Sugestão automática de renegociação:', {
      quantidadeParcelas,
      totalSelecionado,
      distribuicoesNovas,
      totalSugestao: distribuicoesNovas.reduce((s, d) => s + (parseInt(d.qtd) || 1) * (parseFloat(d.valor) || 0), 0)
    })

    setRenegociacaoForm({
      motivo: '',
      distribuicoesNovas,
      totalSelecionado,
      quantidadeParcelas
    })
    setShowModalRenegociacao(true)
  }

  // Salva a renegociação: substitui pagamentos selecionados, grava histórico, recalcula comissão
  const processarRenegociacao = async () => {
    if (!renegociacaoForm.motivo.trim()) {
      setMessage({ type: 'error', text: 'Informe o motivo da renegociação.' })
      clearMessageAfter(4000)
      return
    }

    // Validar distribuições novas
    if (renegociacaoForm.distribuicoesNovas.length === 0 ||
        renegociacaoForm.distribuicoesNovas.some(d => !d.qtd || !d.valor || parseInt(d.qtd) < 1 || parseFloat(d.valor) <= 0)) {
      setMessage({ type: 'error', text: 'Preencha quantidade e valor válidos em todas as distribuições.' })
      clearMessageAfter(4000)
      return
    }

    // Validar que o total da nova distribuição bate com o selecionado (tolerância de centavos)
    const totalNovaDistribuicao = renegociacaoForm.distribuicoesNovas.reduce((s, d) => {
      return s + (parseInt(d.qtd) || 1) * (parseFloat(d.valor) || 0)
    }, 0)

    if (Math.abs(totalNovaDistribuicao - renegociacaoForm.totalSelecionado) > 0.01) {
      setMessage({
        type: 'error',
        text: `Total da nova distribuição (R$${totalNovaDistribuicao.toFixed(2)}) não corresponde ao total selecionado (R$${renegociacaoForm.totalSelecionado.toFixed(2)})`
      })
      clearMessageAfter(6000)
      return
    }

    setSalvandoRenegociacao(true)
    try {
      const venda = selectedItem
      const fator = parseFloat(venda.fator_comissao) || 0

      // 1. Snapshot das originais
      const parcelasOriginais = parcelasSelecionadas.map(p => ({ ...p }))

      // 2. Determinar o tipo das novas parcelas (usar tipo da primeira selecionada)
      const tipoOriginal = parcelasSelecionadas[0]?.tipo || 'parcela_entrada'

      // 3. Montar as novas parcelas a inserir (agrupadas)
      const novasParcelas = []
      let numeroSequencial = 0

      // Pegar número inicial continuando a sequência existente
      const jaExistentes = pagamentosVendaEditando
        .filter(p => p.tipo === tipoOriginal && !parcelasSelecionadas.find(s => s.id === p.id))
        .map(p => p.numero_parcela || 0)
      numeroSequencial = jaExistentes.length > 0 ? Math.max(...jaExistentes) : 0

      // Criar as novas parcelas baseadas na distribuição
      renegociacaoForm.distribuicoesNovas.forEach(dist => {
        const qtd = parseInt(dist.qtd) || 1
        const valor = parseFloat(dist.valor) || 0

        for (let i = 0; i < qtd; i++) {
          numeroSequencial++
          novasParcelas.push({
            venda_id: venda.id,
            tipo: tipoOriginal,
            numero_parcela: tipoOriginal === 'sinal' || tipoOriginal === 'entrada' ? undefined : numeroSequencial,
            valor,
            data_prevista: dist.data_prevista || null,
            comissao_gerada: calcularComissaoPagamento(valor, fator),
            status: 'pendente'
          })
        }
      })

      console.log('💾 Processando renegociação agrupada:', {
        parcelasOriginais: parcelasOriginais.length,
        novasParcelas: novasParcelas.length,
        totalOriginal: renegociacaoForm.totalSelecionado,
        totalNovo: totalNovaDistribuicao
      })

      // 4. Calcular diferenças
      const somaComissaoOriginal = parcelasOriginais.reduce((s, p) => s + (parseFloat(p.comissao_gerada) || 0), 0)
      const somaComissaoNovas = novasParcelas.reduce((s, p) => s + (p.comissao_gerada || 0), 0)

      // 5. Deletar as parcelas originais selecionadas
      const idsParaDeletar = parcelasOriginais.map(p => p.id)
      const { error: errDelete } = await supabase
        .from('pagamentos_prosoluto')
        .delete()
        .in('id', idsParaDeletar)
      if (errDelete) throw errDelete

      // 6. Inserir novas parcelas
      const { error: errInsert } = await supabase
        .from('pagamentos_prosoluto')
        .insert(novasParcelas)
      if (errInsert) throw errInsert

      // 7. Gravar histórico na tabela renegociacoes
      const { error: errHist } = await supabase
        .from('renegociacoes')
        .insert([{
          venda_id: venda.id,
          usuario_id: userProfile?.id || null,
          motivo: renegociacaoForm.motivo.trim(),
          parcelas_originais: parcelasOriginais,
          parcelas_novas: novasParcelas,
          diferenca_valor: totalNovaDistribuicao - renegociacaoForm.totalSelecionado,
          diferenca_comissao: somaComissaoNovas - somaComissaoOriginal
        }])
      if (errHist) throw errHist

      // 8. Recalcular comissão da venda
      const { data: todasParcelas } = await supabase
        .from('pagamentos_prosoluto')
        .select('comissao_gerada')
        .eq('venda_id', venda.id)
      if (todasParcelas) {
        const novaComissaoTotal = todasParcelas.reduce((s, p) => s + (parseFloat(p.comissao_gerada) || 0), 0)
        const comissoesDin = calcularComissoesDinamicas(parseFloat(venda.valor_venda), venda.empreendimento_id, venda.tipo_corretor)
        const getVal = (...termos) => {
          const c = comissoesDin.cargos?.find(x => termos.some(t => x.nome_cargo?.toLowerCase().includes(t)))
          const prop = comissoesDin.percentualTotal > 0 && c ? (parseFloat(c.percentual) / comissoesDin.percentualTotal) : 0
          return novaComissaoTotal * prop
        }
        await supabase.from('vendas').update({
          comissao_total: novaComissaoTotal,
          comissao_corretor: getVal('corretor'),
          comissao_diretor: getVal('diretor'),
          comissao_nohros_imobiliaria: getVal('imobili'),
          comissao_nohros_gestao: getVal('gest'),
          comissao_wsc: getVal('wsc', 'beton'),
          comissao_coordenadora: getVal('coordenad')
        }).eq('id', venda.id)
      }

      setShowModalRenegociacao(false)
      setParcelasSelecionadas([])
      setShowModal(false)
      fetchData()
      setMessage({ type: 'success', text: 'Renegociação salva com sucesso!' })
      clearMessageAfter(4000)
    } catch (err) {
      setMessage({ type: 'error', text: 'Erro ao salvar renegociação: ' + (err.message || err) })
      clearMessageAfter(6000)
    } finally {
      setSalvandoRenegociacao(false)
    }
  }

  // Formatar CPF: 000.000.000-00
  const formatCPF = (value) => {
    if (!value) return ''
    // Remove tudo que não é número
    const numbers = value.replace(/\D/g, '')
    // Limita a 11 dígitos
    const limited = numbers.slice(0, 11)
    // Aplica a máscara
    if (limited.length <= 3) return limited
    if (limited.length <= 6) return `${limited.slice(0, 3)}.${limited.slice(3)}`
    if (limited.length <= 9) return `${limited.slice(0, 3)}.${limited.slice(3, 6)}.${limited.slice(6)}`
    return `${limited.slice(0, 3)}.${limited.slice(3, 6)}.${limited.slice(6, 9)}-${limited.slice(9)}`
  }

  // Formatar telefone: (00) 00000-0000
  const formatTelefone = (value) => {
    if (!value) return ''
    const numbers = value.replace(/\D/g, '')
    const limited = numbers.slice(0, 11)
    if (limited.length <= 2) return `(${limited}`
    if (limited.length <= 7) return `(${limited.slice(0, 2)}) ${limited.slice(2)}`
    return `(${limited.slice(0, 2)}) ${limited.slice(2, 7)}-${limited.slice(7)}`
  }

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value)
  }

  // Formatar data YYYY-MM-DD para DD/MM/YYYY (pt-BR)
  const formatDateBR = (dateStr) => {
    if (!dateStr) return ''
    const parts = dateStr.split('-')
    if (parts.length !== 3) return dateStr
    return `${parts[2]}/${parts[1]}/${parts[0]}`
  }

  // Adicionar N meses a uma data YYYY-MM-DD sem bugs de timezone ou setMonth
  // Preserva o dia; se o mês destino tiver menos dias, usa o último dia do mês
  const addMonthsSafe = (dateStr, months) => {
    const [y, m, d] = dateStr.split('-').map(Number)
    const totalMonths = (m - 1) + months
    const newYear = y + Math.floor(totalMonths / 12)
    const newMonth = totalMonths % 12 // 0-indexed
    const daysInMonth = new Date(newYear, newMonth + 1, 0).getDate()
    const newDay = Math.min(d, daysInMonth)
    return `${newYear}-${String(newMonth + 1).padStart(2, '0')}-${String(newDay).padStart(2, '0')}`
  }

  // Novoo helper: Calcular data com dia fixo, ajustando para último dia do mês se inválido
  const getDataComDiaFixo = (dateStr, months, diaFixo) => {
    if (!diaFixo || diaFixo < 1 || diaFixo > 31) {
      return addMonthsSafe(dateStr, months)
    }

    const [y, m, d] = dateStr.split('-').map(Number)
    const totalMonths = (m - 1) + months
    const newYear = y + Math.floor(totalMonths / 12)
    const newMonth = totalMonths % 12 // 0-indexed
    const daysInMonth = new Date(newYear, newMonth + 1, 0).getDate()

    // Se o dia fixo não existe neste mês, usar o último dia do mês
    const finalDay = Math.min(parseInt(diaFixo), daysInMonth)

    return `${newYear}-${String(newMonth + 1).padStart(2, '0')}-${String(finalDay).padStart(2, '0')}`
  }

  // Formatar nome com primeira letra maiúscula (Title Case)
  const formatNome = (nome) => {
    if (!nome) return ''
    return nome
      .toLowerCase()
      .split(' ')
      .map(palavra => {
        // Preposições e artigos em minúsculo
        const minusculas = ['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'nas', 'nos']
        if (minusculas.includes(palavra)) return palavra
        return palavra.charAt(0).toUpperCase() + palavra.slice(1)
      })
      .join(' ')
  }

  // Ordenar corretores alfabeticamente
  const corretoresOrdenados = [...corretores].sort((a, b) => {
    const nomeA = (a.nome || '').toLowerCase()
    const nomeB = (b.nome || '').toLowerCase()
    return nomeA.localeCompare(nomeB, 'pt-BR')
  })
  
  // Ordenar clientes alfabeticamente
  const clientesOrdenados = [...clientes].sort((a, b) => {
    const nomeA = (a.nome_completo || '').toLowerCase()
    const nomeB = (b.nome_completo || '').toLowerCase()
    return nomeA.localeCompare(nomeB, 'pt-BR')
  })

  // Ordenar empreendimentos alfabeticamente
  const empreendimentosOrdenados = [...empreendimentos].sort((a, b) => {
    const nomeA = (a.nome || '').toLowerCase()
    const nomeB = (b.nome || '').toLowerCase()
    return nomeA.localeCompare(nomeB, 'pt-BR')
  })

  // Formatar valor como moeda para input
  const formatCurrencyInput = (value) => {
    if (!value) return ''
    const num = parseFloat(value)
    if (isNaN(num)) return ''
    return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  // Converter valor formatado para número
  const parseCurrencyInput = (formattedValue) => {
    if (!formattedValue) return ''
    // Remove tudo exceto números e vírgula
    const cleanValue = formattedValue.replace(/[^\d,]/g, '').replace(',', '.')
    return cleanValue
  }

  // Função para gerar PDF de relatório (options.paraPreview = true retorna blob para visualização na aba Preview)
  const gerarRelatorioPDF = async (options = {}) => {
    setGerandoPdf(true)
    
    try {
      const doc = new jsPDF()
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      
      // ========================================
      // PALETA DE CORES PREMIUM - TEMA DOURADO
      // ========================================
      const cores = {
        // Cores principais
        preto: [15, 15, 15],           // #0f0f0f - Preto premium
        dourado: [201, 169, 98],       // #c9a962 - Dourado principal
        douradoClaro: [212, 185, 130], // #d4b982 - Dourado claro
        douradoEscuro: [139, 115, 85], // #8b7355 - Dourado escuro
        
        // Tons neutros
        cinzaEscuro: [30, 30, 30],     // #1e1e1e - Fundo escuro
        cinzaMedio: [45, 45, 45],      // #2d2d2d - Cards
        cinzaClaro: [60, 60, 60],      // #3c3c3c - Bordas
        
        // Texto
        textoBranco: [255, 255, 255],  // #ffffff
        textoClaro: [200, 200, 200],   // #c8c8c8
        textoMedio: [150, 150, 150],   // #969696
        
        // Status
        verde: [16, 185, 129],         // #10b981 - Pago/Sucesso
        vermelho: [239, 68, 68],       // #ef4444 - Atrasado/Erro
        amarelo: [245, 158, 11],       // #f59e0b - Pendente
        
        // Backgrounds claros para tabelas
        bgClaro: [250, 248, 245],      // #faf8f5 - Fundo claro elegante
        bgAlternado: [245, 242, 237]   // #f5f2ed - Linha alternada
      }
      
      // Buscar nome do corretor se filtrado
      const corretorSelecionado = relatorioFiltros.corretorId 
        ? corretores.find(c => c.id === relatorioFiltros.corretorId)
        : null
      
      // Buscar nome do empreendimento se filtrado
      const empreendimentoSelecionado = relatorioFiltros.empreendimentoId
        ? empreendimentos.find(e => e.id === relatorioFiltros.empreendimentoId)
        : null
      
      // ========================================
      // CABECALHO PREMIUM
      // ========================================
      
      // Fundo preto elegante
      doc.setFillColor(...cores.preto)
      doc.rect(0, 0, pageWidth, 50, 'F')
      
      // Linha dourada decorativa no topo
      doc.setFillColor(...cores.dourado)
      doc.rect(0, 0, pageWidth, 2, 'F')
      
      // Linha dourada decorativa na base do header
      doc.setFillColor(...cores.dourado)
      doc.rect(0, 48, pageWidth, 2, 'F')
      
      // Logo/Titulo
      doc.setTextColor(...cores.dourado)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.text('IM INCORPORADORA', 14, 15)
      
      // Titulo principal
      doc.setTextColor(...cores.textoBranco)
      doc.setFontSize(18)
      doc.setFont('helvetica', 'bold')
      
      if (corretorSelecionado) {
        doc.text('RELATORIO DE COMISSOES', pageWidth / 2, 20, { align: 'center' })
        doc.setFontSize(12)
        doc.setTextColor(...cores.dourado)
        doc.text(corretorSelecionado.nome.toUpperCase(), pageWidth / 2, 30, { align: 'center' })
        doc.setFontSize(9)
        doc.setTextColor(...cores.textoClaro)
        doc.setFont('helvetica', 'normal')
        doc.text(`${corretorSelecionado.tipo_corretor === 'interno' ? 'Corretor Interno' : 'Corretor Externo'}`, pageWidth / 2, 38, { align: 'center' })
      } else {
        doc.text('RELATORIO DE COMISSOES', pageWidth / 2, 28, { align: 'center' })
      }
      
      // Data de geracao
      doc.setFontSize(8)
      doc.setTextColor(...cores.textoMedio)
      doc.text(`${new Date().toLocaleDateString('pt-BR')} | ${new Date().toLocaleTimeString('pt-BR')}`, pageWidth - 14, 15, { align: 'right' })
      
      let yPosition = 60
      
      // Determinar fonte de dados
      let dadosFiltrados = []
      
      if (listaVendasComPagamentos.length > 0) {
        dadosFiltrados = [...listaVendasComPagamentos]
      } else if (vendas.length > 0) {
        dadosFiltrados = vendas.map(venda => ({
          venda_id: venda.id,
          venda: venda,
          pagamentos: [],
          totalValor: parseFloat(venda.valor_pro_soluto) || parseFloat(venda.valor_venda) || 0,
          totalComissao: parseFloat(venda.comissao_total) || 0,
          totalPago: venda.status === 'pago' ? (parseFloat(venda.comissao_total) || 0) : 0,
          totalPendente: venda.status !== 'pago' ? (parseFloat(venda.comissao_total) || 0) : 0
        }))
      }
      
      // Aplicar filtros
      if (relatorioFiltros.corretorId) {
        dadosFiltrados = dadosFiltrados.filter(g => {
          const corretorIdVenda = String(g.venda?.corretor?.id || g.venda?.corretor_id || '')
          return corretorIdVenda === String(relatorioFiltros.corretorId)
        })
      }
      
      if (relatorioFiltros.empreendimentoId) {
        dadosFiltrados = dadosFiltrados.filter(g => {
          const empIdVenda = String(g.venda?.empreendimento?.id || g.venda?.empreendimento_id || '')
          return empIdVenda === String(relatorioFiltros.empreendimentoId)
        })
      }
      
      if (relatorioFiltros.vendaId) {
        dadosFiltrados = dadosFiltrados.filter(g => g.venda_id === relatorioFiltros.vendaId)
      }
      
      if (relatorioFiltros.status !== 'todos') {
        if (listaVendasComPagamentos.length > 0) {
          dadosFiltrados = dadosFiltrados.map(g => ({
            ...g,
            pagamentos: g.pagamentos.filter(p => p.status === relatorioFiltros.status)
          })).filter(g => g.pagamentos.length > 0)
        } else {
          dadosFiltrados = dadosFiltrados.filter(g => g.venda?.status === relatorioFiltros.status)
        }
      }
      
      if (relatorioFiltros.dataInicio || relatorioFiltros.dataFim) {
        const dataInicio = relatorioFiltros.dataInicio ? new Date(relatorioFiltros.dataInicio) : null
        const dataFim = relatorioFiltros.dataFim ? new Date(relatorioFiltros.dataFim + 'T23:59:59') : null
        
        if (listaVendasComPagamentos.length > 0) {
          dadosFiltrados = dadosFiltrados.map(g => ({
            ...g,
            pagamentos: g.pagamentos.filter(p => {
              const dataRef = parseDataLocal(dataEfetiva(p))
              if (!dataRef) return false
              if (dataInicio && dataRef < dataInicio) return false
              if (dataFim && dataRef > dataFim) return false
              return true
            })
          })).filter(g => g.pagamentos.length > 0)
        } else {
          dadosFiltrados = dadosFiltrados.filter(g => {
            const dataVenda = parseDataLocal(g.venda?.data_venda)
            if (dataInicio && dataVenda < dataInicio) return false
            if (dataFim && dataVenda > dataFim) return false
            return true
          })
        }
      }
      
      // ========================================
      // FILTROS APLICADOS - Design Minimalista
      // ========================================
      let filtrosTexto = []
      if (corretorSelecionado) filtrosTexto.push(`Corretor: ${corretorSelecionado.nome}`)
      if (empreendimentoSelecionado) filtrosTexto.push(`Empreend.: ${empreendimentoSelecionado.nome}`)
      if (relatorioFiltros.status !== 'todos') filtrosTexto.push(`Status: ${relatorioFiltros.status === 'pago' ? 'Pago' : 'Pendente'}`)
      if (relatorioFiltros.cargoId === '__total__') filtrosTexto.push('Cargo: Total')
      else if (relatorioFiltros.cargoId === '') filtrosTexto.push('Cargo: Todos os cargos')
      else if (relatorioFiltros.cargoId) filtrosTexto.push(`Cargo: ${relatorioFiltros.cargoId}`)
      if (relatorioFiltros.dataInicio || relatorioFiltros.dataFim) {
        const inicio = relatorioFiltros.dataInicio ? formatDataBR(relatorioFiltros.dataInicio) : 'inicio'
        const fim = relatorioFiltros.dataFim ? formatDataBR(relatorioFiltros.dataFim) : 'hoje'
        filtrosTexto.push(`Periodo: ${inicio} a ${fim}`)
      }
      
      if (filtrosTexto.length > 0) {
        doc.setTextColor(...cores.cinzaEscuro)
        doc.setFontSize(9)
        doc.setFont('helvetica', 'normal')
        doc.text(filtrosTexto.join('   '), 14, yPosition + 6)
        yPosition += 16
      }
      
      // ========================================
      // CALCULAR TOTAIS
      // ========================================
      const corretorParaTotais = relatorioFiltros.corretorId 
        ? corretores.find(c => c.id === relatorioFiltros.corretorId)
        : null
      const percentualCorretorTotais = corretorParaTotais?.percentual_corretor 
        ? parseFloat(corretorParaTotais.percentual_corretor) / 100 
        : null
      
      let totalComissao = 0
      let totalPago = 0
      
      const isTotalCargo = relatorioFiltros.cargoId === '__total__'
      const isTodosCargos = relatorioFiltros.cargoId === ''
      if (relatorioFiltros.cargoId && !isTotalCargo) {
        dadosFiltrados.forEach(grupo => {
          grupo.pagamentos.forEach(pag => {
            const comissoesCargo = calcularComissaoPorCargoPagamento(pag)
            const cargoEncontrado = comissoesCargo.find(c => c.nome_cargo === relatorioFiltros.cargoId)
            if (cargoEncontrado) {
              totalComissao += cargoEncontrado.valor
              if (pag.status === 'pago') totalPago += cargoEncontrado.valor
            }
          })
        })
      } else if ((isTotalCargo || isTodosCargos)) {
        dadosFiltrados.forEach(grupo => {
          grupo.pagamentos.forEach(pag => {
            const comissao = parseFloat(pag.comissao_gerada) || 0
            totalComissao += comissao
            if (pag.status === 'pago') totalPago += comissao
          })
        })
      } else if (percentualCorretorTotais !== null) {
        dadosFiltrados.forEach(grupo => {
          grupo.pagamentos.forEach(pag => {
            const valorParcela = parseFloat(pag.valor) || 0
            const comissao = valorParcela * percentualCorretorTotais
            totalComissao += comissao
            if (pag.status === 'pago') totalPago += comissao
          })
        })
      } else {
        dadosFiltrados.forEach(grupo => {
          grupo.pagamentos.forEach(pag => {
            const comissao = parseFloat(pag.comissao_gerada) || 0
            totalComissao += comissao
            if (pag.status === 'pago') totalPago += comissao
          })
        })
      }
      const totalPendente = totalComissao - totalPago
      
      // ========================================
      // CARDS DE RESUMO - Design Premium
      // ========================================
      const cardWidth = (pageWidth - 28 - 10) / 3 // 3 cards com 5px de gap
      const cardHeight = 28
      
      // Card 1 - Comissao Total (Dourado)
      doc.setFillColor(...cores.preto)
      doc.roundedRect(14, yPosition, cardWidth, cardHeight, 2, 2, 'F')
      doc.setDrawColor(...cores.dourado)
      doc.setLineWidth(0.5)
      doc.roundedRect(14, yPosition, cardWidth, cardHeight, 2, 2, 'S')
      
      doc.setTextColor(...cores.dourado)
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.text('COMISSAO TOTAL', 14 + cardWidth/2, yPosition + 8, { align: 'center' })
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...cores.textoBranco)
      doc.text(formatCurrency(totalComissao), 14 + cardWidth/2, yPosition + 20, { align: 'center' })
      
      // Card 2 - Comissao Paga (Verde)
      const card2X = 14 + cardWidth + 5
      doc.setFillColor(...cores.preto)
      doc.roundedRect(card2X, yPosition, cardWidth, cardHeight, 2, 2, 'F')
      doc.setDrawColor(...cores.verde)
      doc.setLineWidth(0.5)
      doc.roundedRect(card2X, yPosition, cardWidth, cardHeight, 2, 2, 'S')
      
      doc.setTextColor(...cores.verde)
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.text('COMISSAO PAGA', card2X + cardWidth/2, yPosition + 8, { align: 'center' })
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...cores.textoBranco)
      doc.text(formatCurrency(totalPago), card2X + cardWidth/2, yPosition + 20, { align: 'center' })
      
      // Card 3 - Comissao Pendente (Amarelo)
      const card3X = card2X + cardWidth + 5
      doc.setFillColor(...cores.preto)
      doc.roundedRect(card3X, yPosition, cardWidth, cardHeight, 2, 2, 'F')
      doc.setDrawColor(...cores.amarelo)
      doc.setLineWidth(0.5)
      doc.roundedRect(card3X, yPosition, cardWidth, cardHeight, 2, 2, 'S')
      
      doc.setTextColor(...cores.amarelo)
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.text('COMISSAO PENDENTE', card3X + cardWidth/2, yPosition + 8, { align: 'center' })
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...cores.textoBranco)
      doc.text(formatCurrency(totalPendente), card3X + cardWidth/2, yPosition + 20, { align: 'center' })
      
      yPosition += 38
      
      // Total de parcelas de entrada por venda: (1) qtd_parcelas_entrada da venda, (2) max(numero_parcela) em todos os pagamentos parcela_entrada da venda (ex.: 59)
      const totalParcelasEntradaPorVendaId = {}
      const vendaIdsUnicos = [...new Set(dadosFiltrados.map(g => g.venda_id != null ? String(g.venda_id) : null).filter(Boolean))]
      vendaIdsUnicos.forEach(vid => {
        const vendaFromList = vendas.find(v => String(v.id) === vid)
        const qtdDb = parseInt(vendaFromList?.qtd_parcelas_entrada) || 0
        if (qtdDb > 0) {
          totalParcelasEntradaPorVendaId[vid] = qtdDb
          return
        }
        const parcelasEntradaVenda = (pagamentos || []).filter(
          p => String(p.venda_id) === vid && (p.tipo_pagamento ?? p.tipo) === 'parcela_entrada'
        )
        const maxNum = parcelasEntradaVenda.reduce((m, p) => {
          const n = p.numero_parcela ?? p.numero
          return (n != null && (m == null || n > m)) ? n : m
        }, null)
        totalParcelasEntradaPorVendaId[vid] = maxNum != null && maxNum > 0 ? maxNum : null
      })
      // Se mesma venda tiver mais de um grupo (ex.: grupos de parcelas), usar maior total entre grupos ou soma dos totais
      dadosFiltrados.forEach(grupo => {
        const vid = grupo.venda_id != null ? String(grupo.venda_id) : null
        if (!vid || totalParcelasEntradaPorVendaId[vid] != null) return
        const gruposMesmaVenda = dadosFiltrados.filter(g => String(g.venda_id) === vid)
        const maxNumEmTodos = gruposMesmaVenda.flatMap(g => g.pagamentos)
          .filter(p => (p.tipo_pagamento ?? p.tipo) === 'parcela_entrada')
          .reduce((m, p) => { const n = p.numero_parcela ?? p.numero; return (n != null && (m == null || n > m)) ? n : m }, null)
        totalParcelasEntradaPorVendaId[vid] = maxNumEmTodos != null && maxNumEmTodos > 0 ? maxNumEmTodos : null
      })
      
      // ========================================
      // DETALHAMENTO DAS VENDAS
      // ========================================
      
      dadosFiltrados.forEach((grupo, idx) => {
        // Verificar se precisa nova página
        if (yPosition > 240) {
          doc.addPage()
          yPosition = 20
        }
        
        const venda = grupo.venda
        const corretor = venda?.corretor?.nome || venda?.nome_corretor || 'N/A'
        const empreendimento = venda?.empreendimento?.nome || 'N/A'
        const unidade = venda?.unidade || venda?.numero_unidade || '-'
        const bloco = venda?.bloco || venda?.numero_bloco || '-'
        const cliente = venda?.nome_cliente || venda?.cliente?.nome_completo || venda?.cliente?.nome || 'Cliente nao informado'
        const dataVenda = venda?.data_venda ? formatDataBR(venda.data_venda) : (venda?.data_emissao ? formatDataBR(venda.data_emissao) : '-')
        const valorVenda = parseFloat(venda?.valor_venda) || parseFloat(venda?.valor_venda_total) || 0
        const valorProSolutoDb = parseFloat(venda?.valor_pro_soluto) || 0
        const valorProSolutoCalc = grupo.pagamentos.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0)
        const valorProSoluto = valorProSolutoDb > 0 ? valorProSolutoDb : (valorProSolutoCalc > 0 ? valorProSolutoCalc : valorVenda)
        
        // Calcular comissão da venda
        let comissaoVenda = 0
        if (percentualCorretorTotais !== null) {
          comissaoVenda = grupo.pagamentos.reduce((acc, p) => {
            const valorParcela = parseFloat(p.valor) || 0
            return acc + (valorParcela * percentualCorretorTotais)
          }, 0)
        } else {
          comissaoVenda = parseFloat(venda?.comissao_total) || grupo.totalComissao || grupo.pagamentos.reduce((acc, p) => acc + (parseFloat(p.comissao_gerada) || 0), 0)
        }
        
        // ========================================
        // HEADER DA VENDA - Borda fina preta, cor dourada, valores sem |, Cliente/Corretor dentro
        // ========================================
        
        const cardW = pageWidth - 28
        const cardH = 38
        doc.setFillColor(...cores.bgClaro)
        doc.setDrawColor(...cores.dourado)
        doc.setLineWidth(0.2)
        doc.roundedRect(14, yPosition, cardW, cardH, 2, 2, 'FD')
        
        // Empreendimento + Unidade (ex: FIGUEIRA GARCIA - Un. 1101 A)
        doc.setTextColor(...cores.cinzaEscuro)
        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')
        const tituloEmp = unidade !== '-' ? `${empreendimento.toUpperCase()} - Un. ${unidade}` : empreendimento.toUpperCase()
        doc.text(tituloEmp, 18, yPosition + 8)
        
        // Valores: Valor Venda   Valor Pro-Soluto   Valor Comissão (sem |)
        doc.setFontSize(8)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...cores.cinzaEscuro)
        const linhaValores = `Valor Venda: ${formatCurrency(valorVenda)}   Valor Pro-Soluto: ${formatCurrency(valorProSoluto)}   Valor Comissão: ${formatCurrency(comissaoVenda)}`
        doc.text(linhaValores, 18, yPosition + 18)
        
        // Cliente e Corretor abaixo dos valores, dentro do card (sem |)
        doc.setFontSize(7)
        doc.setTextColor(...cores.cinzaEscuro)
        doc.text(`Cliente: ${cliente}   Corretor: ${corretor}`, 18, yPosition + 30)
        
        yPosition += cardH + 4
        
        // Obter percentual do corretor filtrado
        const corretorFiltrado = relatorioFiltros.corretorId 
          ? corretores.find(c => c.id === relatorioFiltros.corretorId)
          : null
        const percentualCorretor = corretorFiltrado?.percentual_corretor 
          ? parseFloat(corretorFiltrado.percentual_corretor) / 100 
          : null
        
        // ========================================
        // TABELA DE PARCELAS - Design Premium
        // ========================================
        const tabelaW = pageWidth - 28
        const mostrarTodosCargos = relatorioFiltros.cargoId === ''
        const mostrarTotal = relatorioFiltros.cargoId === '__total__'
        
        const vidStr = grupo.venda_id != null ? String(grupo.venda_id) : null
        const totalParcelasEntradaVenda = vidStr ? (totalParcelasEntradaPorVendaId[vidStr] ?? 0) : 0
        const countPagamentosParcelaEntrada = grupo.pagamentos.filter(p => (p.tipo_pagamento ?? p.tipo) === 'parcela_entrada').length
        const totalParcelasEntrada = totalParcelasEntradaVenda > 0
          ? totalParcelasEntradaVenda
          : countPagamentosParcelaEntrada
        const formatTipo = (pag) => {
          const tipoRaw = pag.tipo_pagamento ?? pag.tipo
          if (tipoRaw === 'parcela_entrada') {
            const num = pag.numero_parcela ?? pag.numero
            return (num != null && totalParcelasEntrada > 0) ? `Parcela ${num}/${totalParcelasEntrada}` : (num != null ? `Parcela ${num}` : 'Parcela')
          }
          return { 'sinal': 'Sinal', 'entrada': 'Entrada', 'balao': 'Balão', 'bens': 'Bens / Dação', 'financiamento': 'Financ.', 'mensal': 'Mensal' }[tipoRaw] || (tipoRaw ? String(tipoRaw).charAt(0).toUpperCase() + String(tipoRaw).slice(1).replace(/_/g, ' ') : '-')
        }
        
        let parcelas
        let head
        let columnStyles
        let statusColIdx
        let pctColIdx
        let comissaoColIdx
        
        const pagamentosOrdenados = sortParcelas(grupo.pagamentos, 'calendario')

        if (mostrarTodosCargos) {
          parcelas = []
          pagamentosOrdenados.forEach(pag => {
            const valorParcela = parseFloat(pag.valor) || 0
            const cargos = calcularComissaoPorCargoPagamento(pag)
            const tipoFormatado = formatTipo(pag)
            const dataStr = formatDataBR(pag.data_prevista)
            const valorStr = formatCurrency(pag.valor)
            const statusStr = pag.status === 'pago' ? 'PAGO' : 'PENDENTE'
            cargos.forEach(c => {
              const pct = valorParcela > 0 ? ((c.valor / valorParcela) * 100).toFixed(2) : '0,00'
              parcelas.push([tipoFormatado, dataStr, valorStr, statusStr, c.nome_cargo, `${pct.replace('.', ',')}%`, formatCurrency(c.valor)])
            })
          })
          head = [['Tipo', 'Data', 'Valor', 'Status', 'Cargo', '%', 'Comissao']]
          statusColIdx = 3
          pctColIdx = 5
          comissaoColIdx = 6
          columnStyles = {
            0: { cellWidth: tabelaW * 0.11, halign: 'left' },
            1: { cellWidth: tabelaW * 0.12, halign: 'left' },
            2: { cellWidth: tabelaW * 0.14, halign: 'right' },
            3: { cellWidth: tabelaW * 0.12, halign: 'center' },
            4: { cellWidth: tabelaW * 0.14, halign: 'left' },
            5: { cellWidth: tabelaW * 0.10, halign: 'center' },
            6: { cellWidth: tabelaW * 0.17, halign: 'right', fontStyle: 'bold' }
          }
        } else {
          parcelas = pagamentosOrdenados.map(pag => {
            const valorParcela = parseFloat(pag.valor) || 0
            let comissaoExibir = 0
            let percentualUsado = 0
            if (relatorioFiltros.cargoId && !mostrarTotal) {
              const comissoesCargo = calcularComissaoPorCargoPagamento(pag)
              const cargoEncontrado = comissoesCargo.find(c => c.nome_cargo === relatorioFiltros.cargoId)
              comissaoExibir = cargoEncontrado ? cargoEncontrado.valor : 0
              percentualUsado = valorParcela > 0 ? (comissaoExibir / valorParcela) * 100 : 0
            } else {
              comissaoExibir = parseFloat(pag.comissao_gerada) || 0
              percentualUsado = valorParcela > 0 && comissaoExibir > 0 ? (comissaoExibir / valorParcela) * 100 : 0
            }
            const tipoFormatado = formatTipo(pag)
            return [
              tipoFormatado,
              formatDataBR(pag.data_prevista),
              formatCurrency(pag.valor),
              pag.status === 'pago' ? 'PAGO' : 'PENDENTE',
              `${percentualUsado.toFixed(2).replace('.', ',')}%`,
              formatCurrency(comissaoExibir)
            ]
          })
          head = [['Tipo', 'Data', 'Valor', 'Status', '%', 'Comissao']]
          statusColIdx = 3
          pctColIdx = 4
          comissaoColIdx = 5
          columnStyles = {
            0: { cellWidth: tabelaW * 0.14, halign: 'left' },
            1: { cellWidth: tabelaW * 0.15, halign: 'left' },
            2: { cellWidth: tabelaW * 0.18, halign: 'right' },
            3: { cellWidth: tabelaW * 0.18, halign: 'center' },
            4: { cellWidth: tabelaW * 0.12, halign: 'center' },
            5: { cellWidth: tabelaW * 0.23, halign: 'right', fontStyle: 'bold' }
          }
        }
        
        autoTable(doc, {
          startY: yPosition,
          head,
          body: parcelas,
          theme: 'plain',
          tableWidth: tabelaW,
          margin: { left: 14, right: 14 },
          headStyles: {
            fillColor: cores.dourado,
            textColor: cores.preto,
            fontStyle: 'bold',
            fontSize: 7,
            cellPadding: 3
          },
          bodyStyles: {
            fontSize: 7,
            textColor: cores.cinzaEscuro,
            cellPadding: 2.5
          },
          alternateRowStyles: {
            fillColor: cores.bgAlternado
          },
          columnStyles,
          didParseCell: function(data) {
            if (data.section === 'body' && data.column.index === statusColIdx) {
              const cellText = data.cell.raw
              if (cellText === 'PAGO') {
                data.cell.styles.textColor = cores.verde
                data.cell.styles.fontStyle = 'bold'
              } else {
                data.cell.styles.textColor = cores.amarelo
                data.cell.styles.fontStyle = 'bold'
              }
            }
            if (data.section === 'body' && data.column.index === comissaoColIdx) {
              data.cell.styles.textColor = cores.textoBranco
              data.cell.styles.fillColor = cores.cinzaEscuro
            }
          }
        })
        
        yPosition = doc.lastAutoTable.finalY + 12
      })
      
      // ========================================
      // RESUMO EXECUTIVO - Design Premium
      // ========================================
      if (dadosFiltrados.length > 0) {
        if (yPosition > 200) {
          doc.addPage()
          yPosition = 20
        }
        
        // Titulo da secao com linha dourada
        doc.setFillColor(...cores.preto)
        doc.roundedRect(14, yPosition, pageWidth - 28, 12, 2, 2, 'F')
        doc.setFillColor(...cores.dourado)
        doc.rect(14, yPosition, 4, 12, 'F')
        
        doc.setTextColor(...cores.dourado)
        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')
        doc.text('RESUMO EXECUTIVO', 24, yPosition + 8)
        yPosition += 18
        
        // Calcular estatisticas (usar totalComissao/totalPago/totalPendente já calculados acima - respeitam filtro de cargo)
        const totalVendasRelatorio = dadosFiltrados.length
        const totalParcelasRelatorio = dadosFiltrados.reduce((acc, g) => acc + g.pagamentos.length, 0)
        
        // Tabela de resumo elegante (usa totalComissao, totalPago, totalPendente que já respeitam cargoId/corretor)
        const statsData = [
          ['Total de Vendas', totalVendasRelatorio.toString()],
          ['Total de Parcelas', totalParcelasRelatorio.toString()],
          ['Comissao Total', formatCurrency(totalComissao)],
          ['Comissao Paga', formatCurrency(totalPago)],
          ['Comissao Pendente', formatCurrency(totalPendente)]
        ]
        
        const resumoW = pageWidth - 28
        autoTable(doc, {
          startY: yPosition,
          head: [['Metrica', 'Valor']],
          body: statsData,
          theme: 'plain',
          tableWidth: resumoW,
          margin: { left: 14, right: 14 },
          headStyles: {
            fillColor: cores.dourado,
            textColor: cores.preto,
            fontStyle: 'bold',
            fontSize: 8,
            cellPadding: 4
          },
          bodyStyles: {
            fontSize: 8,
            textColor: cores.cinzaEscuro,
            cellPadding: 3
          },
          alternateRowStyles: {
            fillColor: cores.bgAlternado
          },
          columnStyles: {
            0: { cellWidth: resumoW * 0.5, fontStyle: 'bold' },
            1: { cellWidth: resumoW * 0.5, halign: 'right', fontStyle: 'bold' }
          }
        })
        
        yPosition = doc.lastAutoTable.finalY + 12
        
        // Lista de empreendimentos (se filtrado por corretor)
        if (corretorSelecionado) {
          const empreendimentosDoCorretor = [...new Set(dadosFiltrados.map(g => g.venda?.empreendimento?.nome).filter(Boolean))]
          
          if (empreendimentosDoCorretor.length > 0) {
            doc.setTextColor(...cores.douradoEscuro)
            doc.setFontSize(8)
            doc.setFont('helvetica', 'bold')
            doc.text('EMPREENDIMENTOS:', 30, yPosition)
            doc.setFont('helvetica', 'normal')
            doc.setTextColor(...cores.cinzaEscuro)
            doc.text(empreendimentosDoCorretor.join('  |  '), 30, yPosition + 8)
            yPosition += 18
          }
        }
      }
      
      // ========================================
      // RODAPE PREMIUM - Todas as paginas
      // ========================================
      const pageCount = doc.internal.getNumberOfPages()
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i)
        
        // Fundo preto elegante
        doc.setFillColor(...cores.preto)
        doc.rect(0, pageHeight - 12, pageWidth, 12, 'F')
        
        // Linha dourada no topo do rodape
        doc.setFillColor(...cores.dourado)
        doc.rect(0, pageHeight - 12, pageWidth, 0.5, 'F')
        
        // Texto do rodape
        doc.setTextColor(...cores.textoMedio)
        doc.setFontSize(7)
        doc.setFont('helvetica', 'normal')
        doc.text('IM INCORPORADORA', 14, pageHeight - 5)
        
        // Separador
        doc.setTextColor(...cores.dourado)
        doc.text('|', 50, pageHeight - 5)
        
        doc.setTextColor(...cores.textoMedio)
        doc.text('Sistema de Gestao de Comissoes', 54, pageHeight - 5)
        
        // Paginacao
        doc.setTextColor(...cores.dourado)
        doc.setFont('helvetica', 'bold')
        doc.text(`${i}`, pageWidth - 20, pageHeight - 5, { align: 'right' })
        doc.setTextColor(...cores.textoMedio)
        doc.setFont('helvetica', 'normal')
        doc.text(`/ ${pageCount}`, pageWidth - 14, pageHeight - 5, { align: 'right' })
      }
      
      if (options.paraPreview) {
        const blob = doc.output('blob')
        setMessage({ type: 'success', text: 'Relatório gerado! Visualize abaixo.' })
        return blob
      }

      // Salvar PDF com nome mais descritivo
      let nomeArquivo = 'relatorio_comissoes'
      if (corretorSelecionado) {
        nomeArquivo = `comissoes_${corretorSelecionado.nome.replace(/\s+/g, '_').toLowerCase()}`
      }
      if (relatorioFiltros.status !== 'todos') {
        nomeArquivo += `_${relatorioFiltros.status}`
      }
      nomeArquivo += `_${new Date().toISOString().split('T')[0]}.pdf`
      doc.save(nomeArquivo)
      
      setMessage({ type: 'success', text: 'Relatório gerado com sucesso!' })
    } catch (error) {
      console.error('Erro ao gerar PDF:', error)
      setMessage({ type: 'error', text: 'Erro ao gerar relatório: ' + error.message })
    } finally {
      setGerandoPdf(false)
    }
  }

  // Handler para campo de moeda
  const handleCurrencyChange = (field, value) => {
    // Remove caracteres não numéricos exceto vírgula e ponto
    const cleanValue = value.replace(/[^\d]/g, '')
    // Converte para decimal (divide por 100 para ter centavos)
    const numValue = cleanValue ? (parseInt(cleanValue) / 100).toString() : ''
    setVendaForm({ ...vendaForm, [field]: numValue })
  }

  // Upload de contrato
  const handleContratoUpload = async (file) => {
    if (!file) return null
    
    setUploadingContrato(true)
    
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`
      const filePath = `contratos/${fileName}`
      
      const { error: uploadError } = await supabase.storage
        .from('contratos')
        .upload(filePath, file)
      
      if (uploadError) {
        console.error('Erro upload:', uploadError)
        setMessage({ type: 'error', text: 'Erro ao fazer upload do contrato' })
        setUploadingContrato(false)
        return null
      }
      
      const { data: { publicUrl } } = supabase.storage
        .from('contratos')
        .getPublicUrl(filePath)
      
      setUploadingContrato(false)
      return { url: publicUrl, nome: file.name }
    } catch (err) {
      console.error('Erro:', err)
      setUploadingContrato(false)
      return null
    }
  }

  // Remover contrato
  const handleRemoveContrato = () => {
    setContratoFile(null)
    setVendaForm({ ...vendaForm, contrato_url: '', contrato_nome: '' })
  }

  const getTotalVendas = () => {
    return vendas.reduce((acc, v) => acc + v.valor_venda, 0)
  }

  const getTotalComissoes = () => {
    return vendas.reduce((acc, v) => acc + v.comissao_total, 0)
  }

  const filteredVendas = vendas.filter(venda => {
    // Busca por texto
    const matchSearch = !searchTerm || 
      venda.corretor?.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      venda.descricao?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      venda.nome_cliente?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      venda.unidade?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      venda.bloco?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      venda.empreendimento?.nome?.toLowerCase().includes(searchTerm.toLowerCase())
    
    // Filtro por tipo de corretor
    const matchTipo = filterTipo === 'todos' || venda.tipo_corretor === filterTipo
    
    // Filtro por corretor
    const matchCorretor = !filtrosVendas.corretor || venda.corretor_id === filtrosVendas.corretor
    
    // Filtro por empreendimento
    const matchEmpreendimento = !filtrosVendas.empreendimento || venda.empreendimento_id === filtrosVendas.empreendimento
    
    // Filtro por status (distrato só aparece quando filtrado explicitamente)
    const matchStatus = (() => {
      if (venda.status === 'distrato') return filtrosVendas.status === 'distrato'
      return filtrosVendas.status === 'todos' || venda.status === filtrosVendas.status
    })()
    
    // Filtro por bloco
    const matchBloco = !filtrosVendas.bloco || (venda.bloco && venda.bloco.toUpperCase() === filtrosVendas.bloco.toUpperCase())
    
    // Filtro por data
    const matchData = (() => {
      if (!filtrosVendas.dataInicio && !filtrosVendas.dataFim) return true
      const dataVenda = parseDataLocal(venda.data_venda)
      if (filtrosVendas.dataInicio && dataVenda < parseDataLocal(filtrosVendas.dataInicio)) return false
      if (filtrosVendas.dataFim) {
        const dataFim = parseDataLocal(filtrosVendas.dataFim)
        dataFim.setHours(23, 59, 59, 999)
        if (dataVenda > dataFim) return false
      }
      return true
    })()
    
    // Filtro por valor
    const matchValor = (() => {
      const valorVenda = parseFloat(venda.valor_venda) || 0
      if (filtrosVendas.valorMin && valorVenda < parseFloat(filtrosVendas.valorMin)) return false
      if (filtrosVendas.valorMax && valorVenda > parseFloat(filtrosVendas.valorMax)) return false
      return true
    })()
    
    return matchSearch && matchTipo && matchCorretor && matchEmpreendimento && matchStatus && matchBloco && matchData && matchValor
  }).sort((a, b) => {
    // Ordenar por data mais recente primeiro
    const dataA = parseDataLocal(a.data_venda) || new Date(a.created_at || 0)
    const dataB = parseDataLocal(b.data_venda) || new Date(b.created_at || 0)
    return dataB - dataA
  })
  
  // Filtrar pagamentos
  const filteredPagamentos = listaVendasComPagamentos
    .map(grupo => {
      // Primeiro, filtrar pagamentos por data
      let pagamentosFiltrados = grupo.pagamentos
      if (filtrosPagamentos.dataInicio || filtrosPagamentos.dataFim) {
        pagamentosFiltrados = grupo.pagamentos.filter(pag => {
          const dataPag = parseDataLocal(dataEfetiva(pag))
          if (!dataPag) return false
          if (filtrosPagamentos.dataInicio) {
            const dataInicio = parseDataLocal(filtrosPagamentos.dataInicio)
            dataInicio.setHours(0, 0, 0, 0)
            if (dataPag < dataInicio) return false
          }
          if (filtrosPagamentos.dataFim) {
            const dataFim = parseDataLocal(filtrosPagamentos.dataFim)
            dataFim.setHours(23, 59, 59, 999)
            if (dataPag > dataFim) return false
          }
          return true
        })
      }
      
      // Retornar grupo com pagamentos filtrados e totais recalculados
      const novoTotalValor = pagamentosFiltrados.reduce((sum, p) => sum + (parseFloat(p.valor) || 0), 0)
      return {
        ...grupo,
        pagamentos: pagamentosFiltrados,
        totalValor: novoTotalValor
      }
    })
    .filter(grupo => {
      // Agora filtrar os grupos que não têm pagamentos após o filtro de data
      if (grupo.pagamentos.length === 0) return false
      
      // Filtro por corretor
      const matchCorretor = !filtrosPagamentos.corretor || grupo.venda?.corretor_id === filtrosPagamentos.corretor
      
      // Filtro por empreendimento
      const matchEmpreendimento = !filtrosPagamentos.empreendimento || grupo.venda?.empreendimento_id === filtrosPagamentos.empreendimento
      
      // Filtro por cliente
      const matchCliente = !filtrosPagamentos.cliente || grupo.venda?.cliente_id === filtrosPagamentos.cliente
      
      // Filtro por unidade
      const matchUnidade = !filtrosPagamentos.unidade || 
        grupo.venda?.unidade?.toLowerCase().includes(filtrosPagamentos.unidade.toLowerCase())
      
      // Filtro por status (verifica se tem pagamentos com o status)
      const matchStatus = filtrosPagamentos.status === 'todos' || 
        grupo.pagamentos.some(p => p.status === filtrosPagamentos.status)
      
      // Filtro por tipo de pagamento
      const matchTipo = filtrosPagamentos.tipo === 'todos' || 
        grupo.pagamentos.some(p => p.tipo === filtrosPagamentos.tipo)
      
      // Busca por venda (inclui cliente por nome ou nome_cliente)
      const buscaLower = filtrosPagamentos.buscaVenda?.toLowerCase() || ''
      const clienteDaVenda = grupo.venda?.cliente_id ? clientes.find(c => c.id === grupo.venda.cliente_id) : null
      const matchBusca = !filtrosPagamentos.buscaVenda ||
        grupo.venda?.corretor?.nome?.toLowerCase().includes(buscaLower) ||
        grupo.venda?.empreendimento?.nome?.toLowerCase().includes(buscaLower) ||
        grupo.venda?.nome_cliente?.toLowerCase().includes(buscaLower) ||
        clienteDaVenda?.nome_completo?.toLowerCase().includes(buscaLower) ||
        clienteDaVenda?.cpf?.toLowerCase().includes(buscaLower)
      
      return matchCorretor && matchEmpreendimento && matchCliente && matchUnidade && matchStatus && matchTipo && matchBusca
    })
    .sort((a, b) => {
    // Ordenar por último atualizado (updated_at) primeiro; fallback para data da venda
    const maxUpdatedA = Math.max(...(a.pagamentos || []).map(p => new Date(p.updated_at || p.created_at || 0).getTime()), 0)
    const maxUpdatedB = Math.max(...(b.pagamentos || []).map(p => new Date(p.updated_at || p.created_at || 0).getTime()), 0)
    if (maxUpdatedA !== maxUpdatedB) return maxUpdatedB - maxUpdatedA
    const dataA = parseDataLocal(a.venda?.data_venda) || new Date(a.venda?.created_at || 0)
    const dataB = parseDataLocal(b.venda?.data_venda) || new Date(b.venda?.created_at || 0)
    return dataB - dataA
  })

  // Filtro de Empreendimentos
  const filteredEmpreendimentos = empreendimentos.filter(emp => {
    const matchBusca = !filtrosEmpreendimentos.busca ||
      emp.nome?.toLowerCase().includes(filtrosEmpreendimentos.busca.toLowerCase()) ||
      emp.descricao?.toLowerCase().includes(filtrosEmpreendimentos.busca.toLowerCase())
    
    return matchBusca
  })

  // Filtro de Clientes (excluídos = ativo false não aparecem)
  const filteredClientes = clientes.filter(cliente => {
    if (cliente.ativo === false) return false
    // Busca por texto
    const matchBusca = !filtrosClientes.busca ||
      cliente.nome_completo?.toLowerCase().includes(filtrosClientes.busca.toLowerCase()) ||
      cliente.cpf?.toLowerCase().includes(filtrosClientes.busca.toLowerCase()) ||
      cliente.email?.toLowerCase().includes(filtrosClientes.busca.toLowerCase()) ||
      cliente.telefone?.toLowerCase().includes(filtrosClientes.busca.toLowerCase()) ||
      cliente.profissao?.toLowerCase().includes(filtrosClientes.busca.toLowerCase()) ||
      cliente.empresa_trabalho?.toLowerCase().includes(filtrosClientes.busca.toLowerCase()) ||
      cliente.endereco?.toLowerCase().includes(filtrosClientes.busca.toLowerCase())
    
    // Filtro por FGTS
    const matchFgts = filtrosClientes.possuiFgts === 'todos' ||
      (filtrosClientes.possuiFgts === 'sim' && cliente.possui_3_anos_fgts) ||
      (filtrosClientes.possuiFgts === 'nao' && !cliente.possui_3_anos_fgts)
    
    // Filtro por complemento de renda
    const matchComplemento = filtrosClientes.temComplemento === 'todos' ||
      (filtrosClientes.temComplemento === 'sim' && cliente.tem_complemento_renda) ||
      (filtrosClientes.temComplemento === 'nao' && !cliente.tem_complemento_renda)
    
    return matchBusca && matchFgts && matchComplemento
  })

  // Quando seleciona um corretor na venda, atualiza o tipo automaticamente
  const handleCorretorChange = (corretorId) => {
    const corretor = corretores.find(c => c.id === corretorId)
    const isAutonomo = corretor && !corretor.empreendimento_id && corretor.percentual_corretor
    
    setVendaForm({
      ...vendaForm, 
      corretor_id: corretorId,
      tipo_corretor: corretor?.tipo_corretor || 'externo',
      empreendimento_id: isAutonomo ? '' : (corretor?.empreendimento_id || vendaForm.empreendimento_id)
    })
  }

  // Quando muda o tipo de corretor no formulário, atualiza o percentual padrão
  const handleTipoCorretorChange = (tipo) => {
    const defaultPercentual = tipo === 'interno' ? '2.5' : '4'
    setCorretorForm({
      ...corretorForm,
      tipo_corretor: tipo,
      percentual_corretor: defaultPercentual
    })
  }


  // Função para gerar dados do Ticker (métricas globais do admin)
  const getTickerData = () => {
    const hoje = new Date()
    const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 0, 0, 0, 0)
    const fimHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59, 999)
    
    // Vendas hoje
    const vendasHoje = vendas.filter(v => {
      const dataVenda = parseDataLocal(v.data_venda)
      return dataVenda && dataVenda >= inicioHoje && dataVenda <= fimHoje
    })
    const totalVendasHoje = vendasHoje.reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)
    
    // Vendas este mês
    const vendasMes = vendas.filter(v => {
      const dataVenda = parseDataLocal(v.data_venda)
      return dataVenda && dataVenda.getMonth() === hoje.getMonth() &&
             dataVenda.getFullYear() === hoje.getFullYear()
    })
    const totalVendasMes = vendasMes.reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)
    
    // Total em vendas
    const totalVendas = vendas.reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)
    
    // Comissões pendentes — sempre por pagamento (R2), nunca por venda.status
    const comissoesPendentes = pagamentos
      .filter(p => p.status === 'pendente')
      .reduce((acc, p) => acc + (parseFloat(p.comissao_gerada) || 0), 0)
    
    // Corretores ativos
    const corretoresAtivos = corretores.filter(c => c.ativo !== false).length
    
    // Média por venda
    const mediaPorVenda = vendas.length > 0 ? totalVendas / vendas.length : 0
    
    // Pagamentos hoje (pro-soluto)
    const pagamentosHoje = pagamentos.filter(p => {
      if (!p.data_pagamento) return false
      const dataPagamento = parseDataLocal(p.data_pagamento)
      return dataPagamento && dataPagamento >= inicioHoje && dataPagamento <= fimHoje
    })
    const totalPagamentosHoje = pagamentosHoje.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0)
    
    // Formatar valores
    const formatTicker = (value) => {
      if (value >= 1000000) {
        return `R$ ${(value / 1000000).toFixed(1)}M`
      } else if (value >= 1000) {
        return `R$ ${(value / 1000).toFixed(0)}k`
      }
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(value)
    }

    const tickerData = [
      {
        name: 'VENDAS HOJE',
        value: formatTicker(totalVendasHoje),
        change: vendasHoje.length > 0 ? `+${vendasHoje.length}` : '0',
        type: vendasHoje.length > 0 ? 'positive' : 'neutral'
      },
      {
        name: 'COMISSÕES PENDENTES',
        value: formatTicker(comissoesPendentes),
        change: '0%',
        type: comissoesPendentes > 0 ? 'negative' : 'neutral'
      },
      {
        name: 'TOTAL EM VENDAS',
        value: formatTicker(totalVendas),
        change: vendas.length > 0 ? `${vendas.length} vendas` : '0',
        type: 'positive'
      },
      {
        name: 'CORRETORES ATIVOS',
        value: corretoresAtivos.toString(),
        change: corretoresAtivos > 0 ? `+${corretoresAtivos}` : '0',
        type: 'positive'
      },
      {
        name: 'MÉDIA POR VENDA',
        value: formatTicker(mediaPorVenda),
        change: '0%',
        type: 'positive'
      },
      {
        name: 'PAGAMENTOS HOJE',
        value: formatTicker(totalPagamentosHoje),
        change: pagamentosHoje.length > 0 ? `+${pagamentosHoje.length}` : '0',
        type: pagamentosHoje.length > 0 ? 'positive' : 'neutral'
      }
    ]

    // Adicionar métricas opcionais se houver dados futuros
    // Exemplo: Meta mensal, Leads novos (comentado para uso futuro)
    // if (metaMensal) {
    //   tickerData.push({
    //     name: 'META MENSAL',
    //     value: `${metaMensal}%`,
    //     change: '+4%',
    //     type: 'positive'
    //   })
    // }
    // if (leadsNovos) {
    //   tickerData.push({
    //     name: 'LEADS NOVOS',
    //     value: leadsNovos.toString(),
    //     change: `+${leadsNovos}`,
    //     type: 'positive'
    //   })
    // }

    return tickerData
  }

  return (
    <div className="dashboard-container">
      {/* Barra de Carregamento Global */}
      {(loading || authLoading) && (
        <div className="global-loading-overlay">
          <div className="global-loading-content">
            <div className="loading-spinner-large"></div>
            <p className="loading-text">Carregando dados...</p>
            <div className="loading-progress-bar">
              <div className="loading-progress-fill"></div>
            </div>
          </div>
        </div>
      )}
      
      {/* Message Toast */}
      {message.text && (
        <div className={`toast-message ${message.type}`}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <X size={18} />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Sidebar Overlay for Mobile */}
      <div 
        className={`sidebar-overlay ${menuOpen ? 'active' : ''}`}
        onClick={() => setMenuOpen(false)}
      />

      {/* Sidebar */}
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
          <button 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => navigate('/admin/dashboard')}
            title="Dashboard"
          >
            <LayoutDashboard size={20} />
            <span>Dashboard</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'vendas' ? 'active' : ''}`}
            onClick={() => navigate('/admin/vendas')}
            title="Vendas"
          >
            <DollarSign size={20} />
            <span>Vendas</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'corretores' ? 'active' : ''}`}
            onClick={() => navigate('/admin/corretores')}
            title="Corretores"
          >
            <Users size={20} />
            <span>Corretores</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'empreendimentos' ? 'active' : ''}`}
            onClick={() => navigate('/admin/empreendimentos')}
            title="Empreendimentos"
          >
            <Building size={20} />
            <span>Empreendimentos</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'pagamentos' ? 'active' : ''}`}
            onClick={() => navigate('/admin/pagamentos')}
            title="Pagamentos"
          >
            <CreditCard size={20} />
            <span>Pagamentos</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'clientes' ? 'active' : ''}`}
            onClick={() => navigate('/admin/clientes')}
            title="Clientes"
          >
            <UserCircle size={20} />
            <span>Clientes</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'relatorios' ? 'active' : ''}`}
            onClick={() => navigate('/admin/relatorios')}
            title="Relatórios"
          >
            <TrendingUp size={20} />
            <span>Relatórios</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'preview-pdf' ? 'active' : ''}`}
            onClick={() => navigate('/admin/preview-pdf')}
            title="Ver PDF (preview para ajuste visual)"
          >
            <Eye size={20} />
            <span>Ver PDF</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'solicitacoes' ? 'active' : ''}`}
            onClick={() => navigate('/admin/solicitacoes')}
            title="Solicitações"
          >
            <ClipboardList size={20} />
            <span>Solicitações</span>
            {solicitacoes.filter(s => s.status === 'pendente').length > 0 && (
              <span className="nav-badge">{solicitacoes.filter(s => s.status === 'pendente').length}</span>
            )}
          </button>
          {/* Sincronizar Sienge - Oculto em produção */}
          {false && (
            <button 
              className={`nav-item ${activeTab === 'sienge' ? 'active' : ''}`}
              onClick={() => navigate('/admin/sienge')}
              title="Sincronizar Sienge"
            >
              <RefreshCw size={20} />
              <span>Sincronizar Sienge</span>
            </button>
          )}
        </nav>

        <div className="sidebar-footer">
          <button 
            className="collapse-btn" 
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Expandir' : 'Recolher'}
          >
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
          <div className="user-info">
            <div className="user-avatar">
              <User size={20} />
            </div>
            <div className="user-details">
              <span className="user-name">{userProfile?.nome || 'Admin'}</span>
              <span className="user-role">Administrador</span>
            </div>
          </div>
          <button 
            className="logout-btn" 
            onClick={() => {
              // Limpar dados locais primeiro
              localStorage.clear()
              // Fazer signOut do Supabase
              supabase.auth.signOut().finally(() => {
                // Redirecionar para login (usando replace para não manter histórico)
                window.location.replace('/login')
              })
            }} 
            title="Sair"
          >
            <LogOut size={20} />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        {/* Ticker */}
        <Ticker data={getTickerData()} />
        
        {/* Header */}
        <header className="main-header">
          <button className="menu-toggle" onClick={() => setMenuOpen(true)}>
            <Menu size={24} />
          </button>
          <h1>
            {activeTab === 'dashboard' && 'Dashboard Executivo'}
            {activeTab === 'vendas' && 'Gestão de Vendas'}
            {activeTab === 'corretores' && 'Corretores'}
            {activeTab === 'empreendimentos' && 'Empreendimentos'}
            {activeTab === 'pagamentos' && 'Acompanhamento de Pagamentos'}
            {activeTab === 'clientes' && 'Cadastro de Clientes'}
            {activeTab === 'relatorios' && 'Relatórios'}
            {activeTab === 'preview-pdf' && 'Ver PDF'}
            {activeTab === 'solicitacoes' && 'Solicitações'}
            {false && activeTab === 'sienge' && 'Sincronização Sienge'}
          </h1>
          <div className="header-actions">
            {activeTab === 'vendas' && (
              <button 
                className="btn-primary"
                onClick={() => {
                  resetVendaForm()
                  setSelectedItem(null)
                  setModalType('venda')
                  setShowModal(true)
                }}
              >
                <Plus size={20} />
                <span>Nova Venda</span>
              </button>
            )}
            {activeTab === 'corretores' && (
              <button 
                className="btn-primary"
                onClick={() => {
                  resetCorretorForm()
                  setSelectedItem(null)
                  setModalType('corretor')
                  setShowModal(true)
                }}
              >
                <UserPlus size={20} />
                <span>Novo Corretor</span>
              </button>
            )}
            {activeTab === 'empreendimentos' && (
              <button 
                className="btn-primary"
                onClick={() => {
                  setEmpreendimentoForm({
                    nome: '',
                    descricao: '',
                    total_unidades: '',
                    comissao_total_externo: '7',
                    comissao_total_interno: '6',
                    cargos_externo: [{ nome_cargo: '', percentual: '' }],
                    cargos_interno: [{ nome_cargo: '', percentual: '' }],
                    logo_url: '',
                    progresso_obra: '0'
                  })
                  setSelectedItem(null)
                  setModalType('empreendimento')
                  setShowModal(true)
                }}
              >
                <Plus size={20} />
                <span>Novo Empreendimento</span>
              </button>
            )}
            {activeTab === 'clientes' && (
              <button 
                className="btn-primary"
                onClick={() => {
                  resetClienteForm()
                  setSelectedItem(null)
                  setModalType('cliente')
                  setShowModal(true)
                }}
              >
                <UserPlus size={20} />
                <span>Novo Cliente</span>
              </button>
            )}
          </div>
        </header>

        {/* Content */}
        {activeTab === 'dashboard' && (
          <div style={{ padding: '0', flex: 1, overflow: 'auto' }}>
            <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, margin: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <strong style={{ fontSize: 14 }}>Sincronizar Sienge (backend - piloto)</strong>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    Dispara a Edge Function <code>sienge-sync</code>. Rode (1) primeiro, depois (2).
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => dispararSiengeSync('sales-contracts')}
                    disabled={!!siengeSyncLoading}
                    style={{ padding: '8px 14px', border: '1px solid #2563eb', background: '#2563eb', color: '#fff', borderRadius: 8, cursor: siengeSyncLoading ? 'not-allowed' : 'pointer', opacity: siengeSyncLoading ? 0.6 : 1 }}
                  >
                    {siengeSyncLoading === 'sales-contracts' ? 'Rodando…' : '1) Sales Contracts'}
                  </button>
                  <button
                    onClick={() => dispararSiengeSync('receivable-bills')}
                    disabled={!!siengeSyncLoading}
                    style={{ padding: '8px 14px', border: '1px solid #059669', background: '#059669', color: '#fff', borderRadius: 8, cursor: siengeSyncLoading ? 'not-allowed' : 'pointer', opacity: siengeSyncLoading ? 0.6 : 1 }}
                  >
                    {siengeSyncLoading === 'receivable-bills' ? 'Rodando…' : '2) Receivable Bills'}
                  </button>
                  <button
                    onClick={dispararProbeBulk}
                    disabled={!!siengeSyncLoading}
                    style={{ padding: '8px 14px', border: '1px solid #a16207', background: '#a16207', color: '#fff', borderRadius: 8, cursor: siengeSyncLoading ? 'not-allowed' : 'pointer', opacity: siengeSyncLoading ? 0.6 : 1 }}
                  >
                    {siengeSyncLoading === 'probe' ? 'Sondando…' : '🔍 Probe Bulk Data'}
                  </button>
                </div>
              </div>
              {siengeSyncProgress && (
                <div style={{ marginTop: 12, background: '#eff6ff', color: '#1e3a8a', padding: 12, borderRadius: 8, fontSize: 12 }}>
                  <div><strong>{siengeSyncProgress.entity}</strong> — chunk {siengeSyncProgress.chunk} (offset {siengeSyncProgress.offset}, limit {siengeSyncProgress.limit}) — {siengeSyncProgress.status}</div>
                  {siengeSyncProgress.total != null && (
                    <div>processados {Math.min(siengeSyncProgress.offset + (siengeSyncProgress.fetched || 0), siengeSyncProgress.total)}/{siengeSyncProgress.total} · hasMore={String(!!siengeSyncProgress.hasMore)} · budgetExhausted={String(!!siengeSyncProgress.budgetExhausted)} · apiCalls={siengeSyncProgress.apiCalls ?? '-'}</div>
                  )}
                  {siengeSyncProgress.aggregate && (
                    <div>acumulado: updated={siengeSyncProgress.aggregate.updated} · errors={siengeSyncProgress.aggregate.errors}</div>
                  )}
                </div>
              )}
              {siengeSyncError && (
                <pre style={{ marginTop: 12, background: '#fef2f2', color: '#991b1b', padding: 12, borderRadius: 8, fontSize: 12, whiteSpace: 'pre-wrap' }}>
                  {siengeSyncError}
                </pre>
              )}
              {siengeSyncResult && (
                <pre style={{ marginTop: 12, background: '#f9fafb', color: '#111827', padding: 12, borderRadius: 8, fontSize: 12, maxHeight: 320, overflow: 'auto' }}>
                  {JSON.stringify(siengeSyncResult, null, 2)}
                </pre>
              )}
            </section>
            <HomeDashboard
              showTicker={false}
              showHeader={false}
              vendas={vendas}
              corretores={corretores}
              pagamentos={pagamentos}
              empreendimentos={empreendimentos}
            />
          </div>
        )}
        {activeTab === 'vendas' && (
          <div className="content-section">
            {/* Busca */}
            <div className="filters-section">
              <div className="search-box">
                <Search size={20} />
                <input 
                  type="text" 
                  placeholder="Buscar por corretor, cliente, unidade, empreendimento..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              
              {/* Filtros em Grid */}
              <div className="filters-grid">
                <div className="filter-item">
                  <label className="filter-label">
                    <Filter size={16} />
                    Tipo de Corretor
                  </label>
                  <select 
                    value={filterTipo} 
                    onChange={(e) => setFilterTipo(e.target.value)}
                    className="filter-select"
                  >
                    <option value="todos">Todos</option>
                    <option value="interno">Interno</option>
                    <option value="externo">Externo</option>
                  </select>
                </div>
                
                <div className="filter-item">
                  <label className="filter-label">Corretor</label>
                  <select 
                    value={filtrosVendas.corretor} 
                    onChange={(e) => setFiltrosVendas({...filtrosVendas, corretor: e.target.value})}
                    className="filter-select"
                  >
                    <option value="">Todos</option>
                    {corretoresOrdenados.map(c => (
                      <option key={c.id} value={c.id}>{formatNome(c.nome)}</option>
                    ))}
                  </select>
                </div>
                
                <div className="filter-item">
                  <label className="filter-label">Empreendimento</label>
                  <select 
                    value={filtrosVendas.empreendimento} 
                    onChange={(e) => setFiltrosVendas({...filtrosVendas, empreendimento: e.target.value})}
                    className="filter-select"
                  >
                    <option value="">Todos</option>
                    {[...empreendimentos].sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR')).map(e => (
                      <option key={e.id} value={e.id}>{e.nome}</option>
                    ))}
                  </select>
                </div>
                
                <div className="filter-item">
                  <label className="filter-label">Status</label>
                  <select 
                    value={filtrosVendas.status} 
                    onChange={(e) => setFiltrosVendas({...filtrosVendas, status: e.target.value})}
                    className="filter-select"
                  >
                    <option value="todos">Todos</option>
                    <option value="pendente">Pendente</option>
                    <option value="pago">Pago</option>
                    <option value="em_andamento">Em Andamento</option>
                    <option value="distrato">Distrato</option>
                  </select>
                </div>
                
                <div className="filter-item">
                  <label className="filter-label">Bloco</label>
                  <select 
                    value={filtrosVendas.bloco} 
                    onChange={(e) => setFiltrosVendas({...filtrosVendas, bloco: e.target.value})}
                    className="filter-select"
                  >
                    <option value="">Todos</option>
                    {(() => {
                      // Coletar blocos únicos das vendas
                      const blocosUnicos = [...new Set(vendas
                        .filter(v => v.bloco && v.bloco.trim() !== '')
                        .map(v => v.bloco.toUpperCase())
                        .sort()
                      )]
                      return blocosUnicos.map(bloco => (
                        <option key={bloco} value={bloco}>{bloco}</option>
                      ))
                    })()}
                  </select>
                </div>
                
                <div className="filter-item">
                  <label className="filter-label">Data Início</label>
                  <input 
                    type="date"
                    value={filtrosVendas.dataInicio}
                    onChange={(e) => setFiltrosVendas({...filtrosVendas, dataInicio: e.target.value})}
                    className="filter-input-date"
                  />
                </div>
                
                <div className="filter-item">
                  <label className="filter-label">Data Fim</label>
                  <input 
                    type="date"
                    value={filtrosVendas.dataFim}
                    onChange={(e) => setFiltrosVendas({...filtrosVendas, dataFim: e.target.value})}
                    className="filter-input-date"
                  />
                </div>
              </div>
              
              <button
                className="btn-clear-filters"
                onClick={() => {
                  setFiltrosVendas({
                    corretor: '',
                    empreendimento: '',
                    status: 'todos',
                    bloco: '',
                    dataInicio: '',
                    dataFim: '',
                    valorMin: '',
                    valorMax: ''
                  })
                  setSearchTerm('')
                  setFilterTipo('todos')
                }}
              >
                <X size={16} />
                Limpar Filtros
              </button>
            </div>

                <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Corretor</th>
                    <th>Cliente</th>
                    <th>Unidade</th>
                    <th>Tipo</th>
                    <th>Valor Venda</th>
                    <th>Comissão Corretor</th>
                    <th>Comissão Total</th>
                    <th>Data</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="10" className="loading-cell">
                        <div className="loading-spinner"></div>
                      </td>
                    </tr>
                  ) : filteredVendas.length === 0 ? (
                    <tr>
                      <td colSpan="10" className="empty-cell">
                        Nenhuma venda encontrada
                      </td>
                    </tr>
                  ) : (
                    filteredVendas.map((venda) => {
                      const { comissaoTotal, comissaoCorretor } = venda.status === 'distrato' && venda.data_distrato
                        ? calcularComissaoVendaDistrato(venda.id, venda.data_distrato)
                        : calcularComissaoVendaPorPagamentos(venda.id)
                      const nomeCliente = venda.nome_cliente || venda.cliente?.nome || ''
                      const dataDistratoFormatada = venda.data_distrato
                        ? formatDataBR(venda.data_distrato)
                        : ''
                      const nomeClienteExibicao = venda.status === 'distrato' && dataDistratoFormatada
                        ? `${nomeCliente} - DISTRATO ${dataDistratoFormatada}`
                        : nomeCliente
                      return (
                      <tr key={venda.id}>
                        <td>
                          <div className="corretor-cell">
                            <div className="corretor-avatar">
                              {venda.corretor?.nome?.charAt(0) || 'C'}
                            </div>
                            <span>{venda.corretor?.nome || 'N/A'}</span>
                          </div>
                        </td>
                        <td>
                          <span style={venda.status === 'distrato' ? { color: '#dc2626', fontWeight: 600 } : {}}>
                            {nomeClienteExibicao || '-'}
                          </span>
                        </td>
                        <td>
                          <span className="unidade-bloco">
                            {venda.unidade || venda.bloco ? (
                              <>{venda.bloco && `Bloco ${venda.bloco}`}{venda.bloco && venda.unidade && ' - '}{venda.unidade && `Un. ${venda.unidade}`}</>
                            ) : '-'}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${venda.tipo_corretor}`}>
                            {venda.tipo_corretor === 'interno' ? 'Interno' : 'Externo'}
                          </span>
                        </td>
                        <td className="value-cell">{formatCurrency(venda.valor_venda)}</td>
                        <td className="value-cell highlight">{formatCurrency(comissaoCorretor)}</td>
                        <td className="value-cell">{formatCurrency(comissaoTotal)}</td>
                        <td>{formatDataBR(venda.data_venda)}</td>
                        <td>
                          <span className={`status-badge ${venda.status}`}>
                            {venda.status === 'pago' && <CheckCircle size={14} />}
                            {venda.status === 'pendente' && <Clock size={14} />}
                            {venda.status === 'em_andamento' && <Clock size={14} />}
                            {venda.status === 'distrato' && <XCircle size={14} />}
                            {venda.status === 'pago' && 'Comissão Paga'}
                            {venda.status === 'pendente' && 'Pendente'}
                            {venda.status === 'em_andamento' && 'Em Andamento'}
                            {venda.status === 'distrato' && 'DISTRATO'}
                          </span>
                        </td>
                        <td>
                          <div className="action-buttons">
                            <button
                              className="action-btn view"
                              onClick={() => {
                                setSelectedItem(venda)
                                setModalType('visualizar-venda')
                                setShowModal(true)
                                fetchPagamentosVisualizacao(venda.id)
                              }}
                              title="Visualizar"
                            >
                              <Eye size={16} />
                            </button>
                            <button
                              className="action-btn edit"
                              onClick={() => openEditModal(venda)}
                              title="Editar"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              className="action-btn delete"
                              onClick={() => handleDeleteVenda(venda)}
                              title="Excluir / Distrato"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )})
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'corretores' && (
          <div className="content-section">
            {/* Filtros de Corretores */}
            <div className="filters-section">
              <div className="search-box">
                <Search size={20} />
                <input 
                  type="text" 
                  placeholder="Buscar por nome, email, telefone..."
                  value={filtrosCorretores.busca}
                  onChange={(e) => setFiltrosCorretores({...filtrosCorretores, busca: e.target.value})}
                />
              </div>
              
              {/* Filtros em Grid */}
              <div className="filters-grid">
                <div className="filter-item">
                  <label className="filter-label">
                    <Filter size={16} />
                    Tipo de Corretor
                  </label>
                  <select 
                    value={filtrosCorretores.tipo} 
                    onChange={(e) => setFiltrosCorretores({...filtrosCorretores, tipo: e.target.value})}
                    className="filter-select"
                  >
                    <option value="todos">Todos</option>
                    <option value="interno">Interno</option>
                    <option value="externo">Externo</option>
                  </select>
                </div>
                
                <div className="filter-item">
                  <label className="filter-label">Empreendimento</label>
                  <select 
                    value={filtrosCorretores.empreendimento} 
                    onChange={(e) => setFiltrosCorretores({...filtrosCorretores, empreendimento: e.target.value})}
                    className="filter-select"
                  >
                    <option value="">Todos</option>
                    <option value="sem_vinculo">Sem Vínculo</option>
                    {empreendimentos.map(e => (
                      <option key={e.id} value={e.id}>{e.nome}</option>
                    ))}
                  </select>
                </div>
                
                <div className="filter-item">
                  <label className="filter-label">Tipo de Vínculo</label>
                  <select 
                    value={filtrosCorretores.autonomo} 
                    onChange={(e) => setFiltrosCorretores({...filtrosCorretores, autonomo: e.target.value})}
                    className="filter-select"
                  >
                    <option value="todos">Todos</option>
                    <option value="sim">Autônomo</option>
                    <option value="nao">Vinculado</option>
                  </select>
                </div>
              </div>
              
              <button
                className="btn-clear-filters"
                onClick={() => {
                  setFiltrosCorretores({
                    busca: '',
                    tipo: 'todos',
                    empreendimento: '',
                    autonomo: 'todos'
                  })
                }}
              >
                <X size={16} />
                Limpar Filtros
              </button>
            </div>
            
            {/* Lista de Corretores */}
            {corretores.length === 0 ? (
              <div className="empty-state-box">
                <Users size={48} />
                <h3>Nenhum corretor cadastrado</h3>
                <p>Clique em "Novo Corretor" para adicionar</p>
              </div>
            ) : (() => {
              // Filtrar corretores
              const filteredCorretores = corretores.filter(corretor => {
                // Busca por texto
                const matchBusca = !filtrosCorretores.busca ||
                  corretor.nome?.toLowerCase().includes(filtrosCorretores.busca.toLowerCase()) ||
                  corretor.email?.toLowerCase().includes(filtrosCorretores.busca.toLowerCase()) ||
                  corretor.telefone?.toLowerCase().includes(filtrosCorretores.busca.toLowerCase())
                
                // Filtro por tipo
                const matchTipo = filtrosCorretores.tipo === 'todos' || corretor.tipo_corretor === filtrosCorretores.tipo
                
                // Filtro por empreendimento
                const matchEmpreendimento = (() => {
                  if (!filtrosCorretores.empreendimento) return true
                  if (filtrosCorretores.empreendimento === 'sem_vinculo') {
                    return !corretor.empreendimento_id
                  }
                  return corretor.empreendimento_id === filtrosCorretores.empreendimento
                })()
                
                // Filtro por autônomo
                const matchAutonomo = (() => {
                  if (filtrosCorretores.autonomo === 'todos') return true
                  const isAutonomo = !corretor.empreendimento_id && corretor.percentual_corretor
                  if (filtrosCorretores.autonomo === 'sim') return isAutonomo
                  if (filtrosCorretores.autonomo === 'nao') return !isAutonomo
                  return true
                })()
                
                return matchBusca && matchTipo && matchEmpreendimento && matchAutonomo
              })
              
              return filteredCorretores.length === 0 ? (
                <div className="empty-state-box">
                  <Users size={48} />
                  <h3>Nenhum corretor encontrado</h3>
                  <p>Não há corretores que correspondam aos filtros selecionados</p>
                </div>
              ) : (
                <div className="corretores-grid">
                  {filteredCorretores.map((corretor) => {
                    const vendasCorretor = vendas.filter(v => v.corretor_id === corretor.id)
                    const comissaoPorPagamentos = calcularComissaoCorretorPorPagamentos(corretor.id)
                    const totalComissao = comissaoPorPagamentos.total
                    const totalVendas = vendasCorretor.reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)
                    const percentual = corretor.percentual_corretor || (corretor.tipo_corretor === 'interno' ? 2.5 : 4)
                    const isAutonomo = !corretor.empreendimento_id && corretor.percentual_corretor
                    
                    return (
                      <div key={corretor.id} className="corretor-card">
                        <div className="corretor-header">
                          <div className="corretor-avatar large">
                            {corretor.nome?.charAt(0)}
                          </div>
                          <div className="corretor-info">
                            <h3>{corretor.nome}</h3>
                            <div className="corretor-badges">
                              <span className={`badge ${corretor.tipo_corretor}`}>
                                {corretor.tipo_corretor === 'interno' ? 'Interno' : 'Externo'}
                              </span>
                              {isAutonomo && (
                                <span className="badge autonomo">
                                  Autônomo
                                </span>
                              )}
                              <span className="badge percent">
                                <Percent size={12} />
                                {percentual}%
                              </span>
                            </div>
                            {(corretor.empreendimento?.nome || corretor.cargo?.nome_cargo) && (
                              <div className="corretor-vinculo">
                                {corretor.empreendimento?.nome && (
                                  <span className="vinculo-item">
                                    <Building size={12} />
                                    {corretor.empreendimento.nome}
                                  </span>
                                )}
                                {corretor.cargo?.nome_cargo && (
                                  <span className="vinculo-item cargo">
                                    {corretor.cargo.nome_cargo}
                                    {corretor.cargo.percentual && ` (${corretor.cargo.percentual}%)`}
                                  </span>
                                )}
                              </div>
                            )}
                            {isAutonomo && (
                              <div className="corretor-vinculo">
                                <span className="vinculo-item">
                                  Comissão Personalizada: {percentual}%
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="corretor-actions">
                            <button 
                              className="action-btn view small"
                              onClick={() => {
                                setSelectedItem({
                                  ...corretor,
                                  vendasCorretor,
                                  totalComissao,
                                  totalVendas,
                                  percentual,
                                  comissaoPaga: comissaoPorPagamentos.pago,
                                  comissaoPendente: comissaoPorPagamentos.pendente
                                })
                                setModalType('visualizar-corretor')
                                setShowModal(true)
                              }}
                              title="Visualizar corretor"
                            >
                              <Eye size={14} />
                            </button>
                            <button 
                              className="action-btn edit small"
                              onClick={() => openEditCorretor(corretor)}
                              title="Editar corretor"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button 
                              className="action-btn delete small"
                              onClick={() => handleDeleteCorretor(corretor)}
                              title="Excluir corretor"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        <div className="corretor-email">
                          <Mail size={14} />
                          <span>{corretor.email}</span>
                          {corretor.telefone && (
                            <>
                              <span style={{ margin: '0 8px' }}>•</span>
                              <span>{corretor.telefone}</span>
                            </>
                          )}
                        </div>
                        <div className="corretor-stats">
                          <div className="corretor-stat">
                            <span className="label">Total em Vendas</span>
                            <span className="value">{formatCurrency(totalVendas)}</span>
                          </div>
                          <div className="corretor-stat">
                            <span className="label">Comissão a Receber</span>
                            <span className="value gold">{formatCurrency(totalComissao)}</span>
                          </div>
                          <div className="corretor-stat">
                            <span className="label">Nº de Vendas</span>
                            <span className="value">{vendasCorretor.length}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}

        {activeTab === 'empreendimentos' && (
          <div className="empreendimentos-premium">
            {/* Header com Estatísticas - Minimalista */}
            <div className="empreendimentos-stats-header">
              <div className="emp-stat-card">
                <span className="emp-stat-value">{empreendimentos.length}</span>
                <span className="emp-stat-label">Empreendimentos</span>
              </div>
              <div className="emp-stat-card">
                <span className="emp-stat-value">
                  {formatCurrency(vendas.reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0))}
                </span>
                <span className="emp-stat-label">Total em Vendas</span>
              </div>
              <div className="emp-stat-card">
                <span className="emp-stat-value">{vendas.length}</span>
                <span className="emp-stat-label">Vendas Realizadas</span>
              </div>
              <div className="emp-stat-card">
                <span className="emp-stat-value">{corretores.filter(c => c.tipo !== 'admin').length}</span>
                <span className="emp-stat-label">Corretores</span>
              </div>
            </div>

            {/* Filtros e Toggle de Visualização */}
            <div className="empreendimentos-filters">
              <div className="emp-search-box">
                <Search size={20} />
                <input 
                  type="text" 
                  placeholder="Buscar empreendimento..."
                  value={filtrosEmpreendimentos.busca}
                  onChange={(e) => setFiltrosEmpreendimentos({...filtrosEmpreendimentos, busca: e.target.value})}
                />
              </div>
              
              <div className="emp-view-toggle">
                <button 
                  className={`emp-view-btn ${empViewMode === 'grid' ? 'active' : ''}`}
                  onClick={() => setEmpViewMode('grid')}
                >
                  <LayoutGrid size={18} />
                  Cards
                </button>
                <button 
                  className={`emp-view-btn ${empViewMode === 'list' ? 'active' : ''}`}
                  onClick={() => setEmpViewMode('list')}
                >
                  <List size={18} />
                  Lista
                </button>
              </div>
            </div>

            {filteredEmpreendimentos.length === 0 ? (
              <div className="emp-empty-state">
                <div className="emp-empty-icon">
                  <Building size={40} />
                </div>
                <h3>{empreendimentos.length === 0 ? 'Nenhum empreendimento cadastrado' : 'Nenhum empreendimento encontrado'}</h3>
                <p>{empreendimentos.length === 0 ? 'Adicione seu primeiro empreendimento para começar' : 'Tente outra busca'}</p>
                {empreendimentos.length === 0 && (
                  <button 
                    className="emp-empty-btn"
                    onClick={() => {
                      setEmpreendimentoForm({
                        nome: '',
                        descricao: '',
                        total_unidades: '',
                        comissao_total_externo: '7',
                        comissao_total_interno: '6',
                        cargos_externo: [{ nome_cargo: '', percentual: '' }],
                        cargos_interno: [{ nome_cargo: '', percentual: '' }],
                        logo_url: '',
                        progresso_obra: '0'
                      })
                      setSelectedItem(null)
                      setModalType('empreendimento')
                      setShowModal(true)
                    }}
                  >
                    <Plus size={20} />
                    Novo Empreendimento
                  </button>
                )}
              </div>
            ) : empViewMode === 'grid' ? (
              /* Visualização em Grid Premium */
              <div className="empreendimentos-showcase">
                {filteredEmpreendimentos.map((emp) => {
                  const vendasEmp = vendas.filter(v => v.empreendimento_id === emp.id)
                  const pagamentosEmp = pagamentos.filter(p => vendasEmp.some(v => v.id === p.venda_id))
                  const totalVendasEmp = vendasEmp.length
                  const valorTotalVendas = vendasEmp.reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)
                  const comissaoTotal = pagamentosEmp.reduce((acc, p) => acc + (parseFloat(p.comissao_gerada) || 0), 0)
                  const comissaoPaga = pagamentosEmp.filter(p => p.status === 'pago').reduce((acc, p) => acc + (parseFloat(p.comissao_gerada) || 0), 0)
                  const comissaoPendente = comissaoTotal - comissaoPaga
                  
                  return (
                    <div key={emp.id} className="emp-premium-card">
                      {/* Imagem de Fachada */}
                      <div className="emp-card-image">
                        {emp.fachada_url ? (
                          <img src={emp.fachada_url} alt={emp.nome} />
                        ) : (
                          <div className="emp-card-image-placeholder">
                            <Building size={48} />
                            <span>Sem imagem</span>
                          </div>
                        )}
                        
                        {/* Logo no canto superior direito */}
                        {emp.logo_url && emp.logo_url.trim() !== '' && (
                          <div className="emp-card-logo">
                            <img 
                              src={emp.logo_url} 
                              alt={`Logo ${emp.nome}`}
                              onError={(e) => {
                                e.target.parentElement.style.display = 'none'
                              }}
                            />
                          </div>
                        )}
                        
                        {/* Nome do empreendimento - sempre visível */}
                        <span className="emp-card-name">{emp.nome}</span>
                        
                        {/* Badges no canto inferior direito */}
                        <div className="emp-card-badges">
                          {emp.sienge_enterprise_id && (
                            <span className="emp-status-badge sienge">Sienge</span>
                          )}
                          <span className="emp-status-badge active">Ativo</span>
                        </div>
                      </div>
                      
                      {/* Conteúdo do Card */}
                      <div className="emp-card-content">
                        {/* Unidades */}
                        <div className="emp-commission-rates">
                          <div className="emp-rate-box unidades">
                            <span className="emp-rate-label">Nº Unidades</span>
                            <span className="emp-rate-value">{emp.total_unidades || 0}</span>
                          </div>
                          <div className="emp-rate-box vendidas">
                            <span className="emp-rate-label">Vendidas</span>
                            <span className="emp-rate-value">{totalVendasEmp}</span>
                          </div>
                        </div>
                        
                        {/* Progresso da Obra */}
                        <div className="emp-progress-section">
                          <div className="emp-progress-header">
                            <span className="emp-progress-label">Progresso da Obra</span>
                            <span className="emp-progress-value">{emp.progresso_obra || 0}%</span>
                          </div>
                          <div className="emp-progress-bar">
                            <div 
                              className="emp-progress-fill"
                              style={{ width: `${emp.progresso_obra || 0}%` }}
                            />
                          </div>
                        </div>
                        
                        {/* Estatísticas */}
                        <div className="emp-card-stats">
                          <div className="emp-mini-stat">
                            <span className="emp-mini-stat-label">Vendas</span>
                            <span className="emp-mini-stat-value">{totalVendasEmp}</span>
                          </div>
                          <div className="emp-mini-stat">
                            <span className="emp-mini-stat-label">Volume</span>
                            <span className="emp-mini-stat-value gold">{formatCurrency(valorTotalVendas)}</span>
                          </div>
                          <div className="emp-mini-stat">
                            <span className="emp-mini-stat-label">Comissão Paga</span>
                            <span className="emp-mini-stat-value green">{formatCurrency(comissaoPaga)}</span>
                          </div>
                          <div className="emp-mini-stat">
                            <span className="emp-mini-stat-label">Pendente</span>
                            <span className="emp-mini-stat-value yellow">{formatCurrency(comissaoPendente)}</span>
                          </div>
                        </div>
                        
                        {/* Ações */}
                        <div className="emp-card-actions">
                          <button 
                            className="emp-action-btn view"
                            onClick={() => setEmpreendimentoVisualizar(emp)}
                            title="Visualizar detalhes"
                          >
                            <Eye size={16} />
                          </button>
                          <button 
                            className="emp-action-btn primary"
                            onClick={() => setGaleriaAberta(emp.id)}
                          >
                            <Camera size={16} />
                            Galeria
                          </button>
                          <button 
                            className="emp-action-btn secondary"
                            onClick={() => {
                              const cargosExt = emp.cargos?.filter(c => c.tipo_corretor === 'externo') || []
                              const cargosInt = emp.cargos?.filter(c => c.tipo_corretor === 'interno') || []
                              setSelectedItem(emp)
                              setEmpreendimentoForm({
                                nome: emp.nome,
                                descricao: emp.descricao || '',
                                total_unidades: emp.total_unidades?.toString() || '',
                                comissao_total_externo: emp.comissao_total_externo?.toString() || '7',
                                comissao_total_interno: emp.comissao_total_interno?.toString() || '6',
                                cargos_externo: cargosExt.length > 0 
                                  ? cargosExt.map(c => ({ nome_cargo: c.nome_cargo, percentual: c.percentual?.toString() || '' }))
                                  : [{ nome_cargo: '', percentual: '' }],
                                cargos_interno: cargosInt.length > 0 
                                  ? cargosInt.map(c => ({ nome_cargo: c.nome_cargo, percentual: c.percentual?.toString() || '' }))
                                  : [{ nome_cargo: '', percentual: '' }],
                                logo_url: emp.logo_url || '',
                                progresso_obra: emp.progresso_obra?.toString() || '0'
                              })
                              setModalType('empreendimento')
                              setShowModal(true)
                            }}
                          >
                            <Edit2 size={16} />
                          </button>
                          <button 
                            className="emp-action-btn danger"
                            onClick={() => handleDeleteEmpreendimento(emp)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              /* Visualização em Lista */
              <div className="empreendimentos-list-view">
                {filteredEmpreendimentos.map((emp) => {
                  const vendasEmp = vendas.filter(v => v.empreendimento_id === emp.id)
                  const totalVendasEmp = vendasEmp.length
                  const valorTotalVendas = vendasEmp.reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)
                  
                  return (
                    <div key={emp.id} className="emp-list-item">
                      <div className="emp-list-thumb">
                        {emp.fachada_url ? (
                          <img src={emp.fachada_url} alt={emp.nome} />
                        ) : emp.logo_url ? (
                          <img src={emp.logo_url} alt={emp.nome} style={{ objectFit: 'contain', padding: '10px' }} />
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                            <Building size={32} color="rgba(255,255,255,0.3)" />
                          </div>
                        )}
                      </div>
                      
                      <div className="emp-list-info">
                        <div className="emp-list-name">
                          {emp.nome}
                          {emp.sienge_enterprise_id && (
                            <span className="emp-status-badge sienge">Sienge</span>
                          )}
                        </div>
                        
                        <div className="emp-list-rates">
                          <span className="emp-list-rate externo">
                            <Percent size={14} />
                            Externo: {emp.comissao_total_externo || 7}%
                          </span>
                          <span className="emp-list-rate interno">
                            <Percent size={14} />
                            Interno: {emp.comissao_total_interno || 6}%
                          </span>
                        </div>
                        
                        <div className="emp-list-stats">
                          <span className="emp-list-stat">
                            Vendas: <strong>{totalVendasEmp}</strong>
                          </span>
                          <span className="emp-list-stat">
                            Volume: <strong style={{ color: '#c9a962' }}>{formatCurrency(valorTotalVendas)}</strong>
                          </span>
                        </div>
                      </div>
                      
                      <div className="emp-list-actions">
                        <button 
                          className="emp-action-btn view"
                          onClick={() => setEmpreendimentoVisualizar(emp)}
                          title="Visualizar"
                        >
                          <Eye size={16} />
                        </button>
                        <button 
                          className="emp-action-btn primary"
                          onClick={() => setGaleriaAberta(emp.id)}
                          title="Galeria"
                        >
                          <Camera size={16} />
                        </button>
                        <button 
                          className="emp-action-btn secondary"
                          onClick={() => {
                            const cargosExt = emp.cargos?.filter(c => c.tipo_corretor === 'externo') || []
                            const cargosInt = emp.cargos?.filter(c => c.tipo_corretor === 'interno') || []
                            setSelectedItem(emp)
                            setEmpreendimentoForm({
                              nome: emp.nome,
                              descricao: emp.descricao || '',
                              total_unidades: emp.total_unidades?.toString() || '',
                              comissao_total_externo: emp.comissao_total_externo?.toString() || '7',
                              comissao_total_interno: emp.comissao_total_interno?.toString() || '6',
                              cargos_externo: cargosExt.length > 0 
                                ? cargosExt.map(c => ({ nome_cargo: c.nome_cargo, percentual: c.percentual?.toString() || '' }))
                                : [{ nome_cargo: '', percentual: '' }],
                              cargos_interno: cargosInt.length > 0 
                                ? cargosInt.map(c => ({ nome_cargo: c.nome_cargo, percentual: c.percentual?.toString() || '' }))
                                : [{ nome_cargo: '', percentual: '' }],
                              logo_url: emp.logo_url || '',
                              progresso_obra: emp.progresso_obra?.toString() || '0'
                            })
                            setModalType('empreendimento')
                            setShowModal(true)
                          }}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          className="emp-action-btn danger"
                          onClick={() => handleDeleteEmpreendimento(emp)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            
            {/* Modal de Galeria */}
            {galeriaAberta && (
              <div className="modal-overlay" onClick={() => setGaleriaAberta(null)}>
                <div className="modal-content galeria-modal" onClick={(e) => e.stopPropagation()}>
                  <EmpreendimentoGaleria 
                    empreendimentoId={galeriaAberta}
                    onClose={() => setGaleriaAberta(null)}
                  />
                </div>
              </div>
            )}

            {/* Modal de Visualização do Empreendimento */}
            {empreendimentoVisualizar && (
              <div className="modal-overlay" onClick={() => setEmpreendimentoVisualizar(null)}>
                <div className="modal-content emp-view-modal" onClick={(e) => e.stopPropagation()}>
                  <button 
                    className="modal-close-btn"
                    onClick={() => setEmpreendimentoVisualizar(null)}
                  >
                    <X size={24} />
                  </button>
                  
                  {/* Header com Fachada */}
                  <div className="emp-view-header">
                    {empreendimentoVisualizar.fachada_url ? (
                      <img 
                        src={empreendimentoVisualizar.fachada_url} 
                        alt={empreendimentoVisualizar.nome}
                        className="emp-view-fachada"
                      />
                    ) : (
                      <div className="emp-view-no-image">
                        <Building size={80} />
                        <span>Sem imagem de fachada</span>
                      </div>
                    )}
                    <div className="emp-view-header-overlay">
                      {empreendimentoVisualizar.logo_url && (
                        <img 
                          src={empreendimentoVisualizar.logo_url} 
                          alt={`Logo ${empreendimentoVisualizar.nome}`}
                          className="emp-view-logo"
                        />
                      )}
                      <h2 className="emp-view-title">{empreendimentoVisualizar.nome}</h2>
                      <div className="emp-view-badges">
                        {empreendimentoVisualizar.sienge_enterprise_id && (
                          <span className="emp-badge sienge">Integrado Sienge</span>
                        )}
                        <span className="emp-badge active">Ativo</span>
                      </div>
                    </div>
                  </div>

                  {/* Conteúdo */}
                  <div className="emp-view-content">
                    {/* Descrição */}
                    {empreendimentoVisualizar.descricao && (
                      <div className="emp-view-section">
                        <h3>Descrição</h3>
                        <p>{empreendimentoVisualizar.descricao}</p>
                      </div>
                    )}

                    {/* Unidades */}
                    <div className="emp-view-section">
                      <h3>Unidades</h3>
                      <div className="emp-view-comissoes">
                        <div className="emp-view-comissao-box">
                          <span className="label">Total de Unidades</span>
                          <span className="value">{empreendimentoVisualizar.total_unidades || 0}</span>
                        </div>
                        <div className="emp-view-comissao-box">
                          <span className="label">Unidades Vendidas</span>
                          <span className="value green">{vendas.filter(v => v.empreendimento_id === empreendimentoVisualizar.id).length}</span>
                        </div>
                      </div>
                    </div>

                    {/* Comissões */}
                    <div className="emp-view-section">
                      <h3>Comissões</h3>
                      <div className="emp-view-comissoes">
                        <div className="emp-view-comissao-box">
                          <span className="label">Corretor Externo</span>
                          <span className="value">{empreendimentoVisualizar.comissao_total_externo || 7}%</span>
                        </div>
                        <div className="emp-view-comissao-box">
                          <span className="label">Corretor Interno</span>
                          <span className="value green">{empreendimentoVisualizar.comissao_total_interno || 6}%</span>
                        </div>
                      </div>
                    </div>

                    {/* Cargos */}
                    {empreendimentoVisualizar.cargos && empreendimentoVisualizar.cargos.length > 0 && (
                      <div className="emp-view-section">
                        <h3>Distribuição de Comissões por Cargo</h3>
                        <div className="emp-view-cargos-grid">
                          <div className="emp-view-cargos-col">
                            <h4>Externos</h4>
                            {empreendimentoVisualizar.cargos
                              .filter(c => c.tipo_corretor === 'externo')
                              .map((cargo, idx) => (
                                <div key={idx} className="emp-view-cargo-item">
                                  <span>{cargo.nome_cargo}</span>
                                  <span className="cargo-percent">{cargo.percentual}%</span>
                                </div>
                              ))}
                          </div>
                          <div className="emp-view-cargos-col">
                            <h4>Internos</h4>
                            {empreendimentoVisualizar.cargos
                              .filter(c => c.tipo_corretor === 'interno')
                              .map((cargo, idx) => (
                                <div key={idx} className="emp-view-cargo-item">
                                  <span>{cargo.nome_cargo}</span>
                                  <span className="cargo-percent green">{cargo.percentual}%</span>
                                </div>
                              ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Estatísticas */}
                    <div className="emp-view-section">
                      <h3>Estatísticas</h3>
                      {(() => {
                        const vendasEmp = vendas.filter(v => v.empreendimento_id === empreendimentoVisualizar.id)
                        const vendasIds = new Set(vendasEmp.map(v => v.id))
                        const pagamentosEmp = pagamentos.filter(p => vendasIds.has(p.venda_id))
                        const totalVendas = vendasEmp.length
                        const valorTotal = vendasEmp.reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)
                        const comissaoPaga = pagamentosEmp
                          .filter(p => p.status === 'pago')
                          .reduce((acc, p) => acc + (parseFloat(p.comissao_gerada) || 0), 0)
                        const comissaoPendente = pagamentosEmp
                          .filter(p => p.status === 'pendente')
                          .reduce((acc, p) => acc + (parseFloat(p.comissao_gerada) || 0), 0)
                        const corretoresEmp = [...new Set(vendasEmp.map(v => v.corretor_id))].length

                        return (
                          <div className="emp-view-stats">
                            <div className="emp-view-stat">
                              <TrendingUp size={20} />
                              <div>
                                <span className="stat-value">{totalVendas}</span>
                                <span className="stat-label">Vendas</span>
                              </div>
                            </div>
                            <div className="emp-view-stat">
                              <DollarSign size={20} />
                              <div>
                                <span className="stat-value">{formatCurrency(valorTotal)}</span>
                                <span className="stat-label">Volume Total</span>
                              </div>
                            </div>
                            <div className="emp-view-stat">
                              <CheckCircle size={20} />
                              <div>
                                <span className="stat-value green">{formatCurrency(comissaoPaga)}</span>
                                <span className="stat-label">Comissão Paga</span>
                              </div>
                            </div>
                            <div className="emp-view-stat">
                              <Clock size={20} />
                              <div>
                                <span className="stat-value yellow">{formatCurrency(comissaoPendente)}</span>
                                <span className="stat-label">Comissão Pendente</span>
                              </div>
                            </div>
                            <div className="emp-view-stat">
                              <Users size={20} />
                              <div>
                                <span className="stat-value">{corretoresEmp}</span>
                                <span className="stat-label">Corretores</span>
                              </div>
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  </div>

                  {/* Footer com ações */}
                  <div className="emp-view-footer">
                    <button 
                      className="emp-view-btn secondary"
                      onClick={() => {
                        setEmpreendimentoVisualizar(null)
                        setGaleriaAberta(empreendimentoVisualizar.id)
                      }}
                    >
                      <Camera size={18} />
                      Ver Galeria
                    </button>
                    <button 
                      className="emp-view-btn primary"
                      onClick={() => {
                        const emp = empreendimentoVisualizar
                        const cargosExt = emp.cargos?.filter(c => c.tipo_corretor === 'externo') || []
                        const cargosInt = emp.cargos?.filter(c => c.tipo_corretor === 'interno') || []
                        setSelectedItem(emp)
                        setEmpreendimentoForm({
                          nome: emp.nome,
                          descricao: emp.descricao || '',
                          total_unidades: emp.total_unidades?.toString() || '',
                          comissao_total_externo: emp.comissao_total_externo?.toString() || '7',
                          comissao_total_interno: emp.comissao_total_interno?.toString() || '6',
                          cargos_externo: cargosExt.length > 0 
                            ? cargosExt.map(c => ({ nome_cargo: c.nome_cargo, percentual: c.percentual?.toString() || '' }))
                            : [{ nome_cargo: '', percentual: '' }],
                          cargos_interno: cargosInt.length > 0 
                            ? cargosInt.map(c => ({ nome_cargo: c.nome_cargo, percentual: c.percentual?.toString() || '' }))
                            : [{ nome_cargo: '', percentual: '' }],
                          logo_url: emp.logo_url || '',
                          progresso_obra: emp.progresso_obra?.toString() || '0'
                        })
                        setEmpreendimentoVisualizar(null)
                        setModalType('empreendimento')
                        setShowModal(true)
                      }}
                    >
                      <Edit2 size={18} />
                      Editar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'pagamentos' && (
          <div className="content-section">
            {/* Filtros de Pagamentos */}
            <div className="filters-section">
              <div className="search-box">
                <Search size={20} />
                <input 
                  type="text" 
                  placeholder="Buscar por corretor, empreendimento, cliente..."
                  value={filtrosPagamentos.buscaVenda}
                  onChange={(e) => setFiltrosPagamentos({...filtrosPagamentos, buscaVenda: e.target.value})}
                />
              </div>
              
              {/* Filtros em Grid */}
              <div className="filters-grid">
                <div className="filter-item">
                  <label className="filter-label">Status</label>
                  <select 
                    value={filtrosPagamentos.status} 
                    onChange={(e) => setFiltrosPagamentos({...filtrosPagamentos, status: e.target.value})}
                    className="filter-select"
                  >
                    <option value="todos">Todos</option>
                    <option value="pendente">Pendente</option>
                    <option value="pago">Pago</option>
                  </select>
                </div>
                
                <div className="filter-item">
                  <label className="filter-label">Tipo de Pagamento</label>
                  <select 
                    value={filtrosPagamentos.tipo} 
                    onChange={(e) => setFiltrosPagamentos({...filtrosPagamentos, tipo: e.target.value})}
                    className="filter-select"
                  >
                    <option value="todos">Todos</option>
                    <option value="sinal">Sinal</option>
                    <option value="entrada">Entrada</option>
                    <option value="parcela_entrada">Parcela Entrada</option>
                    <option value="balao">Balão</option>
                  </select>
                </div>
                
                <div className="filter-item">
                  <label className="filter-label">Corretor</label>
                  <select 
                    value={filtrosPagamentos.corretor} 
                    onChange={(e) => setFiltrosPagamentos({...filtrosPagamentos, corretor: e.target.value})}
                    className="filter-select"
                  >
                    <option value="">Todos</option>
                    {corretoresOrdenados.map(c => (
                      <option key={c.id} value={c.id}>{formatNome(c.nome)}</option>
                    ))}
                  </select>
                </div>
                
                <div className="filter-item">
                  <label className="filter-label">Empreendimento</label>
                  <select 
                    value={filtrosPagamentos.empreendimento} 
                    onChange={(e) => setFiltrosPagamentos({...filtrosPagamentos, empreendimento: e.target.value})}
                    className="filter-select"
                  >
                    <option value="">Todos</option>
                    {[...empreendimentos].sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR')).map(e => (
                      <option key={e.id} value={e.id}>{e.nome}</option>
                    ))}
                  </select>
                </div>
                
                <div className="filter-item">
                  <label className="filter-label">Cliente</label>
                  <select 
                    value={filtrosPagamentos.cliente} 
                    onChange={(e) => setFiltrosPagamentos({...filtrosPagamentos, cliente: e.target.value})}
                    className="filter-select"
                  >
                    <option value="">Todos</option>
                    {clientesOrdenados.map(c => (
                      <option key={c.id} value={c.id}>{formatNome(c.nome_completo)}</option>
                    ))}
                  </select>
                </div>
                
                <div className="filter-item">
                  <label className="filter-label">Unidade</label>
                  <input 
                    type="text"
                    placeholder="Ex: 101, 202..."
                    value={filtrosPagamentos.unidade}
                    onChange={(e) => setFiltrosPagamentos({...filtrosPagamentos, unidade: e.target.value})}
                    className="filter-input-date"
                    style={{ color: '#fff' }}
                  />
                </div>
                
                <div className="filter-item">
                  <label className="filter-label">Data Início</label>
                  <input 
                    type="date"
                    value={filtrosPagamentos.dataInicio}
                    onChange={(e) => setFiltrosPagamentos({...filtrosPagamentos, dataInicio: e.target.value})}
                    className="filter-input-date"
                  />
                </div>
                
                <div className="filter-item">
                  <label className="filter-label">Data Fim</label>
                  <input 
                    type="date"
                    value={filtrosPagamentos.dataFim}
                    onChange={(e) => setFiltrosPagamentos({...filtrosPagamentos, dataFim: e.target.value})}
                    className="filter-input-date"
                  />
                </div>
              </div>
              
              <button
                className="btn-clear-filters"
                onClick={() => {
                  setFiltrosPagamentos({
                    status: 'todos',
                    corretor: '',
                    empreendimento: '',
                    cliente: '',
                    unidade: '',
                    tipo: 'todos',
                    dataInicio: '',
                    dataFim: '',
                    buscaVenda: ''
                  })
                }}
              >
                <X size={16} />
                Limpar Filtros
              </button>
            </div>
            
            {/* Aviso de vendas sem pagamentos */}
            {vendasSemPagamentos.length > 0 && (
              <div className="alert-box warning" style={{
                background: 'rgba(234, 179, 8, 0.1)',
                border: '1px solid rgba(234, 179, 8, 0.3)',
                borderRadius: '12px',
                padding: '16px 20px',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Clock size={24} style={{ color: '#eab308' }} />
                  <div>
                    <strong style={{ color: '#eab308' }}>
                      {vendasSemPagamentos.length} venda(s) sem pagamentos cadastrados
                    </strong>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'rgba(255,255,255,0.7)' }}>
                      Essas vendas precisam ter os pagamentos gerados para aparecerem aqui
                    </p>
                  </div>
                </div>
                <button
                  onClick={gerarTodosPagamentos}
                  disabled={saving}
                  style={{
                    background: '#eab308',
                    color: '#000',
                    border: 'none',
                    padding: '10px 20px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '14px',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {saving ? 'Gerando...' : 'Gerar Pagamentos'}
                </button>
              </div>
            )}

            {pagamentos.length === 0 && vendasSemPagamentos.length === 0 ? (
              <div className="empty-state-box">
                <CreditCard size={48} />
                <h3>Nenhum pagamento cadastrado</h3>
                <p>Os pagamentos são criados automaticamente ao registrar uma venda</p>
              </div>
            ) : pagamentos.length === 0 ? (
              <div className="empty-state-box">
                <CreditCard size={48} />
                <h3>Nenhum pagamento gerado ainda</h3>
                <p>Clique no botão acima para gerar os pagamentos das vendas existentes</p>
              </div>
            ) : (
              <>
                {/* Resumo - Usar filteredPagamentos para refletir os filtros */}
                <div className="pagamentos-resumo">
                  <div className="resumo-card">
                    <span className="resumo-label">Comissão Pendente</span>
                    <span className="resumo-valor pendente">
                      {formatCurrency(filteredPagamentos.reduce((acc, grupo) => {
                        return acc + grupo.pagamentos.reduce((sum, pag) => {
                          if (pag.status === 'pendente') {
                            return sum + (parseFloat(pag.comissao_gerada) || 0)
                          }
                          return sum
                        }, 0)
                      }, 0))}
                    </span>
                  </div>
                  <div className="resumo-card">
                    <span className="resumo-label">Comissão Paga</span>
                    <span className="resumo-valor pago">
                      {formatCurrency(filteredPagamentos.reduce((acc, grupo) => {
                        return acc + grupo.pagamentos
                          .filter(p => p.status === 'pago')
                          .reduce((sum, pag) => sum + (parseFloat(pag.comissao_gerada) || 0), 0)
                      }, 0))}
                    </span>
                  </div>
                  <div className="resumo-card">
                    <span className="resumo-label">Comissão Total</span>
                    <span className="resumo-valor">
                      {formatCurrency(filteredPagamentos.reduce((acc, grupo) => {
                        // Calcular comissão total baseada nos pagamentos filtrados
                        return acc + grupo.pagamentos.reduce((sum, pag) => {
                          return sum + (parseFloat(pag.comissao_gerada) || 0)
                        }, 0)
                      }, 0))}
                    </span>
                  </div>
                </div>

                {/* Toggle Visão: Contrato / Calendário */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px', gap: '4px' }}>
                  <button
                    onClick={() => setVisaoParcelas('contrato')}
                    style={{
                      padding: '5px 14px',
                      fontSize: '12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      border: visaoParcelas === 'contrato' ? '1px solid #c9a962' : '1px solid rgba(255,255,255,0.15)',
                      background: visaoParcelas === 'contrato' ? '#c9a962' : 'transparent',
                      color: visaoParcelas === 'contrato' ? '#000' : 'rgba(255,255,255,0.7)',
                      fontWeight: visaoParcelas === 'contrato' ? 600 : 400,
                      transition: 'all 0.2s'
                    }}
                  >
                    Contrato
                  </button>
                  <button
                    onClick={() => setVisaoParcelas('calendario')}
                    style={{
                      padding: '5px 14px',
                      fontSize: '12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      border: visaoParcelas === 'calendario' ? '1px solid #c9a962' : '1px solid rgba(255,255,255,0.15)',
                      background: visaoParcelas === 'calendario' ? '#c9a962' : 'transparent',
                      color: visaoParcelas === 'calendario' ? '#000' : 'rgba(255,255,255,0.7)',
                      fontWeight: visaoParcelas === 'calendario' ? 600 : 400,
                      transition: 'all 0.2s'
                    }}
                  >
                    <Calendar size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Calendário
                  </button>
                </div>

                {/* Vendas Agrupadas */}
                <div className="vendas-pagamentos-lista">
                  {filteredPagamentos.length === 0 ? (
                    <div className="empty-state-box">
                      <CreditCard size={48} />
                      <h3>Nenhum pagamento encontrado</h3>
                      <p>Não há pagamentos que correspondam aos filtros selecionados</p>
                    </div>
                  ) : (
                    filteredPagamentos.map((grupo) => (
                    <div key={grupo.venda_id} className="venda-pagamento-card">
                      {/* Header da Venda - Clicável */}
                      <div 
                        className={`venda-pagamento-header ${vendaExpandida === grupo.venda_id ? 'expanded' : ''}`}
                        onClick={() => setVendaExpandida(vendaExpandida === grupo.venda_id ? null : grupo.venda_id)}
                      >
                        <div className="venda-info">
                          <div className="venda-titulo">
                            <Building size={18} />
                            <strong>{grupo.venda?.empreendimento?.nome || 'Empreendimento'}</strong>
                          </div>
                          <div className="venda-subtitulo">
                            <User size={14} />
                            <span>{grupo.venda?.corretor?.nome || 'Corretor'}</span>
                            <span className="separator">•</span>
                            <span>{grupo.venda?.cliente?.nome || grupo.venda?.nome_cliente || 'Cliente'}</span>
                            <span className="separator">•</span>
                            <span>Unidade: {grupo.venda?.unidade || '-'}</span>
                            <span className="separator">•</span>
                            <span>{grupo.pagamentos.length} parcelas</span>
                          </div>
                        </div>
                        <div className="venda-valores">
                          <div className="valor-item">
                            <span className="valor-label">Pro-Soluto</span>
                            <span className="valor-number">{formatCurrency(grupo.totalValor)}</span>
                          </div>
                          <div className="valor-item">
                            <span className="valor-label">Comissão Total</span>
                            <span className="valor-number comissao">{formatCurrency(
                              grupo.pagamentos.reduce((sum, p) => sum + (parseFloat(p.comissao_gerada) || 0), 0)
                            )}</span>
                          </div>
                          <div className="valor-item">
                            <span className="valor-label">Comissão Paga</span>
                            <span className="valor-number pago">{formatCurrency(
                              grupo.pagamentos
                                .filter(p => p.status === 'pago')
                                .reduce((sum, p) => sum + (parseFloat(p.comissao_gerada) || 0), 0)
                            )}</span>
                          </div>
                          <div className="valor-item">
                            <span className="valor-label">Comissão Pendente</span>
                            <span className="valor-number pendente">{formatCurrency(
                              grupo.pagamentos.reduce((sum, pag) => {
                                if (pag.status === 'pendente') {
                                  return sum + (parseFloat(pag.comissao_gerada) || 0)
                                }
                                return sum
                              }, 0)
                            )}</span>
                          </div>
                        </div>
                        <div className="header-actions-pagamento" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button 
                            className="action-btn view"
                            onClick={(e) => {
                              e.stopPropagation() // Impedir expansão ao clicar
                              const vendaCompleta = vendas.find(v => v.id === grupo.venda_id) || grupo.venda
                              setSelectedItem(vendaCompleta)
                              setModalType('visualizar-venda')
                              setShowModal(true)
                              fetchPagamentosVisualizacao(grupo.venda_id)
                            }}
                            title="Visualizar Venda"
                            style={{ 
                              background: 'rgba(59, 130, 246, 0.1)',
                              border: '1px solid rgba(59, 130, 246, 0.3)',
                              color: '#c9a962',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '12px'
                            }}
                          >
                            <Eye size={14} />
                            Ver
                          </button>
                          <div className="expand-icon">
                            <ChevronDown size={20} className={vendaExpandida === grupo.venda_id ? 'rotated' : ''} />
                          </div>
                        </div>
                      </div>

                      {/* Lista de Parcelas - Expandível */}
                      {vendaExpandida === grupo.venda_id && (
                        <div className="venda-pagamento-body">
                          {sortParcelas(grupo.pagamentos, visaoParcelas)
                            .map((pag) => (
                            <div key={pag.id} className={`parcela-row ${pag.status === 'pago' ? 'pago' : ''}`}>
                              <div className="parcela-main">
                                <div className="parcela-tipo">
                                  {pag.tipo === 'sinal' && 'Sinal'}
                                  {pag.tipo === 'entrada' && 'Entrada'}
                                  {pag.tipo === 'parcela_entrada' && `Parcela ${pag.numero_parcela}`}
                                  {pag.tipo === 'balao' && `Balão ${pag.numero_parcela || ''}`}
                                  {pag.tipo === 'comissao_integral' && '✨ Comissão Integral'}
                                </div>
                                <div className="parcela-data">{formatDataBR(pag.data_prevista)}</div>
                                <div className="parcela-valor">{formatCurrency(pag.valor)}</div>
                                <div className="parcela-status">
                                  <span className={`status-pill ${pag.status}`}>
                                    {pag.status === 'pago' ? 'Pago' : 'Pendente'}
                                  </span>
                                </div>
                                <div className="parcela-acao">
                                  <button 
                                    className="btn-ver-detalhe"
                                    onClick={(e) => { e.stopPropagation(); setPagamentoDetalhe(pag); }}
                                    title="Ver detalhes"
                                  >
                                    <Eye size={14} />
                                    Ver
                                  </button>
                                  {pag.status !== 'pago' ? (
                                    <button 
                                      className="btn-small-confirm"
                                      onClick={(e) => { e.stopPropagation(); confirmarPagamento(pag); }}
                                    >
                                      Confirmar
                                    </button>
                                  ) : (
                                    <>
                                      <button 
                                        className="btn-ver-detalhe"
                                        onClick={(e) => { e.stopPropagation(); editarBaixa(pag); }}
                                        title="Editar baixa"
                                      >
                                        <Edit2 size={14} />
                                        Editar
                                      </button>
                                      <button 
                                        className="btn-small-danger"
                                        onClick={(e) => { e.stopPropagation(); excluirBaixa(pag); }}
                                        title="Reverter baixa"
                                      >
                                        <Trash2 size={14} />
                                        Excluir
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="parcela-comissoes">
                                {calcularComissaoPorCargoPagamento(pag).map((cargo, idx) => {
                                  const valorParcela = parseFloat(pag.valor) || 0
                                  const percentualFator = valorParcela > 0 ? ((cargo.valor / valorParcela) * 100) : 0
                                  const percentualNominal = parseFloat(cargo.percentual) || 0

                                  return (
                                    <div key={idx} className="comissao-item">
                                      <span className="comissao-nome">
                                        {cargo.nome_cargo}
                                        {percentualNominal > 0 && (
                                          <span className="comissao-percentual-cargo"> ({percentualNominal.toFixed(2)}%)</span>
                                        )}
                                      </span>
                                      <span className="comissao-valor">
                                        {formatCurrency(cargo.valor)}
                                        <span
                                          className="comissao-percentual"
                                          title={`Fator aplicado na parcela: ${percentualFator.toFixed(2)}% do valor. Percentual nominal do cargo: ${percentualNominal.toFixed(2)}%.`}
                                        >
                                          fator {percentualFator.toFixed(2)}%
                                        </span>
                                      </span>
                                    </div>
                                  )
                                })}
                                <div className="comissao-item comissao-total">
                                  <span className="comissao-nome">Total</span>
                                  <span className="comissao-valor">{formatCurrency(calcularComissaoTotalPagamento(pag))}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    ))
                  )}
                </div>

                {/* Modal de Detalhes do Pagamento */}
                {pagamentoDetalhe && (
                  <div className="modal-overlay" onClick={() => setPagamentoDetalhe(null)}>
                    <div className="modal detalhe-pagamento-modal" onClick={e => e.stopPropagation()}>
                      <div className="modal-header">
                        <h2>Divisão de Comissões</h2>
                        <button className="close-btn" onClick={() => setPagamentoDetalhe(null)}>
                          <X size={24} />
                        </button>
                      </div>
                      <div className="modal-body">
                        {/* Info do Pagamento */}
                        <div className="detalhe-info">
                          <div className="detalhe-row">
                            <span className="label">Empreendimento:</span>
                            <span className="value">{pagamentoDetalhe.venda?.empreendimento?.nome || 'N/A'}</span>
                          </div>
                          <div className="detalhe-row">
                            <span className="label">Corretor:</span>
                            <span className="value">{pagamentoDetalhe.venda?.corretor?.nome || 'N/A'}</span>
                          </div>
                          <div className="detalhe-row">
                            <span className="label">Tipo:</span>
                            <span className="value">
                              {pagamentoDetalhe.tipo === 'sinal' && 'Sinal'}
                              {pagamentoDetalhe.tipo === 'entrada' && 'Entrada'}
                              {pagamentoDetalhe.tipo === 'parcela_entrada' && `Parcela de Entrada ${pagamentoDetalhe.numero_parcela}`}
                              {pagamentoDetalhe.tipo === 'balao' && (pagamentoDetalhe.numero_parcela ? `Balão ${pagamentoDetalhe.numero_parcela}` : 'Balão')}
                              {pagamentoDetalhe.tipo === 'comissao_integral' && '✨ Comissão Integral (Entrada ≥ 20%)'}
                            </span>
                          </div>
                          <div className="detalhe-row highlight">
                            <span className="label">Valor do Pagamento:</span>
                            <span className="value">{formatCurrency(pagamentoDetalhe.valor)}</span>
                          </div>
                          <div className="detalhe-row highlight">
                            <span className="label">Comissão Total:</span>
                            <span className="value comissao">{formatCurrency(calcularComissaoTotalPagamento(pagamentoDetalhe))}</span>
                          </div>
                        </div>

                        {/* Divisão por Cargo */}
                        <div className="divisao-cargos">
                          <h3>Divisão por Beneficiário</h3>
                          <table className="tabela-divisao">
                            <thead>
                              <tr>
                                <th>Beneficiário</th>
                                <th>%</th>
                                <th>Valor</th>
                              </tr>
                            </thead>
                            <tbody>
                              {calcularComissaoPorCargoPagamento(pagamentoDetalhe).map((cargo, idx) => {
                                const valorParcela = parseFloat(pagamentoDetalhe.valor) || 0
                                const percentualFator = valorParcela > 0 ? ((cargo.valor / valorParcela) * 100) : 0
                                
                                return (
                                  <tr key={idx}>
                                    <td>{cargo.nome_cargo}</td>
                                    <td>{percentualFator.toFixed(2)}%</td>
                                    <td className="valor-comissao">{formatCurrency(cargo.valor)}</td>
                                  </tr>
                                )
                              })}
                              {calcularComissaoPorCargoPagamento(pagamentoDetalhe).length === 0 && (
                                <tr>
                                  <td colSpan="3" style={{ textAlign: 'center', color: '#999' }}>
                                    Sem cargos cadastrados para este empreendimento
                                  </td>
                                </tr>
                              )}
                            </tbody>
                            <tfoot>
                              <tr className="total-row">
                                <td><strong>TOTAL</strong></td>
                                <td>-</td>
                                <td className="valor-comissao"><strong>{formatCurrency(calcularComissaoTotalPagamento(pagamentoDetalhe))}</strong></td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Modal de Confirmação de Pagamento */}
                {showModalConfirmarPagamento && pagamentoParaConfirmar && (
                  <div className="modal-overlay" onClick={() => setShowModalConfirmarPagamento(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                      <div className="modal-header">
                        <h2>{pagamentoParaConfirmar.status === 'pago' ? 'Editar Baixa' : 'Confirmar Pagamento'}</h2>
                        <button className="close-btn" onClick={() => setShowModalConfirmarPagamento(false)}>
                          <X size={24} />
                        </button>
                      </div>
                      <div className="modal-body">
                        {/* Informações do Pagamento */}
                        <div className="form-section">
                          <h3>Informações da Parcela</h3>
                          <div className="info-row">
                            <span className="label">Tipo:</span>
                            <span className="value">
                              {pagamentoParaConfirmar.tipo === 'sinal' && 'Sinal'}
                              {pagamentoParaConfirmar.tipo === 'entrada' && 'Entrada'}
                              {pagamentoParaConfirmar.tipo === 'parcela_entrada' && `Parcela de Entrada ${pagamentoParaConfirmar.numero_parcela}`}
                              {pagamentoParaConfirmar.tipo === 'balao' && (pagamentoParaConfirmar.numero_parcela ? `Balão ${pagamentoParaConfirmar.numero_parcela}` : 'Balão')}
                              {pagamentoParaConfirmar.tipo === 'comissao_integral' && '✨ Comissão Integral (Entrada ≥ 20%)'}
                            </span>
                          </div>
                          <div className="info-row">
                            <span className="label">Valor da Parcela:</span>
                            <span className="value">{formatCurrency(pagamentoParaConfirmar.valor)}</span>
                          </div>
                          <div className="info-row">
                            <span className="label">Data Prevista:</span>
                            <span className="value">
                              {formatDataBR(pagamentoParaConfirmar.data_prevista)}
                            </span>
                          </div>
                        </div>

                        {/* Data em que o pagamento foi feito */}
                        <div className="form-section">
                          <label>
                            <span>Data em que o pagamento foi feito</span>
                            <input
                              type="date"
                              value={formConfirmarPagamento.dataPagamento}
                              onChange={(e) => setFormConfirmarPagamento({...formConfirmarPagamento, dataPagamento: e.target.value})}
                            />
                            <small>Pode ser antes ou depois da data prevista</small>
                          </label>
                        </div>

                        {/* Comissão que tem que ser paga */}
                        <div className="form-section">
                          <div className="info-row highlight">
                            <span className="label">Comissão que tem que ser paga:</span>
                            <span className="value highlight">{formatCurrency(pagamentoParaConfirmar.comissao_gerada || 0)}</span>
                          </div>
                        </div>

                        {/* Valor a Personalizar */}
                        <div className="form-section">
                          <label>
                            <span>Valor a Personalizar (opcional)</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="Deixe vazio para usar o valor padrão"
                              value={formConfirmarPagamento.valorPersonalizado}
                              onChange={(e) => setFormConfirmarPagamento({...formConfirmarPagamento, valorPersonalizado: e.target.value})}
                            />
                            <small>Se preenchido, este valor será usado ao invés do valor padrão da comissão</small>
                          </label>
                        </div>

                        {/* Resumo */}
                        <div className="form-section summary">
                          <h3>Resumo</h3>
                          <div className="info-row">
                            <span className="label">Valor da Comissão a Confirmar:</span>
                            <span className="value highlight">
                              {formatCurrency(
                                formConfirmarPagamento.valorPersonalizado
                                  ? parseFloat(formConfirmarPagamento.valorPersonalizado) || 0
                                  : (pagamentoParaConfirmar.comissao_gerada || 0)
                              )}
                            </span>
                          </div>
                        </div>

                        <div className="modal-actions">
                          <button
                            className="btn-secondary"
                            onClick={() => setShowModalConfirmarPagamento(false)}
                            disabled={confirmandoPagamento}
                          >
                            Cancelar
                          </button>
                          <button
                            className="btn-primary"
                            onClick={processarConfirmarPagamento}
                            disabled={confirmandoPagamento}
                          >
                            {confirmandoPagamento ? (
                              <>
                                <span className="btn-spinner"></span>
                                {pagamentoParaConfirmar.status === 'pago' ? 'Salvando...' : 'Confirmando...'}
                              </>
                            ) : (
                              pagamentoParaConfirmar.status === 'pago' ? 'Salvar Alterações' : 'Confirmar Pagamento'
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Modal de Excluir/Reverter Baixa */}
                {showModalExcluirBaixa && pagamentoParaExcluir && (
                  <div className="modal-overlay" onClick={() => setShowModalExcluirBaixa(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                      <div className="modal-header">
                        <h2>Reverter Baixa</h2>
                        <button className="close-btn" onClick={() => setShowModalExcluirBaixa(false)}>
                          <X size={24} />
                        </button>
                      </div>
                      <div className="modal-body">
                        <p>
                          Tem certeza que deseja reverter esta baixa? A parcela voltará ao status <strong>Pendente</strong> e a data de pagamento será removida.
                        </p>
                        <div className="modal-actions">
                          <button
                            className="btn-secondary"
                            onClick={() => setShowModalExcluirBaixa(false)}
                            disabled={excluindoBaixa}
                          >
                            Cancelar
                          </button>
                          <button
                            className="btn-danger"
                            onClick={processarExcluirBaixa}
                            disabled={excluindoBaixa}
                          >
                            {excluindoBaixa ? (
                              <>
                                <span className="btn-spinner"></span>
                                Revertendo...
                              </>
                            ) : (
                              'Reverter Baixa'
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'clientes' && (
          <div className="content-section">
            {/* Filtros de Clientes */}
            <div className="filters-section">
              <div className="search-box">
                <Search size={20} />
                <input 
                  type="text" 
                  placeholder="Buscar por nome, CPF, email, telefone, profissão..."
                  value={filtrosClientes.busca}
                  onChange={(e) => setFiltrosClientes({...filtrosClientes, busca: e.target.value})}
                />
              </div>
              
              {/* Filtros em Grid */}
              <div className="filters-grid">
                <div className="filter-item">
                  <label className="filter-label">
                    <Filter size={16} />
                    FGTS (3+ anos)
                  </label>
                  <select 
                    value={filtrosClientes.possuiFgts} 
                    onChange={(e) => setFiltrosClientes({...filtrosClientes, possuiFgts: e.target.value})}
                    className="filter-select"
                  >
                    <option value="todos">Todos</option>
                    <option value="sim">Sim</option>
                    <option value="nao">Não</option>
                  </select>
                </div>
                
                <div className="filter-item">
                  <label className="filter-label">Complemento de Renda</label>
                  <select 
                    value={filtrosClientes.temComplemento} 
                    onChange={(e) => setFiltrosClientes({...filtrosClientes, temComplemento: e.target.value})}
                    className="filter-select"
                  >
                    <option value="todos">Todos</option>
                    <option value="sim">Sim</option>
                    <option value="nao">Não</option>
                  </select>
                </div>
              </div>
              
              {(filtrosClientes.busca || filtrosClientes.possuiFgts !== 'todos' || filtrosClientes.temComplemento !== 'todos') && (
                <button
                  className="btn-clear-filters"
                  onClick={() => setFiltrosClientes({ busca: '', possuiFgts: 'todos', temComplemento: 'todos' })}
                >
                  <X size={16} />
                  Limpar Filtros
                </button>
              )}
            </div>

            {filteredClientes.length === 0 ? (
              <div className="empty-state-box">
                <UserCircle size={48} />
                <h3>{clientes.length === 0 ? 'Nenhum cliente cadastrado' : 'Nenhum cliente encontrado'}</h3>
                <p>{clientes.length === 0 ? 'Clique em "Novo Cliente" para adicionar' : 'Tente ajustar os filtros'}</p>
              </div>
            ) : (
              <div className="clientes-grid">
                {filteredClientes.map((cliente) => (
                  <div key={cliente.id} className="cliente-card">
                    <div className="cliente-header">
                      <div className="cliente-avatar">
                        <UserCircle size={40} />
                      </div>
                      <div className="cliente-info">
                        <h3>{cliente.nome_completo}</h3>
                        <p className="cliente-cpf">{cliente.cpf || 'CPF não informado'}</p>
                      </div>
                      <div className="cliente-actions">
                        <button 
                          className="action-btn view small"
                          onClick={() => {
                            // Buscar vendas do cliente
                            const vendasCliente = vendas.filter(v => v.cliente_id === cliente.id)
                            setSelectedItem({...cliente, vendasCliente})
                            setModalType('visualizar-cliente')
                            setShowModal(true)
                          }}
                          title="Visualizar cliente"
                        >
                          <Eye size={16} />
                        </button>
                        <button 
                          className="action-btn edit small"
                          onClick={() => {
                            setSelectedItem(cliente)
                            setClienteForm({
                              ...cliente,
                              renda_mensal: cliente.renda_mensal?.toString() || '',
                              complementadores: cliente.complementadores || []
                            })
                            setModalType('cliente')
                            setShowModal(true)
                          }}
                          title="Editar cliente"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          className="action-btn delete small"
                          onClick={() => handleDeleteCliente(cliente.id)}
                          title="Excluir cliente"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="cliente-details">
                      <div className="detail-row">
                        <Phone size={14} />
                        <span>{cliente.telefone || '-'}</span>
                      </div>
                      <div className="detail-row">
                        <Mail size={14} />
                        <span>{cliente.email || '-'}</span>
                      </div>
                      <div className="detail-row">
                        <MapPin size={14} />
                        <span>{cliente.endereco || '-'}</span>
                      </div>
                      <div className="detail-row">
                        <Briefcase size={14} />
                        <span>{cliente.profissao || '-'} {cliente.empresa_trabalho ? `- ${cliente.empresa_trabalho}` : ''}</span>
                      </div>
                      <div className="detail-row">
                        <DollarSign size={14} />
                        <span>Renda: {cliente.renda_mensal ? formatCurrency(cliente.renda_mensal) : '-'}</span>
                      </div>
                    </div>
                    <div className="cliente-badges">
                      {cliente.possui_3_anos_fgts && <span className="badge fgts">3+ anos FGTS</span>}
                      {cliente.beneficiado_subsidio_fgts && <span className="badge subsidio">Subsidiado FGTS</span>}
                      {cliente.tem_complemento_renda && <span className="badge complemento">{cliente.complementadores?.length || 0} Complementador(es)</span>}
                    </div>
                    <div className="cliente-docs">
                      {cliente.rg_frente_url && <a href={cliente.rg_frente_url} target="_blank" rel="noopener noreferrer" className="doc-link">RG Frente</a>}
                      {cliente.rg_verso_url && <a href={cliente.rg_verso_url} target="_blank" rel="noopener noreferrer" className="doc-link">RG Verso</a>}
                      {cliente.cpf_url && <a href={cliente.cpf_url} target="_blank" rel="noopener noreferrer" className="doc-link">CPF</a>}
                      {cliente.comprovante_residencia_url && <a href={cliente.comprovante_residencia_url} target="_blank" rel="noopener noreferrer" className="doc-link">Residência</a>}
                      {cliente.comprovante_renda_url && <a href={cliente.comprovante_renda_url} target="_blank" rel="noopener noreferrer" className="doc-link">Renda</a>}
                      {cliente.certidao_casamento_url && <a href={cliente.certidao_casamento_url} target="_blank" rel="noopener noreferrer" className="doc-link">Casamento</a>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'relatorios' && (
          <div className="content-section">
            {/* Gerador de Relatórios */}
            <div className="relatorio-gerador">
              <div className="gerador-header">
                <FileDown size={24} />
                <div>
                  <h3>Gerar Relatório em PDF</h3>
                  <p>Selecione os filtros e gere um relatório profissional</p>
                </div>
              </div>
              
              {/* Busca de Corretor */}
              <div className="filters-section" style={{ marginBottom: '16px' }}>
                <div className="search-box">
                  <Search size={20} />
                  <input 
                    type="text" 
                    placeholder="Buscar corretor por nome..."
                    value={buscaCorretorRelatorio}
                    onChange={(e) => setBuscaCorretorRelatorio(e.target.value)}
                  />
                </div>
              </div>

              <div className="gerador-filtros">
                <div className="filtro-grupo">
                  <label><User size={14} /> Corretor</label>
                  <select
                    value={relatorioFiltros.corretorId}
                    onChange={(e) => {
                      const novoCorretorId = e.target.value
                      // Ao mudar corretor, resetar empreendimento e venda
                      // O empreendimento será filtrado automaticamente no dropdown
                      setRelatorioFiltros({
                        ...relatorioFiltros, 
                        corretorId: novoCorretorId, 
                        empreendimentoId: '', // Reset empreendimento
                        vendaId: '' // Reset venda
                      })
                    }}
                  >
                    <option value="">Todos os corretores</option>
                    {corretoresOrdenados
                      .filter(corretor => {
                        if (!buscaCorretorRelatorio) return true
                        const busca = buscaCorretorRelatorio.toLowerCase()
                        return corretor.nome?.toLowerCase().includes(busca)
                      })
                      .map((corretor) => (
                        <option key={corretor.id} value={corretor.id}>
                          {formatNome(corretor.nome)} ({corretor.tipo_corretor === 'interno' ? 'Interno' : 'Externo'})
                        </option>
                      ))}
                  </select>
                  {buscaCorretorRelatorio && (
                    <small style={{ color: '#10b981', marginTop: '4px', display: 'block' }}>
                      {corretoresOrdenados.filter(c => c.nome?.toLowerCase().includes(buscaCorretorRelatorio.toLowerCase())).length} corretor(es) encontrado(s)
                    </small>
                  )}
                </div>
                
                <div className="filtro-grupo">
                  <label><Building size={14} /> Empreendimento</label>
                  <select
                    value={relatorioFiltros.empreendimentoId}
                    onChange={(e) => {
                      const novoEmpId = e.target.value
                      // Ao mudar empreendimento, verificar se o cargo selecionado existe no novo empreendimento
                      let novoCargo = relatorioFiltros.cargoId
                      if (novoEmpId && novoCargo && novoCargo !== 'Corretor') {
                        const empNovo = empreendimentos.find(emp => emp.id === novoEmpId)
                        const cargoExiste = empNovo?.cargos?.some(c => c.nome_cargo === novoCargo)
                        if (!cargoExiste) {
                          novoCargo = 'Corretor' // Reset para Corretor se cargo não existe no novo empreendimento
                        }
                      }
                      setRelatorioFiltros({...relatorioFiltros, empreendimentoId: novoEmpId, cargoId: novoCargo, vendaId: ''})
                    }}
                  >
                    {(() => {
                      // Se há corretor selecionado, filtrar empreendimentos onde ele tem vendas
                      let empreendimentosFiltrados = [...empreendimentos]
                      
                      if (relatorioFiltros.corretorId) {
                        // Buscar IDs de empreendimentos onde o corretor tem vendas
                        const empIdsDoCorretor = new Set()
                        vendas.forEach(v => {
                          const corretorId = v.corretor_id || v.corretor?.id
                          if (String(corretorId) === String(relatorioFiltros.corretorId)) {
                            const empId = v.empreendimento_id || v.empreendimento?.id
                            if (empId) empIdsDoCorretor.add(String(empId))
                          }
                        })
                        empreendimentosFiltrados = empreendimentos.filter(emp => empIdsDoCorretor.has(String(emp.id)))
                      }
                      
                      const qtdEmpreendimentos = empreendimentosFiltrados.length
                      
                      return (
                        <>
                          <option value="">
                            {relatorioFiltros.corretorId 
                              ? `Todos os empreendimentos (${qtdEmpreendimentos})` 
                              : 'Todos os empreendimentos'}
                          </option>
                          {empreendimentosFiltrados
                            .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'))
                            .map((emp) => (
                              <option key={emp.id} value={emp.id}>
                                {emp.nome} {emp.cargos?.length > 0 ? `(${emp.cargos.length} cargos)` : ''}
                              </option>
                            ))}
                        </>
                      )
                    })()}
                  </select>
                  {relatorioFiltros.corretorId && (
                    <small style={{ color: '#10b981', marginTop: '4px', display: 'block' }}>
                      Empreendimentos com vendas do corretor
                    </small>
                  )}
                </div>
                
                <div className="filtro-grupo">
                  <label>Status</label>
                  <select
                    value={relatorioFiltros.status}
                    onChange={(e) => setRelatorioFiltros({...relatorioFiltros, status: e.target.value})}
                  >
                    <option value="todos">Todos</option>
                    <option value="pendente">Pendentes</option>
                    <option value="pago">Pagos</option>
                  </select>
                </div>
                
                {/* Só mostra o filtro de cargo se um empreendimento estiver selecionado */}
                {relatorioFiltros.empreendimentoId && (
                  <div className="filtro-grupo">
                    <label>Beneficiário / Cargo</label>
                    <select
                      value={relatorioFiltros.cargoId}
                      onChange={(e) => setRelatorioFiltros({...relatorioFiltros, cargoId: e.target.value})}
                    >
                      <option value="__total__">Total</option>
                      <option value="">Todos os cargos</option>
                      <option value="Corretor">Corretor</option>
                      {(() => {
                        // Buscar cargos específicos do empreendimento selecionado (sem duplicatas)
                        const empSelecionado = empreendimentos.find(e => e.id === relatorioFiltros.empreendimentoId)
                        const cargosUnicos = new Set()
                        
                        if (empSelecionado?.cargos) {
                          empSelecionado.cargos.forEach(c => {
                            if (c.nome_cargo && c.nome_cargo !== 'Corretor') {
                              cargosUnicos.add(c.nome_cargo)
                            }
                          })
                        }
                        
                        return Array.from(cargosUnicos).sort().map(cargo => (
                          <option key={cargo} value={cargo}>{cargo}</option>
                        ))
                      })()}
                    </select>
                    <small style={{ color: '#64748b', marginTop: '4px', display: 'block' }}>
                      Cargos do {empreendimentos.find(e => e.id === relatorioFiltros.empreendimentoId)?.nome || 'empreendimento'}
                    </small>
                  </div>
                )}
                
                <div className="filtro-grupo">
                  <label>Venda Específica</label>
                  <select
                    value={relatorioFiltros.vendaId}
                    onChange={(e) => setRelatorioFiltros({...relatorioFiltros, vendaId: e.target.value})}
                  >
                    <option value="">Todas as vendas ({vendas.length})</option>
                    {(listaVendasComPagamentos.length > 0 ? listaVendasComPagamentos : vendas.map(v => ({ venda_id: v.id, venda: v })))
                      .filter(grupo => {
                        const venda = grupo.venda
                        // Filtrar por corretor se selecionado
                        const corretorId = venda?.corretor_id || venda?.corretor?.id
                        if (relatorioFiltros.corretorId && corretorId !== relatorioFiltros.corretorId) return false
                        // Filtrar por empreendimento se selecionado
                        const empId = venda?.empreendimento_id || venda?.empreendimento?.id
                        if (relatorioFiltros.empreendimentoId && empId !== relatorioFiltros.empreendimentoId) return false
                        return true
                      })
                      .sort((a, b) => {
                        const empA = a.venda?.empreendimento?.nome || ''
                        const empB = b.venda?.empreendimento?.nome || ''
                        return empA.localeCompare(empB, 'pt-BR')
                      })
                      .map((grupo) => (
                        <option key={grupo.venda_id} value={grupo.venda_id}>
                          {grupo.venda?.empreendimento?.nome || 'Sem empreend.'} - Bl. {grupo.venda?.bloco || '-'} Un. {grupo.venda?.unidade || '-'} ({formatNome(grupo.venda?.corretor?.nome) || 'Sem corretor'})
                        </option>
                      ))}
                  </select>
                </div>
                
                <div className="filtro-grupo">
                  <label>Data Início</label>
                  <input
                    type="date"
                    value={relatorioFiltros.dataInicio}
                    onChange={(e) => setRelatorioFiltros({...relatorioFiltros, dataInicio: e.target.value})}
                  />
                </div>
                
                <div className="filtro-grupo">
                  <label>Data Fim</label>
                  <input
                    type="date"
                    value={relatorioFiltros.dataFim}
                    onChange={(e) => setRelatorioFiltros({...relatorioFiltros, dataFim: e.target.value})}
                  />
                </div>
              </div>
              
              {/* Botão Limpar Filtros */}
              {(relatorioFiltros.corretorId || relatorioFiltros.empreendimentoId || relatorioFiltros.vendaId || relatorioFiltros.status !== 'todos' || relatorioFiltros.cargoId !== 'Corretor' || relatorioFiltros.dataInicio || relatorioFiltros.dataFim || buscaCorretorRelatorio) && (
                <button
                  className="btn-clear-filters"
                  onClick={() => {
                    setRelatorioFiltros({
                      tipo: 'pagamentos',
                      corretorId: '',
                      vendaId: '',
                      cargoId: 'Corretor', // Manter padrão como Corretor
                      status: 'todos',
                      dataInicio: '',
                      dataFim: '',
                      empreendimentoId: ''
                    })
                    setBuscaCorretorRelatorio('')
                  }}
                  style={{ marginBottom: '16px' }}
                >
                  <X size={16} />
                  Limpar Filtros
                </button>
              )}
              
              <button 
                className="btn-gerar-pdf"
                onClick={gerarRelatorioPDF}
                disabled={gerandoPdf}
              >
                {gerandoPdf ? (
                  <>
                    <Clock size={20} className="spinning" />
                    Gerando...
                  </>
                ) : (
                  <>
                    <Download size={20} />
                    Gerar Relatório PDF
                  </>
                )}
              </button>
            </div>
            
            {/* Resumo Rápido */}
            <div className="relatorio-resumo">
              <h3>Resumo Geral</h3>
              <div className="resumo-cards">
                <div className="resumo-card-item">
                  <span className="resumo-titulo">Total de Vendas</span>
                  <span className="resumo-numero">{vendas.length}</span>
                </div>
                <div className="resumo-card-item">
                  <span className="resumo-titulo">Comissão Total</span>
                  <span className="resumo-numero verde">
                    {formatCurrency(
                      // Usar comissao_gerada dos pagamentos (mais preciso que comissao_total da venda)
                      pagamentos.reduce((acc, p) => acc + (parseFloat(p.comissao_gerada) || 0), 0)
                    )}
                  </span>
                </div>
                <div className="resumo-card-item">
                  <span className="resumo-titulo">Comissão Paga</span>
                  <span className="resumo-numero azul">
                    {formatCurrency(
                      // Somar comissão dos pagamentos com status 'pago'
                      pagamentos
                        .filter(p => p.status === 'pago')
                        .reduce((acc, p) => acc + (parseFloat(p.comissao_gerada) || 0), 0)
                    )}
                  </span>
                </div>
                <div className="resumo-card-item">
                  <span className="resumo-titulo">Comissão Pendente</span>
                  <span className="resumo-numero amarelo">
                    {formatCurrency(
                      // Somar comissão dos pagamentos com status 'pendente'
                      pagamentos
                        .filter(p => p.status === 'pendente')
                        .reduce((acc, p) => acc + (parseFloat(p.comissao_gerada) || 0), 0)
                    )}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Comissão por Empreendimento */}
            <div className="relatorio-beneficiarios" style={{ paddingBottom: '200px' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <Building size={20} />
                Comissão por Empreendimento
              </h3>
              
              {/* Seletor de Empreendimento */}
              <div style={{ marginBottom: '16px', position: 'relative', zIndex: 10 }}>
                <select
                  value={relatorioFiltros.empreendimentoDetalhe || ''}
                  onChange={(e) => setRelatorioFiltros({...relatorioFiltros, empreendimentoDetalhe: e.target.value})}
                  className="filter-select"
                  style={{
                    width: '100%',
                    padding: '12px 16px'
                  }}
                >
                  <option value="">Selecione um empreendimento para ver detalhes</option>
                  {empreendimentosOrdenados.map(emp => (
                    <option key={emp.id} value={emp.id}>{formatNome(emp.nome)}</option>
                  ))}
                </select>
              </div>
              
              {/* Detalhes do Empreendimento Selecionado */}
              {relatorioFiltros.empreendimentoDetalhe ? (
                <div className="beneficiarios-lista">
                  {(() => {
                    const empId = relatorioFiltros.empreendimentoDetalhe
                    const empSelecionado = empreendimentos.find(e => e.id === empId)
                    
                    // Filtrar vendas do empreendimento
                    const vendasEmp = listaVendasComPagamentos.filter(g => 
                      g.venda?.empreendimento_id === empId
                    )
                    
                    // Calcular totais
                    let totalVendas = vendasEmp.length
                    let valorTotalVendas = 0
                    let comissaoTotal = 0
                    let comissaoPaga = 0
                    let comissaoPendente = 0
                    const corretoresEmp = {}
                    const cargosEmp = {}
                    
                    vendasEmp.forEach(grupo => {
                      valorTotalVendas += parseFloat(grupo.venda?.valor_venda) || 0
                      
                      // Agrupar por corretor
                      const corretorNome = grupo.venda?.corretor?.nome || 'Sem corretor'
                      if (!corretoresEmp[corretorNome]) {
                        corretoresEmp[corretorNome] = { vendas: 0, comissao: 0 }
                      }
                      corretoresEmp[corretorNome].vendas++
                      
                      grupo.pagamentos.forEach(pag => {
                        const comissaoPag = parseFloat(pag.comissao_gerada) || 0
                        comissaoTotal += comissaoPag
                        corretoresEmp[corretorNome].comissao += comissaoPag
                        
                        if (pag.status === 'pago') {
                          comissaoPaga += comissaoPag
                        } else {
                          comissaoPendente += comissaoPag
                        }
                        
                        // Calcular por cargo
                        const comissoesCargo = calcularComissaoPorCargoPagamento(pag)
                        comissoesCargo.forEach(cargo => {
                          if (!cargosEmp[cargo.nome_cargo]) {
                            cargosEmp[cargo.nome_cargo] = { pago: 0, pendente: 0 }
                          }
                          if (pag.status === 'pago') {
                            cargosEmp[cargo.nome_cargo].pago += cargo.valor
                          } else {
                            cargosEmp[cargo.nome_cargo].pendente += cargo.valor
                          }
                        })
                      })
                    })
                    
                    return (
                      <>
                        {/* Header do Empreendimento */}
                        <div style={{
                          background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(16, 185, 129, 0.1))',
                          padding: '20px',
                          borderRadius: '12px',
                          marginBottom: '16px',
                          border: '1px solid rgba(59, 130, 246, 0.3)'
                        }}>
                          <h4 style={{ margin: '0 0 4px 0', fontSize: '20px', color: '#c9a962' }}>
                            {empSelecionado?.nome || 'Empreendimento'}
                          </h4>
                          <p style={{ margin: 0, color: 'rgba(255,255,255,0.6)', fontSize: '14px' }}>
                            Comissão: {empSelecionado?.comissao_total_externo || 7}% (Externo) | {empSelecionado?.comissao_total_interno || 6}% (Interno)
                          </p>
                        </div>
                        
                        {/* Resumo Geral */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(4, 1fr)',
                          gap: '12px',
                          marginBottom: '20px'
                        }}>
                          <div style={{ background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
                            <span style={{ display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: '12px', marginBottom: '4px' }}>Vendas</span>
                            <span style={{ fontSize: '24px', fontWeight: '700' }}>{totalVendas}</span>
                          </div>
                          <div style={{ background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
                            <span style={{ display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: '12px', marginBottom: '4px' }}>Valor Total</span>
                            <span style={{ fontSize: '18px', fontWeight: '700' }}>{formatCurrency(valorTotalVendas)}</span>
                          </div>
                          <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '16px', borderRadius: '8px', textAlign: 'center', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                            <span style={{ display: 'block', color: '#10b981', fontSize: '12px', marginBottom: '4px' }}>Comissão Paga</span>
                            <span style={{ fontSize: '18px', fontWeight: '700', color: '#10b981' }}>{formatCurrency(comissaoPaga)}</span>
                          </div>
                          <div style={{ background: 'rgba(234, 179, 8, 0.1)', padding: '16px', borderRadius: '8px', textAlign: 'center', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
                            <span style={{ display: 'block', color: '#eab308', fontSize: '12px', marginBottom: '4px' }}>Comissão Pendente</span>
                            <span style={{ fontSize: '18px', fontWeight: '700', color: '#eab308' }}>{formatCurrency(comissaoPendente)}</span>
                          </div>
                        </div>
                        
                        {/* Corretores do Empreendimento */}
                        <div style={{ marginBottom: '20px' }}>
                          <h5 style={{ margin: '0 0 12px 0', color: '#94a3b8', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            <User size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                            Corretores ({Object.keys(corretoresEmp).length})
                          </h5>
                          {Object.entries(corretoresEmp)
                            .sort((a, b) => b[1].comissao - a[1].comissao)
                            .map(([nome, dados]) => (
                              <div key={nome} className="beneficiario-row" style={{ 
                                background: 'rgba(255,255,255,0.03)',
                                padding: '12px 16px',
                                borderRadius: '8px',
                                marginBottom: '8px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                              }}>
                                <div>
                                  <span style={{ fontWeight: '600' }}>{formatNome(nome)}</span>
                                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', marginLeft: '8px' }}>
                                    {dados.vendas} venda{dados.vendas > 1 ? 's' : ''}
                                  </span>
                                </div>
                                <span style={{ fontWeight: '700', color: '#10b981' }}>{formatCurrency(dados.comissao)}</span>
                              </div>
                            ))}
                        </div>
                        
                        {/* Divisão por Cargo */}
                        <div>
                          <h5 style={{ margin: '0 0 12px 0', color: '#94a3b8', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            <Briefcase size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                            Divisão por Cargo
                          </h5>
                          {Object.entries(cargosEmp)
                            .sort((a, b) => (b[1].pago + b[1].pendente) - (a[1].pago + a[1].pendente))
                            .map(([nome, valores]) => (
                              <div key={nome} className="beneficiario-row">
                                <span className="beneficiario-nome">{nome}</span>
                                <div className="beneficiario-valores">
                                  <span className="valor-pago">Pago: {formatCurrency(valores.pago)}</span>
                                  <span className="valor-pendente">Pendente: {formatCurrency(valores.pendente)}</span>
                                  <span className="valor-total">Total: {formatCurrency(valores.pago + valores.pendente)}</span>
                                </div>
                              </div>
                            ))}
                          {Object.keys(cargosEmp).length === 0 && (
                            <p style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', padding: '20px' }}>
                              Nenhum cargo configurado para este empreendimento
                            </p>
                          )}
                        </div>
                      </>
                    )
                  })()}
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Aba Ver PDF: preview para ajuste visual (remover para usuário final) */}
        {activeTab === 'preview-pdf' && (
          <div className="content-section">
            <div className="relatorio-gerador" style={{ marginBottom: '20px' }}>
              <div className="gerador-header">
                <Eye size={24} />
                <div>
                  <h3>Visualizar PDF do relatório</h3>
                  <p>Use os filtros na aba Relatórios e clique abaixo para gerar e ver o PDF sem baixar.</p>
                </div>
              </div>
              <button
                className="btn-gerar-pdf"
                onClick={async () => {
                  try {
                    if (pdfPreviewUrl) {
                      URL.revokeObjectURL(pdfPreviewUrl)
                      setPdfPreviewUrl(null)
                    }
                    const blob = await gerarRelatorioPDF({ paraPreview: true })
                    if (blob) {
                      setPdfPreviewUrl(URL.createObjectURL(blob))
                    }
                  } catch (e) {
                    console.error(e)
                  }
                }}
                disabled={gerandoPdf}
              >
                {gerandoPdf ? (
                  <>
                    <Clock size={20} className="spinning" />
                    Gerando...
                  </>
                ) : (
                  <>
                    <FileText size={20} />
                    Gerar e visualizar PDF
                  </>
                )}
              </button>
            </div>
            {pdfPreviewUrl && (
              <div style={{ width: '100%', minHeight: '800px', background: '#1e1e1e', borderRadius: '8px', overflow: 'hidden' }}>
                <iframe
                  src={pdfPreviewUrl}
                  title="Preview do relatório PDF"
                  style={{ width: '100%', height: '85vh', minHeight: '800px', border: 'none' }}
                />
              </div>
            )}
          </div>
        )}

        {/* ================================================
            ABA DE SOLICITAÇÕES
            ================================================ */}
        {activeTab === 'solicitacoes' && (
          <div className="content-section">
            {/* Filtros */}
            <div className="solicitacoes-header">
              <div className="solicitacoes-filtros">
                <button 
                  className={`filtro-btn ${filtroSolicitacao === 'pendente' ? 'active' : ''}`}
                  onClick={() => setFiltroSolicitacao('pendente')}
                >
                  <Clock size={16} />
                  Pendentes
                  {solicitacoes.filter(s => s.status === 'pendente').length > 0 && (
                    <span className="filtro-count">{solicitacoes.filter(s => s.status === 'pendente').length}</span>
                  )}
                </button>
                <button 
                  className={`filtro-btn ${filtroSolicitacao === 'aprovado' ? 'active' : ''}`}
                  onClick={() => setFiltroSolicitacao('aprovado')}
                >
                  <CheckCircle2 size={16} />
                  Aprovadas
                </button>
                <button 
                  className={`filtro-btn ${filtroSolicitacao === 'reprovado' ? 'active' : ''}`}
                  onClick={() => setFiltroSolicitacao('reprovado')}
                >
                  <XCircle size={16} />
                  Reprovadas
                </button>
                <button 
                  className={`filtro-btn ${filtroSolicitacao === 'todos' ? 'active' : ''}`}
                  onClick={() => setFiltroSolicitacao('todos')}
                >
                  <ClipboardList size={16} />
                  Todas
                </button>
              </div>
            </div>

            {/* Lista de Solicitações */}
            {loadingSolicitacoes ? (
              <div className="loading-container">
                <div className="loading-spinner"></div>
                <p>Carregando solicitações...</p>
              </div>
            ) : solicitacoes.length === 0 ? (
              <div className="empty-state-box">
                <ClipboardList size={48} />
                <h3>Nenhuma solicitação {filtroSolicitacao !== 'todos' ? filtroSolicitacao : ''}</h3>
                <p>As solicitações dos corretores aparecerão aqui</p>
              </div>
            ) : (
              <div className="solicitacoes-grid">
                {solicitacoes.map(solicitacao => (
                  <div 
                    key={solicitacao.id} 
                    className={`solicitacao-card ${solicitacao.status}`}
                    onClick={() => setSolicitacaoSelecionada(solicitacao)}
                  >
                    <div className="solicitacao-header">
                      <div className="solicitacao-tipo">
                        {solicitacao.tipo === 'venda' && <DollarSign size={18} />}
                        {solicitacao.tipo === 'cliente' && <UserPlus size={18} />}
                        <span>
                          {solicitacao.tipo === 'venda' && 'Nova Venda'}
                          {solicitacao.tipo === 'cliente' && 'Novo Cliente'}
                        </span>
                      </div>
                      <span className={`solicitacao-status ${solicitacao.status}`}>
                        {solicitacao.status === 'pendente' && 'Pendente'}
                        {solicitacao.status === 'aprovado' && 'Aprovada'}
                        {solicitacao.status === 'reprovado' && 'Reprovada'}
                      </span>
                    </div>
                    
                    <div className="solicitacao-corretor">
                      <div className="corretor-avatar">
                        {solicitacao.corretor?.nome?.charAt(0) || 'C'}
                      </div>
                      <div className="corretor-info">
                        <span className="corretor-nome">{solicitacao.corretor?.nome || 'Corretor'}</span>
                        <span className="corretor-email">{solicitacao.corretor?.email}</span>
                      </div>
                    </div>
                    
                    <div className="solicitacao-resumo">
                      {solicitacao.tipo === 'venda' && (
                        <>
                          <div className="resumo-item">
                            <span className="label">Cliente:</span>
                            <span className="value">{solicitacao.dados?.nome_cliente || '-'}</span>
                          </div>
                          <div className="resumo-item">
                            <span className="label">Valor:</span>
                            <span className="value gold">{formatCurrency(solicitacao.dados?.valor_venda || 0)}</span>
                          </div>
                        </>
                      )}
                      {solicitacao.tipo === 'cliente' && (
                        <>
                          <div className="resumo-item">
                            <span className="label">Nome:</span>
                            <span className="value">{solicitacao.dados?.nome_completo || '-'}</span>
                          </div>
                          <div className="resumo-item">
                            <span className="label">CPF:</span>
                            <span className="value">{solicitacao.dados?.cpf || '-'}</span>
                          </div>
                        </>
                      )}
                    </div>
                    
                    <div className="solicitacao-footer">
                      <span className="solicitacao-data">
                        <Calendar size={12} />
                        {new Date(solicitacao.created_at).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                      {solicitacao.status === 'pendente' && (
                        <button className="btn-ver-detalhes">
                          Ver detalhes
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modal de Detalhes da Solicitação */}
      {solicitacaoSelecionada && (
        <div className="modal-overlay" onClick={() => { setSolicitacaoSelecionada(null); setRespostaAdmin(''); }}>
          <div className="modal-content solicitacao-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {solicitacaoSelecionada.tipo === 'venda' && <DollarSign size={20} />}
                {solicitacaoSelecionada.tipo === 'cliente' && <UserPlus size={20} />}
                {solicitacaoSelecionada.tipo === 'venda' && 'Solicitação de Nova Venda'}
                {solicitacaoSelecionada.tipo === 'cliente' && 'Solicitação de Novo Cliente'}
              </h2>
              <button className="modal-close" onClick={() => { setSolicitacaoSelecionada(null); setRespostaAdmin(''); }}>
                <X size={20} />
              </button>
            </div>
            
            <div className="modal-body">
              {/* Info do Corretor */}
              <div className="solicitacao-info-section">
                <h4>Solicitante</h4>
                <div className="info-row">
                  <div className="corretor-avatar large">{solicitacaoSelecionada.corretor?.nome?.charAt(0) || 'C'}</div>
                  <div>
                    <p className="nome">{solicitacaoSelecionada.corretor?.nome}</p>
                    <p className="email">{solicitacaoSelecionada.corretor?.email}</p>
                  </div>
                </div>
                <p className="data-solicitacao">
                  Solicitado em {new Date(solicitacaoSelecionada.created_at).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
              </div>
              
              {/* Dados da Solicitação */}
              <div className="solicitacao-info-section">
                <h4>Dados da Solicitação</h4>
                
                {solicitacaoSelecionada.tipo === 'venda' && (
                  <div className="dados-grid">
                    <div className="dado-item">
                      <span className="label">Cliente</span>
                      <span className="value">{solicitacaoSelecionada.dados?.nome_cliente || '-'}</span>
                    </div>
                    <div className="dado-item">
                      <span className="label">Empreendimento</span>
                      <span className="value">
                        {empreendimentos.find(e => e.id === solicitacaoSelecionada.dados?.empreendimento_id)?.nome || '-'}
                      </span>
                    </div>
                    <div className="dado-item">
                      <span className="label">Unidade</span>
                      <span className="value">{solicitacaoSelecionada.dados?.unidade || '-'}</span>
                    </div>
                    <div className="dado-item">
                      <span className="label">Bloco</span>
                      <span className="value">{solicitacaoSelecionada.dados?.bloco || '-'}</span>
                    </div>
                    <div className="dado-item destaque">
                      <span className="label">Valor da Venda</span>
                      <span className="value gold">{formatCurrency(solicitacaoSelecionada.dados?.valor_venda || 0)}</span>
                    </div>
                    <div className="dado-item">
                      <span className="label">Data da Venda</span>
                      <span className="value">
                        {formatDataBR(solicitacaoSelecionada.dados?.data_venda)}
                      </span>
                    </div>
                  </div>
                )}
                
                {solicitacaoSelecionada.tipo === 'cliente' && (
                  <div className="dados-grid">
                    <div className="dado-item">
                      <span className="label">Nome Completo</span>
                      <span className="value">{solicitacaoSelecionada.dados?.nome_completo || '-'}</span>
                    </div>
                    <div className="dado-item">
                      <span className="label">CPF</span>
                      <span className="value">{solicitacaoSelecionada.dados?.cpf || '-'}</span>
                    </div>
                    <div className="dado-item">
                      <span className="label">Email</span>
                      <span className="value">{solicitacaoSelecionada.dados?.email || '-'}</span>
                    </div>
                    <div className="dado-item">
                      <span className="label">Telefone</span>
                      <span className="value">{solicitacaoSelecionada.dados?.telefone || '-'}</span>
                    </div>
                    <div className="dado-item full">
                      <span className="label">Endereço</span>
                      <span className="value">{solicitacaoSelecionada.dados?.endereco || '-'}</span>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Resposta (se já respondida) */}
              {solicitacaoSelecionada.status !== 'pendente' && (
                <div className="solicitacao-info-section resposta">
                  <h4>
                    {solicitacaoSelecionada.status === 'aprovado' ? (
                      <><CheckCircle2 size={16} className="icon-success" /> Aprovada</>
                    ) : (
                      <><XCircle size={16} className="icon-error" /> Reprovada</>
                    )}
                  </h4>
                  <p className="resposta-texto">{solicitacaoSelecionada.resposta_admin}</p>
                  <p className="resposta-info">
                    Por {solicitacaoSelecionada.admin?.nome || 'Admin'} em{' '}
                    {solicitacaoSelecionada.data_resposta 
                      ? new Date(solicitacaoSelecionada.data_resposta).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: 'long',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      : '-'}
                  </p>
                </div>
              )}
              
              {/* Área de Resposta (se pendente) */}
              {solicitacaoSelecionada.status === 'pendente' && (
                <div className="solicitacao-resposta-area">
                  <div className="form-group">
                    <label>
                      <MessageSquare size={14} />
                      Observação / Motivo (obrigatório para reprovação)
                    </label>
                    <textarea
                      value={respostaAdmin}
                      onChange={(e) => setRespostaAdmin(e.target.value)}
                      placeholder="Digite uma observação ou o motivo da reprovação..."
                      rows={3}
                    />
                  </div>
                </div>
              )}
            </div>
            
            {/* Ações */}
            {solicitacaoSelecionada.status === 'pendente' && (
              <div className="modal-footer solicitacao-acoes">
                <button 
                  className="btn-reprovar"
                  onClick={() => handleReprovarSolicitacao(solicitacaoSelecionada)}
                  disabled={loading}
                >
                  <XCircle size={18} />
                  Reprovar
                </button>
                <button 
                  className="btn-aprovar"
                  onClick={() => handleAprovarSolicitacao(solicitacaoSelecionada)}
                  disabled={loading}
                >
                  <CheckCircle2 size={18} />
                  Aprovar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de Visualização de Venda */}
      {showModal && modalType === 'visualizar-venda' && selectedItem && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '800px' }}>
            <div className="modal-header">
              <h2>
                <Eye size={20} style={{ marginRight: '8px' }} />
                Detalhes da Venda
              </h2>
              <button className="close-btn" onClick={() => setShowModal(false)}>
                <X size={24} />
              </button>
            </div>

            {/* Abas */}
            <div className="visualizar-venda-tabs">
              <button
                className={`visualizar-venda-tab${abaVisualizarVenda === 'detalhes' ? ' active' : ''}`}
                onClick={() => setAbaVisualizarVenda('detalhes')}
              >
                <FileText size={15} />
                Detalhes da Venda
              </button>
              <button
                className={`visualizar-venda-tab${abaVisualizarVenda === 'renegociacoes' ? ' active' : ''}`}
                onClick={() => {
                  setAbaVisualizarVenda('renegociacoes')
                  fetchRenegociacoes(selectedItem.id)
                }}
              >
                <RefreshCw size={15} />
                Renegociações
              </button>
            </div>
            
            <div className="modal-body" style={{ padding: '24px' }}>
              {abaVisualizarVenda === 'renegociacoes' && (
                <div className="renego-historico">
                  {loadingRenegociacoes ? (
                    <div style={{ textAlign: 'center', padding: '2rem' }}>
                      <div className="loading-spinner" />
                    </div>
                  ) : renegociacoesVenda.length === 0 ? (
                    <div className="empty-state-box">
                      <RefreshCw size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
                      <p>Nenhuma renegociação registrada para esta venda.</p>
                    </div>
                  ) : renegociacoesVenda.map(renego => {
                    const parcelasOriginais = Array.isArray(renego.parcelas_originais) ? renego.parcelas_originais : []
                    const parcelasNovas = Array.isArray(renego.parcelas_novas) ? renego.parcelas_novas : []
                    const somaOrig = parcelasOriginais.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0)
                    const somaNovas = parcelasNovas.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0)
                    const somaComOrig = parcelasOriginais.reduce((s, p) => s + (parseFloat(p.comissao_gerada) || 0), 0)
                    const somaComNovas = parcelasNovas.reduce((s, p) => s + (parseFloat(p.comissao_gerada) || 0), 0)
                    return (
                      <div key={renego.id} className="renego-historico-card">
                        <div className="renego-historico-meta">
                          <span className="renego-historico-data">
                            <Calendar size={13} />
                            {new Date(renego.data_renegociacao).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="renego-historico-motivo">"{renego.motivo}"</span>
                        </div>
                        <div className="renego-historico-diff">
                          <div className="renego-historico-lado antes">
                            <span className="renego-historico-label">Antes</span>
                            {parcelasOriginais.map((p, i) => (
                              <div key={i} className="renego-historico-item">
                                <span>{p.tipo?.replace('_', ' ')} {p.numero_parcela ? `#${p.numero_parcela}` : ''}</span>
                                <span>{formatCurrency(p.valor)}</span>
                                <span className="renego-data">{p.data_prevista ? formatDataBR(p.data_prevista) : '—'}</span>
                              </div>
                            ))}
                            <div className="renego-historico-subtotal">Total: {formatCurrency(somaOrig)} | Com.: {formatCurrency(somaComOrig)}</div>
                          </div>
                          <div className="renego-seta-hist">→</div>
                          <div className="renego-historico-lado depois">
                            <span className="renego-historico-label">Depois</span>
                            {parcelasNovas.map((p, i) => (
                              <div key={i} className="renego-historico-item">
                                <span>{p.tipo?.replace('_', ' ')} {p.numero_parcela ? `#${p.numero_parcela}` : ''}</span>
                                <span>{formatCurrency(p.valor)}</span>
                                <span className="renego-data">{p.data_prevista ? formatDataBR(p.data_prevista) : '—'}</span>
                              </div>
                            ))}
                            <div className="renego-historico-subtotal depois">Total: {formatCurrency(somaNovas)} | Com.: {formatCurrency(somaComNovas)}</div>
                          </div>
                        </div>
                        <div className="renego-historico-delta">
                          <span className={parseFloat(renego.diferenca_valor) >= 0 ? 'delta-positivo' : 'delta-negativo'}>
                            Δ Valor: {parseFloat(renego.diferenca_valor) >= 0 ? '+' : ''}{formatCurrency(renego.diferenca_valor)}
                          </span>
                          <span className={parseFloat(renego.diferenca_comissao) >= 0 ? 'delta-positivo' : 'delta-negativo'}>
                            Δ Comissão: {parseFloat(renego.diferenca_comissao) >= 0 ? '+' : ''}{formatCurrency(renego.diferenca_comissao)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {abaVisualizarVenda !== 'renegociacoes' && (
              <>{/* Informações Principais */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, 1fr)', 
                gap: '20px',
                marginBottom: '24px'
              }}>
                <div style={{ 
                  background: 'rgba(255,255,255,0.05)', 
                  padding: '16px', 
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.1)'
                }}>
                  <h4 style={{ margin: '0 0 12px 0', color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Empreendimento
                  </h4>
                  <p style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
                    {selectedItem.empreendimento?.nome || 'Não informado'}
                  </p>
                  <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,0.6)', fontSize: '14px' }}>
                    {selectedItem.bloco && `Bloco ${selectedItem.bloco}`}
                    {selectedItem.bloco && selectedItem.unidade && ' - '}
                    {selectedItem.unidade && `Unidade ${selectedItem.unidade}`}
                    {!selectedItem.bloco && !selectedItem.unidade && 'Sem bloco/unidade'}
                  </p>
                </div>
                
                <div style={{ 
                  background: 'rgba(255,255,255,0.05)', 
                  padding: '16px', 
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.1)'
                }}>
                  <h4 style={{ margin: '0 0 12px 0', color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Corretor
                  </h4>
                  <p style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
                    {formatNome(selectedItem.corretor?.nome) || 'Não informado'}
                  </p>
                  <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,0.6)', fontSize: '14px' }}>
                    {selectedItem.tipo_corretor === 'interno' ? 'Corretor Interno' : 'Corretor Externo'}
                    {selectedItem.corretor?.percentual_corretor && ` • ${selectedItem.corretor.percentual_corretor}%`}
                  </p>
                </div>
                
                <div style={{ 
                  background: 'rgba(255,255,255,0.05)', 
                  padding: '16px', 
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.1)'
                }}>
                  <h4 style={{ margin: '0 0 12px 0', color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Cliente
                  </h4>
                  <p style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
                    {formatNome(selectedItem.nome_cliente || selectedItem.cliente?.nome) || 'Não informado'}
                  </p>
                  <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,0.6)', fontSize: '14px' }}>
                    {selectedItem.cliente?.cpf || selectedItem.cliente?.cnpj || 'Documento não informado'}
                  </p>
                </div>
                
                <div style={{ 
                  background: 'rgba(255,255,255,0.05)', 
                  padding: '16px', 
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.1)'
                }}>
                  <h4 style={{ margin: '0 0 12px 0', color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Data da Venda
                  </h4>
                  <p style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
                    {selectedItem.data_venda ? parseDataLocal(selectedItem.data_venda).toLocaleDateString('pt-BR', {
                      day: '2-digit', month: 'long', year: 'numeric'
                    }) : 'Não informada'}
                  </p>
                  <p style={{ margin: '4px 0 0' }}>
                    <span className={`status-badge ${selectedItem.status || 'pendente'}`} style={{ fontSize: '12px' }}>
                      {selectedItem.status === 'pago' && 'Comissão Paga'}
                      {selectedItem.status === 'pendente' && 'Pendente'}
                      {selectedItem.status === 'em_andamento' && 'Em Andamento'}
                      {!selectedItem.status && 'Pendente'}
                    </span>
                  </p>
                </div>
              </div>
              
              {/* Valores */}
              <div style={{ 
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.1))',
                padding: '24px',
                borderRadius: '12px',
                marginBottom: '24px',
                border: '1px solid rgba(16, 185, 129, 0.2)'
              }}>
                <h4 style={{ margin: '0 0 16px 0', color: '#10b981', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  <DollarSign size={16} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                  Valores da Venda
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', display: 'block' }}>Valor da Venda</span>
                    <span style={{ fontSize: '20px', fontWeight: '700' }}>{formatCurrency(selectedItem.valor_venda)}</span>
                  </div>
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', display: 'block' }}>Valor Pro-Soluto</span>
                    <span style={{ fontSize: '20px', fontWeight: '700' }}>{formatCurrency(selectedItem.valor_pro_soluto || selectedItem.valor_venda)}</span>
                  </div>
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', display: 'block' }}>Comissão Corretor</span>
                    <span style={{ fontSize: '20px', fontWeight: '700', color: '#10b981' }}>{formatCurrency(selectedItem.comissao_corretor)}</span>
                  </div>
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', display: 'block' }}>Comissão Total</span>
                    <span style={{ fontSize: '20px', fontWeight: '700', color: '#c9a962' }}>{formatCurrency(pagamentosVisualizacao.reduce((acc, p) => acc + (parseFloat(p.comissao_gerada) || 0), 0))}</span>
                  </div>
                </div>
              </div>
              
              {/* Detalhes do Pagamento */}
              <div style={{ 
                background: 'rgba(255,255,255,0.05)',
                padding: '24px',
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.1)'
              }}>
                <h4 style={{ margin: '0 0 16px 0', color: '#94a3b8', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  <CreditCard size={16} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                  Condições de Pagamento
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                  <div style={{ padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', display: 'block' }}>Sinal</span>
                    <span style={{ fontSize: '16px', fontWeight: '600' }}>
                      {selectedItem.teve_sinal ? formatCurrency(selectedItem.valor_sinal) : 'Não teve'}
                    </span>
                  </div>
                  <div style={{ padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', display: 'block' }}>Entrada</span>
                    <span style={{ fontSize: '16px', fontWeight: '600' }}>
                      {selectedItem.teve_entrada ? (
                        selectedItem.parcelou_entrada ? (() => {
                          const parcelasEntrada = pagamentosVisualizacao.filter(p => p.tipo === 'parcela_entrada')
                          if (parcelasEntrada.length > 0) {
                            // Agrupa por valor para exibir grupos distintos
                            const grupos = {}
                            parcelasEntrada.forEach(p => {
                              const v = parseFloat(p.valor) || 0
                              const k = v.toFixed(2)
                              grupos[k] = (grupos[k] || 0) + 1
                            })
                            return Object.entries(grupos).map(([v, qtd]) =>
                              `${qtd}x ${formatCurrency(parseFloat(v))}`
                            ).join(' + ')
                          }
                          // Fallback para campos escalares (dados legados)
                          return `${selectedItem.qtd_parcelas_entrada || 1}x ${formatCurrency(selectedItem.valor_parcela_entrada)}`
                        })()
                        : formatCurrency(selectedItem.valor_entrada)
                      ) : 'Não teve'}
                    </span>
                  </div>
                  <div style={{ padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', display: 'block' }}>Balão</span>
                    <span style={{ fontSize: '16px', fontWeight: '600' }}>
                      {selectedItem.teve_balao === 'sim' ? (() => {
                        const baloes = pagamentosVisualizacao.filter(p => p.tipo === 'balao')
                        if (baloes.length > 0) {
                          // Agrupa por valor para exibir grupos distintos
                          const grupos = {}
                          baloes.forEach(p => {
                            const v = parseFloat(p.valor) || 0
                            const k = v.toFixed(2)
                            grupos[k] = (grupos[k] || 0) + 1
                          })
                          return Object.entries(grupos).map(([v, qtd]) =>
                            `${qtd}x ${formatCurrency(parseFloat(v))}`
                          ).join(' + ')
                        }
                        // Fallback para campos escalares (dados legados)
                        return `${selectedItem.qtd_balao || 1}x ${formatCurrency(selectedItem.valor_balao)}`
                      })() : 'Não teve'}
                    </span>
                  </div>
                </div>
              </div>
              
              {/* Sienge Info - se tiver */}
              {selectedItem.sienge_contract_id && (
                <div style={{ 
                  marginTop: '16px',
                  padding: '12px 16px',
                  background: 'rgba(234, 179, 8, 0.1)',
                  borderRadius: '8px',
                  border: '1px solid rgba(234, 179, 8, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <RefreshCw size={16} style={{ color: '#eab308' }} />
                  <span style={{ color: '#eab308', fontSize: '13px' }}>
                    Sincronizado do Sienge • Contrato #{selectedItem.sienge_contract_id}
                    {selectedItem.numero_contrato && ` • Nº ${selectedItem.numero_contrato}`}
                  </span>
                </div>
              )}
              </>
              )}
            </div>

            <div className="modal-footer" style={{
              padding: '16px 24px',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '12px'
            }}>
              <button
                className="btn-secondary"
                onClick={() => { setShowModal(false); setAbaVisualizarVenda('detalhes') }}
              >
                Fechar
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  setAbaVisualizarVenda('detalhes')
                  openEditModal(selectedItem)
                }}
              >
                <Edit2 size={16} />
                Editar Venda
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && modalType !== 'visualizar-venda' && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {modalType === 'venda' 
                  ? (selectedItem ? 'Editar Venda' : 'Nova Venda')
                  : modalType === 'empreendimento'
                  ? (selectedItem ? 'Editar Empreendimento' : 'Novo Empreendimento')
                  : (selectedItem ? 'Editar Corretor' : 'Novo Corretor')
                }
              </h2>
              <button className="close-btn" onClick={() => setShowModal(false)}>
                <X size={24} />
              </button>
            </div>
            
            {/* Modal de Venda */}
            {modalType === 'venda' && (
              <>
                {console.log('📋 Renderizando modal venda. selectedItem:', !!selectedItem, 'pagamentos:', pagamentosVendaEditando.length)}
                <div className="modal-body">
                  <div className="form-group">
                    <label>Corretor *</label>
                    <select
                      value={vendaForm.corretor_id}
                      onChange={(e) => handleCorretorChange(e.target.value)}
                    >
                      <option value="">Selecione</option>
                      {corretoresOrdenados.map((c) => {
                        const isAutonomo = !c.empreendimento_id && c.percentual_corretor
                        const percentual = c.percentual_corretor || (c.tipo_corretor === 'interno' ? 2.5 : 4)
                        return (
                          <option key={c.id} value={c.id}>
                            {formatNome(c.nome)} - {isAutonomo ? 'Autônomo' : (c.tipo_corretor === 'interno' ? 'Interno' : 'Externo')} ({percentual}%)
                          </option>
                        )
                      })}
                    </select>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Valor da Venda *</label>
                      <div className="input-currency">
                        <span className="currency-prefix">R$</span>
                        <input
                          type="text"
                          placeholder="0,00"
                          value={formatCurrencyInput(vendaForm.valor_venda)}
                          onChange={(e) => handleCurrencyChange('valor_venda', e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Data da Venda</label>
                      <input
                        type="date"
                        value={vendaForm.data_venda}
                        onChange={(e) => setVendaForm({...vendaForm, data_venda: e.target.value})}
                      />
                    </div>
                    <div className="form-group">
                      <label>Data da Entrada *</label>
                      <input
                        type="date"
                        value={vendaForm.data_entrada}
                        onChange={(e) => {
                          const novaData = e.target.value
                          setVendaForm({
                            ...vendaForm,
                            data_entrada: novaData,
                            data_sinal: vendaForm.data_sinal || '',
                            datas_parcelas_override: {},
                            datas_balao_override: {}
                          })
                        }}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>
                        Empreendimento {(() => {
                          const corretor = corretores.find(c => c.id === vendaForm.corretor_id)
                          const isAutonomo = corretor && !corretor.empreendimento_id && corretor.percentual_corretor
                          return isAutonomo ? '(opcional - corretor autônomo)' : '*'
                        })()}
                      </label>
                      <select
                        value={vendaForm.empreendimento_id || ''}
                        onChange={(e) => setVendaForm({...vendaForm, empreendimento_id: e.target.value})}
                        disabled={(() => {
                          const corretor = corretores.find(c => c.id === vendaForm.corretor_id)
                          return corretor && !corretor.empreendimento_id && corretor.percentual_corretor
                        })()}
                      >
                        <option value="">Selecione o empreendimento</option>
                        {[...empreendimentos].sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR')).map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.nome}
                          </option>
                        ))}
                      </select>
                      {(() => {
                        const corretor = corretores.find(c => c.id === vendaForm.corretor_id)
                        const isAutonomo = corretor && !corretor.empreendimento_id && corretor.percentual_corretor
                        return isAutonomo && (
                          <small className="form-hint">
                            Corretor autônomo - comissão de {corretor.percentual_corretor}% será aplicada
                          </small>
                        )
                      })()}
                    </div>
                    <div className="form-group">
                      <label>Cliente (opcional)</label>
                      <select
                        value={vendaForm.cliente_id || ''}
                        onChange={(e) => setVendaForm({...vendaForm, cliente_id: e.target.value})}
                      >
                        <option value="">Selecione o cliente</option>
                        {[...clientes].sort((a, b) => (a.nome_completo || '').localeCompare(b.nome_completo || '', 'pt-BR')).map((cliente) => (
                          <option key={cliente.id} value={cliente.id}>
                            {formatNome(cliente.nome_completo)} {cliente.cpf ? `- ${cliente.cpf}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Unidade</label>
                      <input
                        type="text"
                        placeholder="Ex: 101"
                        maxLength={5}
                        value={vendaForm.unidade}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 5)
                          setVendaForm({...vendaForm, unidade: val})
                        }}
                      />
                    </div>
                    <div className="form-group">
                      <label>Bloco</label>
                      <input
                        type="text"
                        placeholder="Ex: A"
                        maxLength={1}
                        value={vendaForm.bloco}
                        onChange={(e) => {
                          const val = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1)
                          setVendaForm({...vendaForm, bloco: val})
                        }}
                      />
                    </div>
                    <div className="form-group">
                      <label>Andar</label>
                      <input
                        type="text"
                        placeholder="Ex: 7 ou 7°Pav"
                        value={vendaForm.andar}
                        onChange={(e) => {
                          setVendaForm({...vendaForm, andar: e.target.value})
                        }}
                        onBlur={(e) => {
                          // Ao sair do campo, se digitar apenas números, formatar automaticamente
                          let val = e.target.value.trim()
                          if (val && /^\d+$/.test(val)) {
                            val = `${val}°Pav`
                            setVendaForm({...vendaForm, andar: val})
                          }
                        }}
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Descrição (opcional)</label>
                      <input
                        type="text"
                        placeholder="Observações adicionais"
                        value={vendaForm.descricao}
                        onChange={(e) => setVendaForm({...vendaForm, descricao: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="section-divider">
                    <span>Condições de Pagamento (Pro-Soluto)</span>
                  </div>

                  {/* SINAL */}
                  <div className="form-row">
                    <div className="form-group">
                      <label>Teve Sinal?</label>
                      <select
                        value={vendaForm.teve_sinal ? 'sim' : 'nao'}
                        onChange={(e) => setVendaForm({...vendaForm, teve_sinal: e.target.value === 'sim', valor_sinal: e.target.value === 'nao' ? '' : vendaForm.valor_sinal, data_sinal: e.target.value === 'nao' ? '' : vendaForm.data_sinal})}
                      >
                        <option value="nao">Não</option>
                        <option value="sim">Sim</option>
                      </select>
                    </div>
                    {vendaForm.teve_sinal && (
                      <div className="form-group">
                        <label>Valor do Sinal</label>
                        <div className="input-currency">
                          <span className="currency-prefix">R$</span>
                          <input
                            type="text"
                            placeholder="0,00"
                            value={formatCurrencyInput(vendaForm.valor_sinal)}
                            onChange={(e) => handleCurrencyChange('valor_sinal', e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  {vendaForm.teve_sinal && (
                    <div className="form-row">
                      <div className="form-group">
                        <label>Data de recebimento do sinal</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {editandoDataSinal ? (
                            <>
                              <input
                                type="date"
                                value={dataSinalTemp}
                                onChange={(e) => setDataSinalTemp(e.target.value)}
                                style={{ flex: 1 }}
                              />
                              <button
                                type="button"
                                onClick={() => { setVendaForm({ ...vendaForm, data_sinal: dataSinalTemp }); setEditandoDataSinal(false) }}
                                style={{ background: '#22c55e', color: 'white', border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                              >
                                <Save size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditandoDataSinal(false)}
                                style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                              >
                                <X size={14} />
                              </button>
                            </>
                          ) : (
                            <>
                              <span style={{ flex: 1, color: vendaForm.data_sinal ? '#e2e8f0' : '#64748b' }}>
                                {vendaForm.data_sinal
                                  ? formatDateBR(vendaForm.data_sinal)
                                  : (vendaForm.data_entrada ? `${formatDateBR(vendaForm.data_entrada)} (padrão)` : '—')}
                              </span>
                              <button
                                type="button"
                                onClick={() => { setEditandoDataSinal(true); setDataSinalTemp(vendaForm.data_sinal || vendaForm.data_entrada || '') }}
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#c9a962', display: 'flex', alignItems: 'center' }}
                              >
                                <Edit2 size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ENTRADA */}
                  <div className="form-row">
                    <div className="form-group">
                      <label>Teve Entrada?</label>
                      <select
                        value={vendaForm.teve_entrada ? 'sim' : 'nao'}
                        onChange={(e) => setVendaForm({
                          ...vendaForm, 
                          teve_entrada: e.target.value === 'sim',
                          valor_entrada: e.target.value === 'nao' ? '' : vendaForm.valor_entrada,
                          parcelou_entrada: e.target.value === 'nao' ? false : vendaForm.parcelou_entrada
                        })}
                      >
                        <option value="nao">Não</option>
                        <option value="sim">Sim</option>
                      </select>
                    </div>
                    {vendaForm.teve_entrada && (
                      <div className="form-group">
                        <label>Parcelou a Entrada?</label>
                        <select
                          value={vendaForm.parcelou_entrada ? 'sim' : 'nao'}
                          onChange={(e) => setVendaForm({...vendaForm, parcelou_entrada: e.target.value === 'sim', datas_parcelas_override: {}})}
                        >
                          <option value="nao">Não (à vista)</option>
                          <option value="sim">Sim</option>
                        </select>
                      </div>
                    )}
                    {vendaForm.teve_entrada && vendaForm.parcelou_entrada && (
                      <div className="form-row">
                        <div className="form-group">
                          <label>Periodicidade das Parcelas</label>
                          <select
                            value={vendaForm.periodicidade_parcelas}
                            onChange={(e) => setVendaForm({ ...vendaForm, periodicidade_parcelas: parseInt(e.target.value), datas_parcelas_override: {} })}
                          >
                            <option value={1}>Mensal (1 mês)</option>
                            <option value={3}>Trimestral (3 meses)</option>
                            <option value={4}>Quadrimestral (4 meses)</option>
                            <option value={6}>Semestral (6 meses)</option>
                            <option value={12}>Anual (12 meses)</option>
                          </select>
                        </div>

                        <div className="form-group">
                          <label>Dia de pagamento das parcelas</label>
                          <select
                            value={vendaForm.dia_pagamento_parcelas === 0 ? '0' : vendaForm.dia_pagamento_parcelas}
                            onChange={(e) => setVendaForm({ ...vendaForm, dia_pagamento_parcelas: parseInt(e.target.value), datas_parcelas_override: {} })}
                          >
                            <option value={1}>1</option>
                            <option value={5}>5</option>
                            <option value={10}>10</option>
                            <option value={15}>15</option>
                            <option value={20}>20</option>
                            <option value={25}>25</option>
                            <option value={30}>30</option>
                            <option value={0}>Outro</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {vendaForm.teve_entrada && vendaForm.parcelou_entrada && vendaForm.dia_pagamento_parcelas === 0 && (
                      <div className="form-group">
                        <label>Digite o dia (1-31)</label>
                        <input
                          type="number"
                          min="1"
                          max="31"
                          placeholder="Ex: 15"
                          value={vendaForm.dia_pagamento_parcelas_outro}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || ''
                            if (val === '' || (val >= 1 && val <= 31)) {
                              setVendaForm({ ...vendaForm, dia_pagamento_parcelas_outro: val?.toString() || '', datas_parcelas_override: {} })
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Datas das Próximas Parcelas (calculadas a partir de data_entrada + periodicidade) */}
                  {vendaForm.teve_entrada && vendaForm.parcelou_entrada && (() => {
                    const periodicidade = parseInt(vendaForm.periodicidade_parcelas) || 1
                    // Determinar qual dia usar (fixo ou customizado "Outro")
                    const diaFixo = vendaForm.dia_pagamento_parcelas === 0
                      ? (parseInt(vendaForm.dia_pagamento_parcelas_outro) || 1)
                      : (vendaForm.dia_pagamento_parcelas || 1)

                    let numeroParcela = 0
                    const parcelasCalc = []
                    ;(vendaForm.grupos_parcelas_entrada || []).forEach(grupo => {
                      const qtd = parseInt(grupo.qtd) || 0
                      const valor = parseFloat(grupo.valor) || 0
                      if (qtd > 0) {
                        for (let i = 0; i < qtd; i++) {
                          const idx = numeroParcela
                          const override = (vendaForm.datas_parcelas_override || {})[idx]
                          const dataAuto = vendaForm.data_entrada
                            ? getDataComDiaFixo(vendaForm.data_entrada, (idx + 1) * periodicidade, diaFixo)
                            : ''
                          const dataFinal = override || dataAuto
                          parcelasCalc.push({ idx, valor, dataFinal, isOverride: !!override })
                          numeroParcela++
                        }
                      }
                    })
                    return parcelasCalc.length > 0 ? (
                      <div className="form-group">
                        <label style={{ marginBottom: '8px', display: 'block' }}>Datas das Próximas Parcelas</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {parcelasCalc.map(({ idx, valor, dataFinal, isOverride }) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#1e2433', borderRadius: '8px' }}>
                              <span style={{ color: '#94a3b8', fontSize: '13px', minWidth: '140px' }}>
                                Parcela {idx + 1}{valor > 0 ? ` — ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor)}` : ''}
                              </span>
                              {editandoDataParcela === idx ? (
                                <>
                                  <input
                                    type="date"
                                    value={dataParcelaTemp}
                                    onChange={(e) => setDataParcelaTemp(e.target.value)}
                                    style={{ flex: 1 }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setVendaForm({ ...vendaForm, datas_parcelas_override: { ...(vendaForm.datas_parcelas_override || {}), [idx]: dataParcelaTemp } })
                                      setEditandoDataParcela(null)
                                    }}
                                    style={{ background: '#22c55e', color: 'white', border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                  >
                                    <Save size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditandoDataParcela(null)}
                                    style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                  >
                                    <X size={14} />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <span style={{ flex: 1, color: isOverride ? '#c9a962' : (dataFinal ? '#e2e8f0' : '#64748b'), fontSize: '14px' }}>
                                    {dataFinal ? formatDateBR(dataFinal) : (vendaForm.data_entrada ? '—' : 'Defina a Data da Entrada')}
                                    {isOverride && <span style={{ color: '#64748b', fontSize: '12px', marginLeft: '6px' }}>(editado)</span>}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => { setEditandoDataParcela(idx); setDataParcelaTemp(dataFinal || '') }}
                                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#c9a962', display: 'flex', alignItems: 'center' }}
                                  >
                                    <Edit2 size={16} />
                                  </button>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null
                  })()}

                  {/* Valor entrada à vista */}
                  {vendaForm.teve_entrada && !vendaForm.parcelou_entrada && (
                    <div className="form-group">
                      <label>Valor da Entrada</label>
                      <div className="input-currency">
                        <span className="currency-prefix">R$</span>
                        <input
                          type="text"
                          placeholder="0,00"
                          value={formatCurrencyInput(vendaForm.valor_entrada)}
                          onChange={(e) => handleCurrencyChange('valor_entrada', e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  {/* Parcelas da entrada */}
                  {vendaForm.teve_entrada && vendaForm.parcelou_entrada && (
                    <div className="form-group">
                      <label>Grupos de Parcelas</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
                        {(vendaForm.grupos_parcelas_entrada || []).map((grupo, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: '#1e2433', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                              <div className="form-group" style={{ flex: '0 0 120px', margin: 0 }}>
                                <input
                                  type="number"
                                  placeholder="Qtd"
                                  min="1"
                                  value={grupo.qtd}
                                  onChange={(e) => {
                                    const novosGrupos = [...(vendaForm.grupos_parcelas_entrada || [])]
                                    novosGrupos[idx].qtd = e.target.value
                                    setVendaForm({ ...vendaForm, grupos_parcelas_entrada: novosGrupos })
                                  }}
                                  style={{ width: '100%' }}
                                />
                              </div>
                              <span style={{ color: '#94a3b8', fontSize: '14px' }}>parcelas de</span>
                              <div className="input-currency" style={{ flex: 1 }}>
                                <span className="currency-prefix">R$</span>
                                <input
                                  type="text"
                                  placeholder="0,00"
                                  value={formatCurrencyInput(grupo.valor)}
                                  onChange={(e) => {
                                    const novosGrupos = [...(vendaForm.grupos_parcelas_entrada || [])]
                                    const cleanValue = e.target.value.replace(/[^\d]/g, '')
                                    const numValue = cleanValue ? (parseInt(cleanValue) / 100).toString() : ''
                                    novosGrupos[idx].valor = numValue
                                    setVendaForm({ ...vendaForm, grupos_parcelas_entrada: novosGrupos })
                                  }}
                                />
                              </div>
                              {(vendaForm.grupos_parcelas_entrada || []).length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const novosGrupos = (vendaForm.grupos_parcelas_entrada || []).filter((_, i) => i !== idx)
                                    setVendaForm({ ...vendaForm, grupos_parcelas_entrada: novosGrupos.length > 0 ? novosGrupos : [{ qtd: '', valor: '' }] })
                                  }}
                                  style={{ 
                                    background: '#ef4444', 
                                    color: 'white', 
                                    border: 'none', 
                                    borderRadius: '4px', 
                                    padding: '8px 12px', 
                                    cursor: 'pointer',
                                    fontSize: '14px'
                                  }}
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            setVendaForm({
                              ...vendaForm,
                              grupos_parcelas_entrada: [...(vendaForm.grupos_parcelas_entrada || []), { qtd: '', valor: '' }]
                            })
                          }}
                          style={{
                            background: '#c9a962',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '10px 16px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: '600',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            justifyContent: 'center'
                          }}
                        >
                          <Plus size={18} />
                          Adicionar Grupo
                        </button>
                      </div>
                    </div>
                  )}

                  {/* BALÃO */}
                  <div className="form-row">
                    <div className="form-group">
                      <label>Teve Balão?</label>
                      <select
                        value={vendaForm.teve_balao}
                        onChange={(e) => setVendaForm({
                          ...vendaForm,
                          teve_balao: e.target.value,
                          qtd_balao: e.target.value === 'nao' ? '' : vendaForm.qtd_balao,
                          valor_balao: e.target.value === 'nao' ? '' : vendaForm.valor_balao,
                          datas_balao_override: {}
                        })}
                      >
                        <option value="nao">Não</option>
                        <option value="sim">Sim</option>
                        <option value="pendente">Ainda não (pendente)</option>
                      </select>
                    </div>
                    {vendaForm.teve_balao === 'sim' && (
                      <div className="form-row">
                        <div className="form-group">
                          <label>Periodicidade dos Balões</label>
                          <select
                            value={vendaForm.periodicidade_balao}
                            onChange={(e) => setVendaForm({ ...vendaForm, periodicidade_balao: parseInt(e.target.value), datas_balao_override: {} })}
                          >
                            <option value={3}>Trimestral (3 meses)</option>
                            <option value={4}>Quadrimestral (4 meses)</option>
                            <option value={6}>Semestral (6 meses)</option>
                            <option value={12}>Anual (12 meses)</option>
                          </select>
                        </div>

                        <div className="form-group">
                          <label>Dia de pagamento dos balões</label>
                          <select
                            value={vendaForm.dia_pagamento_balao === 0 ? '0' : vendaForm.dia_pagamento_balao}
                            onChange={(e) => setVendaForm({ ...vendaForm, dia_pagamento_balao: parseInt(e.target.value), datas_balao_override: {} })}
                          >
                            <option value={1}>1</option>
                            <option value={5}>5</option>
                            <option value={10}>10</option>
                            <option value={15}>15</option>
                            <option value={20}>20</option>
                            <option value={25}>25</option>
                            <option value={30}>30</option>
                            <option value={0}>Outro</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {vendaForm.teve_balao === 'sim' && vendaForm.dia_pagamento_balao === 0 && (
                      <div className="form-group">
                        <label>Digite o dia (1-31)</label>
                        <input
                          type="number"
                          min="1"
                          max="31"
                          placeholder="Ex: 15"
                          value={vendaForm.dia_pagamento_balao_outro}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || ''
                            if (val === '' || (val >= 1 && val <= 31)) {
                              setVendaForm({ ...vendaForm, dia_pagamento_balao_outro: val?.toString() || '', datas_balao_override: {} })
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {(vendaForm.teve_balao === 'sim' || vendaForm.teve_balao === 'pendente') && (
                    <div className="form-group">
                      <label>Grupos de Balões</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
                        {(vendaForm.grupos_balao || []).map((grupo, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: '#1e2433', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                              <div className="form-group" style={{ flex: '0 0 120px', margin: 0 }}>
                                <input
                                  type="number"
                                  placeholder="Qtd"
                                  min="1"
                                  value={grupo.qtd}
                                  onChange={(e) => {
                                    const novosGrupos = [...(vendaForm.grupos_balao || [])]
                                    novosGrupos[idx].qtd = e.target.value
                                    setVendaForm({ ...vendaForm, grupos_balao: novosGrupos })
                                  }}
                                  style={{ width: '100%' }}
                                />
                              </div>
                              <span style={{ color: '#94a3b8', fontSize: '14px' }}>balões de</span>
                              <div className="input-currency" style={{ flex: 1 }}>
                                <span className="currency-prefix">R$</span>
                                <input
                                  type="text"
                                  placeholder="0,00"
                                  value={formatCurrencyInput(grupo.valor)}
                                  onChange={(e) => {
                                    const novosGrupos = [...(vendaForm.grupos_balao || [])]
                                    const cleanValue = e.target.value.replace(/[^\d]/g, '')
                                    const numValue = cleanValue ? (parseInt(cleanValue) / 100).toString() : ''
                                    novosGrupos[idx].valor = numValue
                                    setVendaForm({ ...vendaForm, grupos_balao: novosGrupos })
                                  }}
                                />
                              </div>
                              {(vendaForm.grupos_balao || []).length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const novosGrupos = (vendaForm.grupos_balao || []).filter((_, i) => i !== idx)
                                    setVendaForm({ ...vendaForm, grupos_balao: novosGrupos.length > 0 ? novosGrupos : [{ qtd: '', valor: '' }] })
                                  }}
                                  style={{ 
                                    background: '#ef4444', 
                                    color: 'white', 
                                    border: 'none', 
                                    borderRadius: '4px', 
                                    padding: '8px 12px', 
                                    cursor: 'pointer',
                                    fontSize: '14px'
                                  }}
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            setVendaForm({
                              ...vendaForm,
                              grupos_balao: [...(vendaForm.grupos_balao || []), { qtd: '', valor: '' }]
                            })
                          }}
                          style={{
                            background: '#c9a962',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '10px 16px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: '600',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            justifyContent: 'center'
                          }}
                        >
                          <Plus size={18} />
                          Adicionar Grupo
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Datas dos Balões — calculadas conforme periodicidade a partir da Data da Entrada */}
                  {vendaForm.teve_balao === 'sim' && (() => {
                    const periBalaoUI = parseInt(vendaForm.periodicidade_balao) || 6
                    // Determinar qual dia usar (fixo ou customizado "Outro")
                    const diaFixoBalao = vendaForm.dia_pagamento_balao === 0
                      ? (parseInt(vendaForm.dia_pagamento_balao_outro) || 1)
                      : (vendaForm.dia_pagamento_balao || 1)

                    let numeroBalao = 0
                    const baloesCalc = []
                    ;(vendaForm.grupos_balao || []).forEach(grupo => {
                      const qtd = parseInt(grupo.qtd) || 0
                      const valor = parseFloat(grupo.valor) || 0
                      if (qtd > 0) {
                        for (let i = 0; i < qtd; i++) {
                          const idx = numeroBalao
                          const override = (vendaForm.datas_balao_override || {})[idx]
                          const dataAuto = vendaForm.data_entrada
                            ? getDataComDiaFixo(vendaForm.data_entrada, (idx + 1) * periBalaoUI, diaFixoBalao)
                            : ''
                          const dataFinal = override || dataAuto
                          baloesCalc.push({ idx, valor, dataFinal, isOverride: !!override })
                          numeroBalao++
                        }
                      }
                    })
                    return baloesCalc.length > 0 ? (
                      <div className="form-group">
                        <label style={{ marginBottom: '8px', display: 'block' }}>Data do Balão</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {baloesCalc.map(({ idx, valor, dataFinal, isOverride }) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#1e2433', borderRadius: '8px' }}>
                              <span style={{ color: '#94a3b8', fontSize: '13px', minWidth: '140px' }}>
                                Balão {idx + 1}{valor > 0 ? ` — ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor)}` : ''}
                              </span>
                              {editandoDataBalao === idx ? (
                                <>
                                  <input
                                    type="date"
                                    value={dataBalaoTemp}
                                    onChange={(e) => setDataBalaoTemp(e.target.value)}
                                    style={{ flex: 1 }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setVendaForm({ ...vendaForm, datas_balao_override: { ...(vendaForm.datas_balao_override || {}), [idx]: dataBalaoTemp } })
                                      setEditandoDataBalao(null)
                                    }}
                                    style={{ background: '#22c55e', color: 'white', border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                  >
                                    <Save size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditandoDataBalao(null)}
                                    style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                  >
                                    <X size={14} />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <span style={{ flex: 1, color: isOverride ? '#c9a962' : (dataFinal ? '#e2e8f0' : '#64748b'), fontSize: '14px' }}>
                                    {dataFinal ? formatDateBR(dataFinal) : (vendaForm.data_entrada ? '—' : 'Defina a Data da Entrada')}
                                    {isOverride && <span style={{ color: '#64748b', fontSize: '12px', marginLeft: '6px' }}>(editado)</span>}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => { setEditandoDataBalao(idx); setDataBalaoTemp(dataFinal || '') }}
                                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#c9a962', display: 'flex', alignItems: 'center' }}
                                  >
                                    <Edit2 size={16} />
                                  </button>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null
                  })()}

                  {/* PERMUTA */}
                  <div className="form-row">
                    <div className="form-group">
                      <label>Teve Permuta?</label>
                      <select
                        value={vendaForm.teve_permuta ? 'sim' : 'nao'}
                        onChange={(e) => setVendaForm({
                          ...vendaForm, 
                          teve_permuta: e.target.value === 'sim',
                          tipo_permuta: e.target.value === 'nao' ? '' : vendaForm.tipo_permuta,
                          valor_permuta: e.target.value === 'nao' ? '' : vendaForm.valor_permuta
                        })}
                      >
                        <option value="nao">Não</option>
                        <option value="sim">Sim</option>
                      </select>
                    </div>
                    {vendaForm.teve_permuta && (
                      <div className="form-group">
                        <label>Tipo de Permuta</label>
                        <select
                          value={vendaForm.tipo_permuta}
                          onChange={(e) => setVendaForm({...vendaForm, tipo_permuta: e.target.value})}
                        >
                          <option value="">Selecione</option>
                          <option value="imovel">Imóvel</option>
                          <option value="veiculo">Veículo</option>
                          <option value="outros">Outros</option>
                        </select>
                      </div>
                    )}
                  </div>

                  {vendaForm.teve_permuta && (
                    <div className="form-group">
                      <label>Valor da Permuta</label>
                      <div className="input-currency">
                        <span className="currency-prefix">R$</span>
                        <input
                          type="text"
                          placeholder="0,00"
                          value={formatCurrencyInput(vendaForm.valor_permuta)}
                          onChange={(e) => handleCurrencyChange('valor_permuta', e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  <div className="form-group">
                    <label>Status</label>
                    <select
                      value={vendaForm.status}
                      onChange={(e) => setVendaForm({...vendaForm, status: e.target.value})}
                    >
                      <option value="pendente">Pendente</option>
                      <option value="em_andamento">Em Andamento</option>
                      <option value="pago">Comissão Paga</option>
                    </select>
                  </div>

                  <div className="section-divider">
                    <span>Contrato</span>
                  </div>

                  <div className="contrato-upload-area">
                    {!vendaForm.contrato_url && !contratoFile ? (
                      <label className="upload-box">
                        <input
                          type="file"
                          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                          onChange={(e) => {
                            const file = e.target.files[0]
                            if (file) {
                              setContratoFile(file)
                              setVendaForm({ ...vendaForm, contrato_nome: file.name })
                            }
                          }}
                          style={{ display: 'none' }}
                        />
                        <Upload size={32} />
                        <span>Clique para anexar contrato</span>
                        <small>PDF, DOC, DOCX, JPG ou PNG</small>
                      </label>
                    ) : (
                      <div className="contrato-anexado">
                        <FileText size={24} />
                        <div className="contrato-info">
                          <span className="contrato-nome">
                            {contratoFile?.name || vendaForm.contrato_nome}
                          </span>
                          {vendaForm.contrato_url && !contratoFile && (
                            <a 
                              href={vendaForm.contrato_url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="contrato-link"
                            >
                              Visualizar
                            </a>
                          )}
                          {contratoFile && (
                            <span className="contrato-novo">Novo arquivo</span>
                          )}
                        </div>
                        <button 
                          type="button" 
                          className="btn-remove-contrato"
                          onClick={handleRemoveContrato}
                        >
                          <Trash size={16} />
                        </button>
                      </div>
                    )}
                    {uploadingContrato && (
                      <div className="upload-progress">
                        <div className="loading-spinner"></div>
                        <span>Enviando contrato...</span>
                      </div>
                    )}
                  </div>

                  {vendaForm.valor_venda && vendaForm.corretor_id && (
                    <div className="preview-comissoes">
                      <h4>Resumo da Venda</h4>
                      <div className="preview-grid four-cols">
                        <div className="preview-item">
                          <span>Valor Venda</span>
                          <span>{formatCurrency(parseFloat(vendaForm.valor_venda || 0))}</span>
                        </div>
                        <div className="preview-item">
                          <span>Pro-Soluto</span>
                          <span>{formatCurrency(
                            (parseFloat(vendaForm.valor_sinal) || 0) +
                            (vendaForm.teve_entrada
                              ? (vendaForm.parcelou_entrada
                                  ? (vendaForm.grupos_parcelas_entrada || []).reduce((sum, grupo) => sum + ((parseFloat(grupo.qtd) || 0) * (parseFloat(grupo.valor) || 0)), 0)
                                  : (parseFloat(vendaForm.valor_entrada) || 0))
                              : 0) +
                            (vendaForm.teve_balao === 'sim'
                              ? (vendaForm.grupos_balao || []).reduce((sum, grupo) => sum + ((parseFloat(grupo.qtd) || 0) * (parseFloat(grupo.valor) || 0)), 0)
                              : 0)
                          )}</span>
                        </div>
                        {(() => {
                          const valorVenda = parseFloat(vendaForm.valor_venda) || 0
                          const sinal = vendaForm.teve_sinal ? (parseFloat(vendaForm.valor_sinal) || 0) : 0
                          const parcelas = vendaForm.teve_entrada
                            ? (vendaForm.parcelou_entrada
                                ? (vendaForm.grupos_parcelas_entrada || []).reduce((sum, g) => sum + ((parseFloat(g.qtd) || 0) * (parseFloat(g.valor) || 0)), 0)
                                : (parseFloat(vendaForm.valor_entrada) || 0))
                            : 0
                          const baloes = vendaForm.teve_balao === 'sim'
                            ? (vendaForm.grupos_balao || []).reduce((sum, g) => sum + ((parseFloat(g.qtd) || 0) * (parseFloat(g.valor) || 0)), 0)
                            : 0
                          const saldo = valorVenda - sinal - parcelas - baloes
                          return (
                            <div className={`preview-item ${saldo < 0 ? 'saldo-negativo' : 'saldo-positivo'}`}>
                              <span>Saldo Remanescente</span>
                              <span>{formatCurrency(saldo)}</span>
                            </div>
                          )
                        })()}
                        {getPreviewComissoes().cargos.map((cargo, idx) => (
                          <div key={idx} className="preview-item">
                            <span>{cargo.nome_cargo}</span>
                            <span>{formatCurrency(cargo.valor)}</span>
                          </div>
                        ))}
                        <div className="preview-item total">
                          <span>Comissão Total</span>
                          <span>{formatCurrency(getPreviewComissoes().total)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Renegociação de Parcelas — só para edição de venda já salva */}
                  {selectedItem && pagamentosVendaEditando.length > 0 && (() => {
                    console.log('🔍 Verificando renegociação:', { selectedItem: !!selectedItem, pagamentos: pagamentosVendaEditando.length })
                    const pendentes = pagamentosVendaEditando.filter(p => p.status !== 'pago')
                    console.log('⏳ Pendentes:', pendentes.length)
                    if (pendentes.length === 0) return null
                    return (
                      <div className="renegociacao-section">
                        <div className="renegociacao-header">
                          <ClipboardList size={16} />
                          <span>Renegociação de Parcelas</span>
                          <span className="renegociacao-hint">Selecione parcelas pendentes para renegociar</span>
                        </div>
                        <div className="renegociacao-lista">
                          {pendentes.map(pag => {
                            const checked = parcelasSelecionadas.some(s => s.id === pag.id)
                            const labelTipo = {
                              sinal: 'Sinal',
                              entrada: 'Entrada',
                              parcela_entrada: `Parcela Ent. ${pag.numero_parcela ?? ''}`,
                              balao: `Balão ${pag.numero_parcela ?? ''}`,
                              comissao_integral: 'Comissão Integral'
                            }[pag.tipo] || pag.tipo
                            return (
                              <label key={pag.id} className={`renegociacao-item${checked ? ' selected' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={e => {
                                    if (e.target.checked) {
                                      setParcelasSelecionadas(prev => [...prev, pag])
                                    } else {
                                      setParcelasSelecionadas(prev => prev.filter(s => s.id !== pag.id))
                                    }
                                  }}
                                />
                                <span className="renegociacao-item-tipo">{labelTipo}</span>
                                <span className="renegociacao-item-valor">{formatCurrency(pag.valor)}</span>
                                <span className="renegociacao-item-data">
                                  {pag.data_prevista ? formatDataBR(pag.data_prevista) : '—'}
                                </span>
                                <span className="renegociacao-item-comissao">
                                  Comissão: {formatCurrency(pag.comissao_gerada)}
                                </span>
                              </label>
                            )
                          })}
                        </div>
                        {parcelasSelecionadas.length > 0 && (
                          <button
                            className="btn-renegociar"
                            onClick={abrirModalRenegociacao}
                            type="button"
                          >
                            <RefreshCw size={16} />
                            Renegociar {parcelasSelecionadas.length} parcela{parcelasSelecionadas.length > 1 ? 's' : ''} selecionada{parcelasSelecionadas.length > 1 ? 's' : ''}
                          </button>
                        )}
                      </div>
                    )
                  })()}
                </div>

                <div className="modal-footer">
                  <button className="btn-secondary" onClick={() => setShowModal(false)}>
                    Cancelar
                  </button>
                  <button className="btn-primary" onClick={handleSaveVenda} disabled={saving}>
                    {saving ? <div className="btn-spinner"></div> : <Save size={18} />}
                    <span>{saving ? 'Salvando...' : 'Salvar'}</span>
                  </button>
                </div>
              </>
            )}

            {/* Modal de Corretor */}
            {modalType === 'corretor' && (
              <>
                <div className="modal-body">
                  <div className="form-group">
                    <label>Nome Completo *</label>
                    <div className="input-with-icon">
                      <User size={18} />
                      <input
                        type="text"
                        placeholder="Nome do corretor"
                        value={corretorForm.nome}
                        onChange={(e) => setCorretorForm({...corretorForm, nome: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Email * {selectedItem && '(não editável)'}</label>
                    <div className="input-with-icon">
                      <Mail size={18} />
                      <input
                        type="email"
                        placeholder="email@exemplo.com"
                        value={corretorForm.email}
                        onChange={(e) => setCorretorForm({...corretorForm, email: e.target.value})}
                        disabled={!!selectedItem}
                        style={selectedItem ? { opacity: 0.6 } : {}}
                      />
                    </div>
                  </div>
                  {/* Senha para novo corretor */}
                  {!selectedItem && (
                    <div className="form-group">
                      <label>Senha * (mínimo 6 caracteres)</label>
                      <div className="input-with-icon">
                        <Lock size={18} />
                        <input
                          type="password"
                          placeholder="Senha de acesso"
                          value={corretorForm.senha}
                          onChange={(e) => setCorretorForm({...corretorForm, senha: e.target.value})}
                        />
                      </div>
                    </div>
                  )}

                  {/* Seção de Acesso ao Sistema - apenas para edição */}
                  {selectedItem && (
                    <div className="access-section" style={{
                      background: corretorForm.tem_acesso_sistema 
                        ? 'rgba(16, 185, 129, 0.1)' 
                        : 'rgba(245, 158, 11, 0.1)',
                      border: `1px solid ${corretorForm.tem_acesso_sistema ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                      borderRadius: '8px',
                      padding: '16px',
                      marginBottom: '16px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        {corretorForm.tem_acesso_sistema ? (
                          <>
                            <CheckCircle size={20} style={{ color: '#10b981' }} />
                            <span style={{ fontWeight: '600', color: '#10b981' }}>Acesso ao Sistema Ativo</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle size={20} style={{ color: '#f59e0b' }} />
                            <span style={{ fontWeight: '600', color: '#f59e0b' }}>Sem Acesso ao Sistema</span>
                          </>
                        )}
                      </div>
                      
                      {corretorForm.tem_acesso_sistema ? (
                        <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', margin: 0 }}>
                          Este corretor pode fazer login no sistema com o email cadastrado.
                        </p>
                      ) : (
                        <>
                          <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', marginBottom: '12px' }}>
                            Este corretor foi sincronizado do Sienge e ainda não tem acesso ao sistema. 
                            Ative o acesso para que ele possa fazer login e visualizar suas comissões.
                          </p>
                          
                          <div className="form-group" style={{ marginBottom: '12px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={corretorForm.ativar_acesso}
                                onChange={(e) => setCorretorForm({...corretorForm, ativar_acesso: e.target.checked})}
                                style={{ width: '18px', height: '18px' }}
                              />
                              <span>Ativar acesso ao sistema</span>
                            </label>
                          </div>
                          
                          {corretorForm.ativar_acesso && (
                            <>
                              {(corretorForm.email?.includes('@sync.local') || corretorForm.email?.includes('@placeholder.local')) && (
                                <div style={{
                                  background: 'rgba(239, 68, 68, 0.1)',
                                  border: '1px solid rgba(239, 68, 68, 0.3)',
                                  borderRadius: '6px',
                                  padding: '10px',
                                  marginBottom: '12px'
                                }}>
                                  <p style={{ fontSize: '12px', color: '#ef4444', margin: 0 }}>
                                    ⚠️ O email atual é temporário. Altere para um email válido antes de ativar o acesso.
                                  </p>
                                </div>
                              )}
                              
                              <div className="form-group" style={{ marginBottom: '8px' }}>
                                <label>Email para Login *</label>
                                <div className="input-with-icon">
                                  <Mail size={18} />
                                  <input
                                    type="email"
                                    placeholder="email@exemplo.com"
                                    value={corretorForm.email}
                                    onChange={(e) => setCorretorForm({...corretorForm, email: e.target.value})}
                                  />
                                </div>
                              </div>
                              
                              <div className="form-group">
                                <label>Senha * (mínimo 6 caracteres)</label>
                                <div className="input-with-icon">
                                  <Lock size={18} />
                                  <input
                                    type="password"
                                    placeholder="Defina uma senha"
                                    value={corretorForm.senha}
                                    onChange={(e) => setCorretorForm({...corretorForm, senha: e.target.value})}
                                  />
                                </div>
                                <small style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
                                  A senha é armazenada de forma segura (criptografada). Apenas o corretor terá acesso.
                                </small>
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  <div className="section-divider">
                    <span>Vínculo com Empreendimento</span>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Tipo de Corretor *</label>
                      <select
                        value={corretorForm.tipo_corretor}
                        onChange={(e) => handleTipoCorretorChangeEmp(e.target.value)}
                      >
                        <option value="externo">Externo</option>
                        <option value="interno">Interno</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Empreendimento *</label>
                      <select
                        value={corretorForm.is_autonomo ? 'autonomo' : corretorForm.empreendimento_id}
                        onChange={(e) => handleEmpreendimentoChange(e.target.value)}
                      >
                        <option value="">Selecione um empreendimento</option>
                        <option value="autonomo">Autônomo</option>
                        {[...empreendimentos].sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR')).map((emp) => (
                          <option key={emp.id} value={emp.id}>{emp.nome}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {corretorForm.is_autonomo ? (
                    <div className="form-group">
                      <label>Comissão Personalizada (%) *</label>
                      <div className="input-with-icon">
                        <Percent size={18} />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          placeholder="Ex: 5.5"
                          value={corretorForm.percentual_corretor}
                          onChange={(e) => setCorretorForm({...corretorForm, percentual_corretor: e.target.value})}
                        />
                      </div>
                      <small className="form-hint">
                        Esta será a comissão aplicada em todas as vendas deste corretor autônomo
                      </small>
                    </div>
                  ) : corretorForm.empreendimento_id && (
                    <div className="form-group">
                      <label>Cargo *</label>
                      <select
                        value={corretorForm.cargo_id}
                        onChange={(e) => handleCargoChange(e.target.value)}
                      >
                        <option value="">Selecione um cargo</option>
                        {cargosDisponiveis.map((cargo) => (
                          <option key={cargo.id} value={cargo.id}>
                            {cargo.nome_cargo} ({cargo.percentual}%)
                          </option>
                        ))
                        }
                      </select>
                    </div>
                  )}

                  {corretorForm.cargo_id && corretorForm.percentual_corretor && (
                    <div className="cargo-preview">
                      <span>Comissão do cargo:</span>
                      <strong>{corretorForm.percentual_corretor}%</strong>
                    </div>
                  )}

                  <div className="form-group">
                    <label>Telefone</label>
                    <input
                      type="tel"
                      placeholder="(00) 00000-0000"
                      value={corretorForm.telefone}
                      onChange={(e) => setCorretorForm({...corretorForm, telefone: formatTelefone(e.target.value)})}
                    />
                  </div>

                  <div className="section-divider">
                    <span>Dados Profissionais (opcional)</span>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>CNPJ</label>
                      <input
                        type="text"
                        placeholder="00.000.000/0000-00"
                        value={corretorForm.cnpj}
                        onChange={(e) => setCorretorForm({...corretorForm, cnpj: e.target.value})}
                      />
                    </div>
                    <div className="form-group">
                      <label>CRECI</label>
                      <input
                        type="text"
                        placeholder="Ex: 12345-F"
                        value={corretorForm.creci}
                        onChange={(e) => setCorretorForm({...corretorForm, creci: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Imobiliária</label>
                    <input
                      type="text"
                      placeholder="Nome da imobiliária"
                      value={corretorForm.imobiliaria}
                      onChange={(e) => setCorretorForm({...corretorForm, imobiliaria: e.target.value})}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn-secondary" onClick={() => setShowModal(false)}>
                    Cancelar
                  </button>
                  <button className="btn-primary" onClick={handleSaveCorretor} disabled={saving}>
                    {saving ? <div className="btn-spinner"></div> : (selectedItem ? <Save size={18} /> : <UserPlus size={18} />)}
                    <span>{saving ? 'Salvando...' : (selectedItem ? 'Salvar' : 'Criar Corretor')}</span>
                  </button>
                </div>
              </>
            )}

            {/* Modal de Empreendimento */}
            {modalType === 'empreendimento' && (
              <>
                <div className="modal-body modal-body-scroll">
                  <div className="form-group">
                    <label>Nome do Empreendimento *</label>
                    <input
                      type="text"
                      placeholder="Ex: Residencial Park"
                      value={empreendimentoForm.nome}
                      onChange={(e) => setEmpreendimentoForm({...empreendimentoForm, nome: e.target.value})}
                    />
                  </div>
                  <div className="form-group">
                    <label>Descrição</label>
                    <input
                      type="text"
                      placeholder="Descrição do empreendimento"
                      value={empreendimentoForm.descricao}
                      onChange={(e) => setEmpreendimentoForm({...empreendimentoForm, descricao: e.target.value})}
                    />
                  </div>

                  {/* TOTAL DE UNIDADES */}
                  <div className="form-group">
                    <label>Total de Unidades</label>
                    <input
                      type="number"
                      placeholder="Ex: 120"
                      min="0"
                      value={empreendimentoForm.total_unidades}
                      onChange={(e) => setEmpreendimentoForm({...empreendimentoForm, total_unidades: e.target.value})}
                    />
                  </div>

                  {/* PROGRESSO DA OBRA */}
                  <div className="form-group">
                    <label>Progresso da Obra: {empreendimentoForm.progresso_obra}%</label>
                    <div className="progress-input-container">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={empreendimentoForm.progresso_obra}
                        onChange={(e) => setEmpreendimentoForm({...empreendimentoForm, progresso_obra: e.target.value})}
                        className="progress-slider"
                      />
                      <div className="progress-bar-preview">
                        <div 
                          className="progress-bar-fill"
                          style={{ width: `${empreendimentoForm.progresso_obra}%` }}
                        />
                      </div>
                      <div className="progress-labels">
                        <span>0%</span>
                        <span>50%</span>
                        <span>100%</span>
                      </div>
                    </div>
                  </div>

                  {/* LOGO DO EMPREENDIMENTO */}
                  <div className="form-group">
                    <label>Logo do Empreendimento</label>
                    <div className="logo-upload-container">
                      {empreendimentoForm.logo_url ? (
                        <div className="logo-preview">
                          <img 
                            src={empreendimentoForm.logo_url} 
                            alt="Logo do empreendimento" 
                            className="logo-preview-img"
                          />
                          <button 
                            type="button" 
                            className="btn-remove-logo"
                            onClick={() => setEmpreendimentoForm({...empreendimentoForm, logo_url: ''})}
                            title="Remover logo"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <label className="logo-upload-area">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/svg+xml"
                            onChange={handleLogoUpload}
                            disabled={uploadingLogo}
                            style={{ display: 'none' }}
                          />
                          {uploadingLogo ? (
                            <div className="upload-loading">
                              <div className="btn-spinner"></div>
                              <span>Enviando...</span>
                            </div>
                          ) : (
                            <>
                              <Upload size={24} />
                              <span>Clique para enviar a logo</span>
                              <small>JPG, PNG, WEBP ou SVG (máx 5MB)</small>
                            </>
                          )}
                        </label>
                      )}
                    </div>
                  </div>

                  {/* SEÇÃO EXTERNO */}
                  <div className="tipo-section externo">
                    <div className="tipo-header">
                      <h4>Corretor Externo</h4>
                      <div className="form-group inline">
                        <label>Comissão Total:</label>
                        <input
                          type="number"
                          step="0.1"
                          placeholder="7"
                          value={empreendimentoForm.comissao_total_externo}
                          onChange={(e) => setEmpreendimentoForm({...empreendimentoForm, comissao_total_externo: e.target.value})}
                        />
                        <span>%</span>
                      </div>
                    </div>
                    <div className="cargos-form">
                      {empreendimentoForm.cargos_externo.map((cargo, index) => (
                        <div key={index} className="cargo-form-row">
                          <input
                            type="text"
                            placeholder="Nome do cargo"
                            value={cargo.nome_cargo}
                            onChange={(e) => updateCargo('externo', index, 'nome_cargo', e.target.value)}
                          />
                          <input
                            type="number"
                            step="0.1"
                            placeholder="%"
                            value={cargo.percentual}
                            onChange={(e) => updateCargo('externo', index, 'percentual', e.target.value)}
                          />
                          <button 
                            type="button" 
                            className="action-btn delete small"
                            onClick={() => removeCargo('externo', index)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                      <button type="button" className="btn-add-cargo" onClick={() => addCargo('externo')}>
                        <PlusCircle size={16} />
                        <span>Adicionar Cargo Externo</span>
                      </button>
                    </div>
                    <div className="preview-comissoes">
                      <span>Total Cargos Externos: {empreendimentoForm.cargos_externo.reduce((acc, c) => acc + (parseFloat(c.percentual) || 0), 0).toFixed(2)}%</span>
                    </div>
                  </div>

                  {/* SEÇÃO INTERNO */}
                  <div className="tipo-section interno">
                    <div className="tipo-header">
                      <h4>Corretor Interno</h4>
                      <div className="form-group inline">
                        <label>Comissão Total:</label>
                        <input
                          type="number"
                          step="0.1"
                          placeholder="6"
                          value={empreendimentoForm.comissao_total_interno}
                          onChange={(e) => setEmpreendimentoForm({...empreendimentoForm, comissao_total_interno: e.target.value})}
                        />
                        <span>%</span>
                      </div>
                    </div>
                    <div className="cargos-form">
                      {empreendimentoForm.cargos_interno.map((cargo, index) => (
                        <div key={index} className="cargo-form-row">
                          <input
                            type="text"
                            placeholder="Nome do cargo"
                            value={cargo.nome_cargo}
                            onChange={(e) => updateCargo('interno', index, 'nome_cargo', e.target.value)}
                          />
                          <input
                            type="number"
                            step="0.1"
                            placeholder="%"
                            value={cargo.percentual}
                            onChange={(e) => updateCargo('interno', index, 'percentual', e.target.value)}
                          />
                          <button 
                            type="button" 
                            className="action-btn delete small"
                            onClick={() => removeCargo('interno', index)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                      <button type="button" className="btn-add-cargo interno" onClick={() => addCargo('interno')}>
                        <PlusCircle size={16} />
                        <span>Adicionar Cargo Interno</span>
                      </button>
                    </div>
                    <div className="preview-comissoes interno">
                      <span>Total Cargos Internos: {empreendimentoForm.cargos_interno.reduce((acc, c) => acc + (parseFloat(c.percentual) || 0), 0).toFixed(2)}%</span>
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn-secondary" onClick={() => setShowModal(false)}>
                    Cancelar
                  </button>
                  <button className="btn-primary" onClick={handleSaveEmpreendimento} disabled={saving}>
                    {saving ? <div className="btn-spinner"></div> : <Save size={18} />}
                    <span>{saving ? 'Salvando...' : 'Salvar'}</span>
                  </button>
                </div>
              </>
            )}

            {/* Modal de Cliente */}
            {modalType === 'cliente' && (
              <>
                <div className="modal-body modal-body-scroll">
                  {/* Dados Pessoais */}
                  <div className="section-divider"><span>Dados Pessoais</span></div>
                  
                  <div className="form-group">
                    <label>Nome Completo *</label>
                    <input
                      type="text"
                      placeholder="Nome completo do cliente"
                      value={clienteForm.nome_completo}
                      onChange={(e) => setClienteForm({...clienteForm, nome_completo: e.target.value})}
                    />
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Data de Nascimento</label>
                      <input
                        type="date"
                        value={clienteForm.data_nascimento}
                        onChange={(e) => setClienteForm({...clienteForm, data_nascimento: e.target.value})}
                      />
                    </div>
                    <div className="form-group">
                      <label>CPF</label>
                      <input
                        type="text"
                        placeholder="000.000.000-00"
                        value={clienteForm.cpf}
                        onChange={(e) => setClienteForm({...clienteForm, cpf: formatCPF(e.target.value)})}
                      />
                    </div>
                    <div className="form-group">
                      <label>RG</label>
                      <input
                        type="text"
                        placeholder="Número do RG"
                        value={clienteForm.rg}
                        onChange={(e) => setClienteForm({...clienteForm, rg: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Endereço</label>
                    <input
                      type="text"
                      placeholder="Endereço completo"
                      value={clienteForm.endereco}
                      onChange={(e) => setClienteForm({...clienteForm, endereco: e.target.value})}
                    />
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Telefone</label>
                      <input
                        type="text"
                        placeholder="(00) 00000-0000"
                        value={clienteForm.telefone}
                        onChange={(e) => setClienteForm({...clienteForm, telefone: formatTelefone(e.target.value)})}
                      />
                    </div>
                    <div className="form-group">
                      <label>E-mail</label>
                      <input
                        type="email"
                        placeholder="email@exemplo.com"
                        value={clienteForm.email}
                        onChange={(e) => setClienteForm({...clienteForm, email: e.target.value})}
                      />
                    </div>
                  </div>

                  {/* Acesso ao Sistema */}
                  <div className="section-divider"><span>Acesso ao Sistema</span></div>
                  
                  {selectedItem?.user_id ? (
                    <div className="form-group">
                      <div className="acesso-info success">
                        <CheckCircle size={16} />
                        <span>Cliente já possui acesso ao sistema</span>
                      </div>
                      <small className="form-hint">
                        Email: {selectedItem.email || clienteForm.email || 'Não informado'}
                      </small>
                    </div>
                  ) : (
                    <>
                      <div className="form-group">
                        <label>Criar acesso para o cliente?</label>
                        <select
                          value={clienteForm.criar_acesso ? 'sim' : 'nao'}
                          onChange={(e) => setClienteForm({...clienteForm, criar_acesso: e.target.value === 'sim'})}
                        >
                          <option value="nao">Não</option>
                          <option value="sim">Sim</option>
                        </select>
                        {!selectedItem && (
                          <small className="form-hint">
                            Você pode criar o acesso agora ou depois, editando o cliente.
                          </small>
                        )}
                        {selectedItem && !selectedItem.user_id && (
                          <small className="form-hint warning">
                            ⚠ Este cliente ainda não possui acesso ao sistema. Marque "Sim" e defina uma senha para criar.
                          </small>
                        )}
                      </div>
                      
                      {clienteForm.criar_acesso && (
                        <div className="acesso-box">
                          <div className="acesso-info">
                            <Lock size={16} />
                            <span>O cliente usará o e-mail acima para fazer login</span>
                          </div>
                          {!clienteForm.email && (
                            <div className="acesso-info warning">
                              <AlertCircle size={16} />
                              <span>É necessário informar o e-mail do cliente para criar o acesso</span>
                            </div>
                          )}
                          <div className="form-group">
                            <label>Senha de acesso *</label>
                            <input
                              type="password"
                              placeholder="Mínimo 6 caracteres"
                              value={clienteForm.senha}
                              onChange={(e) => setClienteForm({...clienteForm, senha: e.target.value})}
                            />
                            <small className="form-hint">
                              A senha será usada pelo cliente para fazer login no sistema
                            </small>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Dados Profissionais */}
                  <div className="section-divider"><span>Dados Profissionais</span></div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Profissão</label>
                      <input
                        type="text"
                        placeholder="Ex: Engenheiro, Advogado"
                        value={clienteForm.profissao}
                        onChange={(e) => setClienteForm({...clienteForm, profissao: e.target.value})}
                      />
                    </div>
                    <div className="form-group">
                      <label>Empresa onde trabalha</label>
                      <input
                        type="text"
                        placeholder="Nome da empresa"
                        value={clienteForm.empresa_trabalho}
                        onChange={(e) => setClienteForm({...clienteForm, empresa_trabalho: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Renda Mensal</label>
                    <div className="input-currency">
                      <span className="currency-prefix">R$</span>
                      <input
                        type="text"
                        placeholder="0,00"
                        value={clienteForm.renda_mensal}
                        onChange={(e) => setClienteForm({...clienteForm, renda_mensal: e.target.value})}
                      />
                    </div>
                  </div>

                  {/* FGTS */}
                  <div className="section-divider"><span>Informações FGTS</span></div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Possui 3 anos de FGTS?</label>
                      <select
                        value={clienteForm.possui_3_anos_fgts ? 'sim' : 'nao'}
                        onChange={(e) => setClienteForm({...clienteForm, possui_3_anos_fgts: e.target.value === 'sim'})}
                      >
                        <option value="nao">Não</option>
                        <option value="sim">Sim</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Já foi subsidiado após 16/05/05?</label>
                      <select
                        value={clienteForm.beneficiado_subsidio_fgts ? 'sim' : 'nao'}
                        onChange={(e) => setClienteForm({...clienteForm, beneficiado_subsidio_fgts: e.target.value === 'sim'})}
                      >
                        <option value="nao">Não</option>
                        <option value="sim">Sim</option>
                      </select>
                    </div>
                  </div>

                  {/* Documentos */}
                  <div className="section-divider"><span>Documentos</span></div>

                  <div className="docs-upload-grid">
                    <div className="form-group">
                      <label>RG Frente</label>
                      <div className="file-upload-wrapper">
                        {clienteForm.rg_frente_url ? (
                          <div className="file-upload-info">
                            <span className="file-name" title={clienteForm.rg_frente_url.split('/').pop()}>
                              {clienteForm.rg_frente_url.split('/').pop()}
                            </span>
                            <a href={clienteForm.rg_frente_url} target="_blank" rel="noopener noreferrer" className="doc-preview">
                              Ver arquivo
                            </a>
                          </div>
                        ) : null}
                        <label className="file-upload-label">
                          <input
                            type="file"
                            accept="image/*,.pdf"
                            onChange={(e) => e.target.files[0] && uploadDocumentoCliente(e.target.files[0], 'rg_frente')}
                            className="file-upload-input"
                          />
                          <span className="file-upload-button">Escolher Arquivo</span>
                        </label>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>RG Verso</label>
                      <div className="file-upload-wrapper">
                        {clienteForm.rg_verso_url ? (
                          <div className="file-upload-info">
                            <span className="file-name" title={clienteForm.rg_verso_url.split('/').pop()}>
                              {clienteForm.rg_verso_url.split('/').pop()}
                            </span>
                            <a href={clienteForm.rg_verso_url} target="_blank" rel="noopener noreferrer" className="doc-preview">
                              Ver arquivo
                            </a>
                          </div>
                        ) : null}
                        <label className="file-upload-label">
                          <input
                            type="file"
                            accept="image/*,.pdf"
                            onChange={(e) => e.target.files[0] && uploadDocumentoCliente(e.target.files[0], 'rg_verso')}
                            className="file-upload-input"
                          />
                          <span className="file-upload-button">Escolher Arquivo</span>
                        </label>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>CPF</label>
                      <div className="file-upload-wrapper">
                        {clienteForm.cpf_url ? (
                          <div className="file-upload-info">
                            <span className="file-name" title={clienteForm.cpf_url.split('/').pop()}>
                              {clienteForm.cpf_url.split('/').pop()}
                            </span>
                            <a href={clienteForm.cpf_url} target="_blank" rel="noopener noreferrer" className="doc-preview">
                              Ver arquivo
                            </a>
                          </div>
                        ) : null}
                        <label className="file-upload-label">
                          <input
                            type="file"
                            accept="image/*,.pdf"
                            onChange={(e) => e.target.files[0] && uploadDocumentoCliente(e.target.files[0], 'cpf')}
                            className="file-upload-input"
                          />
                          <span className="file-upload-button">Escolher Arquivo</span>
                        </label>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Comprovante Residência</label>
                      <div className="file-upload-wrapper">
                        {clienteForm.comprovante_residencia_url ? (
                          <div className="file-upload-info">
                            <span className="file-name" title={clienteForm.comprovante_residencia_url.split('/').pop()}>
                              {clienteForm.comprovante_residencia_url.split('/').pop()}
                            </span>
                            <a href={clienteForm.comprovante_residencia_url} target="_blank" rel="noopener noreferrer" className="doc-preview">
                              Ver arquivo
                            </a>
                          </div>
                        ) : null}
                        <label className="file-upload-label">
                          <input
                            type="file"
                            accept="image/*,.pdf"
                            onChange={(e) => e.target.files[0] && uploadDocumentoCliente(e.target.files[0], 'comprovante_residencia')}
                            className="file-upload-input"
                          />
                          <span className="file-upload-button">Escolher Arquivo</span>
                        </label>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Comprovante Renda</label>
                      <div className="file-upload-wrapper">
                        {clienteForm.comprovante_renda_url ? (
                          <div className="file-upload-info">
                            <span className="file-name" title={clienteForm.comprovante_renda_url.split('/').pop()}>
                              {clienteForm.comprovante_renda_url.split('/').pop()}
                            </span>
                            <a href={clienteForm.comprovante_renda_url} target="_blank" rel="noopener noreferrer" className="doc-preview">
                              Ver arquivo
                            </a>
                          </div>
                        ) : null}
                        <label className="file-upload-label">
                          <input
                            type="file"
                            accept="image/*,.pdf"
                            onChange={(e) => e.target.files[0] && uploadDocumentoCliente(e.target.files[0], 'comprovante_renda')}
                            className="file-upload-input"
                          />
                          <span className="file-upload-button">Escolher Arquivo</span>
                        </label>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Certidão Casamento/União</label>
                      <div className="file-upload-wrapper">
                        {clienteForm.certidao_casamento_url ? (
                          <div className="file-upload-info">
                            <span className="file-name" title={clienteForm.certidao_casamento_url.split('/').pop()}>
                              {clienteForm.certidao_casamento_url.split('/').pop()}
                            </span>
                            <a href={clienteForm.certidao_casamento_url} target="_blank" rel="noopener noreferrer" className="doc-preview">
                              Ver arquivo
                            </a>
                          </div>
                        ) : null}
                        <label className="file-upload-label">
                          <input
                            type="file"
                            accept="image/*,.pdf"
                            onChange={(e) => e.target.files[0] && uploadDocumentoCliente(e.target.files[0], 'certidao_casamento')}
                            className="file-upload-input"
                          />
                          <span className="file-upload-button">Escolher Arquivo</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {uploadingDoc && <div className="upload-status">Enviando documento...</div>}

                  {/* Complemento de Renda */}
                  <div className="section-divider"><span>Complemento de Renda</span></div>

                  <div className="form-group">
                    <label>Haverá complemento de renda?</label>
                    <select
                      value={clienteForm.tem_complemento_renda ? 'sim' : 'nao'}
                      onChange={(e) => {
                        const temComplemento = e.target.value === 'sim'
                        setClienteForm({
                          ...clienteForm, 
                          tem_complemento_renda: temComplemento,
                          complementadores: temComplemento && clienteForm.complementadores.length === 0 
                            ? [{ ...complementadorVazio }] 
                            : clienteForm.complementadores
                        })
                      }}
                    >
                      <option value="nao">Não</option>
                      <option value="sim">Sim</option>
                    </select>
                  </div>

                  {clienteForm.tem_complemento_renda && (
                    <div className="complementadores-section">
                      {clienteForm.complementadores.map((comp, index) => (
                        <div key={index} className="complementador-card">
                          <div className="complementador-header">
                            <h4>Complementador {index + 1}</h4>
                            <button 
                              type="button" 
                              className="action-btn delete small"
                              onClick={() => removeComplementador(index)}
                            >
                              <X size={14} />
                            </button>
                          </div>
                          <div className="form-row">
                            <div className="form-group">
                              <label>Tipo de Relacionamento</label>
                              <select
                                value={comp.tipo_relacionamento || ''}
                                onChange={(e) => updateComplementador(index, 'tipo_relacionamento', e.target.value)}
                              >
                                <option value="">Selecione...</option>
                                <option value="Cônjuge">Cônjuge</option>
                                <option value="Pai">Pai</option>
                                <option value="Mãe">Mãe</option>
                                <option value="Irmão">Irmão</option>
                                <option value="Irmã">Irmã</option>
                                <option value="Filho">Filho</option>
                                <option value="Filha">Filha</option>
                                <option value="Avô">Avô</option>
                                <option value="Avó">Avó</option>
                                <option value="Neto">Neto</option>
                                <option value="Neta">Neta</option>
                                <option value="Tio">Tio</option>
                                <option value="Tia">Tia</option>
                                <option value="Sobrinho">Sobrinho</option>
                                <option value="Sobrinha">Sobrinha</option>
                                <option value="Primo">Primo</option>
                                <option value="Prima">Prima</option>
                                <option value="Cunhado">Cunhado</option>
                                <option value="Cunhada">Cunhada</option>
                                <option value="Genro">Genro</option>
                                <option value="Nora">Nora</option>
                                <option value="Sogro">Sogro</option>
                                <option value="Sogra">Sogra</option>
                                <option value="Padrasto">Padrasto</option>
                                <option value="Madrasta">Madrasta</option>
                                <option value="Enteado">Enteado</option>
                                <option value="Enteada">Enteada</option>
                                <option value="Bisavô">Bisavô</option>
                                <option value="Bisavó">Bisavó</option>
                                <option value="Bisneto">Bisneto</option>
                                <option value="Bisneta">Bisneta</option>
                                <option value="Tio-avô">Tio-avô</option>
                                <option value="Tia-avó">Tia-avó</option>
                                <option value="Sobrinho-neto">Sobrinho-neto</option>
                                <option value="Sobrinha-neta">Sobrinha-neta</option>
                                <option value="Cunhado(a) do cônjuge">Cunhado(a) do cônjuge</option>
                                <option value="Outro">Outro</option>
                              </select>
                            </div>
                            <div className="form-group">
                              <label>Nome</label>
                              <input
                                type="text"
                                placeholder="Nome completo"
                                value={comp.nome}
                                onChange={(e) => updateComplementador(index, 'nome', e.target.value)}
                              />
                            </div>
                          </div>
                          <div className="form-row">
                            <div className="form-group">
                              <label>CPF</label>
                              <input
                                type="text"
                                placeholder="000.000.000-00"
                                value={comp.cpf}
                                onChange={(e) => updateComplementador(index, 'cpf', formatCPF(e.target.value))}
                              />
                            </div>
                          </div>
                          <div className="form-row">
                            <div className="form-group">
                              <label>RG</label>
                              <input
                                type="text"
                                value={comp.rg}
                                onChange={(e) => updateComplementador(index, 'rg', e.target.value)}
                              />
                            </div>
                            <div className="form-group">
                              <label>Data Nascimento</label>
                              <input
                                type="date"
                                value={comp.data_nascimento}
                                onChange={(e) => updateComplementador(index, 'data_nascimento', e.target.value)}
                              />
                            </div>
                          </div>
                          <div className="form-row">
                            <div className="form-group">
                              <label>Profissão</label>
                              <input
                                type="text"
                                value={comp.profissao}
                                onChange={(e) => updateComplementador(index, 'profissao', e.target.value)}
                              />
                            </div>
                            <div className="form-group">
                              <label>Empresa</label>
                              <input
                                type="text"
                                value={comp.empresa_trabalho}
                                onChange={(e) => updateComplementador(index, 'empresa_trabalho', e.target.value)}
                              />
                            </div>
                          </div>
                          <div className="form-row">
                            <div className="form-group">
                              <label>Valor Complemento</label>
                              <div className="input-currency">
                                <span className="currency-prefix">R$</span>
                                <input
                                  type="text"
                                  placeholder="0,00"
                                  value={comp.valor_complemento}
                                  onChange={(e) => updateComplementador(index, 'valor_complemento', e.target.value)}
                                />
                              </div>
                            </div>
                            <div className="form-group">
                              <label>Telefone</label>
                              <input
                                type="text"
                                placeholder="(00) 00000-0000"
                                value={comp.telefone}
                                onChange={(e) => updateComplementador(index, 'telefone', formatTelefone(e.target.value))}
                              />
                            </div>
                            <div className="form-group">
                              <label>E-mail</label>
                              <input
                                type="email"
                                value={comp.email}
                                onChange={(e) => updateComplementador(index, 'email', e.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                      <button type="button" className="btn-add-complementador" onClick={addComplementador}>
                        <PlusCircle size={16} />
                        <span>Adicionar Complementador</span>
                      </button>
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button className="btn-secondary" onClick={() => setShowModal(false)}>
                    Cancelar
                  </button>
                  <button className="btn-primary" onClick={handleSaveCliente} disabled={saving || uploadingDoc}>
                    {saving ? <div className="btn-spinner"></div> : <Save size={18} />}
                    <span>{saving ? 'Salvando...' : 'Salvar'}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal de Visualização de Corretor */}
      {showModal && modalType === 'visualizar-corretor' && selectedItem && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '700px' }}>
            <div className="modal-header">
              <h2>
                <Eye size={20} style={{ marginRight: '8px' }} />
                Detalhes do Corretor
              </h2>
              <button className="close-btn" onClick={() => setShowModal(false)}>
                <X size={24} />
              </button>
            </div>
            
            <div className="modal-body" style={{ padding: '24px' }}>
              {/* Header do Corretor */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '20px',
                marginBottom: '24px',
                paddingBottom: '24px',
                borderBottom: '1px solid rgba(255,255,255,0.1)'
              }}>
                <div style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '16px',
                  background: 'linear-gradient(135deg, #c9a962 0%, #8b7355 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '32px',
                  fontWeight: '600',
                  color: '#0a0a0a'
                }}>
                  {selectedItem.nome?.charAt(0)?.toUpperCase()}
                </div>
                <div>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '24px', fontWeight: '600' }}>
                    {selectedItem.nome}
                  </h3>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <span className={`badge ${selectedItem.tipo_corretor}`}>
                      {selectedItem.tipo_corretor === 'interno' ? 'Interno' : 'Externo'}
                    </span>
                    <span className="badge percent">
                      <Percent size={12} />
                      {selectedItem.percentual}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Informações de Contato */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, 1fr)', 
                gap: '16px',
                marginBottom: '24px'
              }}>
                <div style={{ 
                  background: 'rgba(255,255,255,0.05)', 
                  padding: '16px', 
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.1)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <Mail size={16} style={{ color: '#c9a962' }} />
                    <span style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>Email</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '14px' }}>{selectedItem.email || 'Não informado'}</p>
                </div>
                <div style={{ 
                  background: 'rgba(255,255,255,0.05)', 
                  padding: '16px', 
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.1)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <Phone size={16} style={{ color: '#c9a962' }} />
                    <span style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>Telefone</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '14px' }}>{selectedItem.telefone || 'Não informado'}</p>
                </div>
              </div>

              {/* Vínculo */}
              {(selectedItem.empreendimento?.nome || selectedItem.cargo?.nome_cargo) && (
                <div style={{ 
                  background: 'rgba(201, 169, 98, 0.1)', 
                  padding: '16px', 
                  borderRadius: '12px',
                  border: '1px solid rgba(201, 169, 98, 0.2)',
                  marginBottom: '24px'
                }}>
                  <h4 style={{ margin: '0 0 12px 0', color: '#c9a962', fontSize: '12px', textTransform: 'uppercase' }}>
                    Vínculo
                  </h4>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    {selectedItem.empreendimento?.nome && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Building size={16} style={{ color: '#c9a962' }} />
                        <span>{selectedItem.empreendimento.nome}</span>
                      </div>
                    )}
                    {selectedItem.cargo?.nome_cargo && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Award size={16} style={{ color: '#c9a962' }} />
                        <span>{selectedItem.cargo.nome_cargo}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Estatísticas */}
              <div style={{ 
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(201, 169, 98, 0.1))',
                padding: '24px',
                borderRadius: '12px',
                border: '1px solid rgba(16, 185, 129, 0.2)',
                marginBottom: '24px'
              }}>
                <h4 style={{ margin: '0 0 16px 0', color: '#10b981', fontSize: '12px', textTransform: 'uppercase' }}>
                  Desempenho
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '16px' }}>
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', display: 'block' }}>Total em Vendas</span>
                    <span style={{ fontSize: '20px', fontWeight: '700' }}>{formatCurrency(selectedItem.totalVendas)}</span>
                  </div>
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', display: 'block' }}>Comissão Total</span>
                    <span style={{ fontSize: '20px', fontWeight: '700', color: '#10b981' }}>{formatCurrency(selectedItem.totalComissao)}</span>
                  </div>
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', display: 'block' }}>Comissão Paga</span>
                    <span style={{ fontSize: '20px', fontWeight: '700', color: '#10b981' }}>{formatCurrency(selectedItem.comissaoPaga ?? 0)}</span>
                  </div>
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', display: 'block' }}>Comissão Pendente</span>
                    <span style={{ fontSize: '20px', fontWeight: '700', color: '#eab308' }}>{formatCurrency(selectedItem.comissaoPendente ?? 0)}</span>
                  </div>
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', display: 'block' }}>Nº de Vendas</span>
                    <span style={{ fontSize: '20px', fontWeight: '700' }}>{selectedItem.vendasCorretor?.length || 0}</span>
                  </div>
                </div>
              </div>

              {/* Lista de Vendas */}
              {selectedItem.vendasCorretor && selectedItem.vendasCorretor.length > 0 && (
                <div>
                  <h4 style={{ margin: '0 0 12px 0', color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>
                    Vendas Recentes ({selectedItem.vendasCorretor.length})
                  </h4>
                  <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {selectedItem.vendasCorretor.slice(0, 5).map(venda => (
                      <div key={venda.id} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px',
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: '8px',
                        marginBottom: '8px'
                      }}>
                        <div>
                          <span style={{ fontWeight: '500' }}>{venda.empreendimento?.nome || 'N/A'}</span>
                          <span style={{ color: '#64748b', fontSize: '12px', marginLeft: '8px' }}>
                            {formatDataBR(venda.data_venda)}
                          </span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontWeight: '600', color: '#c9a962' }}>{formatCurrency(venda.valor_venda)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowModal(false)}>
                Fechar
              </button>
              <button className="btn-primary" onClick={() => {
                setShowModal(false)
                openEditCorretor(selectedItem)
              }}>
                <Edit2 size={18} />
                <span>Editar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Visualização de Cliente */}
      {showModal && modalType === 'visualizar-cliente' && selectedItem && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '700px' }}>
            <div className="modal-header">
              <h2>
                <Eye size={20} style={{ marginRight: '8px' }} />
                Detalhes do Cliente
              </h2>
              <button className="close-btn" onClick={() => setShowModal(false)}>
                <X size={24} />
              </button>
            </div>
            
            <div className="modal-body" style={{ padding: '24px' }}>
              {/* Header do Cliente */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '20px',
                marginBottom: '24px',
                paddingBottom: '24px',
                borderBottom: '1px solid rgba(255,255,255,0.1)'
              }}>
                <div style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '16px',
                  background: 'linear-gradient(135deg, #c9a962 0%, #8b7355 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#0a0a0a'
                }}>
                  <UserCircle size={40} />
                </div>
                <div>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '24px', fontWeight: '600' }}>
                    {selectedItem.nome_completo}
                  </h3>
                  <p style={{ margin: 0, color: '#94a3b8', fontSize: '14px' }}>
                    {selectedItem.cpf || 'CPF não informado'}
                  </p>
                </div>
              </div>

              {/* Informações de Contato */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, 1fr)', 
                gap: '16px',
                marginBottom: '24px'
              }}>
                <div style={{ 
                  background: 'rgba(255,255,255,0.05)', 
                  padding: '16px', 
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.1)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <Phone size={16} style={{ color: '#c9a962' }} />
                    <span style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>Telefone</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '14px' }}>{selectedItem.telefone || 'Não informado'}</p>
                </div>
                <div style={{ 
                  background: 'rgba(255,255,255,0.05)', 
                  padding: '16px', 
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.1)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <Mail size={16} style={{ color: '#c9a962' }} />
                    <span style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>Email</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '14px' }}>{selectedItem.email || 'Não informado'}</p>
                </div>
                <div style={{ 
                  background: 'rgba(255,255,255,0.05)', 
                  padding: '16px', 
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.1)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <MapPin size={16} style={{ color: '#c9a962' }} />
                    <span style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>Endereço</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '14px' }}>{selectedItem.endereco || 'Não informado'}</p>
                </div>
                <div style={{ 
                  background: 'rgba(255,255,255,0.05)', 
                  padding: '16px', 
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.1)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <DollarSign size={16} style={{ color: '#c9a962' }} />
                    <span style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>Renda Mensal</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '14px' }}>{selectedItem.renda_mensal ? formatCurrency(selectedItem.renda_mensal) : 'Não informado'}</p>
                </div>
              </div>

              {/* Profissão */}
              {(selectedItem.profissao || selectedItem.empresa_trabalho) && (
                <div style={{ 
                  background: 'rgba(255,255,255,0.05)', 
                  padding: '16px', 
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  marginBottom: '24px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <Briefcase size={16} style={{ color: '#c9a962' }} />
                    <span style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>Profissão</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '14px' }}>
                    {selectedItem.profissao || 'Não informado'}
                    {selectedItem.empresa_trabalho && ` - ${selectedItem.empresa_trabalho}`}
                  </p>
                </div>
              )}

              {/* Badges FGTS */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '24px' }}>
                {selectedItem.possui_3_anos_fgts && (
                  <span className="badge fgts" style={{ padding: '8px 12px' }}>
                    <CheckCircle size={14} style={{ marginRight: '6px' }} />
                    3+ anos FGTS
                  </span>
                )}
                {selectedItem.beneficiado_subsidio_fgts && (
                  <span className="badge subsidio" style={{ padding: '8px 12px' }}>
                    <CheckCircle size={14} style={{ marginRight: '6px' }} />
                    Subsidiado FGTS
                  </span>
                )}
                {selectedItem.tem_complemento_renda && (
                  <span className="badge complemento" style={{ padding: '8px 12px' }}>
                    <Users size={14} style={{ marginRight: '6px' }} />
                    {selectedItem.complementadores?.length || 0} Complementador(es)
                  </span>
                )}
              </div>

              {/* Vendas do Cliente */}
              {selectedItem.vendasCliente && selectedItem.vendasCliente.length > 0 && (
                <div style={{ 
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(201, 169, 98, 0.1))',
                  padding: '20px',
                  borderRadius: '12px',
                  border: '1px solid rgba(16, 185, 129, 0.2)'
                }}>
                  <h4 style={{ margin: '0 0 16px 0', color: '#10b981', fontSize: '12px', textTransform: 'uppercase' }}>
                    Compras Realizadas ({selectedItem.vendasCliente.length})
                  </h4>
                  <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {selectedItem.vendasCliente.map(venda => (
                      <div key={venda.id} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px',
                        background: 'rgba(0,0,0,0.2)',
                        borderRadius: '8px',
                        marginBottom: '8px'
                      }}>
                        <div>
                          <span style={{ fontWeight: '500' }}>{venda.empreendimento?.nome || 'N/A'}</span>
                          <span style={{ color: '#64748b', fontSize: '12px', marginLeft: '8px' }}>
                            {formatDataBR(venda.data_venda)}
                          </span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontWeight: '600', color: '#10b981' }}>{formatCurrency(venda.valor_venda)}</span>
                          <span className={`status-badge ${venda.status || 'pendente'}`} style={{ marginLeft: '8px', fontSize: '10px' }}>
                            {venda.status === 'pago' ? 'Pago' : 'Pendente'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ 
                    marginTop: '16px', 
                    paddingTop: '16px', 
                    borderTop: '1px solid rgba(255,255,255,0.1)',
                    display: 'flex',
                    justifyContent: 'space-between'
                  }}>
                    <span style={{ color: '#94a3b8' }}>Total em Compras:</span>
                    <span style={{ fontWeight: '700', fontSize: '18px', color: '#10b981' }}>
                      {formatCurrency(selectedItem.vendasCliente.reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0))}
                    </span>
                  </div>
                </div>
              )}

              {/* Documentos */}
              {(selectedItem.rg_frente_url || selectedItem.rg_verso_url || selectedItem.cpf_url || 
                selectedItem.comprovante_residencia_url || selectedItem.comprovante_renda_url) && (
                <div style={{ marginTop: '24px' }}>
                  <h4 style={{ margin: '0 0 12px 0', color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>
                    Documentos
                  </h4>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {selectedItem.rg_frente_url && (
                      <a href={selectedItem.rg_frente_url} target="_blank" rel="noopener noreferrer" className="doc-link">
                        RG Frente
                      </a>
                    )}
                    {selectedItem.rg_verso_url && (
                      <a href={selectedItem.rg_verso_url} target="_blank" rel="noopener noreferrer" className="doc-link">
                        RG Verso
                      </a>
                    )}
                    {selectedItem.cpf_url && (
                      <a href={selectedItem.cpf_url} target="_blank" rel="noopener noreferrer" className="doc-link">
                        CPF
                      </a>
                    )}
                    {selectedItem.comprovante_residencia_url && (
                      <a href={selectedItem.comprovante_residencia_url} target="_blank" rel="noopener noreferrer" className="doc-link">
                        Comprovante Residência
                      </a>
                    )}
                    {selectedItem.comprovante_renda_url && (
                      <a href={selectedItem.comprovante_renda_url} target="_blank" rel="noopener noreferrer" className="doc-link">
                        Comprovante Renda
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowModal(false)}>
                Fechar
              </button>
              <button className="btn-primary" onClick={() => {
                setShowModal(false)
                setClienteForm({
                  ...selectedItem,
                  renda_mensal: selectedItem.renda_mensal?.toString() || '',
                  complementadores: selectedItem.complementadores || []
                })
                setModalType('cliente')
                setShowModal(true)
              }}>
                <Edit2 size={18} />
                <span>Editar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Renegociação de Parcelas */}
      {showModalRenegociacao && (
        <div className="modal-overlay" onClick={() => !salvandoRenegociacao && setShowModalRenegociacao(false)}>
          <div className="modal modal-renegociacao" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><RefreshCw size={18} style={{ marginRight: 8 }} />Renegociação de Parcelas</h2>
              <button className="close-btn" onClick={() => !salvandoRenegociacao && setShowModalRenegociacao(false)}>
                <X size={24} />
              </button>
            </div>
            <div className="modal-body">

              {/* Seção ANTES: resumo consolidado */}
              <div className="renego-resumo-antes">
                <h4 className="renego-section-title">📋 Seleção Consolidada</h4>
                <div className="renego-info-box">
                  <div className="renego-info-linha">
                    <span className="label">Parcelas selecionadas:</span>
                    <span className="valor">{renegociacaoForm.quantidadeParcelas}</span>
                  </div>
                  <div className="renego-info-linha">
                    <span className="label">Total consolidado:</span>
                    <span className="valor destaque">{formatCurrency(renegociacaoForm.totalSelecionado)}</span>
                  </div>
                </div>
              </div>

              {/* Seção DEPOIS: definir nova distribuição */}
              <div className="renego-section-distribuicao">
                <h4 className="renego-section-title">📊 Nova Distribuição</h4>
                <div className="renego-distribuicao-info">
                  <small>Defina como redistribuir o total de <strong>{formatCurrency(renegociacaoForm.totalSelecionado)}</strong></small>
                </div>

                <div className="renego-distribuicao-lista">
                  {renegociacaoForm.distribuicoesNovas.map((dist, idx) => {
                    const fator = parseFloat(selectedItem?.fator_comissao) || 0
                    const qtd = parseInt(dist.qtd) || 1
                    const val = parseFloat(dist.valor) || 0
                    const totalLinha = qtd * val
                    const comissaoLinha = calcularComissaoPagamento(val * qtd, fator)

                    return (
                      <div key={idx} className="renego-dist-row">
                        <div className="renego-dist-inputs">
                          <label>
                            <span>Qtd</span>
                            <input
                              type="number"
                              min="1"
                              value={dist.qtd}
                              onChange={e => {
                                const novo = [...renegociacaoForm.distribuicoesNovas]
                                novo[idx] = { ...novo[idx], qtd: e.target.value }
                                setRenegociacaoForm(f => ({ ...f, distribuicoesNovas: novo }))
                              }}
                              disabled={salvandoRenegociacao}
                            />
                          </label>

                          <label className="input-wide">
                            <span>Valor unitário (R$)</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={dist.valor}
                              onChange={e => {
                                const novo = [...renegociacaoForm.distribuicoesNovas]
                                novo[idx] = { ...novo[idx], valor: e.target.value }
                                setRenegociacaoForm(f => ({ ...f, distribuicoesNovas: novo }))
                              }}
                              disabled={salvandoRenegociacao}
                            />
                          </label>

                          <label className="input-wide">
                            <span>Data de vencimento</span>
                            <input
                              type="date"
                              value={dist.data_prevista}
                              onChange={e => {
                                const novo = [...renegociacaoForm.distribuicoesNovas]
                                novo[idx] = { ...novo[idx], data_prevista: e.target.value }
                                setRenegociacaoForm(f => ({ ...f, distribuicoesNovas: novo }))
                              }}
                              disabled={salvandoRenegociacao}
                            />
                          </label>
                        </div>

                        <div className="renego-dist-resumo">
                          <span className="dist-total">{qtd}× = {formatCurrency(totalLinha)}</span>
                          <span className="dist-comissao">{formatCurrency(comissaoLinha)}</span>
                          {renegociacaoForm.distribuicoesNovas.length > 1 && (
                            <button
                              type="button"
                              className="btn-remove-dist"
                              onClick={() => {
                                const novo = renegociacaoForm.distribuicoesNovas.filter((_, i) => i !== idx)
                                setRenegociacaoForm(f => ({ ...f, distribuicoesNovas: novo }))
                              }}
                              disabled={salvandoRenegociacao}
                              title="Remover esta distribuição"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <button
                  type="button"
                  className="btn-add-dist"
                  onClick={() => {
                    const novo = [
                      ...renegociacaoForm.distribuicoesNovas,
                      { qtd: '1', valor: '0.00', data_prevista: '' }
                    ]
                    setRenegociacaoForm(f => ({ ...f, distribuicoesNovas: novo }))
                  }}
                  disabled={salvandoRenegociacao}
                >
                  <Plus size={14} /> Adicionar mais uma distribuição
                </button>

                <div className="renego-dist-total">
                  <div className="renego-dist-total-row">
                    <span className="label">Total original:</span>
                    <span className="valor">{formatCurrency(renegociacaoForm.totalSelecionado)}</span>
                  </div>
                  <div className="renego-dist-total-row">
                    <span className="label">Total renegociado:</span>
                    <span className={`valor ${totalsFechados ? 'correto' : 'alerta'}`}>
                      {formatCurrency(totalDistribuicaoAtual)}
                    </span>
                  </div>
                </div>

                {!totalsFechados && (
                  <div className="renego-alerta-total">
                    <AlertCircle size={16} />
                    <span>
                      Diferença: <strong>{formatCurrency(diferenca)}</strong> — Os totais devem ser iguais para salvar
                    </span>
                  </div>
                )}

                {totalsFechados && (
                  <div className="renego-confirmacao-total">
                    <Check size={16} />
                    <span>Os totais batem corretamente ✓</span>
                  </div>
                )}
              </div>

              {/* Motivo */}
              <div className="renego-motivo-section">
                <label>
                  <span>Motivo da Renegociação *</span>
                  <textarea
                    className="renego-motivo-input"
                    rows={3}
                    placeholder="Descreva o motivo da renegociação..."
                    value={renegociacaoForm.motivo}
                    onChange={e => setRenegociacaoForm(f => ({ ...f, motivo: e.target.value }))}
                    disabled={salvandoRenegociacao}
                  />
                </label>
              </div>

            </div>
            <div className="modal-actions">
              <button
                className="btn-secondary"
                onClick={() => setShowModalRenegociacao(false)}
                disabled={salvandoRenegociacao}
              >
                Cancelar
              </button>
              <button
                className="btn-confirmar-distrato"
                onClick={processarRenegociacao}
                disabled={salvandoRenegociacao || !renegociacaoForm.motivo.trim() || !totalsFechados}
                title={!totalsFechados ? 'Os totais devem ser iguais para salvar' : ''}
              >
                {salvandoRenegociacao
                  ? <><span className="btn-spinner" />Salvando...</>
                  : !totalsFechados
                  ? <><AlertCircle size={16} />Totais não batem</>
                  : <><Save size={16} />Salvar Renegociação</>
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Exclusão / Distrato de Venda */}
      {showModalExcluirVenda && vendaParaExcluir && (
        <div className="modal-overlay" onClick={() => !processandoExclusaoVenda && setShowModalExcluirVenda(false)}>
          <div className="modal modal-excluir-venda" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{modalExcluirVendaStep === 1 ? 'Excluir / Distrato de Venda' : 'Distrato do Contrato'}</h2>
              <button className="close-btn" onClick={() => !processandoExclusaoVenda && setShowModalExcluirVenda(false)}>
                <X size={24} />
              </button>
            </div>
            <div className="modal-body">
              {modalExcluirVendaStep === 1 && (
                <>
                  <p className="modal-excluir-descricao">
                    Escolha como deseja proceder com a venda de{' '}
                    <strong>{vendaParaExcluir.nome_cliente || vendaParaExcluir.cliente?.nome || 'este cliente'}</strong>:
                  </p>
                  <div className="modal-excluir-opcoes">
                    <button
                      className="btn-opcao-modal danger"
                      onClick={processarExclusaoVenda}
                      disabled={processandoExclusaoVenda}
                    >
                      <span className="btn-opcao-modal-title">
                        {processandoExclusaoVenda
                          ? <><span className="btn-spinner" />Excluindo...</>
                          : <><Trash2 size={18} />Exclusão do Sistema</>
                        }
                      </span>
                      <span className="btn-opcao-modal-desc">
                        Arquiva a venda permanentemente. Some completamente da listagem.
                      </span>
                    </button>
                    <button
                      className="btn-opcao-modal gold"
                      onClick={() => setModalExcluirVendaStep(2)}
                      disabled={processandoExclusaoVenda}
                    >
                      <span className="btn-opcao-modal-title">
                        <FileText size={18} />Distrato do Contrato
                      </span>
                      <span className="btn-opcao-modal-desc">
                        Registra o distrato com data. A venda permanece no banco com status Distrato.
                      </span>
                    </button>
                  </div>
                  <div className="modal-actions">
                    <button
                      className="btn-secondary"
                      onClick={() => setShowModalExcluirVenda(false)}
                      disabled={processandoExclusaoVenda}
                    >
                      Cancelar
                    </button>
                  </div>
                </>
              )}
              {modalExcluirVendaStep === 2 && (
                <>
                  <p className="modal-excluir-descricao">
                    Informe a data do distrato para{' '}
                    <strong>{vendaParaExcluir.nome_cliente || vendaParaExcluir.cliente?.nome || 'este cliente'}</strong>.
                    A comissão será recalculada considerando apenas parcelas pagas ou vencidas até essa data.
                  </p>
                  <div className="form-section modal-distrato-data">
                    <label>
                      <span>Data do Distrato</span>
                      <input
                        type="date"
                        value={dataDistrato}
                        onChange={e => setDataDistrato(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="modal-actions">
                    <button
                      className="btn-secondary"
                      onClick={() => setModalExcluirVendaStep(1)}
                      disabled={processandoExclusaoVenda}
                    >
                      Voltar
                    </button>
                    <button
                      className="btn-confirmar-distrato"
                      onClick={processarDistratoVenda}
                      disabled={processandoExclusaoVenda || !dataDistrato}
                    >
                      {processandoExclusaoVenda
                        ? <><span className="btn-spinner" />Registrando...</>
                        : <><CheckCircle size={16} />Confirmar Distrato</>
                      }
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default AdminDashboard
