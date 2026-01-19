import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { 
  DollarSign, TrendingUp, LogOut, 
  Calendar, User, CheckCircle, Clock, 
  Wallet, Target, Award, BarChart3,
  LayoutDashboard, Menu, X, ChevronLeft, ChevronRight, ChevronDown,
  Building, MapPin, CreditCard, Users, FileText, Eye, Phone, Mail,
  Home, Percent, CalendarDays, BanknoteIcon, TrendingDown, ArrowUpRight,
  Plus, UserPlus, Send, ClipboardList, CheckCircle2, XCircle, AlertCircle,
  Camera
} from 'lucide-react'
import logo from '../imgs/logo.png'
import Ticker from '../components/Ticker'
import '../styles/Dashboard.css'
import '../styles/CorretorDashboard.css'
import '../styles/EmpreendimentosPage.css'

const CorretorDashboard = () => {
  const { user, userProfile, signOut } = useAuth()
  const { tab } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  
  // Detectar activeTab baseado na URL
  let activeTab = 'dashboard'
  if (location.pathname === '/corretor/dashboard') {
    activeTab = 'dashboard'
  } else if (tab) {
    activeTab = tab
  } else if (location.pathname === '/corretor') {
    activeTab = 'dashboard'
  }
  
  const [vendas, setVendas] = useState([])
  const [loading, setLoading] = useState(true)
  const [periodo, setPeriodo] = useState('todos')
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('corretor-sidebar-collapsed')
    return saved === 'true'
  })
  const [cargoInfo, setCargoInfo] = useState(null)
  const [empreendimentoInfo, setEmpreendimentoInfo] = useState(null)
  const [vendaExpandida, setVendaExpandida] = useState(null)
  const [pagamentosVenda, setPagamentosVenda] = useState({}) // Cache de pagamentos por venda
  const [gruposExpandidos, setGruposExpandidos] = useState({}) // Controla quais grupos estão expandidos: { "vendaId-tipo": true }
  
  // Novos estados para as abas adicionais
  const [empreendimentos, setEmpreendimentos] = useState([])
  const [meusPagamentos, setMeusPagamentos] = useState([])
  const [meusClientes, setMeusClientes] = useState([])
  const [loadingEmpreendimentos, setLoadingEmpreendimentos] = useState(false)
  const [loadingPagamentos, setLoadingPagamentos] = useState(false)
  const [loadingClientes, setLoadingClientes] = useState(false)
  const [selectedEmpreendimento, setSelectedEmpreendimento] = useState(null)
  const [selectedCliente, setSelectedCliente] = useState(null)
  
  // Estados para solicitações
  const [minhasSolicitacoes, setMinhasSolicitacoes] = useState([])
  const [loadingSolicitacoes, setLoadingSolicitacoes] = useState(false)
  const [showNovaVendaModal, setShowNovaVendaModal] = useState(false)
  const [showNovoClienteModal, setShowNovoClienteModal] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  const [todosClientes, setTodosClientes] = useState([])
  
  // Form de nova venda
  const [novaVendaForm, setNovaVendaForm] = useState({
    empreendimento_id: '',
    cliente_id: '',
    nome_cliente: '',
    unidade: '',
    bloco: '',
    valor_venda: '',
    data_venda: new Date().toISOString().split('T')[0]
  })
  
  // Form de novo cliente
  const [novoClienteForm, setNovoClienteForm] = useState({
    nome_completo: '',
    cpf: '',
    email: '',
    telefone: '',
    endereco: ''
  })

  useEffect(() => {
    if (user) {
      fetchVendas()
      // Carregar solicitações para mostrar badge
      fetchMinhasSolicitacoes()
    }
  }, [user])

  useEffect(() => {
    if (userProfile) {
      fetchCargoAndEmpreendimento()
    }
  }, [userProfile])

  // Carregar dados quando mudar de aba
  useEffect(() => {
    if ((activeTab === 'empreendimentos' || activeTab === 'solicitacoes') && empreendimentos.length === 0) {
      fetchEmpreendimentos()
    }
    if (activeTab === 'pagamentos' && meusPagamentos.length === 0 && vendas.length > 0) {
      fetchMeusPagamentos()
    }
    if (activeTab === 'clientes' && meusClientes.length === 0 && vendas.length > 0) {
      fetchMeusClientes()
    }
  }, [activeTab, vendas])

  // Fetch Empreendimentos
  const fetchEmpreendimentos = async () => {
    setLoadingEmpreendimentos(true)
    try {
      const { data, error } = await supabase
        .from('empreendimentos')
        .select('*')
        .order('nome')

      if (error) throw error
      
      // Buscar fotos de fachada para cada empreendimento
      const empsComFotos = await Promise.all((data || []).map(async (emp) => {
        const { data: fotos } = await supabase
          .from('empreendimento_fotos')
          .select('url')
          .eq('empreendimento_id', emp.id)
          .eq('categoria', 'fachada')
          .limit(1)
        
        return {
          ...emp,
          foto_fachada: fotos?.[0]?.url || null
        }
      }))
      
      setEmpreendimentos(empsComFotos)
    } catch (error) {
      console.error('Erro ao buscar empreendimentos:', error)
    } finally {
      setLoadingEmpreendimentos(false)
    }
  }

  // Fetch Meus Pagamentos (pagamentos das vendas do corretor)
  const fetchMeusPagamentos = async () => {
    setLoadingPagamentos(true)
    try {
      const vendaIds = vendas.map(v => v.id)
      if (vendaIds.length === 0) {
        setMeusPagamentos([])
        return
      }

      const { data, error } = await supabase
        .from('pagamentos_prosoluto')
        .select('*')
        .in('venda_id', vendaIds)
        .order('data_prevista', { ascending: true })

      if (error) throw error

      // Associar nome do cliente e empreendimento a cada pagamento
      const pagamentosEnriquecidos = (data || []).map(pag => {
        const venda = vendas.find(v => v.id === pag.venda_id)
        return {
          ...pag,
          cliente_nome: venda?.cliente_nome || 'N/A',
          empreendimento_nome: venda?.empreendimento_nome || 'N/A',
          unidade: venda?.unidade || 'N/A',
          valor_venda: venda?.valor_venda || 0,
          comissao_corretor: venda?.comissao_corretor || 0
        }
      })

      setMeusPagamentos(pagamentosEnriquecidos)
    } catch (error) {
      console.error('Erro ao buscar pagamentos:', error)
    } finally {
      setLoadingPagamentos(false)
    }
  }

  // Fetch Meus Clientes (clientes das vendas do corretor)
  const fetchMeusClientes = async () => {
    setLoadingClientes(true)
    try {
      const clienteIds = [...new Set(vendas.map(v => v.cliente_id).filter(Boolean))]
      if (clienteIds.length === 0) {
        setMeusClientes([])
        return
      }

      const { data, error } = await supabase
        .from('clientes')
        .select('*')
        .in('id', clienteIds)
        .order('nome_completo')

      if (error) throw error

      // Associar vendas a cada cliente
      const clientesComVendas = (data || []).map(cliente => {
        const vendasCliente = vendas.filter(v => v.cliente_id === cliente.id)
        const totalVendas = vendasCliente.reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)
        return {
          ...cliente,
          vendas: vendasCliente,
          total_vendas: totalVendas,
          qtd_vendas: vendasCliente.length
        }
      })

      setMeusClientes(clientesComVendas)
    } catch (error) {
      console.error('Erro ao buscar clientes:', error)
    } finally {
      setLoadingClientes(false)
    }
  }

  const fetchCargoAndEmpreendimento = async () => {
    if (!userProfile?.cargo_id && !userProfile?.empreendimento_id) {
      return
    }

    try {
      const promises = []
      
      if (userProfile?.cargo_id) {
        promises.push(
          supabase
            .from('cargos_empreendimento')
            .select('nome_cargo, percentual')
            .eq('id', userProfile.cargo_id)
            .single()
            .then(({ data }) => data)
        )
      } else {
        promises.push(Promise.resolve(null))
      }

      if (userProfile?.empreendimento_id) {
        promises.push(
          supabase
            .from('empreendimentos')
            .select('nome')
            .eq('id', userProfile.empreendimento_id)
            .single()
            .then(({ data }) => data)
        )
      } else {
        promises.push(Promise.resolve(null))
      }

      const [cargo, empreendimento] = await Promise.all(promises)
      setCargoInfo(cargo)
      setEmpreendimentoInfo(empreendimento)
    } catch (error) {
      console.error('Erro ao buscar cargo e empreendimento:', error)
    }
  }

  const fetchVendas = async () => {
    setLoading(true)
    
    try {
    const { data, error } = await supabase
      .from('vendas')
      .select('*')
      .eq('corretor_id', user.id)
      .order('data_venda', { ascending: false })

      if (error) {
        console.error('❌ Erro ao buscar vendas:', error)
        setVendas([])
        return
      }

      // Buscar empreendimentos e clientes para associar
      const empreendimentoIds = [...new Set((data || []).map(v => v.empreendimento_id).filter(Boolean))]
      const clienteIds = [...new Set((data || []).map(v => v.cliente_id).filter(Boolean))]

      const [empreendimentosResult, clientesResult] = await Promise.all([
        empreendimentoIds.length > 0 
          ? supabase.from('empreendimentos').select('id, nome').in('id', empreendimentoIds)
          : Promise.resolve({ data: [], error: null }),
        clienteIds.length > 0
          ? supabase.from('clientes').select('id, nome_completo').in('id', clienteIds)
          : Promise.resolve({ data: [], error: null })
      ])

      const empreendimentosMap = (empreendimentosResult.data || []).reduce((acc, emp) => {
        acc[emp.id] = emp.nome
        return acc
      }, {})

      const clientesMap = (clientesResult.data || []).reduce((acc, cliente) => {
        acc[cliente.id] = cliente.nome_completo
        return acc
      }, {})

      // Validar e normalizar os dados
      const vendasValidadas = (data || []).map(venda => {
        const valorVenda = parseFloat(venda.valor_venda) || 0
        let comissaoCorretor = venda.comissao_corretor
        
        // Se comissao_corretor for null, undefined ou string vazia, calcular
        if (comissaoCorretor === null || comissaoCorretor === undefined || comissaoCorretor === '') {
          const percentual = userProfile?.percentual_corretor || 
            (userProfile?.tipo_corretor === 'interno' ? 2.5 : 3.5)
          comissaoCorretor = (valorVenda * percentual) / 100
        } else {
          // Converter para número se for string
          comissaoCorretor = parseFloat(comissaoCorretor) || 0
        }

        return {
          ...venda,
          valor_venda: valorVenda,
          comissao_corretor: comissaoCorretor,
          status: venda.status || 'pendente',
          empreendimento_nome: venda.empreendimento_id ? empreendimentosMap[venda.empreendimento_id] : null,
          cliente_nome: venda.cliente_id ? clientesMap[venda.cliente_id] : null
        }
      })
      
      setVendas(vendasValidadas)
    } catch (error) {
      console.error('❌ Erro crítico ao buscar vendas:', error)
      setVendas([])
    } finally {
    setLoading(false)
    }
  }

  // Função para buscar minhas solicitações
  const fetchMinhasSolicitacoes = async () => {
    setLoadingSolicitacoes(true)
    try {
      const { data, error } = await supabase
        .from('solicitacoes')
        .select('*')
        .eq('corretor_id', user.id)
        .order('created_at', { ascending: false })
      
      if (error) throw error
      setMinhasSolicitacoes(data || [])
    } catch (error) {
      console.error('Erro ao buscar solicitações:', error)
    } finally {
      setLoadingSolicitacoes(false)
    }
  }

  // Função para buscar todos os clientes (para o select de nova venda)
  const fetchTodosClientes = async () => {
    try {
      const { data, error } = await supabase
        .from('clientes')
        .select('id, nome_completo, cpf')
        .order('nome_completo')
      
      if (error) throw error
      setTodosClientes(data || [])
    } catch (error) {
      console.error('Erro ao buscar clientes:', error)
    }
  }

  // Carregar solicitações quando acessar a aba
  useEffect(() => {
    if (activeTab === 'solicitacoes' && user) {
      fetchMinhasSolicitacoes()
      fetchTodosClientes()
    }
  }, [activeTab, user])

  // Limpar mensagem após 5 segundos
  useEffect(() => {
    if (message.text) {
      const timer = setTimeout(() => {
        setMessage({ type: '', text: '' })
      }, 5000)
      return () => clearTimeout(timer)
    }
  }, [message])

  // Função para enviar solicitação de nova venda
  const handleEnviarSolicitacaoVenda = async (e) => {
    e.preventDefault()
    
    if (!novaVendaForm.empreendimento_id || !novaVendaForm.valor_venda) {
      setMessage({ type: 'error', text: 'Preencha os campos obrigatórios' })
      return
    }
    
    try {
      setLoading(true)
      
      // Buscar nome do cliente se selecionado
      let nomeCliente = novaVendaForm.nome_cliente
      if (novaVendaForm.cliente_id) {
        const cliente = todosClientes.find(c => c.id === novaVendaForm.cliente_id)
        if (cliente) nomeCliente = cliente.nome_completo
      }
      
      const { error } = await supabase
        .from('solicitacoes')
        .insert([{
          corretor_id: user.id,
          tipo: 'venda',
          status: 'pendente',
          dados: {
            ...novaVendaForm,
            corretor_id: user.id,
            nome_cliente: nomeCliente
          }
        }])
      
      if (error) throw error
      
      setMessage({ type: 'success', text: 'Solicitação de venda enviada! Aguarde aprovação do admin.' })
      setShowNovaVendaModal(false)
      setNovaVendaForm({
        empreendimento_id: '',
        cliente_id: '',
        nome_cliente: '',
        unidade: '',
        bloco: '',
        valor_venda: '',
        data_venda: new Date().toISOString().split('T')[0]
      })
      fetchMinhasSolicitacoes()
    } catch (error) {
      console.error('Erro ao enviar solicitação:', error)
      setMessage({ type: 'error', text: 'Erro ao enviar solicitação: ' + error.message })
    } finally {
      setLoading(false)
    }
  }

  // Função para enviar solicitação de novo cliente
  const handleEnviarSolicitacaoCliente = async (e) => {
    e.preventDefault()
    
    if (!novoClienteForm.nome_completo || !novoClienteForm.cpf) {
      setMessage({ type: 'error', text: 'Nome e CPF são obrigatórios' })
      return
    }
    
    try {
      setLoading(true)
      
      const { error } = await supabase
        .from('solicitacoes')
        .insert([{
          corretor_id: user.id,
          tipo: 'cliente',
          status: 'pendente',
          dados: novoClienteForm
        }])
      
      if (error) throw error
      
      setMessage({ type: 'success', text: 'Solicitação de cliente enviada! Aguarde aprovação do admin.' })
      setShowNovoClienteModal(false)
      setNovoClienteForm({
        nome_completo: '',
        cpf: '',
        email: '',
        telefone: '',
        endereco: ''
      })
      fetchMinhasSolicitacoes()
    } catch (error) {
      console.error('Erro ao enviar solicitação:', error)
      setMessage({ type: 'error', text: 'Erro ao enviar solicitação: ' + error.message })
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value) => {
    if (value === null || value === undefined || isNaN(value)) {
      return 'R$ 0,00'
    }
    // Sempre mostrar valor completo, nunca formato compacto (1M, 1k, etc)
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value)
  }

  // Função para capitalizar nomes (primeira letra de cada palavra em maiúscula)
  const capitalizeName = (name) => {
    if (!name || typeof name !== 'string') return name
    return name
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const filteredVendas = vendas.filter(venda => {
    if (periodo === 'todos') return true
    
    const dataVenda = new Date(venda.data_venda)
    const hoje = new Date()
    
    if (periodo === 'mes') {
      const mesmoMes = dataVenda.getMonth() === hoje.getMonth() && 
                       dataVenda.getFullYear() === hoje.getFullYear()
      return mesmoMes
    }
    if (periodo === 'ano') {
      const mesmoAno = dataVenda.getFullYear() === hoje.getFullYear()
      return mesmoAno
    }
    return true
  })
  
  // Log resumido do filtro
  useEffect(() => {
    console.log(`🔍 [FILTRO RESUMO] Período: ${periodo.toUpperCase()} | Total vendas: ${vendas.length} | Vendas filtradas: ${filteredVendas.length}`)
    if (periodo !== 'todos' && filteredVendas.length > 0) {
      console.log(`📋 Vendas incluídas no filtro "${periodo}":`)
      filteredVendas.forEach((v, i) => {
        console.log(`  ${i + 1}. ${new Date(v.data_venda).toLocaleDateString('pt-BR')} - ${formatCurrency(v.valor_venda)}`)
      })
    } else if (periodo !== 'todos' && filteredVendas.length === 0) {
      console.log(`⚠️ Nenhuma venda encontrada para o período "${periodo}"`)
      console.log(`📅 Vendas disponíveis:`)
      vendas.forEach((v, i) => {
        console.log(`  ${i + 1}. ${new Date(v.data_venda).toLocaleDateString('pt-BR')} - ${formatCurrency(v.valor_venda)}`)
      })
    }
  }, [periodo, vendas.length, filteredVendas.length])

  const getTotalVendas = () => {
    return filteredVendas.reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)
  }

  const getTotalComissao = () => {
    return filteredVendas.reduce((acc, v) => {
      const comissao = v.comissao_corretor === null || v.comissao_corretor === undefined 
        ? 0 
        : (parseFloat(v.comissao_corretor) || 0)
      return acc + comissao
    }, 0)
  }

  const getComissaoPendente = () => {
    const pendentes = filteredVendas.filter(v => v.status === 'pendente')
    return pendentes.reduce((acc, v) => {
      const comissao = v.comissao_corretor === null || v.comissao_corretor === undefined 
        ? 0 
        : (parseFloat(v.comissao_corretor) || 0)
      return acc + comissao
    }, 0)
  }

  const getComissaoPaga = () => {
    const pagas = filteredVendas.filter(v => v.status === 'pago')
    return pagas.reduce((acc, v) => acc + (parseFloat(v.comissao_corretor) || 0), 0)
  }

  const percentualCorretor = userProfile?.percentual_corretor || 
    (userProfile?.tipo_corretor === 'interno' ? 2.5 : 4)

  // Buscar pagamentos de uma venda específica
  const fetchPagamentosVenda = async (vendaId) => {
    if (pagamentosVenda[vendaId]) {
      return pagamentosVenda[vendaId] // Retornar do cache se já foi buscado
    }

    try {
      const { data, error } = await supabase
        .from('pagamentos_prosoluto')
        .select('*')
        .eq('venda_id', vendaId)
        .order('data_prevista', { ascending: true })

      if (error) {
        console.error('Erro ao buscar pagamentos:', error)
        return []
      }

      // Salvar no cache
      setPagamentosVenda(prev => ({
        ...prev,
        [vendaId]: data || []
      }))

      return data || []
    } catch (error) {
      console.error('Erro ao buscar pagamentos:', error)
      return []
    }
  }

  // Calcular comissão proporcional do corretor para uma parcela
  const calcularComissaoProporcional = (pagamento, venda) => {
    const valorTotalVenda = parseFloat(venda.valor_venda) || 0
    const valorParcela = parseFloat(pagamento.valor) || 0
    const comissaoTotalCorretor = parseFloat(venda.comissao_corretor) || 0

    if (valorTotalVenda === 0) return 0
    return (comissaoTotalCorretor * valorParcela) / valorTotalVenda
  }

  // Agrupar pagamentos por tipo
  const agruparPagamentosPorTipo = (pagamentos) => {
    const grupos = {
      sinal: [],
      entrada: [],
      parcela_entrada: [],
      balao: []
    }

    pagamentos.forEach(pagamento => {
      const tipo = pagamento.tipo
      if (grupos[tipo]) {
        grupos[tipo].push(pagamento)
      }
    })

    // Ordenar cada grupo por número de parcela
    grupos.parcela_entrada.sort((a, b) => (a.numero_parcela || 0) - (b.numero_parcela || 0))
    grupos.balao.sort((a, b) => (a.numero_parcela || 0) - (b.numero_parcela || 0))

    return grupos
  }

  // Obter label do grupo
  const getGrupoLabel = (tipo) => {
    const labels = {
      sinal: 'Sinal',
      entrada: 'Entrada',
      parcela_entrada: 'Parcelas de Entrada',
      balao: 'Balões'
    }
    return labels[tipo] || tipo
  }

  // Toggle expansão de grupo (quando tem mais de 10 itens)
  const toggleGrupoExpandido = (vendaId, tipo) => {
    const key = `${vendaId}-${tipo}`
    setGruposExpandidos(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  // Verificar se grupo está expandido
  const isGrupoExpandido = (vendaId, tipo) => {
    const key = `${vendaId}-${tipo}`
    return gruposExpandidos[key] || false
  }

  // Handler para expandir/colapsar venda
  const toggleVendaExpandida = async (vendaId) => {
    if (vendaExpandida === vendaId) {
      setVendaExpandida(null)
    } else {
      setVendaExpandida(vendaId)
      // Buscar pagamentos se ainda não foram buscados
      if (!pagamentosVenda[vendaId]) {
        await fetchPagamentosVenda(vendaId)
      }
    }
  }

  // Função para gerar título dinâmico do dashboard
  const getDashboardTitle = () => {
    if (cargoInfo?.nome_cargo) {
      return `Dashboard ${cargoInfo.nome_cargo}`
    } else {
      return 'Dashboard do Corretor'
    }
  }

  // Função para gerar dados do Ticker (métricas pessoais do corretor)
  const getTickerData = () => {
    const hoje = new Date()
    const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 0, 0, 0, 0)
    const fimHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59, 999)
    
    // Vendas hoje
    const vendasHoje = vendas.filter(v => {
      const dataVenda = new Date(v.data_venda)
      return dataVenda >= inicioHoje && dataVenda <= fimHoje
    })
    const totalVendasHoje = vendasHoje.reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)
    
    // Vendas este mês
    const vendasMes = vendas.filter(v => {
      const dataVenda = new Date(v.data_venda)
      return dataVenda.getMonth() === hoje.getMonth() && 
             dataVenda.getFullYear() === hoje.getFullYear()
    })
    const totalVendasMes = vendasMes.reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)
    
    // Média por venda
    const mediaPorVenda = vendas.length > 0 
      ? getTotalVendas() / vendas.length 
      : 0
    
    // Formatar valores
    const formatTicker = (value) => {
      // Sempre mostrar valor completo, nunca formato compacto (1M, 1k, etc)
      if (value === null || value === undefined || isNaN(value)) {
        return 'R$ 0,00'
      }
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(value)
    }

    const tickerData = [
      {
        name: 'MINHAS VENDAS HOJE',
        value: formatTicker(totalVendasHoje),
        change: vendasHoje.length > 0 ? `+${vendasHoje.length}` : '',
        type: vendasHoje.length > 0 ? 'positive' : 'neutral'
      },
      {
        name: 'MINHA COMISSÃO PENDENTE',
        value: formatTicker(getComissaoPendente()),
        change: getComissaoPendente() > 0 ? `${Math.round((getComissaoPendente() / getTotalVendas()) * 100)}%` : '',
        type: getComissaoPendente() > 0 ? 'positive' : 'neutral'
      },
      {
        name: 'TOTAL EM VENDAS',
        value: formatTicker(getTotalVendas()),
        change: vendas.length > 0 ? `${vendas.length} vendas` : '',
        type: 'positive'
      },
      {
        name: 'COMISSÃO PAGA',
        value: formatTicker(getComissaoPaga()),
        change: getComissaoPaga() > 0 ? `${Math.round((getComissaoPaga() / getTotalVendas()) * 100)}%` : '',
        type: getComissaoPaga() > 0 ? 'positive' : 'neutral'
      },
      {
        name: 'VENDAS ESTE MÊS',
        value: formatTicker(totalVendasMes),
        change: vendasMes.length > 0 ? `${vendasMes.length} vendas` : '',
        type: 'positive'
      },
      {
        name: 'MÉDIA POR VENDA',
        value: formatTicker(mediaPorVenda),
        change: '',
        type: 'positive'
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

    return tickerData
  }

  // Toggle sidebar collapsed state
  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const newValue = !prev
      localStorage.setItem('corretor-sidebar-collapsed', String(newValue))
      return newValue
    })
  }

  // Initialize menu state based on screen width
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 1024) {
        setMenuOpen(true)
      } else {
        setMenuOpen(false)
      }
    }
    
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Redirecionar /corretor para /corretor/dashboard
  useEffect(() => {
    if (!tab && location.pathname === '/corretor') {
      navigate('/corretor/dashboard', { replace: true })
    }
  }, [tab, navigate, location.pathname])


  return (
    <div className="dashboard-container">
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
            onClick={() => navigate('/corretor/dashboard')}
            title="Dashboard"
          >
            <LayoutDashboard size={20} />
            <span>Dashboard</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'vendas' ? 'active' : ''}`}
            onClick={() => navigate('/corretor/vendas')}
            title="Minhas Vendas"
          >
            <DollarSign size={20} />
            <span>Minhas Vendas</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'pagamentos' ? 'active' : ''}`}
            onClick={() => navigate('/corretor/pagamentos')}
            title="Meus Pagamentos"
          >
            <CreditCard size={20} />
            <span>Meus Pagamentos</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'clientes' ? 'active' : ''}`}
            onClick={() => navigate('/corretor/clientes')}
            title="Meus Clientes"
          >
            <Users size={20} />
            <span>Meus Clientes</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'empreendimentos' ? 'active' : ''}`}
            onClick={() => navigate('/corretor/empreendimentos')}
            title="Empreendimentos"
          >
            <Building size={20} />
            <span>Empreendimentos</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'relatorios' ? 'active' : ''}`}
            onClick={() => navigate('/corretor/relatorios')}
            title="Relatórios"
          >
            <FileText size={20} />
            <span>Relatórios</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'solicitacoes' ? 'active' : ''}`}
            onClick={() => navigate('/corretor/solicitacoes')}
            title="Solicitações"
          >
            <ClipboardList size={20} />
            <span>Solicitações</span>
            {minhasSolicitacoes.filter(s => s.status === 'pendente').length > 0 && (
              <span className="nav-badge pendente">{minhasSolicitacoes.filter(s => s.status === 'pendente').length}</span>
            )}
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
              <span className="user-name">{capitalizeName(userProfile?.nome || 'Corretor')}</span>
              <span className="user-role">
                {userProfile?.tipo_corretor === 'interno' ? 'Interno' : 'Externo'}
              </span>
          </div>
          </div>
          <button className="logout-btn" onClick={signOut} title="Sair">
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
            {activeTab === 'dashboard' && getDashboardTitle()}
            {activeTab === 'vendas' && 'Minhas Vendas'}
            {activeTab === 'pagamentos' && 'Meus Pagamentos'}
            {activeTab === 'clientes' && 'Meus Clientes'}
            {activeTab === 'empreendimentos' && 'Empreendimentos'}
            {activeTab === 'relatorios' && 'Relatórios'}
            {activeTab === 'solicitacoes' && 'Minhas Solicitações'}
          </h1>
      </header>

        {/* Content Section */}
        <div className="content-section">
          {/* Dashboard Tab */}
          {activeTab === 'dashboard' && (
            <>
      {/* Welcome Section */}
      <section className="welcome-section">
        <div className="welcome-content">
                  <h1>Bem-vindo, {capitalizeName(userProfile?.nome?.split(' ')[0] || 'Corretor')}</h1>
          <p>Acompanhe suas vendas e comissões</p>
        </div>
        <div className="tipo-badge">
          <span className={`badge-large ${userProfile?.tipo_corretor || 'externo'}`}>
                    {userProfile?.tipo_corretor === 'interno' ? 'Interno' : 'Externo'}
          </span>
        </div>
      </section>

      {/* Stats Cards */}
      <section className="stats-section">
        <div className="stat-card-corretor primary">
          <div className="stat-card-icon">
            <Wallet size={28} />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-label">Total a Receber</span>
            <span className="stat-card-value">
              {formatCurrency(getTotalComissao())}
            </span>
          </div>
          <div className="stat-card-decoration"></div>
        </div>

        <div className="stat-card-corretor success">
          <div className="stat-card-icon">
            <CheckCircle size={28} />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-label">Comissão Paga</span>
            <span className="stat-card-value">
              {formatCurrency(getComissaoPaga())}
            </span>
          </div>
          <div className="stat-card-decoration"></div>
        </div>

        <div className="stat-card-corretor warning">
          <div className="stat-card-icon">
            <Clock size={28} />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-label">Pendente</span>
            <span className="stat-card-value">
              {formatCurrency(getComissaoPendente())}
            </span>
          </div>
          <div className="stat-card-decoration"></div>
        </div>

        <div className="stat-card-corretor info">
          <div className="stat-card-icon">
            <Target size={28} />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-label">Total em Vendas</span>
            <span className="stat-card-value">
              {formatCurrency(getTotalVendas())}
            </span>
          </div>
          <div className="stat-card-decoration"></div>
        </div>
      </section>

      {/* Percentual Info */}
      <section className="percentual-section">
        <div className="percentual-card">
          <div className="percentual-header">
            <Award size={24} />
            <h3>Seu Percentual de Comissão</h3>
          </div>
          <div className="percentual-value">
            <span className="big-percent">
              {percentualCorretor}%
            </span>
            <span className="percent-label">sobre cada venda</span>
          </div>
          <div className="percentual-info">
            <p>
              Como corretor <strong>{userProfile?.tipo_corretor === 'interno' ? 'interno' : 'externo'}</strong>, 
              você recebe {percentualCorretor}% do valor de cada venda realizada.
            </p>
          </div>
        </div>
      </section>

            </>
          )}

          {/* Vendas Tab */}
          {activeTab === 'vendas' && (
      <section className="vendas-section">
        <div className="section-header-corretor">
          <div className="period-filter">
            <button 
              className={periodo === 'todos' ? 'active' : ''} 
              onClick={() => setPeriodo('todos')}
            >
              Todas
            </button>
            <button 
              className={periodo === 'mes' ? 'active' : ''} 
              onClick={() => setPeriodo('mes')}
            >
              Este Mês
            </button>
            <button 
              className={periodo === 'ano' ? 'active' : ''} 
              onClick={() => setPeriodo('ano')}
            >
              Este Ano
            </button>
          </div>
        </div>

        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner-large"></div>
            <p>Carregando suas vendas...</p>
          </div>
              ) : (
                <>
                  {/* Resumo de Comissões */}
                  <div className="stats-section" style={{ marginBottom: '32px' }}>
                    <div className="stat-card-corretor primary">
                      <div className="stat-card-icon">
                        <Wallet size={28} />
                      </div>
                      <div className="stat-card-content">
                        <span className="stat-card-label">Total a Receber</span>
                        <span className="stat-card-value">{formatCurrency(getTotalComissao())}</span>
                      </div>
                      <div className="stat-card-decoration"></div>
                    </div>

                    <div className="stat-card-corretor success">
                      <div className="stat-card-icon">
                        <CheckCircle size={28} />
                      </div>
                      <div className="stat-card-content">
                        <span className="stat-card-label">Comissão Paga</span>
                        <span className="stat-card-value">{formatCurrency(getComissaoPaga())}</span>
                      </div>
                      <div className="stat-card-decoration"></div>
                    </div>

                    <div className="stat-card-corretor warning">
                      <div className="stat-card-icon">
                        <Clock size={28} />
                      </div>
                      <div className="stat-card-content">
                        <span className="stat-card-label">Pendente</span>
                        <span className="stat-card-value">{formatCurrency(getComissaoPendente())}</span>
                      </div>
                      <div className="stat-card-decoration"></div>
                    </div>

                    <div className="stat-card-corretor info">
                      <div className="stat-card-icon">
                        <Target size={28} />
                      </div>
                      <div className="stat-card-content">
                        <span className="stat-card-label">Total em Vendas</span>
                        <span className="stat-card-value">{formatCurrency(getTotalVendas())}</span>
                      </div>
                      <div className="stat-card-decoration"></div>
                    </div>
                  </div>

                  {/* Lista de Vendas */}
                  {filteredVendas.length === 0 ? (
          <div className="empty-state">
            <DollarSign size={48} />
            <h3>Nenhuma venda encontrada</h3>
            <p>Suas vendas aparecerão aqui quando forem registradas</p>
          </div>
        ) : (
          <div className="vendas-list">
            {filteredVendas.map((venda) => (
              <div key={venda.id} className="venda-card">
                <div className="venda-main">
                  <div className="venda-info">
                              <h4>
                                {(() => {
                                  // Montar título: Unidade Bloco Nome Cliente
                                  const partes = []
                                  
                                  // Unidade
                                  if (venda.unidade) {
                                    partes.push(`Unidade ${venda.unidade}`)
                                  }
                                  
                                  // Bloco
                                  if (venda.bloco) {
                                    partes.push(`Bloco ${venda.bloco}`)
                                  }
                                  
                                  // Cliente (se houver)
                                  if (venda.cliente_nome) {
                                    partes.push(capitalizeName(venda.cliente_nome))
                                  }
                                  
                                  // Se não tiver nenhuma informação, usar descrição ou padrão
                                  if (partes.length === 0) {
                                    return venda.descricao || 'Venda de Imóvel'
                                  }
                                  
                                  return partes.join(' • ')
                                })()}
                              </h4>
                    <div className="venda-meta">
                                {venda.empreendimento_nome && (
                                  <span className="venda-empreendimento">
                                    <Building size={12} />
                                    {capitalizeName(venda.empreendimento_nome)}
                                  </span>
                                )}
                                {(venda.unidade || venda.bloco || venda.andar) && (
                                  <span className="venda-unidade">
                                    <MapPin size={12} />
                                    {venda.bloco && `Bloco ${venda.bloco}`}
                                    {venda.bloco && (venda.unidade || venda.andar) && ' • '}
                                    {venda.unidade && `Unidade ${venda.unidade}`}
                                    {venda.unidade && venda.andar && ' • '}
                                    {venda.andar && venda.andar}
                                  </span>
                                )}
                      <span className="venda-date">
                        <Calendar size={14} />
                        {new Date(venda.data_venda).toLocaleDateString('pt-BR')}
                      </span>
                      <span className={`status-tag ${venda.status}`}>
                        {venda.status === 'pago' ? (
                          <>
                            <CheckCircle size={12} />
                            Pago
                          </>
                        ) : (
                          <>
                            <Clock size={12} />
                            Pendente
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                            
                            {/* Botão Ver mais */}
                            <div className="venda-expand-btn-wrapper">
                              <button 
                                className="venda-expand-btn"
                                onClick={() => toggleVendaExpandida(venda.id)}
                              >
                                <ChevronDown 
                                  size={18} 
                                  className={vendaExpandida === venda.id ? 'rotated' : ''} 
                                />
                                <span>Ver mais</span>
                              </button>
                            </div>

                  <div className="venda-values">
                    <div className="venda-valor">
                      <span className="label">Valor da Venda</span>
                      <span className="value">{formatCurrency(venda.valor_venda)}</span>
                    </div>
                    <div className="venda-comissao">
                                <span className="label">Sua Comissão ({percentualCorretor}%)</span>
                      <span className="value highlight">{formatCurrency(venda.comissao_corretor)}</span>
                    </div>
                  </div>
                </div>

                          {/* Seção expandida com detalhes dos pagamentos */}
                          {vendaExpandida === venda.id && (
                            <div className="venda-pagamentos-detalhes">
                              {pagamentosVenda[venda.id] && pagamentosVenda[venda.id].length > 0 ? (
                                <>
                                  <div className="parcelas-header">
                                    <h5>Detalhamento de Pagamentos</h5>
                                  </div>
                                  
                                  {(() => {
                                    const grupos = agruparPagamentosPorTipo(pagamentosVenda[venda.id])
                                    const tiposOrdem = ['sinal', 'entrada', 'parcela_entrada', 'balao']
                                    
                                    return tiposOrdem.map(tipo => {
                                      const pagamentosGrupo = grupos[tipo]
                                      if (!pagamentosGrupo || pagamentosGrupo.length === 0) return null
                                      
                                      // Calcular totais do grupo
                                      const totalValor = pagamentosGrupo.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0)
                                      const totalComissao = pagamentosGrupo.reduce((acc, p) => acc + calcularComissaoProporcional(p, venda), 0)
                                      const pagos = pagamentosGrupo.filter(p => p.status === 'pago').length
                                      const pendentes = pagamentosGrupo.filter(p => p.status === 'pendente').length
                                      
                                      // Verificar se tem mais de 10 itens e se está expandido
                                      const temMaisDe10 = pagamentosGrupo.length > 10
                                      const estaExpandido = isGrupoExpandido(venda.id, tipo)
                                      const itensParaMostrar = temMaisDe10 && !estaExpandido ? 10 : pagamentosGrupo.length
                                      const pagamentosExibidos = pagamentosGrupo.slice(0, itensParaMostrar)
                                      
                                      return (
                                        <div key={tipo} className="pagamento-grupo">
                                          <div className="grupo-header">
                                            <h6 className="grupo-titulo">{getGrupoLabel(tipo)}</h6>
                                            <div className="grupo-resumo">
                                              <span className="grupo-total-valor">{formatCurrency(totalValor)}</span>
                                              <span className="grupo-total-comissao">{formatCurrency(totalComissao)}</span>
                                              <span className="grupo-contador">
                                                {pagamentosGrupo.length} {pagamentosGrupo.length === 1 ? 'item' : 'itens'}
                                                {pagos > 0 && ` • ${pagos} pago${pagos > 1 ? 's' : ''}`}
                                                {pendentes > 0 && ` • ${pendentes} pendente${pendentes > 1 ? 's' : ''}`}
                                              </span>
                                            </div>
                                          </div>
                                          <div className="parcelas-list">
                                            {pagamentosExibidos.map((pagamento) => {
                                              const comissaoParcela = calcularComissaoProporcional(pagamento, venda)
                                              return (
                                                <div 
                                                  key={pagamento.id} 
                                                  className={`corretor-parcela-row ${pagamento.status === 'pago' ? 'pago' : ''}`}
                                                >
                                                  <div className="corretor-parcela-tipo">
                                                    {pagamento.tipo === 'sinal' && 'Sinal'}
                                                    {pagamento.tipo === 'entrada' && 'Entrada'}
                                                    {pagamento.tipo === 'parcela_entrada' && `Parcela ${pagamento.numero_parcela || ''}`}
                                                    {pagamento.tipo === 'balao' && `Balão ${pagamento.numero_parcela || ''}`}
                                                  </div>
                                                  <div className="corretor-parcela-data">
                                                    {pagamento.data_prevista 
                                                      ? new Date(pagamento.data_prevista).toLocaleDateString('pt-BR')
                                                      : '-'
                                                    }
                                                  </div>
                                                  <div className="corretor-parcela-valor">
                                                    {formatCurrency(pagamento.valor)}
                                                  </div>
                                                  <div className="corretor-parcela-comissao">
                                                    {formatCurrency(comissaoParcela)}
                                                  </div>
                                                  <div className="corretor-parcela-status">
                                                    <span className={`status-pill ${pagamento.status}`}>
                                                      {pagamento.status === 'pago' ? 'Pago' : 'Pendente'}
                                                    </span>
                                                  </div>
                                                </div>
                                              )
                                            })}
                                          </div>
                                          {temMaisDe10 && (
                                            <div className="grupo-expand-btn-wrapper">
                                              <button 
                                                className="grupo-expand-btn"
                                                onClick={() => toggleGrupoExpandido(venda.id, tipo)}
                                              >
                                                {estaExpandido ? (
                                                  <>
                                                    <ChevronDown size={16} className="rotated" />
                                                    <span>Ver menos ({pagamentosGrupo.length - 10} itens ocultos)</span>
                                                  </>
                                                ) : (
                                                  <>
                                                    <ChevronDown size={16} />
                                                    <span>Ver mais ({pagamentosGrupo.length - 10} itens restantes)</span>
                                                  </>
                                                )}
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })
                                  })()}
                                </>
                              ) : (
                                <div className="parcelas-empty">
                                  <p>Nenhum pagamento cadastrado para esta venda</p>
                                </div>
                              )}
                            </div>
                          )}
              </div>
            ))}
          </div>
                  )}
                </>
        )}
      </section>
          )}

          {/* Relatórios Tab */}
          {/* Meus Pagamentos Tab */}
          {activeTab === 'pagamentos' && (
            <section className="pagamentos-section">
              {loadingPagamentos ? (
                <div className="loading-state">
                  <div className="loading-spinner"></div>
                  <p>Carregando pagamentos...</p>
                </div>
              ) : meusPagamentos.length === 0 ? (
                <div className="empty-state">
                  <CreditCard size={48} />
                  <h3>Nenhum pagamento encontrado</h3>
                  <p>Seus pagamentos aparecerão aqui quando houver vendas registradas</p>
                </div>
              ) : (
                <>
                  {/* Resumo de Pagamentos */}
                  <div className="pagamentos-resumo">
                    <div className="resumo-card">
                      <div className="resumo-icon success">
                        <CheckCircle size={24} />
                      </div>
                      <div className="resumo-info">
                        <span className="resumo-label">Pagos</span>
                        <span className="resumo-value success">
                          {formatCurrency(meusPagamentos.filter(p => p.status === 'pago').reduce((acc, p) => {
                            const venda = vendas.find(v => v.id === p.venda_id)
                            if (!venda) return acc
                            const proporcao = (parseFloat(p.valor) || 0) / (parseFloat(venda.valor_venda) || 1)
                            return acc + (proporcao * (parseFloat(venda.comissao_corretor) || 0))
                          }, 0))}
                        </span>
                      </div>
                    </div>
                    <div className="resumo-card">
                      <div className="resumo-icon warning">
                        <Clock size={24} />
                      </div>
                      <div className="resumo-info">
                        <span className="resumo-label">Pendentes</span>
                        <span className="resumo-value warning">
                          {formatCurrency(meusPagamentos.filter(p => p.status === 'pendente').reduce((acc, p) => {
                            const venda = vendas.find(v => v.id === p.venda_id)
                            if (!venda) return acc
                            const proporcao = (parseFloat(p.valor) || 0) / (parseFloat(venda.valor_venda) || 1)
                            return acc + (proporcao * (parseFloat(venda.comissao_corretor) || 0))
                          }, 0))}
                        </span>
                      </div>
                    </div>
                    <div className="resumo-card">
                      <div className="resumo-icon info">
                        <CalendarDays size={24} />
                      </div>
                      <div className="resumo-info">
                        <span className="resumo-label">Total Parcelas</span>
                        <span className="resumo-value">{meusPagamentos.length}</span>
                      </div>
                    </div>
                  </div>

                  {/* Lista de Pagamentos */}
                  <div className="pagamentos-lista">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Cliente</th>
                          <th>Empreendimento</th>
                          <th>Tipo</th>
                          <th>Valor Parcela</th>
                          <th>Minha Comissão</th>
                          <th>Vencimento</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {meusPagamentos.map(pagamento => {
                          const venda = vendas.find(v => v.id === pagamento.venda_id)
                          const proporcao = venda ? (parseFloat(pagamento.valor) || 0) / (parseFloat(venda.valor_venda) || 1) : 0
                          const minhaComissao = venda ? proporcao * (parseFloat(venda.comissao_corretor) || 0) : 0
                          
                          return (
                            <tr key={pagamento.id}>
                              <td>{pagamento.cliente_nome}</td>
                              <td>{pagamento.empreendimento_nome}</td>
                              <td>
                                <span className={`badge-tipo ${pagamento.tipo}`}>
                                  {pagamento.tipo === 'sinal' && 'Sinal'}
                                  {pagamento.tipo === 'entrada' && 'Entrada'}
                                  {pagamento.tipo === 'parcela_entrada' && `Parcela ${pagamento.numero_parcela || ''}`}
                                  {pagamento.tipo === 'balao' && `Balão ${pagamento.numero_parcela || ''}`}
                                </span>
                              </td>
                              <td>{formatCurrency(pagamento.valor)}</td>
                              <td className="comissao-cell">{formatCurrency(minhaComissao)}</td>
                              <td>{pagamento.data_prevista ? new Date(pagamento.data_prevista).toLocaleDateString('pt-BR') : '-'}</td>
                              <td>
                                <span className={`status-badge ${pagamento.status}`}>
                                  {pagamento.status === 'pago' && <><CheckCircle size={12} /> Pago</>}
                                  {pagamento.status === 'pendente' && <><Clock size={12} /> Pendente</>}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}

          {/* Meus Clientes Tab */}
          {activeTab === 'clientes' && (
            <section className="clientes-section">
              {loadingClientes ? (
                <div className="loading-state">
                  <div className="loading-spinner"></div>
                  <p>Carregando clientes...</p>
                </div>
              ) : meusClientes.length === 0 ? (
                <div className="empty-state">
                  <Users size={48} />
                  <h3>Nenhum cliente encontrado</h3>
                  <p>Seus clientes aparecerão aqui quando houver vendas registradas</p>
                </div>
              ) : (
                <>
                  {/* Resumo de Clientes */}
                  <div className="clientes-resumo">
                    <div className="resumo-card">
                      <div className="resumo-icon primary">
                        <Users size={24} />
                      </div>
                      <div className="resumo-info">
                        <span className="resumo-label">Total Clientes</span>
                        <span className="resumo-value">{meusClientes.length}</span>
                      </div>
                    </div>
                    <div className="resumo-card">
                      <div className="resumo-icon success">
                        <DollarSign size={24} />
                      </div>
                      <div className="resumo-info">
                        <span className="resumo-label">Volume de Vendas</span>
                        <span className="resumo-value success">
                          {formatCurrency(meusClientes.reduce((acc, c) => acc + c.total_vendas, 0))}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Lista de Clientes */}
                  <div className="clientes-grid">
                    {meusClientes.map(cliente => (
                      <div key={cliente.id} className="cliente-card">
                        <div className="cliente-header">
                          <div className="cliente-avatar">
                            <User size={24} />
                          </div>
                          <div className="cliente-info">
                            <h3>{capitalizeName(cliente.nome_completo)}</h3>
                            <span className="cliente-cpf">{cliente.cpf || 'CPF não informado'}</span>
                          </div>
                        </div>
                        
                        <div className="cliente-contato">
                          {cliente.telefone && (
                            <div className="contato-item">
                              <Phone size={14} />
                              <span>{cliente.telefone}</span>
                            </div>
                          )}
                          {cliente.email && (
                            <div className="contato-item">
                              <Mail size={14} />
                              <span>{cliente.email}</span>
                            </div>
                          )}
                        </div>

                        <div className="cliente-stats">
                          <div className="stat-mini">
                            <span className="stat-mini-label">Vendas</span>
                            <span className="stat-mini-value">{cliente.qtd_vendas}</span>
                          </div>
                          <div className="stat-mini">
                            <span className="stat-mini-label">Total</span>
                            <span className="stat-mini-value success">{formatCurrency(cliente.total_vendas)}</span>
                          </div>
                        </div>

                        <button 
                          className="btn-ver-detalhes"
                          onClick={() => setSelectedCliente(cliente)}
                        >
                          <Eye size={16} />
                          Ver Detalhes
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          {/* Empreendimentos Tab */}
          {activeTab === 'empreendimentos' && (
            <section className="empreendimentos-section">
              {loadingEmpreendimentos ? (
                <div className="loading-state">
                  <div className="loading-spinner"></div>
                  <p>Carregando empreendimentos...</p>
                </div>
              ) : empreendimentos.length === 0 ? (
                <div className="empty-state">
                  <Building size={48} />
                  <h3>Nenhum empreendimento encontrado</h3>
                  <p>Os empreendimentos disponíveis aparecerão aqui</p>
                </div>
              ) : (
                <div className="emp-cards-grid">
                  {empreendimentos.map(emp => {
                    // Calcular estatísticas do empreendimento
                    const vendasEmp = vendas.filter(v => v.empreendimento_id === emp.id)
                    const totalVendasEmp = vendasEmp.length
                    const valorTotalVendas = vendasEmp.reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)
                    
                    return (
                      <div key={emp.id} className="emp-card-premium">
                        {/* Imagem de Fachada */}
                        <div className="emp-card-image">
                          {emp.foto_fachada ? (
                            <img src={emp.foto_fachada} alt={emp.nome} />
                          ) : (
                            <div className="emp-placeholder">
                              <Building size={48} />
                            </div>
                          )}
                          {emp.logo_url && (
                            <img src={emp.logo_url} alt="Logo" className="emp-logo-overlay" />
                          )}
                          <div className="emp-card-overlay">
                            <h3 className="emp-card-title">{emp.nome}</h3>
                            <div className="emp-card-badges">
                              {emp.sienge_enterprise_id && (
                                <span className="emp-badge sienge">SIENGE</span>
                              )}
                              <span className="emp-badge ativo">ATIVO</span>
                            </div>
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
                              <span className="emp-mini-stat-label">Minhas Vendas</span>
                              <span className="emp-mini-stat-value">{totalVendasEmp}</span>
                            </div>
                            <div className="emp-mini-stat">
                              <span className="emp-mini-stat-label">Volume</span>
                              <span className="emp-mini-stat-value gold">{formatCurrency(valorTotalVendas)}</span>
                            </div>
                          </div>
                          
                          {/* Ações */}
                          <div className="emp-card-actions">
                            <button 
                              className="emp-action-btn view"
                              onClick={() => setSelectedEmpreendimento(emp)}
                              title="Visualizar detalhes"
                            >
                              <Eye size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {/* Relatórios Tab */}
          {activeTab === 'relatorios' && (
            <section className="relatorios-section">
              {/* Resumo Geral */}
              <div className="relatorios-resumo">
                <h3>Resumo do Período</h3>
                <div className="resumo-grid">
                  <div className="resumo-card large">
                    <div className="resumo-icon primary">
                      <BarChart3 size={28} />
                    </div>
                    <div className="resumo-info">
                      <span className="resumo-label">Total de Vendas</span>
                      <span className="resumo-value large">{filteredVendas.length}</span>
                    </div>
                  </div>
                  <div className="resumo-card large">
                    <div className="resumo-icon success">
                      <DollarSign size={28} />
                    </div>
                    <div className="resumo-info">
                      <span className="resumo-label">Volume Total</span>
                      <span className="resumo-value large success">{formatCurrency(getTotalVendas())}</span>
                    </div>
                  </div>
                  <div className="resumo-card large">
                    <div className="resumo-icon warning">
                      <Wallet size={28} />
                    </div>
                    <div className="resumo-info">
                      <span className="resumo-label">Comissão Total</span>
                      <span className="resumo-value large warning">{formatCurrency(getTotalComissao())}</span>
                    </div>
                  </div>
                  <div className="resumo-card large">
                    <div className="resumo-icon info">
                      <Percent size={28} />
                    </div>
                    <div className="resumo-info">
                      <span className="resumo-label">Meu Percentual</span>
                      <span className="resumo-value large">{percentualCorretor}%</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Vendas por Status */}
              <div className="relatorios-status">
                <h3>Vendas por Status</h3>
                <div className="status-grid">
                  <div className="status-card">
                    <div className="status-header">
                      <CheckCircle size={20} className="success" />
                      <span>Pagas</span>
                    </div>
                    <div className="status-value">{filteredVendas.filter(v => v.status === 'pago').length}</div>
                    <div className="status-amount success">{formatCurrency(getComissaoPaga())}</div>
                  </div>
                  <div className="status-card">
                    <div className="status-header">
                      <Clock size={20} className="warning" />
                      <span>Pendentes</span>
                    </div>
                    <div className="status-value">{filteredVendas.filter(v => v.status === 'pendente').length}</div>
                    <div className="status-amount warning">{formatCurrency(getComissaoPendente())}</div>
                  </div>
                </div>
              </div>

              {/* Vendas Recentes */}
              <div className="relatorios-vendas">
                <h3>Últimas Vendas</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Cliente</th>
                      <th>Empreendimento</th>
                      <th>Valor</th>
                      <th>Comissão</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVendas.slice(0, 10).map(venda => (
                      <tr key={venda.id}>
                        <td>{new Date(venda.data_venda).toLocaleDateString('pt-BR')}</td>
                        <td>{capitalizeName(venda.cliente_nome) || 'N/A'}</td>
                        <td>{venda.empreendimento_nome || 'N/A'}</td>
                        <td>{formatCurrency(venda.valor_venda)}</td>
                        <td className="comissao-cell">{formatCurrency(venda.comissao_corretor)}</td>
                        <td>
                          <span className={`status-badge ${venda.status}`}>
                            {venda.status === 'pago' && <><CheckCircle size={12} /> Pago</>}
                            {venda.status === 'pendente' && <><Clock size={12} /> Pendente</>}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Solicitações Tab */}
          {activeTab === 'solicitacoes' && (
            <section className="solicitacoes-section">
              {/* Mensagem de feedback */}
              {message.text && (
                <div className={`message-alert ${message.type}`}>
                  {message.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                  {message.text}
                </div>
              )}
              
              {/* Ações */}
              <div className="solicitacoes-acoes-header">
                <h3>Registrar Nova Solicitação</h3>
                <div className="acoes-btns">
                  <button 
                    className="btn-nova-solicitacao venda"
                    onClick={() => setShowNovaVendaModal(true)}
                  >
                    <DollarSign size={18} />
                    Registrar Venda
                  </button>
                  <button 
                    className="btn-nova-solicitacao cliente"
                    onClick={() => setShowNovoClienteModal(true)}
                  >
                    <UserPlus size={18} />
                    Cadastrar Cliente
                  </button>
                </div>
              </div>

              {/* Lista de Minhas Solicitações */}
              <div className="minhas-solicitacoes">
                <h3>Minhas Solicitações</h3>
                
                {loadingSolicitacoes ? (
                  <div className="loading-container">
                    <div className="loading-spinner"></div>
                    <p>Carregando...</p>
                  </div>
                ) : minhasSolicitacoes.length === 0 ? (
                  <div className="empty-state-box">
                    <ClipboardList size={48} />
                    <h3>Nenhuma solicitação</h3>
                    <p>Suas solicitações de vendas e clientes aparecerão aqui</p>
                  </div>
                ) : (
                  <div className="solicitacoes-lista">
                    {minhasSolicitacoes.map(sol => (
                      <div key={sol.id} className={`solicitacao-item ${sol.status}`}>
                        <div className="sol-icon">
                          {sol.tipo === 'venda' ? <DollarSign size={20} /> : <UserPlus size={20} />}
                        </div>
                        <div className="sol-info">
                          <div className="sol-tipo">
                            {sol.tipo === 'venda' ? 'Venda' : 'Cliente'}
                          </div>
                          <div className="sol-dados">
                            {sol.tipo === 'venda' ? (
                              <>
                                <span>{sol.dados?.nome_cliente || 'Cliente não informado'}</span>
                                <span className="sol-valor">{formatCurrency(sol.dados?.valor_venda || 0)}</span>
                              </>
                            ) : (
                              <>
                                <span>{sol.dados?.nome_completo || 'Nome não informado'}</span>
                                <span className="sol-cpf">{sol.dados?.cpf || ''}</span>
                              </>
                            )}
                          </div>
                          <div className="sol-data">
                            {new Date(sol.created_at).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                        </div>
                        <div className="sol-status-container">
                          <span className={`sol-status ${sol.status}`}>
                            {sol.status === 'pendente' && <><Clock size={14} /> Aguardando</>}
                            {sol.status === 'aprovado' && <><CheckCircle2 size={14} /> Aprovada</>}
                            {sol.status === 'reprovado' && <><XCircle size={14} /> Reprovada</>}
                          </span>
                          {sol.resposta_admin && (
                            <p className="sol-resposta">{sol.resposta_admin}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {/* Modal Nova Venda */}
        {showNovaVendaModal && (
          <div className="modal-overlay" onClick={() => setShowNovaVendaModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2><DollarSign size={20} /> Solicitar Registro de Venda</h2>
                <button className="close-btn" onClick={() => setShowNovaVendaModal(false)}>
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleEnviarSolicitacaoVenda}>
                <div className="modal-body">
                  <p className="modal-info">
                    <AlertCircle size={16} />
                    Sua solicitação será enviada para aprovação do administrador
                  </p>
                  
                  <div className="form-group">
                    <label>Empreendimento *</label>
                    <select
                      value={novaVendaForm.empreendimento_id}
                      onChange={(e) => setNovaVendaForm({...novaVendaForm, empreendimento_id: e.target.value})}
                      required
                    >
                      <option value="">Selecione...</option>
                      {empreendimentos.map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.nome}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="form-group">
                    <label>Cliente</label>
                    <select
                      value={novaVendaForm.cliente_id}
                      onChange={(e) => {
                        const clienteId = e.target.value
                        const cliente = todosClientes.find(c => c.id === clienteId)
                        setNovaVendaForm({
                          ...novaVendaForm, 
                          cliente_id: clienteId,
                          nome_cliente: cliente ? cliente.nome_completo : ''
                        })
                      }}
                    >
                      <option value="">Selecione ou digite abaixo...</option>
                      {todosClientes.map(cliente => (
                        <option key={cliente.id} value={cliente.id}>
                          {cliente.nome_completo} - {cliente.cpf}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="form-group">
                    <label>Nome do Cliente (se não cadastrado)</label>
                    <input
                      type="text"
                      value={novaVendaForm.nome_cliente}
                      onChange={(e) => setNovaVendaForm({...novaVendaForm, nome_cliente: e.target.value})}
                      placeholder="Nome completo do cliente"
                    />
                  </div>
                  
                  <div className="form-row">
                    <div className="form-group">
                      <label>Unidade</label>
                      <input
                        type="text"
                        value={novaVendaForm.unidade}
                        onChange={(e) => setNovaVendaForm({...novaVendaForm, unidade: e.target.value})}
                        placeholder="Ex: 101"
                      />
                    </div>
                    <div className="form-group">
                      <label>Bloco</label>
                      <input
                        type="text"
                        value={novaVendaForm.bloco}
                        onChange={(e) => setNovaVendaForm({...novaVendaForm, bloco: e.target.value})}
                        placeholder="Ex: A"
                      />
                    </div>
                  </div>
                  
                  <div className="form-row">
                    <div className="form-group">
                      <label>Valor da Venda *</label>
                      <input
                        type="number"
                        value={novaVendaForm.valor_venda}
                        onChange={(e) => setNovaVendaForm({...novaVendaForm, valor_venda: e.target.value})}
                        placeholder="0,00"
                        step="0.01"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Data da Venda</label>
                      <input
                        type="date"
                        value={novaVendaForm.data_venda}
                        onChange={(e) => setNovaVendaForm({...novaVendaForm, data_venda: e.target.value})}
                      />
                    </div>
                  </div>
                </div>
                
                <div className="modal-footer">
                  <button type="button" className="btn-secondary" onClick={() => setShowNovaVendaModal(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary" disabled={loading}>
                    <Send size={16} />
                    {loading ? 'Enviando...' : 'Enviar Solicitação'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal Novo Cliente */}
        {showNovoClienteModal && (
          <div className="modal-overlay" onClick={() => setShowNovoClienteModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2><UserPlus size={20} /> Solicitar Cadastro de Cliente</h2>
                <button className="close-btn" onClick={() => setShowNovoClienteModal(false)}>
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleEnviarSolicitacaoCliente}>
                <div className="modal-body">
                  <p className="modal-info">
                    <AlertCircle size={16} />
                    Sua solicitação será enviada para aprovação do administrador
                  </p>
                  
                  <div className="form-group">
                    <label>Nome Completo *</label>
                    <input
                      type="text"
                      value={novoClienteForm.nome_completo}
                      onChange={(e) => setNovoClienteForm({...novoClienteForm, nome_completo: e.target.value})}
                      placeholder="Nome completo"
                      required
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>CPF *</label>
                    <input
                      type="text"
                      value={novoClienteForm.cpf}
                      onChange={(e) => setNovoClienteForm({...novoClienteForm, cpf: e.target.value})}
                      placeholder="000.000.000-00"
                      required
                    />
                  </div>
                  
                  <div className="form-row">
                    <div className="form-group">
                      <label>Email</label>
                      <input
                        type="email"
                        value={novoClienteForm.email}
                        onChange={(e) => setNovoClienteForm({...novoClienteForm, email: e.target.value})}
                        placeholder="email@exemplo.com"
                      />
                    </div>
                    <div className="form-group">
                      <label>Telefone</label>
                      <input
                        type="tel"
                        value={novoClienteForm.telefone}
                        onChange={(e) => setNovoClienteForm({...novoClienteForm, telefone: e.target.value})}
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                  </div>
                  
                  <div className="form-group">
                    <label>Endereço</label>
                    <input
                      type="text"
                      value={novoClienteForm.endereco}
                      onChange={(e) => setNovoClienteForm({...novoClienteForm, endereco: e.target.value})}
                      placeholder="Endereço completo"
                    />
                  </div>
                </div>
                
                <div className="modal-footer">
                  <button type="button" className="btn-secondary" onClick={() => setShowNovoClienteModal(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary" disabled={loading}>
                    <Send size={16} />
                    {loading ? 'Enviando...' : 'Enviar Solicitação'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal Cliente Detalhes */}
        {selectedCliente && (
          <div className="modal-overlay" onClick={() => setSelectedCliente(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Detalhes do Cliente</h2>
                <button className="close-btn" onClick={() => setSelectedCliente(null)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <div className="cliente-detalhe-header">
                  <div className="cliente-avatar-large">
                    <User size={40} />
                  </div>
                  <div>
                    <h3>{capitalizeName(selectedCliente.nome_completo)}</h3>
                    <p>{selectedCliente.cpf || 'CPF não informado'}</p>
                  </div>
                </div>

                <div className="cliente-detalhe-info">
                  {selectedCliente.telefone && (
                    <div className="info-row">
                      <Phone size={16} />
                      <span>{selectedCliente.telefone}</span>
                    </div>
                  )}
                  {selectedCliente.email && (
                    <div className="info-row">
                      <Mail size={16} />
                      <span>{selectedCliente.email}</span>
                    </div>
                  )}
                </div>

                <div className="cliente-detalhe-vendas">
                  <h4>Vendas ({selectedCliente.qtd_vendas})</h4>
                  {selectedCliente.vendas.map(venda => (
                    <div key={venda.id} className="venda-mini-card">
                      <div className="venda-mini-info">
                        <span className="venda-mini-emp">{venda.empreendimento_nome || 'N/A'}</span>
                        <span className="venda-mini-data">{new Date(venda.data_venda).toLocaleDateString('pt-BR')}</span>
                      </div>
                      <div className="venda-mini-valores">
                        <span className="venda-mini-valor">{formatCurrency(venda.valor_venda)}</span>
                        <span className={`status-badge ${venda.status}`}>{venda.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal Empreendimento Detalhes */}
        {selectedEmpreendimento && (() => {
          const vendasEmp = vendas.filter(v => v.empreendimento_id === selectedEmpreendimento.id)
          const totalVendasEmp = vendasEmp.length
          const valorTotalVendas = vendasEmp.reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)
          const comissaoTotal = vendasEmp.reduce((acc, v) => acc + (parseFloat(v.comissao_corretor) || 0), 0)
          
          return (
            <div className="modal-overlay" onClick={() => setSelectedEmpreendimento(null)}>
              <div className="modal-content modal-large emp-view-modal" onClick={e => e.stopPropagation()}>
                {/* Header com Imagem */}
                <div className="emp-view-header">
                  {selectedEmpreendimento.foto_fachada ? (
                    <img 
                      src={selectedEmpreendimento.foto_fachada} 
                      alt={selectedEmpreendimento.nome}
                      className="emp-view-fachada"
                    />
                  ) : (
                    <div className="emp-view-placeholder">
                      <Building size={80} />
                    </div>
                  )}
                  <div className="emp-view-header-overlay">
                    {selectedEmpreendimento.logo_url && (
                      <img 
                        src={selectedEmpreendimento.logo_url} 
                        alt={`Logo ${selectedEmpreendimento.nome}`}
                        className="emp-view-logo"
                      />
                    )}
                    <h2 className="emp-view-title">{selectedEmpreendimento.nome}</h2>
                    <div className="emp-view-badges">
                      {selectedEmpreendimento.sienge_enterprise_id && (
                        <span className="emp-badge sienge">SIENGE</span>
                      )}
                      <span className="emp-badge ativo">ATIVO</span>
                    </div>
                  </div>
                  <button className="emp-view-close" onClick={() => setSelectedEmpreendimento(null)}>
                    <X size={24} />
                  </button>
                </div>

                {/* Conteúdo */}
                <div className="emp-view-content">
                  {/* Descrição */}
                  {selectedEmpreendimento.descricao && (
                    <div className="emp-view-section">
                      <h3>Sobre o Empreendimento</h3>
                      <p>{selectedEmpreendimento.descricao}</p>
                    </div>
                  )}

                  {/* Unidades */}
                  <div className="emp-view-section">
                    <h3>Unidades</h3>
                    <div className="emp-view-comissoes">
                      <div className="emp-view-comissao-box">
                        <span className="label">Total de Unidades</span>
                        <span className="value">{selectedEmpreendimento.total_unidades || 0}</span>
                      </div>
                      <div className="emp-view-comissao-box">
                        <span className="label">Unidades Vendidas</span>
                        <span className="value green">{totalVendasEmp}</span>
                      </div>
                    </div>
                  </div>

                  {/* Progresso da Obra */}
                  <div className="emp-view-section">
                    <h3>Progresso da Obra</h3>
                    <div className="emp-progress-bar large">
                      <div 
                        className="emp-progress-fill"
                        style={{ width: `${selectedEmpreendimento.progresso_obra || 0}%` }}
                      />
                    </div>
                    <span className="emp-progress-text">{selectedEmpreendimento.progresso_obra || 0}% concluído</span>
                  </div>

                  {/* Minhas Estatísticas */}
                  <div className="emp-view-section">
                    <h3>Minhas Estatísticas</h3>
                    <div className="emp-view-stats-grid">
                      <div className="emp-view-stat-card">
                        <span className="stat-icon"><DollarSign size={24} /></span>
                        <div className="stat-info">
                          <span className="stat-value gold">{totalVendasEmp}</span>
                          <span className="stat-label">Vendas Realizadas</span>
                        </div>
                      </div>
                      <div className="emp-view-stat-card">
                        <span className="stat-icon"><TrendingUp size={24} /></span>
                        <div className="stat-info">
                          <span className="stat-value">{formatCurrency(valorTotalVendas)}</span>
                          <span className="stat-label">Volume de Vendas</span>
                        </div>
                      </div>
                      <div className="emp-view-stat-card">
                        <span className="stat-icon"><Wallet size={24} /></span>
                        <div className="stat-info">
                          <span className="stat-value green">{formatCurrency(comissaoTotal)}</span>
                          <span className="stat-label">Minha Comissão</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        })()}
      </main>
    </div>
  )
}

export default CorretorDashboard
