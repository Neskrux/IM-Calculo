import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { 
  DollarSign, TrendingUp, LogOut, 
  Calendar, User, CheckCircle, Clock, 
  Wallet, Target, Award, BarChart3,
  LayoutDashboard, Menu, X, ChevronLeft, ChevronRight
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

  useEffect(() => {
    if (user) {
      fetchVendas()
    }
  }, [user])

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

      // Debug: Ver dados brutos do banco
      console.log('🔍 [DEBUG] Dados brutos do banco:', data)
      if (data && data.length > 0) {
        data.forEach((venda, index) => {
          console.log(`📦 [DEBUG] Venda ${index + 1} (ID: ${venda.id}):`, {
            valor_venda: venda.valor_venda,
            comissao_corretor: venda.comissao_corretor,
            tipo_comissao: typeof venda.comissao_corretor,
            is_null: venda.comissao_corretor === null,
            status: venda.status,
            tipo_corretor: venda.tipo_corretor
          })
        })
      }

      // Validar e normalizar os dados
      const vendasValidadas = (data || []).map(venda => {
        const valorVenda = parseFloat(venda.valor_venda) || 0
        let comissaoCorretor = venda.comissao_corretor
        
        // Se comissao_corretor for null, undefined ou string vazia, calcular
        if (comissaoCorretor === null || comissaoCorretor === undefined || comissaoCorretor === '') {
          const percentual = userProfile?.percentual_corretor || 
            (userProfile?.tipo_corretor === 'interno' ? 2.5 : 3.5)
          comissaoCorretor = (valorVenda * percentual) / 100
          console.log(`⚠️ [DEBUG] Comissão NULL para venda ${venda.id}, calculando:`, {
            valor_venda: valorVenda,
            percentual: percentual,
            comissao_calculada: comissaoCorretor
          })
        } else {
          // Converter para número se for string
          comissaoCorretor = parseFloat(comissaoCorretor) || 0
        }

        return {
          ...venda,
          valor_venda: valorVenda,
          comissao_corretor: comissaoCorretor,
          status: venda.status || 'pendente'
        }
      })

      console.log('✅ Vendas carregadas e validadas:', vendasValidadas)
      console.log('📊 Total de vendas:', vendasValidadas.length)
      console.log('💰 Total valor vendas:', vendasValidadas.reduce((acc, v) => acc + v.valor_venda, 0))
      console.log('💵 Total comissões:', vendasValidadas.reduce((acc, v) => acc + v.comissao_corretor, 0))
      console.log('🔍 [DEBUG] Verificando comissões normalizadas:', vendasValidadas.map(v => ({
        id: v.id,
        comissao_original: data?.find(d => d.id === v.id)?.comissao_corretor,
        comissao_normalizada: v.comissao_corretor,
        tipo: typeof v.comissao_corretor
      })))
      
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
      console.warn('⚠️ [FORMAT] Valor inválido para formatar:', value)
      return 'R$ 0,00'
    }
    const formatted = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value)
    console.log('💰 [FORMAT] Formatando:', { value, formatted })
    return formatted
  }

  const getTotalVendas = () => {
    const total = vendas.reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)
    console.log('📊 [CALC] getTotalVendas:', { total, vendas_count: vendas.length })
    return total
  }

  const getTotalComissao = () => {
    const total = vendas.reduce((acc, v) => {
      const comissao = v.comissao_corretor === null || v.comissao_corretor === undefined 
        ? 0 
        : (parseFloat(v.comissao_corretor) || 0)
      return acc + comissao
    }, 0)
    console.log('💵 [CALC] getTotalComissao:', { 
      total, 
      vendas_count: vendas.length,
      detalhes: vendas.map(v => ({ 
        id: v.id, 
        comissao: v.comissao_corretor,
        comissao_parsed: parseFloat(v.comissao_corretor) || 0,
        tipo: typeof v.comissao_corretor,
        is_null: v.comissao_corretor === null
      }))
    })
    return total
  }

  const getComissaoPendente = () => {
    const pendentes = vendas.filter(v => v.status === 'pendente')
    const total = pendentes.reduce((acc, v) => {
      const comissao = v.comissao_corretor === null || v.comissao_corretor === undefined 
        ? 0 
        : (parseFloat(v.comissao_corretor) || 0)
      return acc + comissao
    }, 0)
    console.log('⏳ [CALC] getComissaoPendente:', { 
      total, 
      pendentes_count: pendentes.length,
      detalhes: pendentes.map(v => ({ 
        id: v.id, 
        comissao: v.comissao_corretor,
        comissao_parsed: parseFloat(v.comissao_corretor) || 0,
        tipo: typeof v.comissao_corretor,
        is_null: v.comissao_corretor === null,
        status: v.status 
      }))
    })
    return total
  }

  const getComissaoPaga = () => {
    const pagas = vendas.filter(v => v.status === 'pago')
    const total = pagas.reduce((acc, v) => acc + (parseFloat(v.comissao_corretor) || 0), 0)
    console.log('✅ [CALC] getComissaoPaga:', { 
      total, 
      pagas_count: pagas.length,
      detalhes: pagas.map(v => ({ id: v.id, comissao: v.comissao_corretor, status: v.status }))
    })
    return total
  }

  const filteredVendas = vendas.filter(venda => {
    if (periodo === 'todos') return true
    
    const dataVenda = new Date(venda.data_venda)
    const hoje = new Date()
    
    if (periodo === 'mes') {
      return dataVenda.getMonth() === hoje.getMonth() && 
             dataVenda.getFullYear() === hoje.getFullYear()
    }
    if (periodo === 'ano') {
      return dataVenda.getFullYear() === hoje.getFullYear()
    }
    return true
  })

  const percentualCorretor = userProfile?.percentual_corretor || 
    (userProfile?.tipo_corretor === 'interno' ? 2.5 : 4)

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

  // Debug: Verificar DOM após renderização
  useEffect(() => {
    if (activeTab === 'dashboard' && !loading && vendas.length > 0) {
      setTimeout(() => {
        console.log('🔍 [DOM CHECK] Verificando elementos no DOM...')
        const statValues = document.querySelectorAll('.stat-card-value')
        console.log('📊 [DOM CHECK] Total de elementos encontrados:', statValues.length)
        
        statValues.forEach((el, index) => {
          const parent = el.closest('.stat-card-corretor')
          const cardType = parent?.classList.contains('primary') ? 'primary' :
                          parent?.classList.contains('success') ? 'success' :
                          parent?.classList.contains('warning') ? 'warning' :
                          parent?.classList.contains('info') ? 'info' : 'unknown'
          
          const styles = window.getComputedStyle(el)
          console.log(`🎨 [DOM CHECK] Card ${index + 1} (${cardType}):`, {
            textContent: el.textContent,
            innerHTML: el.innerHTML,
            display: styles.display,
            visibility: styles.visibility,
            opacity: styles.opacity,
            color: styles.color,
            backgroundColor: styles.backgroundColor,
            fontSize: styles.fontSize,
            fontWeight: styles.fontWeight,
            height: styles.height,
            width: styles.width,
            overflow: styles.overflow
          })
        })
      }, 500)
    }
  }, [activeTab, loading, vendas])

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
              <span className="user-name">{userProfile?.nome || 'Corretor'}</span>
              <span className="user-role">
                {userProfile?.tipo_corretor === 'interno' ? 'Corretor Interno' : 'Corretor Externo'}
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
        <Ticker />
        
        {/* Header */}
        <header className="main-header">
          <button className="menu-toggle" onClick={() => setMenuOpen(true)}>
            <Menu size={24} />
          </button>
          <h1>
            {activeTab === 'dashboard' && 'Dashboard do Corretor'}
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
                  <h1>Bem-vindo, {userProfile?.nome?.split(' ')[0] || 'Corretor'}</h1>
                  <p>Acompanhe suas vendas e comissões</p>
                </div>
                <div className="tipo-badge">
                  <span className={`badge-large ${userProfile?.tipo_corretor || 'externo'}`}>
                    {userProfile?.tipo_corretor === 'interno' ? 'Corretor Interno' : 'Corretor Externo'}
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
              {(() => {
                const valor = getTotalComissao()
                const formatado = formatCurrency(valor)
                console.log('🎯 [RENDER] Total a Receber:', { valor, formatado, elemento: 'stat-card-value primary' })
                return formatado
              })()}
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
              {(() => {
                const valor = getComissaoPaga()
                const formatado = formatCurrency(valor)
                console.log('🎯 [RENDER] Comissão Paga:', { valor, formatado, elemento: 'stat-card-value success' })
                return formatado
              })()}
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
              {(() => {
                const valor = getComissaoPendente()
                const formatado = formatCurrency(valor)
                console.log('🎯 [RENDER] Comissão Pendente:', { valor, formatado, elemento: 'stat-card-value warning' })
                return formatado
              })()}
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
              {(() => {
                const valor = getTotalVendas()
                const formatado = formatCurrency(valor)
                console.log('🎯 [RENDER] Total em Vendas:', { valor, formatado, elemento: 'stat-card-value info' })
                return formatado
              })()}
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
                <h2>
                  <BarChart3 size={24} />
                  Minhas Vendas
                </h2>
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
                              <h4>{venda.descricao || 'Venda de Imóvel'}</h4>
                              <div className="venda-meta">
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
              <div className="section-header-corretor">
                <h2>
                  <TrendingUp size={24} />
                  Relatórios
                </h2>
              </div>
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
