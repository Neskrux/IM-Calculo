import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { 
  Home, ShoppingBag, FileText, User as UserIcon, LogOut,
  Menu, X, ChevronLeft, ChevronRight, ChevronDown, Calendar, MapPin,
  Building, DollarSign, CheckCircle, Clock, Download,
  CreditCard, FileCheck, AlertCircle, Eye, Upload,
  IdCard, Copy, Heart, Image as ImageIcon
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
  const [pagamentos, setPagamentos] = useState([])
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [uploadingDocType, setUploadingDocType] = useState(null)
  const [compraExpandida, setCompraExpandida] = useState(null)
  const [gruposExpandidos, setGruposExpandidos] = useState({})
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
        
        // Buscar pagamentos das compras
        let pagamentosData = []
        if (comprasData && comprasData.length > 0) {
          const compraIds = comprasData.map(c => c.id)
          const { data: pagData } = await supabase
            .from('pagamentos_prosoluto')
            .select('*')
            .in('venda_id', compraIds)
          
          if (pagData) {
            pagamentosData = pagData
          }
        }
        setPagamentos(pagamentosData)
        
        // Buscar dados relacionados separadamente se necessário
        if (comprasData && comprasData.length > 0) {
          const empreendimentoIds = [...new Set(comprasData.map(c => c.empreendimento_id).filter(Boolean))]
          const corretorIds = [...new Set(comprasData.map(c => c.corretor_id).filter(Boolean))]
          
          let empreendimentosMap = {}
          let corretoresMap = {}
          
          if (empreendimentoIds.length > 0) {
            const { data: empData, error: empError } = await supabase
              .from('empreendimentos')
              .select('id, nome')
              .in('id', empreendimentoIds)
            
            if (empError) {
              console.error('Erro ao buscar empreendimentos:', empError)
            }
            
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
          const comprasComRelacoes = comprasData.map(compra => {
            // Buscar empreendimento - tentar com ID como string e como UUID
            const empreendimentoId = compra.empreendimento_id
            const empreendimento = empreendimentoId 
              ? (empreendimentosMap[empreendimentoId] || 
                 empreendimentosMap[String(empreendimentoId)] ||
                 null)
              : null
            
            return {
              ...compra,
              empreendimentos: empreendimento,
              empreendimento: empreendimento, // Também adicionar no singular para compatibilidade
              corretores: corretoresMap[compra.corretor_id] || null
            }
          })
          
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
    
    // Se for uma string no formato YYYY-MM-DD, formatar diretamente sem timezone
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)) {
      const [year, month, day] = date.split('T')[0].split('-')
      return `${day}/${month}/${year}`
    }
    
    // Para outros formatos, usar Date mas forçar interpretação local
    const dateObj = new Date(date)
    // Se a data for inválida, retornar '-'
    if (isNaN(dateObj.getTime())) return '-'
    
    // Usar métodos locais para evitar problemas de timezone
    const day = String(dateObj.getDate()).padStart(2, '0')
    const month = String(dateObj.getMonth() + 1).padStart(2, '0')
    const year = dateObj.getFullYear()
    
    return `${day}/${month}/${year}`
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
  const toggleGrupoExpandido = (compraId, tipo) => {
    const key = `${compraId}-${tipo}`
    setGruposExpandidos(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  // Verificar se grupo está expandido
  const isGrupoExpandido = (compraId, tipo) => {
    const key = `${compraId}-${tipo}`
    return gruposExpandidos[key] || false
  }

  // Formatação para Ticker (valor completo)
  const formatTicker = (value) => {
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

  // Dados dinâmicos para o Ticker
  const getTickerData = () => {
    const totalCompras = compras.reduce((acc, c) => acc + (parseFloat(c.valor_venda) || 0), 0)
    const comprasPagas = compras.filter(c => c.status === 'pago')
    const totalJaPago = comprasPagas.reduce((acc, c) => acc + (parseFloat(c.valor_venda) || 0), 0)
    const comprasMes = compras.filter(c => {
      const dataVenda = new Date(c.data_venda)
      const hoje = new Date()
      return dataVenda.getMonth() === hoje.getMonth() && dataVenda.getFullYear() === hoje.getFullYear()
    })
    const totalComprasMes = comprasMes.reduce((acc, c) => acc + (parseFloat(c.valor_venda) || 0), 0)
    const mediaPorCompra = compras.length > 0 ? totalCompras / compras.length : 0
    const documentosEnviados = [
      cliente?.rg_frente_url,
      cliente?.rg_verso_url,
      cliente?.cpf_url,
      cliente?.comprovante_residencia_url,
      cliente?.comprovante_renda_url,
      cliente?.certidao_casamento_url
    ].filter(Boolean).length

    return [
      {
        name: 'TOTAL JÁ PAGO',
        value: formatTicker(totalJaPago),
        change: comprasPagas.length > 0 ? `${comprasPagas.length} compras` : '0',
        type: comprasPagas.length > 0 ? 'positive' : 'neutral'
      },
      {
        name: 'TOTAL EM COMPRAS',
        value: formatTicker(totalCompras),
        change: compras.length > 0 ? `${compras.length} compras` : '0',
        type: 'positive'
      },
      {
        name: 'COMPRAS ESTE MÊS',
        value: formatTicker(totalComprasMes),
        change: comprasMes.length > 0 ? `${comprasMes.length} compras` : '0',
        type: 'positive'
      },
      {
        name: 'MÉDIA POR COMPRA',
        value: formatTicker(mediaPorCompra),
        change: '0%',
        type: 'neutral'
      },
      {
        name: 'DOCUMENTOS ENVIADOS',
        value: `${documentosEnviados}/6`,
        change: documentosEnviados === 6 ? '100%' : `${Math.round((documentosEnviados / 6) * 100)}%`,
        type: documentosEnviados === 6 ? 'positive' : documentosEnviados > 0 ? 'neutral' : 'negative'
      }
    ]
  }

  // Helper para adicionar cache busting na URL
  const getUrlComCacheBust = (url) => {
    if (!url) return url
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}t=${Date.now()}`
  }

  // Upload de documento do cliente
  const uploadDocumentoCliente = async (file, tipo) => {
    if (!file || !cliente || !user) {
      alert('Você precisa estar autenticado para fazer upload de documentos.')
      return
    }

    // Verificar se o usuário está autenticado
    if (!user || !user.id) {
      alert('Você precisa estar autenticado para fazer upload de documentos.')
      return
    }
    
    setUploadingDoc(true)
    setUploadingDocType(tipo)
    
    try {
      // Verificar se a sessão está ativa
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      
      if (sessionError || !session) {
        throw new Error('Sessão não encontrada. Por favor, faça login novamente.')
      }

      // ========== VALIDAÇÕES DE SEGURANÇA ==========
      
      // 1. Validar tipo de documento permitido
      const tiposPermitidos = [
        'rg_frente',
        'rg_verso',
        'cpf',
        'comprovante_residencia',
        'comprovante_renda',
        'certidao_casamento'
      ]
      
      if (!tiposPermitidos.includes(tipo)) {
        throw new Error('Tipo de documento inválido.')
      }

      // 2. Validar extensão do arquivo
      const extensoesPermitidas = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp']
      const fileExt = file.name.split('.').pop()?.toLowerCase()
      
      if (!fileExt || !extensoesPermitidas.includes(fileExt)) {
        throw new Error(`Tipo de arquivo não permitido. Use: ${extensoesPermitidas.join(', ').toUpperCase()}`)
      }

      // 2.1. Validar tipo MIME do arquivo (segurança adicional)
      const mimeTypesPermitidos = [
        'application/pdf',
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp'
      ]
      
      if (!mimeTypesPermitidos.includes(file.type)) {
        throw new Error('Tipo de arquivo inválido. Apenas PDF e imagens são permitidos.')
      }

      // 3. Validar tamanho do arquivo (máximo 10MB)
      const maxSize = 10 * 1024 * 1024 // 10MB em bytes
      if (file.size > maxSize) {
        throw new Error('Arquivo muito grande. Tamanho máximo: 10MB')
      }

      if (file.size === 0) {
        throw new Error('Arquivo vazio não é permitido.')
      }

      // 4. Garantir que user.id existe
      if (!user || !user.id) {
        throw new Error('Erro de autenticação. Faça login novamente.')
      }

      // 5. Construir caminho igual ao AdminDashboard
      // Se já existe documento, usar o mesmo nome para substituir, senão criar novo
      let fileName, filePath
      const documentoExistente = cliente[`${tipo}_url`]
      
      if (documentoExistente) {
        // Se já existe, extrair o nome do arquivo da URL existente
        try {
          const urlParts = documentoExistente.split('/')
          let nomeExistente = urlParts[urlParts.length - 1]
          // Remover query parameters se existirem (ex: ?token=xyz)
          nomeExistente = nomeExistente.split('?')[0]
          // Validar se o nome extraído é válido
          if (nomeExistente && nomeExistente.length > 0) {
            fileName = nomeExistente
            filePath = `clientes/${fileName}`
          } else {
            // Se não conseguir extrair, criar novo arquivo
            fileName = `${tipo}_${Date.now()}.${fileExt}`
            filePath = `clientes/${fileName}`
          }
        } catch (error) {
          // Se houver erro na extração, criar novo arquivo
          console.warn('Erro ao extrair nome do arquivo existente, criando novo:', error)
          fileName = `${tipo}_${Date.now()}.${fileExt}`
          filePath = `clientes/${fileName}`
        }
      } else {
        // Se não existe, criar novo arquivo
        fileName = `${tipo}_${Date.now()}.${fileExt}`
        filePath = `clientes/${fileName}`
      }

      // 6. Validação final do caminho (prevenir path traversal)
      if (filePath.includes('..') || filePath.includes('//') || !filePath.startsWith('clientes/')) {
        throw new Error('Caminho de arquivo inválido.')
      }

      // Fazer upload - se já existe, vai substituir automaticamente
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('documentos')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true // Permite substituir se já existir
        })

      if (uploadError) {
        throw uploadError
      }

      const { data: { publicUrl } } = supabase.storage
        .from('documentos')
        .getPublicUrl(uploadData?.path || filePath)

      // Atualizar cliente no banco - usar user.id para garantir segurança
      const { error: updateError } = await supabase
        .from('clientes')
        .update({ [`${tipo}_url`]: publicUrl })
        .eq('id', cliente.id)
        .eq('user_id', user.id) // Garantir que só atualiza usando o user.id logado

      if (updateError) {
        console.error('Erro ao atualizar cliente:', updateError)
        throw new Error('Erro ao salvar o documento. Verifique suas permissões.')
      }

      // Atualizar estado local com URL atualizada
      setCliente(prev => ({ ...prev, [`${tipo}_url`]: publicUrl }))
      
      // Pequeno delay para garantir que o arquivo foi processado no storage
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Recarregar dados para garantir sincronização
      await fetchClienteData()
      
    } catch (error) {
      console.error('Erro no upload:', error)
      
      let errorMessage = 'Erro ao fazer upload do documento.'
      
      if (error.message?.includes('row-level security') || error.message?.includes('RLS')) {
        errorMessage = 'Você não tem permissão para fazer upload de documentos. Entre em contato com o administrador.'
      } else if (error.message) {
        errorMessage = error.message
      }
      
      alert(errorMessage)
    } finally {
      setUploadingDoc(false)
      setUploadingDocType(null)
    }
  }

  // Toggle sidebar collapsed state
  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const newValue = !prev
      localStorage.setItem('cliente-sidebar-collapsed', String(newValue))
      return newValue
    })
  }

  // Se há transição de login ativa, não renderizar nada
  if (sessionStorage.getItem('im-login-transition')) {
    return null
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
        <Ticker data={getTickerData()} />
        
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                          <div className="compra-valor-principal">
                            {formatCurrency(compra.valor_venda)}
                          </div>
                          {/* Botão Ver mais */}
                          <div className="venda-expand-btn-wrapper">
                            <button 
                              className="venda-expand-btn"
                              onClick={() => setCompraExpandida(compraExpandida === compra.id ? null : compra.id)}
                            >
                              <ChevronDown 
                                size={18} 
                                className={compraExpandida === compra.id ? 'rotated' : ''} 
                              />
                              <span>Ver mais</span>
                            </button>
                          </div>
                        </div>
                      </div>
                      
                      <div className="compra-details">
                        <div className="detail-item">
                          <Calendar size={18} />
                          <div>
                            <span className="detail-label">DATA DA COMPRA</span>
                            <span className="detail-value">{formatDate(compra.data_venda)}</span>
                          </div>
                        </div>
                        
                        {compra.corretores && (
                          <div className="detail-item">
                            <UserIcon size={18} />
                            <div>
                              <span className="detail-label">CORRETOR</span>
                              <span className="detail-value">{compra.corretores.nome}</span>
                            </div>
                          </div>
                        )}
                        
                        {compra.unidade && (
                          <div className="detail-item">
                            <MapPin size={18} />
                            <div>
                              <span className="detail-label">UNIDADE</span>
                              <span className="detail-value">
                                {compra.bloco ? `${compra.bloco} - ` : ''}{compra.unidade}{compra.andar ? ` | ${compra.andar}` : ''}
                              </span>
                            </div>
                          </div>
                        )}
                        
                        {(compra.empreendimentos || compra.empreendimento) && (
                          <div className="detail-item">
                            <Building size={18} />
                            <div>
                              <span className="detail-label">EMPREENDIMENTO</span>
                              <span className="detail-value">
                                {compra.empreendimentos?.nome || compra.empreendimento?.nome || '-'}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Seção expandida com detalhes dos pagamentos */}
                      {compraExpandida === compra.id && (
                        <div className="compra-pagamentos-detalhes">
                          {(() => {
                            const pagamentosCompra = pagamentos.filter(p => String(p.venda_id) === String(compra.id))
                            
                            if (pagamentosCompra.length === 0) {
                              return (
                                <div className="parcelas-empty">
                                  <p>Nenhum pagamento cadastrado para esta compra</p>
                                </div>
                              )
                            }
                            
                            const grupos = agruparPagamentosPorTipo(pagamentosCompra)
                            const tiposOrdem = ['sinal', 'entrada', 'parcela_entrada', 'balao']
                            
                            return (
                              <>
                                <div className="parcelas-header">
                                  <h5>Detalhamento de Pagamentos</h5>
                                </div>
                                
                                {tiposOrdem.map(tipo => {
                                  const pagamentosGrupo = grupos[tipo]
                                  if (!pagamentosGrupo || pagamentosGrupo.length === 0) return null
                                  
                                  // Calcular totais do grupo
                                  const totalValor = pagamentosGrupo.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0)
                                  const pagos = pagamentosGrupo.filter(p => p.status === 'pago').length
                                  const pendentes = pagamentosGrupo.filter(p => p.status === 'pendente').length
                                  
                                  // Verificar se tem mais de 10 itens e se está expandido
                                  const temMaisDe10 = pagamentosGrupo.length > 10
                                  const estaExpandido = isGrupoExpandido(compra.id, tipo)
                                  const itensParaMostrar = temMaisDe10 && !estaExpandido ? 10 : pagamentosGrupo.length
                                  const pagamentosExibidos = pagamentosGrupo.slice(0, itensParaMostrar)
                                  
                                  return (
                                    <div key={tipo} className="pagamento-grupo">
                                      <div className="grupo-header">
                                        <h6 className="grupo-titulo">{getGrupoLabel(tipo)}</h6>
                                        <div className="grupo-resumo">
                                          <span className="grupo-total-valor">{formatCurrency(totalValor)}</span>
                                          <span className="grupo-contador">
                                            {pagamentosGrupo.length} {pagamentosGrupo.length === 1 ? 'item' : 'itens'}
                                            {pagos > 0 && ` • ${pagos} pago${pagos > 1 ? 's' : ''}`}
                                            {pendentes > 0 && ` • ${pendentes} pendente${pendentes > 1 ? 's' : ''}`}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="parcelas-list">
                                        {pagamentosExibidos.map((pagamento) => (
                                          <div 
                                            key={pagamento.id} 
                                            className={`cliente-parcela-row ${pagamento.status === 'pago' ? 'pago' : ''}`}
                                          >
                                            <div className="cliente-parcela-tipo">
                                              {pagamento.tipo === 'sinal' && 'Sinal'}
                                              {pagamento.tipo === 'entrada' && 'Entrada'}
                                              {pagamento.tipo === 'parcela_entrada' && `Parcela ${pagamento.numero_parcela || ''}`}
                                              {pagamento.tipo === 'balao' && `Balão ${pagamento.numero_parcela || ''}`}
                                            </div>
                                            <div className="cliente-parcela-data">
                                              {pagamento.data_prevista 
                                                ? new Date(pagamento.data_prevista).toLocaleDateString('pt-BR')
                                                : '-'
                                              }
                                            </div>
                                            <div className="cliente-parcela-valor">
                                              {formatCurrency(pagamento.valor)}
                                            </div>
                                            <div className="cliente-parcela-status">
                                              <span className={`status-pill ${pagamento.status}`}>
                                                {pagamento.status === 'pago' ? 'Pago' : 'Pendente'}
                                              </span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                      {temMaisDe10 && (
                                        <div className="grupo-expand-btn-wrapper">
                                          <button 
                                            className="grupo-expand-btn"
                                            onClick={() => toggleGrupoExpandido(compra.id, tipo)}
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
                                })}
                              </>
                            )
                          })()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Documentos Tab */}
          {activeTab === 'documentos' && (
            <section className="documentos-section">
              <div className="docs-upload-grid-cliente">
                {/* RG Frente */}
                <div className="form-group-doc">
                  <label className="doc-label">
                    RG Frente
                    {cliente.rg_frente_url ? (
                      <span className="doc-status-badge success">
                        <CheckCircle size={14} />
                        Enviado
                      </span>
                    ) : (
                      <span className="doc-status-badge warning">
                        <Clock size={14} />
                        Pendente
                      </span>
                    )}
                  </label>
                  <div className="file-upload-wrapper">
                    {cliente.rg_frente_url ? (
                      <div className="file-upload-info">
                        <span className="file-name" title={cliente.rg_frente_url.split('/').pop()?.split('?')[0]}>
                          {cliente.rg_frente_url.split('/').pop()?.split('?')[0]}
                        </span>
                        <a href={getUrlComCacheBust(cliente.rg_frente_url)} target="_blank" rel="noopener noreferrer" className="doc-preview">
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
                        disabled={uploadingDoc && uploadingDocType === 'rg_frente'}
                      />
                      <span className="file-upload-button">
                        {uploadingDoc && uploadingDocType === 'rg_frente' ? (
                          <>
                            <div className="loading-spinner-small"></div>
                            Enviando...
                          </>
                        ) : (
                          'Escolher Arquivo'
                        )}
                      </span>
                    </label>
                  </div>
                </div>

                {/* RG Verso */}
                <div className="form-group-doc">
                  <label className="doc-label">
                    RG Verso
                    {cliente.rg_verso_url ? (
                      <span className="doc-status-badge success">
                        <CheckCircle size={14} />
                        Enviado
                      </span>
                    ) : (
                      <span className="doc-status-badge warning">
                        <Clock size={14} />
                        Pendente
                      </span>
                    )}
                  </label>
                  <div className="file-upload-wrapper">
                    {cliente.rg_verso_url ? (
                      <div className="file-upload-info">
                        <span className="file-name" title={cliente.rg_verso_url.split('/').pop()?.split('?')[0]}>
                          {cliente.rg_verso_url.split('/').pop()?.split('?')[0]}
                        </span>
                        <a href={getUrlComCacheBust(cliente.rg_verso_url)} target="_blank" rel="noopener noreferrer" className="doc-preview">
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
                        disabled={uploadingDoc && uploadingDocType === 'rg_verso'}
                      />
                      <span className="file-upload-button">
                        {uploadingDoc && uploadingDocType === 'rg_verso' ? (
                          <>
                            <div className="loading-spinner-small"></div>
                            Enviando...
                          </>
                        ) : (
                          'Escolher Arquivo'
                        )}
                      </span>
                    </label>
                  </div>
                </div>

                {/* CPF */}
                <div className="form-group-doc">
                  <label className="doc-label">
                    CPF
                    {cliente.cpf_url ? (
                      <span className="doc-status-badge success">
                        <CheckCircle size={14} />
                        Enviado
                      </span>
                    ) : (
                      <span className="doc-status-badge warning">
                        <Clock size={14} />
                        Pendente
                      </span>
                    )}
                  </label>
                  <div className="file-upload-wrapper">
                    {cliente.cpf_url ? (
                      <div className="file-upload-info">
                        <span className="file-name" title={cliente.cpf_url.split('/').pop()?.split('?')[0]}>
                          {cliente.cpf_url.split('/').pop()?.split('?')[0]}
                        </span>
                        <a href={getUrlComCacheBust(cliente.cpf_url)} target="_blank" rel="noopener noreferrer" className="doc-preview">
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
                        disabled={uploadingDoc && uploadingDocType === 'cpf'}
                      />
                      <span className="file-upload-button">
                        {uploadingDoc && uploadingDocType === 'cpf' ? (
                          <>
                            <div className="loading-spinner-small"></div>
                            Enviando...
                          </>
                        ) : (
                          'Escolher Arquivo'
                        )}
                      </span>
                    </label>
                  </div>
                </div>

                {/* Comprovante de Residência */}
                <div className="form-group-doc">
                  <label className="doc-label">
                    Comprovante de Residência
                    {cliente.comprovante_residencia_url ? (
                      <span className="doc-status-badge success">
                        <CheckCircle size={14} />
                        Enviado
                      </span>
                    ) : (
                      <span className="doc-status-badge warning">
                        <Clock size={14} />
                        Pendente
                      </span>
                    )}
                  </label>
                  <div className="file-upload-wrapper">
                    {cliente.comprovante_residencia_url ? (
                      <div className="file-upload-info">
                        <span className="file-name" title={cliente.comprovante_residencia_url.split('/').pop()?.split('?')[0]}>
                          {cliente.comprovante_residencia_url.split('/').pop()?.split('?')[0]}
                        </span>
                        <a href={getUrlComCacheBust(cliente.comprovante_residencia_url)} target="_blank" rel="noopener noreferrer" className="doc-preview">
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
                        disabled={uploadingDoc && uploadingDocType === 'comprovante_residencia'}
                      />
                      <span className="file-upload-button">
                        {uploadingDoc && uploadingDocType === 'comprovante_residencia' ? (
                          <>
                            <div className="loading-spinner-small"></div>
                            Enviando...
                          </>
                        ) : (
                          'Escolher Arquivo'
                        )}
                      </span>
                    </label>
                  </div>
                </div>

                {/* Comprovante de Renda */}
                <div className="form-group-doc">
                  <label className="doc-label">
                    Comprovante de Renda
                    {cliente.comprovante_renda_url ? (
                      <span className="doc-status-badge success">
                        <CheckCircle size={14} />
                        Enviado
                      </span>
                    ) : (
                      <span className="doc-status-badge warning">
                        <Clock size={14} />
                        Pendente
                      </span>
                    )}
                  </label>
                  <div className="file-upload-wrapper">
                    {cliente.comprovante_renda_url ? (
                      <div className="file-upload-info">
                        <span className="file-name" title={cliente.comprovante_renda_url.split('/').pop()?.split('?')[0]}>
                          {cliente.comprovante_renda_url.split('/').pop()?.split('?')[0]}
                        </span>
                        <a href={getUrlComCacheBust(cliente.comprovante_renda_url)} target="_blank" rel="noopener noreferrer" className="doc-preview">
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
                        disabled={uploadingDoc && uploadingDocType === 'comprovante_renda'}
                      />
                      <span className="file-upload-button">
                        {uploadingDoc && uploadingDocType === 'comprovante_renda' ? (
                          <>
                            <div className="loading-spinner-small"></div>
                            Enviando...
                          </>
                        ) : (
                          'Escolher Arquivo'
                        )}
                      </span>
                    </label>
                  </div>
                </div>

                {/* Certidão de Casamento */}
                <div className="form-group-doc">
                  <label className="doc-label">
                    Certidão de Casamento/União
                    {cliente.certidao_casamento_url ? (
                      <span className="doc-status-badge success">
                        <CheckCircle size={14} />
                        Enviado
                      </span>
                    ) : (
                      <span className="doc-status-badge warning">
                        <Clock size={14} />
                        Pendente
                      </span>
                    )}
                  </label>
                  <div className="file-upload-wrapper">
                    {cliente.certidao_casamento_url ? (
                      <div className="file-upload-info">
                        <span className="file-name" title={cliente.certidao_casamento_url.split('/').pop()?.split('?')[0]}>
                          {cliente.certidao_casamento_url.split('/').pop()?.split('?')[0]}
                        </span>
                        <a href={getUrlComCacheBust(cliente.certidao_casamento_url)} target="_blank" rel="noopener noreferrer" className="doc-preview">
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
                        disabled={uploadingDoc && uploadingDocType === 'certidao_casamento'}
                      />
                      <span className="file-upload-button">
                        {uploadingDoc && uploadingDocType === 'certidao_casamento' ? (
                          <>
                            <div className="loading-spinner-small"></div>
                            Enviando...
                          </>
                        ) : (
                          'Escolher Arquivo'
                        )}
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Perfil Tab */}
          {activeTab === 'perfil' && (
            <section className="perfil-section">
              <div className="perfil-card-cliente">
                <div className="perfil-header-cliente">
                  <div className="avatar-large">
                    {cliente.nome_completo?.charAt(0).toUpperCase() || 'C'}
                  </div>
                  <div className="perfil-info-header">
                    <h3>{cliente.nome_completo}</h3>
                    <p>Cliente IM Incorporadora</p>
                  </div>
                </div>

                <div className="perfil-details-grid">
                  <div className="perfil-detail-card">
                    <span className="perfil-detail-label">CPF</span>
                    <span className="perfil-detail-value">{cliente.cpf || '-'}</span>
                  </div>
                  
                  <div className="perfil-detail-card">
                    <span className="perfil-detail-label">RG</span>
                    <span className="perfil-detail-value">{cliente.rg || '-'}</span>
                  </div>
                  
                  <div className="perfil-detail-card">
                    <span className="perfil-detail-label">DATA DE NASCIMENTO</span>
                    <span className="perfil-detail-value">{formatDate(cliente.data_nascimento) || '-'}</span>
                  </div>
                  
                  <div className="perfil-detail-card">
                    <span className="perfil-detail-label">EMAIL</span>
                    <span className="perfil-detail-value">{cliente.email || '-'}</span>
                  </div>
                  
                  <div className="perfil-detail-card">
                    <span className="perfil-detail-label">TELEFONE</span>
                    <span className="perfil-detail-value">{cliente.telefone || '-'}</span>
                  </div>
                  
                  <div className="perfil-detail-card">
                    <span className="perfil-detail-label">ENDEREÇO</span>
                    <span className="perfil-detail-value">{cliente.endereco || '-'}</span>
                  </div>
                  
                  {cliente.cep && (
                    <div className="perfil-detail-card">
                      <span className="perfil-detail-label">CEP</span>
                      <span className="perfil-detail-value">{cliente.cep}</span>
                    </div>
                  )}
                  
                  <div className="perfil-detail-card">
                    <span className="perfil-detail-label">PROFISSÃO</span>
                    <span className="perfil-detail-value">{cliente.profissao || '-'}</span>
                  </div>
                  
                  <div className="perfil-detail-card">
                    <span className="perfil-detail-label">EMPRESA</span>
                    <span className="perfil-detail-value">{cliente.empresa_trabalho || '-'}</span>
                  </div>
                  
                  <div className="perfil-detail-card highlight">
                    <span className="perfil-detail-label">RENDA MENSAL</span>
                    <span className="perfil-detail-value">{formatCurrency(cliente.renda_mensal)}</span>
                  </div>
                </div>

                {(cliente.tem_complemento_renda || cliente.possui_3_anos_fgts) && (
                  <div className="perfil-badges-section">
                    {cliente.possui_3_anos_fgts && (
                      <div className="perfil-badge success">
                        <CheckCircle size={18} />
                        <span>Possui 3 anos de FGTS</span>
                      </div>
                    )}
                    
                    {cliente.tem_complemento_renda && (
                      <div className="perfil-badge info">
                        <UserIcon size={18} />
                        <span>Complemento de Renda Cadastrado</span>
                      </div>
                    )}
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


