import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { 
  DollarSign, TrendingUp, LogOut, 
  Calendar, User, CheckCircle, Clock, 
  Wallet, Target, Award, BarChart3
} from 'lucide-react'
import logo from '../imgs/logo.png'
import '../styles/Dashboard.css'
import '../styles/CorretorDashboard.css'

const CorretorDashboard = () => {
  const { user, userProfile, signOut } = useAuth()
  const [vendas, setVendas] = useState([])
  const [loading, setLoading] = useState(true)
  const [periodo, setPeriodo] = useState('todos')

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

  return (
    <div className="corretor-dashboard">
      {/* Header */}
      <header className="corretor-header">
        <div className="header-left">
          <div className="logo">
            <img src={logo} alt="IM Incorporadora" className="logo-header" />
            <span>IM Incorporadora</span>
          </div>
        </div>
        <div className="header-right">
          <div className="user-info-header">
            <div className="user-avatar-small">
              {userProfile?.nome?.charAt(0) || 'C'}
            </div>
            <span className="user-name-header">{userProfile?.nome || 'Corretor'}</span>
          </div>
          <button className="logout-btn-header" onClick={signOut}>
            <LogOut size={20} />
          </button>
        </div>
      </header>

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

      {/* Vendas List */}
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

      {/* Footer */}
      <footer className="corretor-footer">
        <p>IM Incorporadora - Sistema de Comissões</p>
      </footer>
    </div>
  )
}

export default CorretorDashboard
