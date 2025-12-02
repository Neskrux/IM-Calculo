import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { 
  Users, DollarSign, TrendingUp, Plus, Edit2, Trash2, 
  Search, Filter, LogOut, Menu, X, ChevronDown, Save, Eye,
  Calculator, Calendar, User, Briefcase, CheckCircle, Clock, UserPlus, Mail, Lock, Percent
} from 'lucide-react'
import logo from '../imgs/logo.png'
import '../styles/Dashboard.css'

const AdminDashboard = () => {
  const { userProfile, signOut } = useAuth()
  const [corretores, setCorretores] = useState([])
  const [vendas, setVendas] = useState([])
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('vendas')
  const [searchTerm, setSearchTerm] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [modalType, setModalType] = useState('')
  const [selectedItem, setSelectedItem] = useState(null)
  const [filterTipo, setFilterTipo] = useState('todos')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })

  // Dados do formulário de venda
  const [vendaForm, setVendaForm] = useState({
    corretor_id: '',
    valor_venda: '',
    tipo_corretor: 'externo',
    data_venda: new Date().toISOString().split('T')[0],
    descricao: '',
    status: 'pendente'
  })

  // Dados do formulário de corretor
  const [corretorForm, setCorretorForm] = useState({
    nome: '',
    email: '',
    senha: '',
    tipo_corretor: 'externo',
    telefone: '',
    percentual_corretor: '4'
  })

  // Percentuais base de comissão (exceto corretor que é personalizado)
  const getComissoesBase = (tipoCorretor) => ({
    diretor: 0.5,
    nohros_imobiliaria: tipoCorretor === 'externo' ? 0.5 : 1.25,
    nohros_gestao: 1.0,
    wsc: tipoCorretor === 'externo' ? 0.5 : 1.25,
    coordenadora: tipoCorretor === 'externo' ? 0.5 : 0
  })

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    
    // Buscar corretores
    const { data: corretoresData } = await supabase
      .from('usuarios')
      .select('*')
      .eq('tipo', 'corretor')
      .order('nome')

    // Buscar vendas
    const { data: vendasData } = await supabase
      .from('vendas')
      .select(`
        *,
        corretor:usuarios(nome, email, tipo_corretor, percentual_corretor)
      `)
      .order('data_venda', { ascending: false })

    setCorretores(corretoresData || [])
    setVendas(vendasData || [])
    setLoading(false)
  }

  const calcularComissoes = (valorVenda, tipoCorretor, percentualCorretor) => {
    const base = getComissoesBase(tipoCorretor)
    const percCorretor = parseFloat(percentualCorretor) || (tipoCorretor === 'externo' ? 4 : 2.5)
    
    const comissoes = {
      diretor: (valorVenda * base.diretor) / 100,
      nohros_imobiliaria: (valorVenda * base.nohros_imobiliaria) / 100,
      nohros_gestao: (valorVenda * base.nohros_gestao) / 100,
      wsc: (valorVenda * base.wsc) / 100,
      corretor: (valorVenda * percCorretor) / 100,
      coordenadora: (valorVenda * base.coordenadora) / 100,
    }
    
    comissoes.total = comissoes.diretor + comissoes.nohros_imobiliaria + 
                      comissoes.nohros_gestao + comissoes.wsc + 
                      comissoes.corretor + comissoes.coordenadora
    
    return comissoes
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
      setMessage({ type: 'error', text: 'Preencha todos os campos obrigatórios' })
      return
    }

    setSaving(true)
    
    // Buscar o percentual do corretor selecionado
    const corretor = corretores.find(c => c.id === vendaForm.corretor_id)
    const percentualCorretor = corretor?.percentual_corretor || (vendaForm.tipo_corretor === 'externo' ? 4 : 2.5)
    
    const comissoes = calcularComissoes(
      parseFloat(vendaForm.valor_venda),
      vendaForm.tipo_corretor,
      percentualCorretor
    )

    const vendaData = {
      ...vendaForm,
      valor_venda: parseFloat(vendaForm.valor_venda),
      comissao_diretor: comissoes.diretor,
      comissao_nohros_imobiliaria: comissoes.nohros_imobiliaria,
      comissao_nohros_gestao: comissoes.nohros_gestao,
      comissao_wsc: comissoes.wsc,
      comissao_corretor: comissoes.corretor,
      comissao_coordenadora: comissoes.coordenadora,
      comissao_total: comissoes.total
    }

    let error
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
      error = result.error
    }

    setSaving(false)

    if (error) {
      setMessage({ type: 'error', text: 'Erro ao salvar venda: ' + error.message })
      return
    }

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
            percentual_corretor: parseFloat(corretorForm.percentual_corretor) || null
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
            percentual_corretor: parseFloat(corretorForm.percentual_corretor) || null
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

  const openEditCorretor = (corretor) => {
    setSelectedItem(corretor)
    setCorretorForm({
      nome: corretor.nome,
      email: corretor.email,
      senha: '',
      tipo_corretor: corretor.tipo_corretor || 'externo',
      telefone: corretor.telefone || '',
      percentual_corretor: corretor.percentual_corretor?.toString() || (corretor.tipo_corretor === 'interno' ? '2.5' : '4')
    })
    setModalType('corretor')
    setShowModal(true)
  }

  const resetVendaForm = () => {
    setVendaForm({
      corretor_id: '',
      valor_venda: '',
      tipo_corretor: 'externo',
      data_venda: new Date().toISOString().split('T')[0],
      descricao: '',
      status: 'pendente'
    })
  }

  const resetCorretorForm = () => {
    setCorretorForm({
      nome: '',
      email: '',
      senha: '',
      tipo_corretor: 'externo',
      telefone: '',
      percentual_corretor: '4'
    })
  }

  const openEditModal = (venda) => {
    setSelectedItem(venda)
    setVendaForm({
      corretor_id: venda.corretor_id,
      valor_venda: venda.valor_venda.toString(),
      tipo_corretor: venda.tipo_corretor,
      data_venda: venda.data_venda,
      descricao: venda.descricao || '',
      status: venda.status
    })
    setModalType('venda')
    setShowModal(true)
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
    setVendaForm({
      ...vendaForm, 
      corretor_id: corretorId,
      tipo_corretor: corretor?.tipo_corretor || 'externo'
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

      {/* Sidebar */}
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo">
            <img src={logo} alt="IM Incorporadora" className="logo-sidebar" />
            <span>IM Incorporadora</span>
          </div>
          <button className="close-menu" onClick={() => setMenuOpen(false)}>
            <X size={24} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <button 
            className={`nav-item ${activeTab === 'vendas' ? 'active' : ''}`}
            onClick={() => setActiveTab('vendas')}
          >
            <DollarSign size={20} />
            <span>Vendas</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'corretores' ? 'active' : ''}`}
            onClick={() => setActiveTab('corretores')}
          >
            <Users size={20} />
            <span>Corretores</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'relatorios' ? 'active' : ''}`}
            onClick={() => setActiveTab('relatorios')}
          >
            <TrendingUp size={20} />
            <span>Relatórios</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">
              <User size={20} />
            </div>
            <div className="user-details">
              <span className="user-name">{userProfile?.nome || 'Admin'}</span>
              <span className="user-role">Administrador</span>
            </div>
          </div>
          <button className="logout-btn" onClick={signOut}>
            <LogOut size={20} />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Header */}
        <header className="main-header">
          <button className="menu-toggle" onClick={() => setMenuOpen(true)}>
            <Menu size={24} />
          </button>
          <h1>
            {activeTab === 'vendas' && 'Gestão de Vendas'}
            {activeTab === 'corretores' && 'Corretores'}
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
          </div>
        </header>

        {/* Stats Cards */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon blue">
              <DollarSign size={24} />
            </div>
            <div className="stat-info">
              <span className="stat-label">Total em Vendas</span>
              <span className="stat-value">{formatCurrency(getTotalVendas())}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon gold">
              <Calculator size={24} />
            </div>
            <div className="stat-info">
              <span className="stat-label">Total Comissões</span>
              <span className="stat-value">{formatCurrency(getTotalComissoes())}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon green">
              <Users size={24} />
            </div>
            <div className="stat-info">
              <span className="stat-label">Corretores Ativos</span>
              <span className="stat-value">{corretores.length}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon purple">
              <Briefcase size={24} />
            </div>
            <div className="stat-info">
              <span className="stat-label">Vendas do Mês</span>
              <span className="stat-value">{vendas.length}</span>
            </div>
          </div>
        </div>

        {/* Content */}
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
                      <td colSpan="8" className="loading-cell">
                        <div className="loading-spinner"></div>
                      </td>
                    </tr>
                  ) : filteredVendas.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="empty-cell">
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
                            {venda.status === 'pago' ? 'Pago' : 'Pendente'}
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

        {activeTab === 'relatorios' && (
          <div className="content-section">
            <div className="relatorio-grid">
              <div className="relatorio-card">
                <h3>Distribuição de Comissões</h3>
                <div className="comissao-breakdown">
                  <div className="breakdown-item">
                    <span className="entity">Diretor</span>
                    <span className="percent">0,5%</span>
                    <span className="value">
                      {formatCurrency(vendas.reduce((acc, v) => acc + (v.comissao_diretor || 0), 0))}
                    </span>
                  </div>
                  <div className="breakdown-item">
                    <span className="entity">IM Figueira Garcia</span>
                    <span className="percent">0,5% - 1,25%</span>
                    <span className="value">
                      {formatCurrency(vendas.reduce((acc, v) => acc + (v.comissao_nohros_imobiliaria || 0), 0))}
                    </span>
                  </div>
                  <div className="breakdown-item">
                    <span className="entity">Ferretti Consultoria</span>
                    <span className="percent">1%</span>
                    <span className="value">
                      {formatCurrency(vendas.reduce((acc, v) => acc + (v.comissao_nohros_gestao || 0), 0))}
                    </span>
                  </div>
                  <div className="breakdown-item">
                    <span className="entity">Beton Arme</span>
                    <span className="percent">0,5% - 1,25%</span>
                    <span className="value">
                      {formatCurrency(vendas.reduce((acc, v) => acc + (v.comissao_wsc || 0), 0))}
                    </span>
                  </div>
                  <div className="breakdown-item">
                    <span className="entity">Coordenadora</span>
                    <span className="percent">0,5%</span>
                    <span className="value">
                      {formatCurrency(vendas.reduce((acc, v) => acc + (v.comissao_coordenadora || 0), 0))}
                    </span>
                  </div>
                  <div className="breakdown-item highlight">
                    <span className="entity">Corretores</span>
                    <span className="percent">Personalizado</span>
                    <span className="value">
                      {formatCurrency(vendas.reduce((acc, v) => acc + (v.comissao_corretor || 0), 0))}
                    </span>
                  </div>
                </div>
              </div>

              <div className="relatorio-card">
                <h3>Tabela de Percentuais Base</h3>
                <div className="percentuais-table">
                  <div className="percentuais-header">
                    <span></span>
                    <span>Externo</span>
                    <span>Interno</span>
                  </div>
                  <div className="percentuais-row">
                    <span>Diretor</span>
                    <span>0,5%</span>
                    <span>0,5%</span>
                  </div>
                  <div className="percentuais-row">
                    <span>IM Figueira Garcia</span>
                    <span>0,5%</span>
                    <span>1,25%</span>
                  </div>
                  <div className="percentuais-row">
                    <span>Ferretti Consultoria</span>
                    <span>1%</span>
                    <span>1%</span>
                  </div>
                  <div className="percentuais-row">
                    <span>Beton Arme</span>
                    <span>0,5%</span>
                    <span>1,25%</span>
                  </div>
                  <div className="percentuais-row">
                    <span>Corretor (padrão)</span>
                    <span>4%</span>
                    <span>2,5%</span>
                  </div>
                  <div className="percentuais-row">
                    <span>Coordenadora</span>
                    <span>0,5%</span>
                    <span>-</span>
                  </div>
                  <div className="percentuais-row total">
                    <span>Total (padrão)</span>
                    <span>7%</span>
                    <span>6,5%</span>
                  </div>
                </div>
                <p className="percentuais-note">
                  * O percentual do corretor pode ser personalizado individualmente
                </p>
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
                      <option value="">Selecione um corretor</option>
                      {corretores.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome} ({c.percentual_corretor || (c.tipo_corretor === 'interno' ? 2.5 : 4)}%)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Tipo do Corretor</label>
                    <select
                      value={vendaForm.tipo_corretor}
                      onChange={(e) => setVendaForm({...vendaForm, tipo_corretor: e.target.value})}
                    >
                      <option value="externo">Externo</option>
                      <option value="interno">Interno</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Valor da Venda *</label>
                    <input
                      type="number"
                      placeholder="Ex: 500000"
                      value={vendaForm.valor_venda}
                      onChange={(e) => setVendaForm({...vendaForm, valor_venda: e.target.value})}
                    />
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
                    <label>Descrição (Imóvel)</label>
                    <input
                      type="text"
                      placeholder="Ex: Apartamento 3 quartos - Centro"
                      value={vendaForm.descricao}
                      onChange={(e) => setVendaForm({...vendaForm, descricao: e.target.value})}
                    />
                  </div>
                  <div className="form-group">
                    <label>Status</label>
                    <select
                      value={vendaForm.status}
                      onChange={(e) => setVendaForm({...vendaForm, status: e.target.value})}
                    >
                      <option value="pendente">Pendente</option>
                      <option value="pago">Pago</option>
                    </select>
                  </div>

                  {vendaForm.valor_venda && vendaForm.corretor_id && (
                    <div className="preview-comissoes">
                      <h4>Prévia das Comissões</h4>
                      <div className="preview-grid">
                        <div className="preview-item">
                          <span>Corretor ({getCorretorPercentual(vendaForm.corretor_id)}%)</span>
                          <span>{formatCurrency(calcularComissoes(
                            parseFloat(vendaForm.valor_venda || 0), 
                            vendaForm.tipo_corretor,
                            getCorretorPercentual(vendaForm.corretor_id)
                          ).corretor)}</span>
                        </div>
                        <div className="preview-item">
                          <span>Total Comissões</span>
                          <span>{formatCurrency(calcularComissoes(
                            parseFloat(vendaForm.valor_venda || 0), 
                            vendaForm.tipo_corretor,
                            getCorretorPercentual(vendaForm.corretor_id)
                          ).total)}</span>
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
                  <div className="form-row">
                    <div className="form-group">
                      <label>Tipo de Corretor</label>
                      <select
                        value={corretorForm.tipo_corretor}
                        onChange={(e) => handleTipoCorretorChange(e.target.value)}
                      >
                        <option value="externo">Externo</option>
                        <option value="interno">Interno</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Percentual de Comissão (%)</label>
                      <div className="input-with-icon">
                        <Percent size={18} />
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          placeholder="Ex: 4"
                          value={corretorForm.percentual_corretor}
                          onChange={(e) => setCorretorForm({...corretorForm, percentual_corretor: e.target.value})}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Telefone</label>
                    <input
                      type="tel"
                      placeholder="(00) 00000-0000"
                      value={corretorForm.telefone}
                      onChange={(e) => setCorretorForm({...corretorForm, telefone: e.target.value})}
                    />
                  </div>
                  
                  <div className="info-box">
                    <p>
                      <strong>Percentuais padrão:</strong><br/>
                      Externo: 4% | Interno: 2,5%<br/>
                      <small>Você pode definir um percentual personalizado para este corretor.</small>
                    </p>
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
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminDashboard
