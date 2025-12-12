import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { 
  Home, ShoppingBag, FileText, User as UserIcon, LogOut,
  Menu, X, ChevronLeft, ChevronRight, Calendar, MapPin,
  Building, DollarSign, CheckCircle, Clock, Download
} from 'lucide-react'
import logo from '../imgs/logo.png'
import Ticker from '../components/Ticker'
import '../styles/Dashboard.css'
import '../styles/ClienteDashboard.css'

const ClienteDashboard = () => {
  const { user, userProfile, signOut } = useAuth()
  const { tab } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  
  // Detectar activeTab baseado na URL
  let activeTab = 'dashboard'
  if (location.pathname === '/cliente/dashboard') {
    activeTab = 'dashboard'
  } else if (tab) {
    activeTab = tab
  } else if (location.pathname === '/cliente') {
    activeTab = 'dashboard'
  }
  
  const [cliente, setCliente] = useState(null)
  const [compras, setCompras] = useState([])
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('cliente-sidebar-collapsed')
    return saved === 'true'
  })

  useEffect(() => {
    if (user) {
      fetchClienteData()
    }
  }, [user])

  // Redirecionar /cliente para /cliente/dashboard
  useEffect(() => {
    if (!tab && location.pathname === '/cliente') {
      navigate('/cliente/dashboard', { replace: true })
    }
  }, [tab, navigate, location.pathname])

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

  const fetchClienteData = async () => {
    setLoading(true)
    
    try {
      // Buscar dados do cliente
      const { data: clienteData, error: clienteError } = await supabase
        .from('clientes')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()

      if (clienteError) {
        console.error('Erro ao buscar cliente:', clienteError)
      } else if (clienteData) {
        setCliente(clienteData)
        
        // Buscar compras do cliente
        // Nota: A coluna cliente_id precisa existir na tabela vendas
        // Se não existir, execute: ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id);
        const { data: comprasData, error: comprasError } = await supabase
          .from('vendas')
          .select('*')
          .eq('cliente_id', clienteData.id)
          .order('data_venda', { ascending: false })
        
        // Buscar dados relacionados separadamente se necessário
        if (comprasData && comprasData.length > 0) {
          const empreendimentoIds = [...new Set(comprasData.map(c => c.empreendimento_id).filter(Boolean))]
          const corretorIds = [...new Set(comprasData.map(c => c.corretor_id).filter(Boolean))]
          
          let empreendimentosMap = {}
          let corretoresMap = {}
          
          if (empreendimentoIds.length > 0) {
            const { data: empData } = await supabase
              .from('empreendimentos')
              .select('id, nome, endereco')
              .in('id', empreendimentoIds)
            if (empData) {
              empreendimentosMap = empData.reduce((acc, emp) => {
                acc[emp.id] = emp
                return acc
              }, {})
            }
          }
          
          if (corretorIds.length > 0) {
            const { data: corrData } = await supabase
              .from('usuarios')
              .select('id, nome')
              .in('id', corretorIds)
            if (corrData) {
              corretoresMap = corrData.reduce((acc, corr) => {
                acc[corr.id] = corr
                return acc
              }, {})
            }
          }
          
          // Adicionar dados relacionados às compras
          const comprasComRelacoes = comprasData.map(compra => ({
            ...compra,
            empreendimentos: empreendimentosMap[compra.empreendimento_id] || null,
            corretores: corretoresMap[compra.corretor_id] || null
          }))
          
          setCompras(comprasComRelacoes)
        } else {
          setCompras([])
        }

      }
    } catch (error) {
      console.error('Erro ao buscar dados:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value) => {
    if (!value) return 'R$ 0,00'
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value)
  }

  const formatDate = (date) => {
    if (!date) return '-'
    return new Date(date).toLocaleDateString('pt-BR')
  }

  // Toggle sidebar collapsed state
  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const newValue = !prev
      localStorage.setItem('cliente-sidebar-collapsed', String(newValue))
      return newValue
    })
  }

  if (loading && !cliente) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <div className="loading-spinner-screen"></div>
          <p>Carregando...</p>
        </div>
      </div>
    )
  }

  if (!cliente) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <p style={{ color: '#ef4444', marginBottom: '10px' }}>Cliente não encontrado</p>
          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>
            Entre em contato com a administração
          </p>
        </div>
      </div>
    )
  }

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
            onClick={() => navigate('/cliente/dashboard')}
            title="Dashboard"
          >
            <Home size={20} />
            <span>Dashboard</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'compras' ? 'active' : ''}`}
            onClick={() => navigate('/cliente/compras')}
            title="Minhas Compras"
          >
            <ShoppingBag size={20} />
            <span>Minhas Compras</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'documentos' ? 'active' : ''}`}
            onClick={() => navigate('/cliente/documentos')}
            title="Documentos"
          >
            <FileText size={20} />
            <span>Documentos</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'perfil' ? 'active' : ''}`}
            onClick={() => navigate('/cliente/perfil')}
            title="Meu Perfil"
          >
            <UserIcon size={20} />
            <span>Meu Perfil</span>
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
              <UserIcon size={20} />
            </div>
            <div className="user-details">
              <span className="user-name">{cliente.nome_completo || 'Cliente'}</span>
              <span className="user-role">Cliente</span>
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
            {activeTab === 'dashboard' && 'Dashboard'}
            {activeTab === 'compras' && 'Minhas Compras'}
            {activeTab === 'documentos' && 'Meus Documentos'}
            {activeTab === 'perfil' && 'Meu Perfil'}
          </h1>
        </header>

        {/* Content Section */}
        <div className="content-section">
          {/* Dashboard Tab */}
          {activeTab === 'dashboard' && (
            <>
              {/* Welcome Section */}
              <section className="welcome-section-cliente">
                <div className="welcome-content">
                  <h1>Bem-vindo, {cliente.nome_completo?.split(' ')[0] || 'Cliente'}</h1>
                  <p>Acompanhe suas compras e documentos</p>
                </div>
              </section>

              {/* Stats Cards */}
              <section className="stats-section">
                <div className="stat-card-cliente primary">
                  <div className="stat-card-icon">
                    <ShoppingBag size={28} />
                  </div>
                  <div className="stat-card-content">
                    <span className="stat-card-label">Total de Compras</span>
                    <span className="stat-card-value">{compras.length}</span>
                  </div>
                  <div className="stat-card-decoration"></div>
                </div>

                <div className="stat-card-cliente success">
                  <div className="stat-card-icon">
                    <DollarSign size={28} />
                  </div>
                  <div className="stat-card-content">
                    <span className="stat-card-label">Valor Total Investido</span>
                    <span className="stat-card-value">
                      {formatCurrency(compras.reduce((acc, c) => acc + (c.valor_venda || 0), 0))}
                    </span>
                  </div>
                  <div className="stat-card-decoration"></div>
                </div>

                <div className="stat-card-cliente info">
                  <div className="stat-card-icon">
                    <FileText size={28} />
                  </div>
                  <div className="stat-card-content">
                    <span className="stat-card-label">Documentos</span>
                    <span className="stat-card-value">
                      {[
                        cliente.rg_frente_url,
                        cliente.cpf_url,
                        cliente.comprovante_residencia_url,
                        cliente.comprovante_renda_url
                      ].filter(Boolean).length} enviados
                    </span>
                  </div>
                  <div className="stat-card-decoration"></div>
                </div>
              </section>

              {/* Últimas Compras */}
              {compras.length > 0 && (
                <section className="ultimas-compras-section">
                  <h2>
                    <ShoppingBag size={24} />
                    Últimas Compras
                  </h2>
                  <div className="compras-list-mini">
                    {compras.slice(0, 3).map((compra) => (
                      <div key={compra.id} className="compra-card-mini">
                        <div className="compra-info-mini">
                          <h4>{compra.descricao || 'Compra de Imóvel'}</h4>
                          <div className="compra-meta-mini">
                            <span>
                              <Calendar size={14} />
                              {formatDate(compra.data_venda)}
                            </span>
                            <span className={`status-tag ${compra.status}`}>
                              {compra.status === 'pago' ? (
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
                        <div className="compra-valor-mini">
                          {formatCurrency(compra.valor_venda)}
                        </div>
                      </div>
                    ))}
                  </div>
                  {compras.length > 3 && (
                    <button 
                      className="btn-ver-todas"
                      onClick={() => navigate('/cliente/compras')}
                    >
                      Ver todas as compras
                    </button>
                  )}
                </section>
              )}
            </>
          )}

          {/* Compras Tab */}
          {activeTab === 'compras' && (
            <section className="compras-section">
              <div className="section-header-cliente">
                <h2>
                  <ShoppingBag size={24} />
                  Minhas Compras
                </h2>
              </div>

              {loading ? (
                <div className="loading-container">
                  <div className="loading-spinner-large"></div>
                  <p>Carregando suas compras...</p>
                </div>
              ) : compras.length === 0 ? (
                <div className="empty-state">
                  <ShoppingBag size={48} />
                  <h3>Nenhuma compra encontrada</h3>
                  <p>Suas compras aparecerão aqui quando forem registradas</p>
                </div>
              ) : (
                <div className="compras-list">
                  {compras.map((compra) => (
                    <div key={compra.id} className="compra-card">
                      <div className="compra-header">
                        <div className="compra-title">
                          <h3>{compra.descricao || 'Compra de Imóvel'}</h3>
                          <span className={`status-tag ${compra.status}`}>
                            {compra.status === 'pago' ? (
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
                        <div className="compra-valor-principal">
                          {formatCurrency(compra.valor_venda)}
                        </div>
                      </div>
                      
                      <div className="compra-details">
                        <div className="detail-item">
                          <Calendar size={16} />
                          <div>
                            <span className="detail-label">Data da Compra</span>
                            <span className="detail-value">{formatDate(compra.data_venda)}</span>
                          </div>
                        </div>
                        
                        {compra.empreendimentos && (
                          <div className="detail-item">
                            <Building size={16} />
                            <div>
                              <span className="detail-label">Empreendimento</span>
                              <span className="detail-value">{compra.empreendimentos.nome}</span>
                            </div>
                          </div>
                        )}
                        
                        {compra.corretores && (
                          <div className="detail-item">
                            <UserIcon size={16} />
                            <div>
                              <span className="detail-label">Corretor</span>
                              <span className="detail-value">{compra.corretores.nome}</span>
                            </div>
                          </div>
                        )}
                        
                        {compra.unidade && (
                          <div className="detail-item">
                            <MapPin size={16} />
                            <div>
                              <span className="detail-label">Unidade</span>
                              <span className="detail-value">
                                {compra.bloco ? `${compra.bloco} - ` : ''}{compra.unidade}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Documentos Tab */}
          {activeTab === 'documentos' && (
            <section className="documentos-section">
              <div className="section-header-cliente">
                <h2>
                  <FileText size={24} />
                  Meus Documentos
                </h2>
              </div>

              <div className="documentos-grid">
                <div className="documento-card">
                  <div className="documento-header">
                    <FileText size={24} />
                    <h3>RG - Frente</h3>
                  </div>
                  {cliente.rg_frente_url ? (
                    <div className="documento-status success">
                      <CheckCircle size={20} />
                      <span>Enviado</span>
                      <a 
                        href={cliente.rg_frente_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="btn-download"
                      >
                        <Download size={16} />
                        Baixar
                      </a>
                    </div>
                  ) : (
                    <div className="documento-status pendente">
                      <Clock size={20} />
                      <span>Pendente</span>
                    </div>
                  )}
                </div>

                <div className="documento-card">
                  <div className="documento-header">
                    <FileText size={24} />
                    <h3>CPF</h3>
                  </div>
                  {cliente.cpf_url ? (
                    <div className="documento-status success">
                      <CheckCircle size={20} />
                      <span>Enviado</span>
                      <a 
                        href={cliente.cpf_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="btn-download"
                      >
                        <Download size={16} />
                        Baixar
                      </a>
                    </div>
                  ) : (
                    <div className="documento-status pendente">
                      <Clock size={20} />
                      <span>Pendente</span>
                    </div>
                  )}
                </div>

                <div className="documento-card">
                  <div className="documento-header">
                    <FileText size={24} />
                    <h3>Comprovante de Residência</h3>
                  </div>
                  {cliente.comprovante_residencia_url ? (
                    <div className="documento-status success">
                      <CheckCircle size={20} />
                      <span>Enviado</span>
                      <a 
                        href={cliente.comprovante_residencia_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="btn-download"
                      >
                        <Download size={16} />
                        Baixar
                      </a>
                    </div>
                  ) : (
                    <div className="documento-status pendente">
                      <Clock size={20} />
                      <span>Pendente</span>
                    </div>
                  )}
                </div>

                <div className="documento-card">
                  <div className="documento-header">
                    <FileText size={24} />
                    <h3>Comprovante de Renda</h3>
                  </div>
                  {cliente.comprovante_renda_url ? (
                    <div className="documento-status success">
                      <CheckCircle size={20} />
                      <span>Enviado</span>
                      <a 
                        href={cliente.comprovante_renda_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="btn-download"
                      >
                        <Download size={16} />
                        Baixar
                      </a>
                    </div>
                  ) : (
                    <div className="documento-status pendente">
                      <Clock size={20} />
                      <span>Pendente</span>
                    </div>
                  )}
                </div>

                {cliente.certidao_casamento_url && (
                  <div className="documento-card">
                    <div className="documento-header">
                      <FileText size={24} />
                      <h3>Certidão de Casamento</h3>
                    </div>
                    <div className="documento-status success">
                      <CheckCircle size={20} />
                      <span>Enviado</span>
                      <a 
                        href={cliente.certidao_casamento_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="btn-download"
                      >
                        <Download size={16} />
                        Baixar
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Perfil Tab */}
          {activeTab === 'perfil' && (
            <section className="perfil-section">
              <div className="section-header-cliente">
                <h2>
                  <UserIcon size={24} />
                  Meu Perfil
                </h2>
              </div>

              <div className="perfil-card-cliente">
                <div className="perfil-header-cliente">
                  <div className="avatar-large">
                    {cliente.nome_completo?.charAt(0) || 'C'}
                  </div>
                  <div className="perfil-info-header">
                    <h3>{cliente.nome_completo}</h3>
                    <p>Cliente IM Incorporadora</p>
                  </div>
                </div>

                <div className="perfil-details-grid">
                  <div className="detail-row">
                    <span className="detail-label">CPF</span>
                    <span className="detail-value">{cliente.cpf || '-'}</span>
                  </div>
                  
                  <div className="detail-row">
                    <span className="detail-label">RG</span>
                    <span className="detail-value">{cliente.rg || '-'}</span>
                  </div>
                  
                  <div className="detail-row">
                    <span className="detail-label">Data de Nascimento</span>
                    <span className="detail-value">{formatDate(cliente.data_nascimento)}</span>
                  </div>
                  
                  <div className="detail-row">
                    <span className="detail-label">Email</span>
                    <span className="detail-value">{cliente.email || '-'}</span>
                  </div>
                  
                  <div className="detail-row">
                    <span className="detail-label">Telefone</span>
                    <span className="detail-value">{cliente.telefone || '-'}</span>
                  </div>
                  
                  <div className="detail-row">
                    <span className="detail-label">Endereço</span>
                    <span className="detail-value">{cliente.endereco || '-'}</span>
                  </div>
                  
                  <div className="detail-row">
                    <span className="detail-label">Profissão</span>
                    <span className="detail-value">{cliente.profissao || '-'}</span>
                  </div>
                  
                  <div className="detail-row">
                    <span className="detail-label">Empresa</span>
                    <span className="detail-value">{cliente.empresa_trabalho || '-'}</span>
                  </div>
                  
                  <div className="detail-row">
                    <span className="detail-label">Renda Mensal</span>
                    <span className="detail-value">{formatCurrency(cliente.renda_mensal)}</span>
                  </div>
                </div>

                {cliente.tem_complemento_renda && (
                  <div className="complemento-renda-section">
                    <h4>Complemento de Renda</h4>
                    <p>Você possui complementadores de renda cadastrados</p>
                  </div>
                )}

                {cliente.possui_3_anos_fgts && (
                  <div className="fgts-info">
                    <CheckCircle size={20} />
                    <span>Possui 3 anos de FGTS</span>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

export default ClienteDashboard

