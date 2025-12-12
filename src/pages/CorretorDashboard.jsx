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
    
    const { data, error } = await supabase
      .from('vendas')
      .select('*')
      .eq('corretor_id', user.id)
      .order('data_venda', { ascending: false })

    if (!error) {
      setVendas(data || [])
    }
    setLoading(false)
  }

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value)
  }

  const getTotalVendas = () => {
    return vendas.reduce((acc, v) => acc + v.valor_venda, 0)
  }

  const getTotalComissao = () => {
    return vendas.reduce((acc, v) => acc + v.comissao_corretor, 0)
  }

  const getComissaoPendente = () => {
    return vendas
      .filter(v => v.status === 'pendente')
      .reduce((acc, v) => acc + v.comissao_corretor, 0)
  }

  const getComissaoPaga = () => {
    return vendas
      .filter(v => v.status === 'pago')
      .reduce((acc, v) => acc + v.comissao_corretor, 0)
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

  return (
    <div className="dashboard-container">
      {/* Sidebar Overlay for Mobile */}
      {menuOpen && (
        <div 
          className="sidebar-overlay" 
          onClick={() => setMenuOpen(false)}
          style={{ display: 'block' }}
        />
      )}

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
            className={`nav-item ${activeTab === 'comissoes' ? 'active' : ''}`}
            onClick={() => navigate('/corretor/comissoes')}
            title="Comissões"
          >
            <Wallet size={20} />
            <span>Comissões</span>
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
            {activeTab === 'comissoes' && 'Minhas Comissões'}
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
              ) : filteredVendas.length === 0 ? (
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
                            <span className="label">Sua Comissão</span>
                            <span className="value highlight">{formatCurrency(venda.comissao_corretor)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Comissões Tab */}
          {activeTab === 'comissoes' && (
            <section className="comissoes-section">
              <div className="section-header-corretor">
                <h2>
                  <Wallet size={24} />
                  Minhas Comissões
                </h2>
              </div>

              {loading ? (
                <div className="loading-container">
                  <div className="loading-spinner-large"></div>
                  <p>Carregando suas comissões...</p>
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
                  </div>

                  {/* Lista de Comissões */}
                  <div className="comissoes-list">
                    {vendas.length === 0 ? (
                      <div className="empty-state">
                        <Wallet size={48} />
                        <h3>Nenhuma comissão encontrada</h3>
                        <p>Suas comissões aparecerão aqui quando houver vendas registradas</p>
                      </div>
                    ) : (
                      <div className="vendas-list">
                        {vendas.map((venda) => (
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
                  </div>
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
