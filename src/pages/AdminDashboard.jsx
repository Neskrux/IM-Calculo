import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { 
  Users, DollarSign, TrendingUp, Plus, Edit2, Trash2, 
  Search, Filter, LogOut, Menu, X, ChevronDown, Save, Eye,
  Calculator, Calendar, User, Briefcase, CheckCircle, Clock, UserPlus, Mail, Lock, Percent, Building, PlusCircle, CreditCard, Check, Upload, FileText, Trash, UserCircle, Phone, MapPin, Camera, Download, FileDown, LayoutDashboard, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeft, AlertCircle
} from 'lucide-react'
import logo from '../imgs/logo.png'
import Ticker from '../components/Ticker'
import HomeDashboard from './HomeDashboard'
import '../styles/Dashboard.css'

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
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar-collapsed')
    return saved === 'true'
  })
  const [searchTerm, setSearchTerm] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [modalType, setModalType] = useState('')
  const [selectedItem, setSelectedItem] = useState(null)
  const [filterTipo, setFilterTipo] = useState('todos')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  const [contratoFile, setContratoFile] = useState(null)
  const [uploadingContrato, setUploadingContrato] = useState(false)
  const [pagamentoDetalhe, setPagamentoDetalhe] = useState(null)
  const [vendaExpandida, setVendaExpandida] = useState(null)
  const [cargoExpandido, setCargoExpandido] = useState(null) // Formato: "empreendimentoId-cargoId"
  const [cargosExpandidos, setCargosExpandidos] = useState({}) // Formato: { "empreendimentoId-externo": true, "empreendimentoId-interno": false }
  const [clientes, setClientes] = useState([])
  const [uploadingDoc, setUploadingDoc] = useState(false)
  
  // Estados para relatórios
  const [relatorioFiltros, setRelatorioFiltros] = useState({
    tipo: 'pagamentos', // pagamentos, comissoes, vendas
    vendaId: '',
    cargoId: '',
    status: 'todos',
    dataInicio: '',
    dataFim: ''
  })
  const [gerandoPdf, setGerandoPdf] = useState(false)

  // Toggle sidebar collapsed state
  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const newValue = !prev
      localStorage.setItem('sidebar-collapsed', String(newValue))
      return newValue
    })
  }

  // Agrupar pagamentos por venda
  const pagamentosAgrupados = pagamentos.reduce((acc, pag) => {
    const vendaId = pag.venda_id
    if (!acc[vendaId]) {
      acc[vendaId] = {
        venda_id: vendaId,
        venda: pag.venda,
        pagamentos: [],
        totalValor: 0,
        totalComissao: 0,
        totalPago: 0,
        totalPendente: 0
      }
    }
    acc[vendaId].pagamentos.push(pag)
    acc[vendaId].totalValor += parseFloat(pag.valor) || 0
    acc[vendaId].totalComissao += parseFloat(pag.comissao_gerada) || 0
    if (pag.status === 'pago') {
      acc[vendaId].totalPago += parseFloat(pag.valor) || 0
    } else {
      acc[vendaId].totalPendente += parseFloat(pag.valor) || 0
    }
    return acc
  }, {})

  const listaVendasComPagamentos = Object.values(pagamentosAgrupados)

  // Formulário de empreendimento
  const [empreendimentoForm, setEmpreendimentoForm] = useState({
    nome: '',
    descricao: '',
    comissao_total_externo: '7',
    comissao_total_interno: '6',
    cargos_externo: [{ nome_cargo: '', percentual: '' }],
    cargos_interno: [{ nome_cargo: '', percentual: '' }]
  })

  // Dados do formulário de venda
  const [vendaForm, setVendaForm] = useState({
    corretor_id: '',
    empreendimento_id: '',
    cliente_id: '',
    unidade: '',
    bloco: '',
    valor_venda: '',
    tipo_corretor: 'externo',
    data_venda: new Date().toISOString().split('T')[0],
    descricao: '',
    status: 'pendente',
    // Campos pro-soluto
    teve_sinal: false,
    valor_sinal: '',
    teve_entrada: false,
    valor_entrada: '',
    parcelou_entrada: false,
    qtd_parcelas_entrada: '',
    valor_parcela_entrada: '',
    teve_balao: 'nao', // 'nao', 'sim', 'pendente'
    qtd_balao: '',
    valor_balao: '',
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
    is_autonomo: false // Novo campo para identificar corretor autônomo
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
    
    // PEGAR A COMISSÃO TOTAL JÁ CALCULADA NA VENDA
    const comissaoTotalVenda = parseFloat(venda.comissao_total) || 0
    
    // Buscar todas as parcelas desta venda para calcular o total pro-soluto
    const parcelasVenda = pagamentos.filter(p => p.venda_id === venda.id)
    const valorTotalParcelas = parcelasVenda.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0)
    
    // Fator de proporção = comissão total da venda / valor total das parcelas
    const fatorProporcao = valorTotalParcelas > 0 ? comissaoTotalVenda / valorTotalParcelas : 0
    
    // Comissão desta parcela = valor da parcela × fator de proporção
    const comissaoTotalParcela = valorPagamento * fatorProporcao
    
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

  // Carregar dados apenas quando o perfil estiver pronto e for admin
  useEffect(() => {
    if (!authLoading && userProfile && userProfile.tipo === 'admin' && !dataLoadedRef.current) {
      dataLoadedRef.current = true // Marca ANTES de chamar para evitar duplicação
      console.log('✅ Condições atendidas, chamando fetchData...')
      fetchData()
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

  const fetchData = async () => {
    setLoading(true)
    
    try {
      // Buscar todos os dados em paralelo
      const [
        { data: corretoresData, error: corretoresError },
        { data: vendasData, error: vendasError },
        { data: empreendimentosData, error: empreendimentosError }
      ] = await Promise.all([
        supabase.from('usuarios').select('*').eq('tipo', 'corretor'),
        supabase.from('vendas').select('*'),
        supabase.from('empreendimentos').select('*')
      ])

      if (corretoresError) console.error('Erro ao buscar corretores:', corretoresError)
      if (vendasError) console.error('Erro ao buscar vendas:', vendasError)
      if (empreendimentosError) console.error('Erro ao buscar empreendimentos:', empreendimentosError)

      // Buscar cargos separadamente
      const { data: cargosData, error: cargosError } = await supabase
        .from('cargos_empreendimento')
        .select('*')
      
      if (cargosError) {
        console.error('Erro ao buscar cargos:', cargosError)
      }

      // Buscar pagamentos pro-soluto (sem JOINs)
      const { data: pagamentosData, error: pagamentosError } = await supabase
        .from('pagamentos_prosoluto')
        .select('*')
      
      if (pagamentosError) {
        console.error('Erro ao buscar pagamentos:', pagamentosError)
      }
      console.log('Pagamentos do banco:', pagamentosData)

      // Associar cargos aos empreendimentos manualmente
      const empreendimentosComCargos = (empreendimentosData || []).map(emp => ({
        ...emp,
        cargos: (cargosData || []).filter(c => c.empreendimento_id === emp.id)
      }))

      // Associar dados relacionados às vendas manualmente
      const vendasComRelacionamentos = (vendasData || []).map(venda => {
        const corretor = (corretoresData || []).find(c => c.id === venda.corretor_id)
        const empreendimento = (empreendimentosData || []).find(e => e.id === venda.empreendimento_id)
        return {
          ...venda,
          corretor: corretor ? { nome: corretor.nome, email: corretor.email, tipo_corretor: corretor.tipo_corretor, percentual_corretor: corretor.percentual_corretor } : null,
          empreendimento: empreendimento ? { nome: empreendimento.nome } : null
        }
      })

      // Associar dados relacionados aos pagamentos manualmente
      const pagamentosComRelacionamentos = (pagamentosData || []).map(pag => {
        const venda = (vendasData || []).find(v => v.id === pag.venda_id)
        const corretor = venda ? (corretoresData || []).find(c => c.id === venda.corretor_id) : null
        const empreendimento = venda ? (empreendimentosData || []).find(e => e.id === venda.empreendimento_id) : null
        
        return {
          ...pag,
          venda: venda ? {
            id: venda.id,
            valor_venda: venda.valor_venda,
            comissao_total: venda.comissao_total,
            tipo_corretor: venda.tipo_corretor,
            empreendimento_id: venda.empreendimento_id,
            descricao: venda.descricao,
            fator_comissao: venda.fator_comissao,
            corretor: corretor ? { nome: corretor.nome } : null,
            empreendimento: empreendimento ? { nome: empreendimento.nome } : null
          } : null
        }
      })

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

      // Buscar clientes
      const { data: clientesData, error: clientesError } = await supabase
        .from('clientes')
        .select('*')
        .eq('ativo', true)
      
      if (clientesError) {
        console.error('Erro ao buscar clientes:', clientesError)
      }

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
      
      console.log('✅ Dados carregados com sucesso:', {
        corretores: corretoresComRelacionamentos?.length || 0,
        vendas: vendasComRelacionamentos?.length || 0,
        empreendimentos: empreendimentosComCargos?.length || 0,
        pagamentos: pagamentosComRelacionamentos?.length || 0,
        clientes: clientesComComplementadores?.length || 0
      })
      
    } catch (error) {
      console.error('❌ Erro crítico ao carregar dados:', error)
      setMessage({ type: 'error', text: `Erro ao carregar dados: ${error.message || 'Erro desconhecido'}. Tente recarregar a página.` })
    } finally {
      setLoading(false)
      console.log('🏁 fetchData finalizado')
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
    
    const valorVenda = parseFloat(vendaForm.valor_venda)
    
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
    
    // Entrada: se parcelou, usa qtd × valor_parcela. Se não parcelou, usa valor_entrada
    let valorEntradaTotal = 0
    if (vendaForm.teve_entrada) {
      if (vendaForm.parcelou_entrada) {
        valorEntradaTotal = (parseFloat(vendaForm.qtd_parcelas_entrada) || 0) * (parseFloat(vendaForm.valor_parcela_entrada) || 0)
      } else {
        valorEntradaTotal = parseFloat(vendaForm.valor_entrada) || 0
      }
    }
    
    // Balões
    const valorTotalBalao = vendaForm.teve_balao === 'sim' 
      ? (parseFloat(vendaForm.qtd_balao) || 0) * (parseFloat(vendaForm.valor_balao) || 0)
      : 0
    
    // Pro-soluto = sinal + entrada + balões
    const valorProSoluto = valorSinal + valorEntradaTotal + valorTotalBalao
    
    // Fator de comissão = Percentual total de comissão / 100
    // Ex: 7% -> 0.07, então parcela de R$ 1.000 x 0.07 = R$ 70 de comissão
    const fatorComissao = comissoesDinamicas.percentualTotal / 100
    
    console.log('Cálculo venda:', {
      valorVenda,
      valorSinal,
      valorEntradaTotal,
      valorTotalBalao,
      valorProSoluto,
      comissaoTotal: comissoesDinamicas.total,
      fatorComissao,
      teveSinal: vendaForm.teve_sinal,
      teveEntrada: vendaForm.teve_entrada,
      parcelouEntrada: vendaForm.parcelou_entrada,
      teveBalao: vendaForm.teve_balao
    })

    const vendaData = {
      corretor_id: vendaForm.corretor_id,
      empreendimento_id: isCorretorAutonomo ? null : (vendaForm.empreendimento_id || null),
      cliente_id: vendaForm.cliente_id || null,
      unidade: vendaForm.unidade || null,
      bloco: vendaForm.bloco?.toUpperCase() || null,
      valor_venda: valorVenda,
      tipo_corretor: vendaForm.tipo_corretor,
      data_venda: vendaForm.data_venda,
      descricao: vendaForm.descricao,
      status: vendaForm.status,
      teve_sinal: vendaForm.teve_sinal,
      valor_sinal: valorSinal || null,
      teve_entrada: vendaForm.teve_entrada,
      valor_entrada: parseFloat(vendaForm.valor_entrada) || null,
      parcelou_entrada: vendaForm.parcelou_entrada,
      qtd_parcelas_entrada: parseInt(vendaForm.qtd_parcelas_entrada) || null,
      valor_parcela_entrada: parseFloat(vendaForm.valor_parcela_entrada) || null,
      teve_balao: vendaForm.teve_balao,
      qtd_balao: parseInt(vendaForm.qtd_balao) || null,
      valor_balao: parseFloat(vendaForm.valor_balao) || null,
      teve_permuta: vendaForm.teve_permuta,
      tipo_permuta: vendaForm.tipo_permuta || null,
      valor_permuta: parseFloat(vendaForm.valor_permuta) || null,
      valor_pro_soluto: valorProSoluto || null,
      fator_comissao: fatorComissao || null,
      comissao_total: comissoesDinamicas.total,
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
      setSaving(false)
      setMessage({ type: 'error', text: 'Erro ao salvar venda: ' + error.message })
      return
    }

    // Se é nova venda, salvar comissões por cargo e pagamentos pro-soluto
    if (!selectedItem && vendaId) {
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
      
      // Sinal
      if (valorSinal > 0) {
        pagamentos.push({
          venda_id: vendaId,
          tipo: 'sinal',
          valor: valorSinal,
          data_prevista: vendaForm.data_venda,
          comissao_gerada: valorSinal * fatorComissao
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
            data_prevista: vendaForm.data_venda,
            comissao_gerada: valorEntradaAvista * fatorComissao
          })
        }
      }
      
      // Parcelas da entrada - só se teve entrada E parcelou
      if (vendaForm.teve_entrada && vendaForm.parcelou_entrada) {
        const qtdParcelas = parseInt(vendaForm.qtd_parcelas_entrada) || 0
        const valorParcelaEnt = parseFloat(vendaForm.valor_parcela_entrada) || 0
        
        for (let i = 1; i <= qtdParcelas; i++) {
          const dataParcela = new Date(vendaForm.data_venda)
          dataParcela.setMonth(dataParcela.getMonth() + i)
          
          pagamentos.push({
            venda_id: vendaId,
            tipo: 'parcela_entrada',
            numero_parcela: i,
            valor: valorParcelaEnt,
            data_prevista: dataParcela.toISOString().split('T')[0],
            comissao_gerada: valorParcelaEnt * fatorComissao
          })
        }
      }
      
      // Balões
      if (vendaForm.teve_balao === 'sim') {
        const qtdBalao = parseInt(vendaForm.qtd_balao) || 0
        const valorBalaoUnit = parseFloat(vendaForm.valor_balao) || 0
        for (let i = 1; i <= qtdBalao; i++) {
          pagamentos.push({
            venda_id: vendaId,
            tipo: 'balao',
            numero_parcela: i,
            valor: valorBalaoUnit,
            comissao_gerada: valorBalaoUnit * fatorComissao
          })
        }
      }

      if (pagamentos.length > 0) {
        const { error: pagError } = await supabase.from('pagamentos_prosoluto').insert(pagamentos)
        if (pagError) {
          console.error('Erro ao criar pagamentos:', pagError)
        } else {
          console.log('Pagamentos criados:', pagamentos.length)
        }
      } else {
        console.log('Nenhum pagamento para criar. Pro-soluto:', valorProSoluto)
      }
    }

    setSaving(false)

    setShowModal(false)
    setSelectedItem(null)
    resetVendaForm()
    fetchData()
    setMessage({ type: 'success', text: 'Venda salva com sucesso!' })
    setTimeout(() => setMessage({ type: '', text: '' }), 3000)
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

    // Se é edição, não precisa de senha
    if (!selectedItem && !corretorForm.senha) {
      setMessage({ type: 'error', text: 'A senha é obrigatória para novos corretores' })
      return
    }

    if (!selectedItem && corretorForm.senha.length < 6) {
      setMessage({ type: 'error', text: 'A senha deve ter no mínimo 6 caracteres' })
      return
    }

    setSaving(true)
    setMessage({ type: '', text: '' })

    try {
      if (selectedItem) {
        // EDIÇÃO de corretor existente
        const { error: dbError } = await supabase
          .from('usuarios')
          .update({
            nome: corretorForm.nome,
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
            creci: corretorForm.creci || null
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
      setTimeout(() => setMessage({ type: '', text: '' }), 5000)

    } catch (err) {
      setSaving(false)
      setMessage({ type: 'error', text: err.message })
    }
  }

  const handleDeleteVenda = async (id) => {
    if (confirm('Tem certeza que deseja excluir esta venda?')) {
      await supabase.from('vendas').delete().eq('id', id)
      fetchData()
    }
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
      setTimeout(() => setMessage({ type: '', text: '' }), 3000)
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
            comissao_total_externo: parseFloat(empreendimentoForm.comissao_total_externo) || 7,
            comissao_total_interno: parseFloat(empreendimentoForm.comissao_total_interno) || 6
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
            comissao_total_externo: parseFloat(empreendimentoForm.comissao_total_externo) || 7,
            comissao_total_interno: parseFloat(empreendimentoForm.comissao_total_interno) || 6
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
      setTimeout(() => setMessage({ type: '', text: '' }), 3000)

    } catch (err) {
      setSaving(false)
      setMessage({ type: 'error', text: err.message })
    }
  }

  const handleDeleteEmpreendimento = async (emp) => {
    if (confirm(`Tem certeza que deseja excluir o empreendimento ${emp.nome}?`)) {
      const { error } = await supabase
        .from('empreendimentos')
        .delete()
        .eq('id', emp.id)
      
      if (error) {
        setMessage({ type: 'error', text: 'Erro ao excluir: ' + error.message })
        return
      }
      
      fetchData()
      setMessage({ type: 'success', text: 'Empreendimento excluído!' })
      setTimeout(() => setMessage({ type: '', text: '' }), 3000)
    }
  }

  // Confirmar pagamento pro-soluto
  const confirmarPagamento = async (pagamentoId) => {
    const { error } = await supabase
      .from('pagamentos_prosoluto')
      .update({ 
        status: 'pago',
        data_pagamento: new Date().toISOString().split('T')[0]
      })
      .eq('id', pagamentoId)
    
    if (error) {
      setMessage({ type: 'error', text: 'Erro ao confirmar: ' + error.message })
      return
    }
    
    fetchData()
    setMessage({ type: 'success', text: 'Pagamento confirmado!' })
    setTimeout(() => setMessage({ type: '', text: '' }), 3000)
  }

  // Identificar vendas sem pagamentos
  const vendasSemPagamentos = vendas.filter(v => {
    const temPagamento = pagamentos.some(p => p.venda_id === v.id)
    return !temPagamento
  })

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
    // Fator de comissão = Percentual total / 100
    const fatorComissao = comissoesDinamicas.percentualTotal / 100
    
    const novosPagamentos = []
    
    // Sinal
    if (valorSinal > 0) {
      novosPagamentos.push({
        venda_id: venda.id,
        tipo: 'sinal',
        valor: valorSinal,
        data_prevista: venda.data_venda,
        comissao_gerada: valorSinal * fatorComissao
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
          comissao_gerada: valorEntradaAvista * fatorComissao
        })
      }
    }
    
    // Parcelas da entrada
    if (venda.teve_entrada && venda.parcelou_entrada) {
      const qtdParcelas = parseInt(venda.qtd_parcelas_entrada) || 0
      const valorParcelaEnt = parseFloat(venda.valor_parcela_entrada) || 0
      
      for (let i = 1; i <= qtdParcelas; i++) {
        const dataParcela = new Date(venda.data_venda)
        dataParcela.setMonth(dataParcela.getMonth() + i)
        
        novosPagamentos.push({
          venda_id: venda.id,
          tipo: 'parcela_entrada',
          numero_parcela: i,
          valor: valorParcelaEnt,
          data_prevista: dataParcela.toISOString().split('T')[0],
          comissao_gerada: valorParcelaEnt * fatorComissao
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
          comissao_gerada: valorBalaoUnit * fatorComissao
        })
      }
    }

    if (novosPagamentos.length > 0) {
      const { error } = await supabase.from('pagamentos_prosoluto').insert(novosPagamentos)
      if (error) {
        setMessage({ type: 'error', text: 'Erro ao gerar pagamentos: ' + error.message })
      } else {
        setMessage({ type: 'success', text: `${novosPagamentos.length} pagamentos gerados!` })
        fetchData()
      }
    } else {
      setMessage({ type: 'warning', text: 'Esta venda não tem parcelas pro-soluto configuradas (sinal, entrada ou balão)' })
    }
    
    setSaving(false)
    setTimeout(() => setMessage({ type: '', text: '' }), 3000)
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
    setTimeout(() => setMessage({ type: '', text: '' }), 3000)
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
    
    // Carregar cargos do empreendimento se existir
    if (corretor.empreendimento_id) {
      const emp = empreendimentos.find(e => e.id === corretor.empreendimento_id)
      setCargosDisponiveis(emp?.cargos || [])
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
      creci: corretor.creci || ''
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
      valor_venda: '',
      tipo_corretor: 'externo',
      data_venda: new Date().toISOString().split('T')[0],
      descricao: '',
      status: 'pendente',
      teve_sinal: false,
      valor_sinal: '',
      teve_entrada: false,
      valor_entrada: '',
      parcelou_entrada: false,
      qtd_parcelas_entrada: '',
      valor_parcela_entrada: '',
      teve_balao: 'nao',
      qtd_balao: '',
      valor_balao: '',
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
      creci: ''
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
      const fileExt = file.name.split('.').pop()
      const fileName = `${tipo}_${Date.now()}.${fileExt}`
      const filePath = `clientes/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('documentos')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('documentos')
        .getPublicUrl(filePath)

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

  // Deletar cliente
  const handleDeleteCliente = async (clienteId) => {
    if (!window.confirm('Tem certeza que deseja excluir este cliente?')) return

    try {
      const { error } = await supabase
        .from('clientes')
        .update({ ativo: false })
        .eq('id', clienteId)
      if (error) throw error
      setMessage({ type: 'success', text: 'Cliente excluído!' })
      fetchData()
    } catch (error) {
      setMessage({ type: 'error', text: 'Erro ao excluir: ' + error.message })
    }
  }

  const openEditModal = (venda) => {
    setSelectedItem(venda)
    setVendaForm({
      corretor_id: venda.corretor_id,
      empreendimento_id: venda.empreendimento_id || '',
      cliente_id: venda.cliente_id || '',
      unidade: venda.unidade || '',
      bloco: venda.bloco || '',
      valor_venda: venda.valor_venda.toString(),
      tipo_corretor: venda.tipo_corretor,
      data_venda: venda.data_venda,
      descricao: venda.descricao || '',
      status: venda.status,
      teve_sinal: venda.teve_sinal || false,
      valor_sinal: venda.valor_sinal?.toString() || '',
      teve_entrada: venda.teve_entrada || false,
      valor_entrada: venda.valor_entrada?.toString() || '',
      parcelou_entrada: venda.parcelou_entrada || false,
      qtd_parcelas_entrada: venda.qtd_parcelas_entrada?.toString() || '',
      valor_parcela_entrada: venda.valor_parcela_entrada?.toString() || '',
      teve_balao: venda.teve_balao || 'nao',
      qtd_balao: venda.qtd_balao?.toString() || '',
      valor_balao: venda.valor_balao?.toString() || '',
      teve_permuta: venda.teve_permuta || false,
      tipo_permuta: venda.tipo_permuta || '',
      valor_permuta: venda.valor_permuta?.toString() || '',
      valor_pro_soluto: venda.valor_pro_soluto?.toString() || '',
      contrato_url: venda.contrato_url || '',
      contrato_nome: venda.contrato_nome || ''
    })
    setContratoFile(null)
    setModalType('venda')
    setShowModal(true)
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

  // Função para gerar PDF de relatório
  const gerarRelatorioPDF = async () => {
    setGerandoPdf(true)
    
    try {
      const doc = new jsPDF()
      const pageWidth = doc.internal.pageSize.getWidth()
      
      // Cores do tema
      const corPrimaria = [30, 41, 59] // #1e293b
      const corSecundaria = [16, 185, 129] // #10b981
      const corTexto = [51, 65, 85] // #334155
      
      // Cabeçalho
      doc.setFillColor(...corPrimaria)
      doc.rect(0, 0, pageWidth, 40, 'F')
      
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(22)
      doc.setFont('helvetica', 'bold')
      doc.text('RELATÓRIO DE COMISSÕES', pageWidth / 2, 18, { align: 'center' })
      
      doc.setFontSize(11)
      doc.setFont('helvetica', 'normal')
      doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}`, pageWidth / 2, 30, { align: 'center' })
      
      let yPosition = 50
      
      // Filtrar dados
      let dadosFiltrados = [...listaVendasComPagamentos]
      
      if (relatorioFiltros.vendaId) {
        dadosFiltrados = dadosFiltrados.filter(g => g.venda_id === relatorioFiltros.vendaId)
      }
      
      if (relatorioFiltros.status !== 'todos') {
        dadosFiltrados = dadosFiltrados.map(g => ({
          ...g,
          pagamentos: g.pagamentos.filter(p => p.status === relatorioFiltros.status)
        })).filter(g => g.pagamentos.length > 0)
      }
      
      // Filtro por data
      if (relatorioFiltros.dataInicio || relatorioFiltros.dataFim) {
        const dataInicio = relatorioFiltros.dataInicio ? new Date(relatorioFiltros.dataInicio) : null
        const dataFim = relatorioFiltros.dataFim ? new Date(relatorioFiltros.dataFim + 'T23:59:59') : null
        
        dadosFiltrados = dadosFiltrados.map(g => ({
          ...g,
          pagamentos: g.pagamentos.filter(p => {
            const dataPagamento = new Date(p.data_prevista)
            if (dataInicio && dataPagamento < dataInicio) return false
            if (dataFim && dataPagamento > dataFim) return false
            return true
          })
        })).filter(g => g.pagamentos.length > 0)
      }
      
      // Título do filtro aplicado
      doc.setTextColor(...corTexto)
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      
      let filtroTexto = 'Todas as vendas'
      if (relatorioFiltros.vendaId) {
        const vendaSelecionada = dadosFiltrados[0]
        filtroTexto = `Venda: ${vendaSelecionada?.venda?.corretor?.nome || 'N/A'} - Unidade ${vendaSelecionada?.venda?.unidade || 'N/A'}`
      }
      if (relatorioFiltros.status !== 'todos') {
        filtroTexto += ` | Status: ${relatorioFiltros.status === 'pago' ? 'Pago' : 'Pendente'}`
      }
      if (relatorioFiltros.cargoId) {
        filtroTexto += ` | Cargo: ${relatorioFiltros.cargoId}`
      }
      if (relatorioFiltros.dataInicio || relatorioFiltros.dataFim) {
        const inicio = relatorioFiltros.dataInicio ? new Date(relatorioFiltros.dataInicio).toLocaleDateString('pt-BR') : 'início'
        const fim = relatorioFiltros.dataFim ? new Date(relatorioFiltros.dataFim).toLocaleDateString('pt-BR') : 'hoje'
        filtroTexto += ` | Período: ${inicio} a ${fim}`
      }
      
      doc.text(filtroTexto, 14, yPosition)
      yPosition += 10
      
      // Resumo geral - calcular baseado no cargo selecionado ou total
      let totalComissao = 0
      let totalPago = 0
      
      if (relatorioFiltros.cargoId) {
        // Filtrar apenas comissões do cargo selecionado
        dadosFiltrados.forEach(grupo => {
          grupo.pagamentos.forEach(pag => {
            const comissoesCargo = calcularComissaoPorCargoPagamento(pag)
            const cargoEncontrado = comissoesCargo.find(c => c.nome_cargo === relatorioFiltros.cargoId)
            if (cargoEncontrado) {
              totalComissao += cargoEncontrado.valor
              if (pag.status === 'pago') {
                totalPago += cargoEncontrado.valor
              }
            }
          })
        })
      } else {
        totalComissao = dadosFiltrados.reduce((acc, g) => acc + (parseFloat(g.venda?.comissao_total) || 0), 0)
        totalPago = dadosFiltrados.reduce((acc, g) => {
          const comissaoTotal = parseFloat(g.venda?.comissao_total) || 0
          const totalParcelas = g.totalValor
          const parcelasPagas = g.pagamentos.filter(p => p.status === 'pago').reduce((a, p) => a + (parseFloat(p.valor) || 0), 0)
          return totalParcelas > 0 ? acc + (comissaoTotal * parcelasPagas / totalParcelas) : acc
        }, 0)
      }
      const totalPendente = totalComissao - totalPago
      
      // Box de resumo
      doc.setFillColor(241, 245, 249) // #f1f5f9
      doc.roundedRect(14, yPosition, pageWidth - 28, 25, 3, 3, 'F')
      
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...corTexto)
      
      const resumoY = yPosition + 10
      doc.text('Comissão Total:', 20, resumoY)
      doc.setFont('helvetica', 'bold')
      doc.text(formatCurrency(totalComissao), 20, resumoY + 8)
      
      doc.setFont('helvetica', 'normal')
      doc.text('Comissão Paga:', 80, resumoY)
      doc.setTextColor(16, 185, 129)
      doc.setFont('helvetica', 'bold')
      doc.text(formatCurrency(totalPago), 80, resumoY + 8)
      
      doc.setTextColor(...corTexto)
      doc.setFont('helvetica', 'normal')
      doc.text('Comissão Pendente:', 140, resumoY)
      doc.setTextColor(245, 158, 11)
      doc.setFont('helvetica', 'bold')
      doc.text(formatCurrency(totalPendente), 140, resumoY + 8)
      
      yPosition += 35
      
      // Para cada venda
      dadosFiltrados.forEach((grupo, idx) => {
        // Verificar se precisa nova página
        if (yPosition > 250) {
          doc.addPage()
          yPosition = 20
        }
        
        const venda = grupo.venda
        const corretor = venda?.corretor?.nome || 'N/A'
        const empreendimento = venda?.empreendimento?.nome || 'N/A'
        const unidade = venda?.unidade || 'N/A'
        const comissaoVenda = parseFloat(venda?.comissao_total) || 0
        
        // Título da venda
        doc.setFillColor(...corPrimaria)
        doc.rect(14, yPosition, pageWidth - 28, 8, 'F')
        doc.setTextColor(255, 255, 255)
        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')
        doc.text(`${empreendimento} - Unidade ${unidade} | Corretor: ${corretor}`, 18, yPosition + 5.5)
        doc.text(`Comissão: ${formatCurrency(comissaoVenda)}`, pageWidth - 18, yPosition + 5.5, { align: 'right' })
        
        yPosition += 12
        
        // Tabela de parcelas
        const parcelas = grupo.pagamentos.map(pag => {
          const comissoesCargo = calcularComissaoPorCargoPagamento(pag)
          let comissaoExibir = calcularComissaoTotalPagamento(pag)
          
          // Se filtro por cargo, mostrar apenas comissão daquele cargo
          if (relatorioFiltros.cargoId) {
            const cargoEncontrado = comissoesCargo.find(c => c.nome_cargo === relatorioFiltros.cargoId)
            comissaoExibir = cargoEncontrado ? cargoEncontrado.valor : 0
          }
          
          // Calcular percentual da comissão em relação ao valor da parcela (sem arredondamento)
          const valorParcela = parseFloat(pag.valor) || 0
          const percentualComissao = valorParcela > 0 ? ((comissaoExibir / valorParcela) * 100).toFixed(6).replace(/\.?0+$/, '') : '0'
          
          return [
            pag.tipo_pagamento?.charAt(0).toUpperCase() + pag.tipo_pagamento?.slice(1) || '-',
            new Date(pag.data_prevista).toLocaleDateString('pt-BR'),
            formatCurrency(pag.valor),
            pag.status === 'pago' ? 'Pago' : 'Pendente',
            `${percentualComissao}%`,
            formatCurrency(comissaoExibir)
          ]
        })
        
        autoTable(doc, {
          startY: yPosition,
          head: [['Tipo', 'Data', 'Valor Parcela', 'Status', '% Comissão', 'Comissão']],
          body: parcelas,
          theme: 'striped',
          headStyles: {
            fillColor: corSecundaria,
            textColor: 255,
            fontStyle: 'bold',
            fontSize: 9
          },
          bodyStyles: {
            fontSize: 8,
            textColor: corTexto
          },
          alternateRowStyles: {
            fillColor: [248, 250, 252]
          },
          columnStyles: {
            0: { cellWidth: 25 },
            1: { cellWidth: 25 },
            2: { cellWidth: 35, halign: 'right' },
            3: { cellWidth: 22, halign: 'center' },
            4: { cellWidth: 25, halign: 'center' },
            5: { cellWidth: 35, halign: 'right' }
          },
          margin: { left: 14, right: 14 }
        })
        
        yPosition = doc.lastAutoTable.finalY + 5
        
        // Divisão por cargo (se filtro de cargo específico não estiver ativo)
        if (!relatorioFiltros.cargoId) {
          const cargosVenda = {}
          grupo.pagamentos.forEach(pag => {
            const comissoesCargo = calcularComissaoPorCargoPagamento(pag)
            comissoesCargo.forEach(cargo => {
              if (!cargosVenda[cargo.nome_cargo]) {
                cargosVenda[cargo.nome_cargo] = 0
              }
              cargosVenda[cargo.nome_cargo] += cargo.valor
            })
          })
          
          const cargosData = Object.entries(cargosVenda).map(([nome, valor]) => [nome, formatCurrency(valor)])
          
          if (cargosData.length > 0) {
            doc.setFontSize(9)
            doc.setFont('helvetica', 'bold')
            doc.setTextColor(...corTexto)
            doc.text('Divisão por Beneficiário:', 14, yPosition + 3)
            
            autoTable(doc, {
              startY: yPosition + 6,
              head: [['Beneficiário', 'Valor Total']],
              body: cargosData,
              theme: 'plain',
              headStyles: {
                fillColor: [226, 232, 240],
                textColor: corTexto,
                fontStyle: 'bold',
                fontSize: 8
              },
              bodyStyles: {
                fontSize: 8,
                textColor: corTexto
              },
              columnStyles: {
                0: { cellWidth: 80 },
                1: { cellWidth: 50, halign: 'right' }
              },
              margin: { left: 14, right: 14 },
              tableWidth: 130
            })
            
            yPosition = doc.lastAutoTable.finalY + 10
          }
        }
        
        yPosition += 5
      })
      
      // Rodapé em todas as páginas
      const pageCount = doc.internal.getNumberOfPages()
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i)
        doc.setFillColor(...corPrimaria)
        doc.rect(0, doc.internal.pageSize.getHeight() - 15, pageWidth, 15, 'F')
        doc.setTextColor(255, 255, 255)
        doc.setFontSize(8)
        doc.text('Sistema de Gestão de Comissões - InvestMoney', 14, doc.internal.pageSize.getHeight() - 6)
        doc.text(`Página ${i} de ${pageCount}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 6, { align: 'right' })
      }
      
      // Salvar PDF
      const nomeArquivo = `relatorio_comissoes_${new Date().toISOString().split('T')[0]}.pdf`
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
    const matchSearch = venda.corretor?.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                       venda.descricao?.toLowerCase().includes(searchTerm.toLowerCase())
    const matchTipo = filterTipo === 'todos' || venda.tipo_corretor === filterTipo
    return matchSearch && matchTipo
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

  return (
    <div className="dashboard-container">
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
        <Ticker />
        
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
                    comissao_total_externo: '7',
                    comissao_total_interno: '6',
                    cargos_externo: [{ nome_cargo: '', percentual: '' }],
                    cargos_interno: [{ nome_cargo: '', percentual: '' }]
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
            <HomeDashboard showTicker={false} showHeader={false} />
          </div>
        )}
        {activeTab === 'vendas' && (
          <div className="content-section">
            <div className="section-header">
              <div className="search-box">
                <Search size={20} />
                <input 
                  type="text" 
                  placeholder="Buscar vendas..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="filter-group">
                <Filter size={18} />
                <select 
                  value={filterTipo} 
                  onChange={(e) => setFilterTipo(e.target.value)}
                >
                  <option value="todos">Todos</option>
                  <option value="interno">Interno</option>
                  <option value="externo">Externo</option>
                </select>
              </div>
            </div>

            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Corretor</th>
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
                      <td colSpan="9" className="loading-cell">
                        <div className="loading-spinner"></div>
                      </td>
                    </tr>
                  ) : filteredVendas.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="empty-cell">
                        Nenhuma venda encontrada
                      </td>
                    </tr>
                  ) : (
                    filteredVendas.map((venda) => (
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
                        <td className="value-cell highlight">{formatCurrency(venda.comissao_corretor)}</td>
                        <td className="value-cell">{formatCurrency(venda.comissao_total)}</td>
                        <td>{new Date(venda.data_venda).toLocaleDateString('pt-BR')}</td>
                        <td>
                          <span className={`status-badge ${venda.status}`}>
                            {venda.status === 'pago' && <CheckCircle size={14} />}
                            {venda.status === 'pendente' && <Clock size={14} />}
                            {venda.status === 'em_andamento' && <Clock size={14} />}
                            {venda.status === 'pago' && 'Comissão Paga'}
                            {venda.status === 'pendente' && 'Pendente'}
                            {venda.status === 'em_andamento' && 'Em Andamento'}
                          </span>
                        </td>
                        <td>
                          <div className="action-buttons">
                            <button 
                              className="action-btn edit"
                              onClick={() => openEditModal(venda)}
                            >
                              <Edit2 size={16} />
                            </button>
                            <button 
                              className="action-btn delete"
                              onClick={() => handleDeleteVenda(venda.id)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'corretores' && (
          <div className="content-section">
            {corretores.length === 0 ? (
              <div className="empty-state-box">
                <Users size={48} />
                <h3>Nenhum corretor cadastrado</h3>
                <p>Clique em "Novo Corretor" para adicionar</p>
              </div>
            ) : (
              <div className="corretores-grid">
                {corretores.map((corretor) => {
                  const vendasCorretor = vendas.filter(v => v.corretor_id === corretor.id)
                  const totalComissao = vendasCorretor.reduce((acc, v) => acc + v.comissao_corretor, 0)
                  const totalVendas = vendasCorretor.reduce((acc, v) => acc + v.valor_venda, 0)
                  const percentual = corretor.percentual_corretor || (corretor.tipo_corretor === 'interno' ? 2.5 : 4)
                  
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
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="corretor-actions">
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
            )}
          </div>
        )}

        {activeTab === 'empreendimentos' && (
          <div className="content-section">
            {empreendimentos.length === 0 ? (
              <div className="empty-state-box">
                <Building size={48} />
                <h3>Nenhum empreendimento cadastrado</h3>
                <p>Clique em "Novo Empreendimento" para adicionar</p>
              </div>
            ) : (
              <div className="empreendimentos-grid">
                {empreendimentos.map((emp) => (
                  <div key={emp.id} className="empreendimento-card">
                    <div className="empreendimento-header">
                      <div className="empreendimento-info">
                        <h3>{emp.nome}</h3>
                        <div className="comissoes-totais">
                          <span className="badge externo">
                            Externo: {emp.comissao_total_externo || 7}%
                          </span>
                          <span className="badge interno">
                            Interno: {emp.comissao_total_interno || 6}%
                          </span>
                        </div>
                      </div>
                      <div className="empreendimento-actions">
                        <button 
                          className="action-btn edit small"
                          onClick={() => {
                            const cargosExt = emp.cargos?.filter(c => c.tipo_corretor === 'externo') || []
                            const cargosInt = emp.cargos?.filter(c => c.tipo_corretor === 'interno') || []
                            setSelectedItem(emp)
                            setEmpreendimentoForm({
                              nome: emp.nome,
                              descricao: emp.descricao || '',
                              comissao_total_externo: emp.comissao_total_externo?.toString() || '7',
                              comissao_total_interno: emp.comissao_total_interno?.toString() || '6',
                              cargos_externo: cargosExt.length > 0 
                                ? cargosExt.map(c => ({ nome_cargo: c.nome_cargo, percentual: c.percentual?.toString() || '' }))
                                : [{ nome_cargo: '', percentual: '' }],
                              cargos_interno: cargosInt.length > 0 
                                ? cargosInt.map(c => ({ nome_cargo: c.nome_cargo, percentual: c.percentual?.toString() || '' }))
                                : [{ nome_cargo: '', percentual: '' }]
                            })
                            setModalType('empreendimento')
                            setShowModal(true)
                          }}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button 
                          className="action-btn delete small"
                          onClick={() => handleDeleteEmpreendimento(emp)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    {emp.descricao && (
                      <p className="empreendimento-descricao">{emp.descricao}</p>
                    )}
                    
                    {/* Cargos Externos */}
                    <div className="empreendimento-cargos">
                      <h4>Cargos Externos</h4>
                      {emp.cargos?.filter(c => c.tipo_corretor === 'externo').length > 0 && (
                        <button
                          className="btn-toggle-cargos"
                          onClick={() => setCargosExpandidos(prev => ({
                            ...prev,
                            [`${emp.id}-externo`]: !prev[`${emp.id}-externo`]
                          }))}
                        >
                          {cargosExpandidos[`${emp.id}-externo`] ? 'Ocultar cargos e taxas' : 'Mostrar cargos e taxas'}
                          <ChevronDown 
                            size={16} 
                            className={cargosExpandidos[`${emp.id}-externo`] ? 'rotated' : ''}
                          />
                        </button>
                      )}
                      {cargosExpandidos[`${emp.id}-externo`] && emp.cargos?.filter(c => c.tipo_corretor === 'externo').length > 0 ? (
                        <div className="cargos-list">
                          {emp.cargos.filter(c => c.tipo_corretor === 'externo').map((cargo, idx) => {
                            const cargoKey = `${emp.id}-${cargo.id}`
                            const setor = calcularValoresPorSetor(emp.id).find(s => s.cargo_id === cargo.id)
                            const isExpanded = cargoExpandido === cargoKey
                            
                            return (
                              <div key={idx}>
                                <div className="cargo-item">
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                                    <span>{cargo.nome_cargo}</span>
                                    <span className="cargo-percent">{cargo.percentual}%</span>
                                  </div>
                                  <button
                                    className="btn-cargo-expand"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setCargoExpandido(isExpanded ? null : cargoKey)
                                    }}
                                    title={isExpanded ? 'Ocultar detalhes' : 'Mostrar detalhes'}
                                  >
                                    {isExpanded ? <X size={14} /> : <Plus size={14} />}
                                  </button>
                                </div>
                                {isExpanded && (
                                  <div className="cargo-detalhes">
                                    {setor ? (
                                      <>
                                        <div className="cargo-detalhe-row">
                                          <span className="cargo-detalhe-label">Total:</span>
                                          <span className="cargo-detalhe-valor">{formatCurrency(setor.valorTotal)}</span>
                                        </div>
                                        <div className="cargo-detalhe-row">
                                          <span className="cargo-detalhe-label">Pago:</span>
                                          <span className="cargo-detalhe-valor pago">
                                            {formatCurrency(setor.valorPago)} <span className="cargo-detalhe-porcentagem">({setor.percentualPago}%)</span>
                                          </span>
                                        </div>
                                        <div className="cargo-detalhe-row">
                                          <span className="cargo-detalhe-label">Pendente:</span>
                                          <span className="cargo-detalhe-valor pendente">{formatCurrency(setor.valorPendente)}</span>
                                        </div>
                                      </>
                                    ) : (
                                      <div className="cargo-detalhe-row" style={{ color: '#8b949e', fontSize: '11px', fontStyle: 'italic' }}>
                                        Nenhuma venda registrada para este cargo
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      ) : emp.cargos?.filter(c => c.tipo_corretor === 'externo').length === 0 ? (
                        <p className="no-cargos">Nenhum cargo externo</p>
                      ) : null}
                    </div>

                    {/* Cargos Internos */}
                    <div className="empreendimento-cargos">
                      <h4>Cargos Internos</h4>
                      {emp.cargos?.filter(c => c.tipo_corretor === 'interno').length > 0 && (
                        <button
                          className="btn-toggle-cargos"
                          onClick={() => setCargosExpandidos(prev => ({
                            ...prev,
                            [`${emp.id}-interno`]: !prev[`${emp.id}-interno`]
                          }))}
                        >
                          {cargosExpandidos[`${emp.id}-interno`] ? 'Ocultar cargos e taxas' : 'Mostrar cargos e taxas'}
                          <ChevronDown 
                            size={16} 
                            className={cargosExpandidos[`${emp.id}-interno`] ? 'rotated' : ''}
                          />
                        </button>
                      )}
                      {cargosExpandidos[`${emp.id}-interno`] && emp.cargos?.filter(c => c.tipo_corretor === 'interno').length > 0 ? (
                        <div className="cargos-list">
                          {emp.cargos.filter(c => c.tipo_corretor === 'interno').map((cargo, idx) => {
                            const cargoKey = `${emp.id}-${cargo.id}`
                            const setor = calcularValoresPorSetor(emp.id).find(s => s.cargo_id === cargo.id)
                            const isExpanded = cargoExpandido === cargoKey
                            
                            return (
                              <div key={idx}>
                                <div className="cargo-item interno">
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                                    <span>{cargo.nome_cargo}</span>
                                    <span className="cargo-percent">{cargo.percentual}%</span>
                                  </div>
                                  <button
                                    className="btn-cargo-expand"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setCargoExpandido(isExpanded ? null : cargoKey)
                                    }}
                                    title={isExpanded ? 'Ocultar detalhes' : 'Mostrar detalhes'}
                                  >
                                    {isExpanded ? <X size={14} /> : <Plus size={14} />}
                                  </button>
                                </div>
                                {isExpanded && (
                                  <div className="cargo-detalhes">
                                    {setor ? (
                                      <>
                                        <div className="cargo-detalhe-row">
                                          <span className="cargo-detalhe-label">Total:</span>
                                          <span className="cargo-detalhe-valor">{formatCurrency(setor.valorTotal)}</span>
                                        </div>
                                        <div className="cargo-detalhe-row">
                                          <span className="cargo-detalhe-label">Pago:</span>
                                          <span className="cargo-detalhe-valor pago">
                                            {formatCurrency(setor.valorPago)} <span className="cargo-detalhe-porcentagem">({setor.percentualPago}%)</span>
                                          </span>
                                        </div>
                                        <div className="cargo-detalhe-row">
                                          <span className="cargo-detalhe-label">Pendente:</span>
                                          <span className="cargo-detalhe-valor pendente">{formatCurrency(setor.valorPendente)}</span>
                                        </div>
                                      </>
                                    ) : (
                                      <div className="cargo-detalhe-row" style={{ color: '#8b949e', fontSize: '11px', fontStyle: 'italic' }}>
                                        Nenhuma venda registrada para este cargo
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      ) : emp.cargos?.filter(c => c.tipo_corretor === 'interno').length === 0 ? (
                        <p className="no-cargos">Nenhum cargo interno</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'pagamentos' && (
          <div className="content-section">
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
                {/* Resumo */}
                <div className="pagamentos-resumo">
                  <div className="resumo-card">
                    <span className="resumo-label">Comissão Pendente</span>
                    <span className="resumo-valor pendente">
                      {formatCurrency(listaVendasComPagamentos.reduce((acc, grupo) => {
                        const comissaoTotal = parseFloat(grupo.venda?.comissao_total) || 0
                        const totalParcelas = grupo.totalValor
                        const parcelasPendentes = grupo.pagamentos.filter(p => p.status === 'pendente').reduce((a, p) => a + (parseFloat(p.valor) || 0), 0)
                        return totalParcelas > 0 ? acc + (comissaoTotal * parcelasPendentes / totalParcelas) : acc
                      }, 0))}
                    </span>
                  </div>
                  <div className="resumo-card">
                    <span className="resumo-label">Comissão Paga</span>
                    <span className="resumo-valor pago">
                      {formatCurrency(listaVendasComPagamentos.reduce((acc, grupo) => {
                        const comissaoTotal = parseFloat(grupo.venda?.comissao_total) || 0
                        const totalParcelas = grupo.totalValor
                        const parcelasPagas = grupo.pagamentos.filter(p => p.status === 'pago').reduce((a, p) => a + (parseFloat(p.valor) || 0), 0)
                        return totalParcelas > 0 ? acc + (comissaoTotal * parcelasPagas / totalParcelas) : acc
                      }, 0))}
                    </span>
                  </div>
                  <div className="resumo-card">
                    <span className="resumo-label">Comissão Total</span>
                    <span className="resumo-valor">
                      {formatCurrency(listaVendasComPagamentos.reduce((acc, grupo) => {
                        return acc + (parseFloat(grupo.venda?.comissao_total) || 0)
                      }, 0))}
                    </span>
                  </div>
                </div>

                {/* Vendas Agrupadas */}
                <div className="vendas-pagamentos-lista">
                  {listaVendasComPagamentos.map((grupo) => (
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
                            <span className="valor-number comissao">{formatCurrency(grupo.venda?.comissao_total || 0)}</span>
                          </div>
                          <div className="valor-item">
                            <span className="valor-label">Comissão Paga</span>
                            <span className="valor-number pago">{formatCurrency(
                              (() => {
                                const comissaoTotal = parseFloat(grupo.venda?.comissao_total) || 0
                                const totalParcelas = grupo.totalValor
                                const parcelasPagas = grupo.pagamentos.filter(p => p.status === 'pago').reduce((a, p) => a + (parseFloat(p.valor) || 0), 0)
                                return totalParcelas > 0 ? (comissaoTotal * parcelasPagas / totalParcelas) : 0
                              })()
                            )}</span>
                          </div>
                          <div className="valor-item">
                            <span className="valor-label">Comissão Pendente</span>
                            <span className="valor-number pendente">{formatCurrency(
                              (() => {
                                const comissaoTotal = parseFloat(grupo.venda?.comissao_total) || 0
                                const totalParcelas = grupo.totalValor
                                const parcelasPendentes = grupo.pagamentos.filter(p => p.status === 'pendente').reduce((a, p) => a + (parseFloat(p.valor) || 0), 0)
                                return totalParcelas > 0 ? (comissaoTotal * parcelasPendentes / totalParcelas) : 0
                              })()
                            )}</span>
                          </div>
                        </div>
                        <div className="expand-icon">
                          <ChevronDown size={20} className={vendaExpandida === grupo.venda_id ? 'rotated' : ''} />
                        </div>
                      </div>

                      {/* Lista de Parcelas - Expandível */}
                      {vendaExpandida === grupo.venda_id && (
                        <div className="venda-pagamento-body">
                          {grupo.pagamentos
                            .sort((a, b) => {
                              const ordem = { sinal: 0, entrada: 1, parcela_entrada: 2, balao: 3 }
                              if (ordem[a.tipo] !== ordem[b.tipo]) return ordem[a.tipo] - ordem[b.tipo]
                              return (a.numero_parcela || 0) - (b.numero_parcela || 0)
                            })
                            .map((pag) => (
                            <div key={pag.id} className={`parcela-row ${pag.status === 'pago' ? 'pago' : ''}`}>
                              <div className="parcela-main">
                                <div className="parcela-tipo">
                                  {pag.tipo === 'sinal' && 'Sinal'}
                                  {pag.tipo === 'entrada' && 'Entrada'}
                                  {pag.tipo === 'parcela_entrada' && `Parcela ${pag.numero_parcela}`}
                                  {pag.tipo === 'balao' && `Balão ${pag.numero_parcela || ''}`}
                                </div>
                                <div className="parcela-data">{pag.data_prevista ? new Date(pag.data_prevista).toLocaleDateString('pt-BR') : '-'}</div>
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
                                  {pag.status !== 'pago' && (
                                    <button 
                                      className="btn-small-confirm"
                                      onClick={(e) => { e.stopPropagation(); confirmarPagamento(pag.id); }}
                                    >
                                      Confirmar
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="parcela-comissoes">
                                {calcularComissaoPorCargoPagamento(pag).map((cargo, idx) => (
                                  <div key={idx} className="comissao-item">
                                    <span className="comissao-nome">{cargo.nome_cargo}</span>
                                    <span className="comissao-valor">{formatCurrency(cargo.valor)}</span>
                                  </div>
                                ))}
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
                  ))}
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
                              {calcularComissaoPorCargoPagamento(pagamentoDetalhe).map((cargo, idx) => (
                                <tr key={idx}>
                                  <td>{cargo.nome_cargo}</td>
                                  <td>{cargo.percentual.toFixed(2)}%</td>
                                  <td className="valor-comissao">{formatCurrency(cargo.valor)}</td>
                                </tr>
                              ))}
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
              </>
            )}
          </div>
        )}

        {activeTab === 'clientes' && (
          <div className="content-section">
            {clientes.length === 0 ? (
              <div className="empty-state-box">
                <UserCircle size={48} />
                <h3>Nenhum cliente cadastrado</h3>
                <p>Clique em "Novo Cliente" para adicionar</p>
              </div>
            ) : (
              <div className="clientes-grid">
                {clientes.map((cliente) => (
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
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          className="action-btn delete small"
                          onClick={() => handleDeleteCliente(cliente.id)}
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
              
              <div className="gerador-filtros">
                <div className="filtro-grupo">
                  <label>Venda</label>
                  <select
                    value={relatorioFiltros.vendaId}
                    onChange={(e) => setRelatorioFiltros({...relatorioFiltros, vendaId: e.target.value})}
                  >
                    <option value="">Todas as vendas</option>
                    {listaVendasComPagamentos.map((grupo) => (
                      <option key={grupo.venda_id} value={grupo.venda_id}>
                        {grupo.venda?.empreendimento?.nome} - Un. {grupo.venda?.unidade} ({grupo.venda?.corretor?.nome})
                      </option>
                    ))}
                  </select>
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
                
                <div className="filtro-grupo">
                  <label>Beneficiário / Cargo</label>
                  <select
                    value={relatorioFiltros.cargoId}
                    onChange={(e) => setRelatorioFiltros({...relatorioFiltros, cargoId: e.target.value})}
                  >
                    <option value="">Todos os cargos</option>
                    {(() => {
                      // Coletar todos os cargos únicos
                      const cargosUnicos = new Set()
                      listaVendasComPagamentos.forEach(grupo => {
                        grupo.pagamentos.forEach(pag => {
                          const comissoes = calcularComissaoPorCargoPagamento(pag)
                          comissoes.forEach(c => cargosUnicos.add(c.nome_cargo))
                        })
                      })
                      return Array.from(cargosUnicos).map(cargo => (
                        <option key={cargo} value={cargo}>{cargo}</option>
                      ))
                    })()}
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
                    {formatCurrency(vendas.reduce((acc, v) => acc + (parseFloat(v.comissao_total) || 0), 0))}
                  </span>
                </div>
                <div className="resumo-card-item">
                  <span className="resumo-titulo">Comissão Paga</span>
                  <span className="resumo-numero azul">
                    {formatCurrency(listaVendasComPagamentos.reduce((acc, grupo) => {
                      const comissaoTotal = parseFloat(grupo.venda?.comissao_total) || 0
                      const totalParcelas = grupo.totalValor
                      const parcelasPagas = grupo.pagamentos.filter(p => p.status === 'pago').reduce((a, p) => a + (parseFloat(p.valor) || 0), 0)
                      return totalParcelas > 0 ? acc + (comissaoTotal * parcelasPagas / totalParcelas) : acc
                    }, 0))}
                  </span>
                </div>
                <div className="resumo-card-item">
                  <span className="resumo-titulo">Comissão Pendente</span>
                  <span className="resumo-numero amarelo">
                    {formatCurrency(listaVendasComPagamentos.reduce((acc, grupo) => {
                      const comissaoTotal = parseFloat(grupo.venda?.comissao_total) || 0
                      const totalParcelas = grupo.totalValor
                      const parcelasPendentes = grupo.pagamentos.filter(p => p.status === 'pendente').reduce((a, p) => a + (parseFloat(p.valor) || 0), 0)
                      return totalParcelas > 0 ? acc + (comissaoTotal * parcelasPendentes / totalParcelas) : acc
                    }, 0))}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Divisão por Beneficiário */}
            <div className="relatorio-beneficiarios">
              <h3>Comissão por Beneficiário</h3>
              <div className="beneficiarios-lista">
                {(() => {
                  const cargosTotal = {}
                  listaVendasComPagamentos.forEach(grupo => {
                    grupo.pagamentos.forEach(pag => {
                      const comissoesCargo = calcularComissaoPorCargoPagamento(pag)
                      comissoesCargo.forEach(cargo => {
                        if (!cargosTotal[cargo.nome_cargo]) {
                          cargosTotal[cargo.nome_cargo] = { pendente: 0, pago: 0 }
                        }
                        if (pag.status === 'pago') {
                          cargosTotal[cargo.nome_cargo].pago += cargo.valor
                        } else {
                          cargosTotal[cargo.nome_cargo].pendente += cargo.valor
                        }
                      })
                    })
                  })
                  
                  return Object.entries(cargosTotal).map(([nome, valores]) => (
                    <div key={nome} className="beneficiario-row">
                      <span className="beneficiario-nome">{nome}</span>
                      <div className="beneficiario-valores">
                        <span className="valor-pago">Pago: {formatCurrency(valores.pago)}</span>
                        <span className="valor-pendente">Pendente: {formatCurrency(valores.pendente)}</span>
                        <span className="valor-total">Total: {formatCurrency(valores.pago + valores.pendente)}</span>
                      </div>
                    </div>
                  ))
                })()}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {modalType === 'venda' 
                  ? (selectedItem ? 'Editar Venda' : 'Nova Venda')
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
                <div className="modal-body">
                  <div className="form-group">
                    <label>Corretor *</label>
                    <select
                      value={vendaForm.corretor_id}
                      onChange={(e) => handleCorretorChange(e.target.value)}
                    >
                      <option value="">Selecione</option>
                      {corretores.map((c) => {
                        const isAutonomo = !c.empreendimento_id && c.percentual_corretor
                        const percentual = c.percentual_corretor || (c.tipo_corretor === 'interno' ? 2.5 : 4)
                        return (
                          <option key={c.id} value={c.id}>
                            {c.nome} - {isAutonomo ? 'Autônomo' : (c.tipo_corretor === 'interno' ? 'Interno' : 'Externo')} ({percentual}%)
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
                        {empreendimentos.map((emp) => (
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
                        {clientes.map((cliente) => (
                          <option key={cliente.id} value={cliente.id}>
                            {cliente.nome_completo} {cliente.cpf ? `- ${cliente.cpf}` : ''}
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
                        onChange={(e) => setVendaForm({...vendaForm, teve_sinal: e.target.value === 'sim', valor_sinal: e.target.value === 'nao' ? '' : vendaForm.valor_sinal})}
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
                          onChange={(e) => setVendaForm({...vendaForm, parcelou_entrada: e.target.value === 'sim'})}
                        >
                          <option value="nao">Não (à vista)</option>
                          <option value="sim">Sim</option>
                        </select>
                      </div>
                    )}
                  </div>

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
                    <div className="form-row">
                      <div className="form-group">
                        <label>Qtd. Parcelas</label>
                        <input
                          type="number"
                          placeholder="Ex: 12"
                          value={vendaForm.qtd_parcelas_entrada}
                          onChange={(e) => setVendaForm({...vendaForm, qtd_parcelas_entrada: e.target.value})}
                        />
                      </div>
                      <div className="form-group">
                        <label>Valor Parcela</label>
                        <div className="input-currency">
                          <span className="currency-prefix">R$</span>
                          <input
                            type="text"
                            placeholder="0,00"
                            value={formatCurrencyInput(vendaForm.valor_parcela_entrada)}
                            onChange={(e) => handleCurrencyChange('valor_parcela_entrada', e.target.value)}
                          />
                        </div>
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
                          valor_balao: e.target.value === 'nao' ? '' : vendaForm.valor_balao
                        })}
                      >
                        <option value="nao">Não</option>
                        <option value="sim">Sim</option>
                        <option value="pendente">Ainda não (pendente)</option>
                      </select>
                    </div>
                  </div>

                  {(vendaForm.teve_balao === 'sim' || vendaForm.teve_balao === 'pendente') && (
                    <div className="form-row">
                      <div className="form-group">
                        <label>Quantos Balões?</label>
                        <input
                          type="number"
                          placeholder="Ex: 2"
                          min="1"
                          value={vendaForm.qtd_balao}
                          onChange={(e) => setVendaForm({...vendaForm, qtd_balao: e.target.value})}
                        />
                      </div>
                      <div className="form-group">
                        <label>Valor de Cada Balão</label>
                        <div className="input-currency">
                          <span className="currency-prefix">R$</span>
                          <input
                            type="text"
                            placeholder="0,00"
                            value={formatCurrencyInput(vendaForm.valor_balao)}
                            onChange={(e) => handleCurrencyChange('valor_balao', e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}

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
                            (vendaForm.parcelou_entrada 
                              ? ((parseFloat(vendaForm.qtd_parcelas_entrada) || 0) * (parseFloat(vendaForm.valor_parcela_entrada) || 0))
                              : (parseFloat(vendaForm.valor_entrada) || 0)) +
                            ((parseFloat(vendaForm.qtd_balao) || 0) * (parseFloat(vendaForm.valor_balao) || 0))
                          )}</span>
                        </div>
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
                        {empreendimentos.map((emp) => (
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
                        {cargosDisponiveis
                          .filter(cargo => {
                            // Filtrar cargos já ocupados (exceto se for edição do mesmo corretor)
                            const ocupado = corretores.some(c => 
                              c.cargo_id === cargo.id && c.id !== selectedItem?.id
                            )
                            return !ocupado
                          })
                          .map((cargo) => (
                            <option key={cargo.id} value={cargo.id}>
                              {cargo.nome_cargo} ({cargo.percentual}%)
                            </option>
                          ))
                        }
                      </select>
                      {cargosDisponiveis.length > 0 && 
                       cargosDisponiveis.filter(c => !corretores.some(cor => cor.cargo_id === c.id && cor.id !== selectedItem?.id)).length === 0 && (
                        <p className="field-hint error">Todos os cargos deste empreendimento já estão ocupados</p>
                      )}
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
                              <input
                                type="text"
                                placeholder="Ex: Cônjuge, Mãe, Pai, Irmão(ã)"
                                value={comp.tipo_relacionamento || ''}
                                onChange={(e) => updateComplementador(index, 'tipo_relacionamento', e.target.value)}
                              />
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
    </div>
  )
}

export default AdminDashboard
