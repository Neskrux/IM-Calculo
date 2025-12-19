import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { 
  DollarSign, TrendingUp, LogOut, 
  Calendar, User, CheckCircle, Clock, 
  Wallet, Target, Award, BarChart3,
  LayoutDashboard, Menu, X, ChevronLeft, ChevronRight, ChevronDown,
  Building, MapPin
} from 'lucide-react'
import logo from '../imgs/logo.png'
import Ticker from '../components/Ticker'
import '../styles/Dashboard.css'
import '../styles/CorretorDashboard.css'

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

  useEffect(() => {
    if (user) {
      fetchVendas()
    }
  }, [user])

  useEffect(() => {
    if (userProfile) {
      fetchCargoAndEmpreendimento()
    }
  }, [userProfile])

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
            className={`nav-item ${activeTab === 'relatorios' ? 'active' : ''}`}
            onClick={() => navigate('/corretor/relatorios')}
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
            {activeTab === 'relatorios' && 'Relatórios'}
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
          {activeTab === 'relatorios' && (
            <section className="relatorios-section">
              <div className="empty-state">
                <TrendingUp size={48} />
                <h3>Relatórios em desenvolvimento</h3>
                <p>Em breve você poderá gerar relatórios detalhados das suas vendas e comissões</p>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

export default CorretorDashboard
