import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { 
  DollarSign, TrendingUp, Users, Target, 
  BarChart3, PieChart, Award, Activity,
  ArrowUpRight, ArrowDownRight, Calendar,
  Building2, Wallet, CheckCircle2, Clock
} from 'lucide-react'
import Ticker from '../components/Ticker'
import '../styles/HomeDashboard.css'

const HomeDashboard = ({ showTicker = true, showHeader = true }) => {
  const { userProfile } = useAuth()
  const [periodo, setPeriodo] = useState('mes')

  // Dados estáticos para demonstração
  const statsData = {
    vendasTotal: 18750000,
    vendasMes: 2450000,
    comissoesPendentes: 156800,
    comissoesPagas: 892000,
    corretoresAtivos: 24,
    vendasHoje: 485000,
    metaMensal: 78,
    leadsNovos: 12
  }

  const vendasMensais = [
    { mes: 'Jan', valor: 1800000 },
    { mes: 'Fev', valor: 2100000 },
    { mes: 'Mar', valor: 1950000 },
    { mes: 'Abr', valor: 2300000 },
    { mes: 'Mai', valor: 2450000 },
    { mes: 'Jun', valor: 2200000 }
  ]

  const distribuicaoComissoes = [
    { tipo: 'Corretor Externo', valor: 65, cor: '#4ade80' },
    { tipo: 'Corretor Interno', valor: 25, cor: '#60a5fa' },
    { tipo: 'Gerente', valor: 7, cor: '#facc15' },
    { tipo: 'Diretor', valor: 3, cor: '#a78bfa' }
  ]

  const topCorretores = [
    { nome: 'João Silva', vendas: 12, valor: 5820000, posicao: 1 },
    { nome: 'Maria Santos', vendas: 10, valor: 4850000, posicao: 2 },
    { nome: 'Pedro Costa', vendas: 9, valor: 4365000, posicao: 3 },
    { nome: 'Ana Oliveira', vendas: 8, valor: 3880000, posicao: 4 },
    { nome: 'Carlos Souza', vendas: 7, valor: 3395000, posicao: 5 }
  ]

  const vendasRecentes = [
    { id: 1, cliente: 'Residencial Vista Verde', valor: 485000, data: '2024-01-15', status: 'pago' },
    { id: 2, cliente: 'Apartamento Centro', valor: 320000, data: '2024-01-14', status: 'pendente' },
    { id: 3, cliente: 'Casa Jardim', valor: 650000, data: '2024-01-13', status: 'pago' },
    { id: 4, cliente: 'Condomínio Premium', valor: 780000, data: '2024-01-12', status: 'pendente' },
    { id: 5, cliente: 'Terreno Comercial', valor: 420000, data: '2024-01-11', status: 'pago' }
  ]

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value)
  }

  const maxVendas = Math.max(...vendasMensais.map(v => v.valor))

  return (
    <div className="home-dashboard">
      {showTicker && <Ticker />}
      
      <div className="dashboard-wrapper">
        {showHeader && (
          <div className="dashboard-header">
            <div className="header-content">
              <h1>Dashboard Executivo</h1>
              <p className="header-subtitle">Visão geral do desempenho do sistema</p>
            </div>
            <div className="header-actions">
              <select 
                className="period-select"
                value={periodo}
                onChange={(e) => setPeriodo(e.target.value)}
              >
                <option value="hoje">Hoje</option>
                <option value="semana">Esta Semana</option>
                <option value="mes">Este Mês</option>
                <option value="ano">Este Ano</option>
              </select>
            </div>
          </div>
        )}

        {/* Cards de Estatísticas */}
        <div className="stats-grid">
          <div className="stat-card primary">
            <div className="stat-icon">
              <DollarSign size={24} />
            </div>
            <div className="stat-content">
              <span className="stat-label">Total em Vendas</span>
              <span className="stat-value">{formatCurrency(statsData.vendasTotal)}</span>
              <div className="stat-change positive">
                <ArrowUpRight size={14} />
                <span>+8.2% vs mês anterior</span>
              </div>
            </div>
          </div>

          <div className="stat-card success">
            <div className="stat-icon">
              <TrendingUp size={24} />
            </div>
            <div className="stat-content">
              <span className="stat-label">Vendas Este Mês</span>
              <span className="stat-value">{formatCurrency(statsData.vendasMes)}</span>
              <div className="stat-change positive">
                <ArrowUpRight size={14} />
                <span>+12.5% vs mês anterior</span>
              </div>
            </div>
          </div>

          <div className="stat-card warning">
            <div className="stat-icon">
              <Clock size={24} />
            </div>
            <div className="stat-content">
              <span className="stat-label">Comissões Pendentes</span>
              <span className="stat-value">{formatCurrency(statsData.comissoesPendentes)}</span>
              <div className="stat-change negative">
                <ArrowDownRight size={14} />
                <span>-3.2% vs mês anterior</span>
              </div>
            </div>
          </div>

          <div className="stat-card info">
            <div className="stat-icon">
              <CheckCircle2 size={24} />
            </div>
            <div className="stat-content">
              <span className="stat-label">Comissões Pagas</span>
              <span className="stat-value">{formatCurrency(statsData.comissoesPagas)}</span>
              <div className="stat-change positive">
                <ArrowUpRight size={14} />
                <span>+15.8% vs mês anterior</span>
              </div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon">
              <Users size={24} />
            </div>
            <div className="stat-content">
              <span className="stat-label">Corretores Ativos</span>
              <span className="stat-value">{statsData.corretoresAtivos}</span>
              <div className="stat-change positive">
                <ArrowUpRight size={14} />
                <span>+2 este mês</span>
              </div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon">
              <Target size={24} />
            </div>
            <div className="stat-content">
              <span className="stat-label">Meta Mensal</span>
              <span className="stat-value">{statsData.metaMensal}%</span>
              <div className="stat-change positive">
                <ArrowUpRight size={14} />
                <span>+4% vs semana anterior</span>
              </div>
            </div>
          </div>
        </div>

        {/* Grid de Gráficos e Tabelas */}
        <div className="dashboard-grid">
          {/* Gráfico de Vendas Mensais */}
          <div className="chart-card">
            <div className="chart-header">
              <div className="chart-title">
                <BarChart3 size={20} />
                <h3>Vendas Mensais</h3>
              </div>
              <span className="chart-subtitle">Últimos 6 meses</span>
            </div>
            <div className="chart-container">
              <div className="bar-chart">
                {vendasMensais.map((item, index) => {
                  const height = (item.valor / maxVendas) * 100
                  return (
                    <div key={index} className="bar-wrapper">
                      <div 
                        className="bar" 
                        style={{ height: `${height}%` }}
                        title={formatCurrency(item.valor)}
                      >
                        <span className="bar-value">{formatCurrency(item.valor / 1000)}k</span>
                      </div>
                      <span className="bar-label">{item.mes}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Gráfico de Distribuição */}
          <div className="chart-card">
            <div className="chart-header">
              <div className="chart-title">
                <PieChart size={20} />
                <h3>Distribuição de Comissões</h3>
              </div>
              <span className="chart-subtitle">Por tipo de corretor</span>
            </div>
            <div className="chart-container">
              <div className="pie-chart-container">
                <div className="pie-chart">
                  {distribuicaoComissoes.map((item, index, array) => {
                    const startPercent = array.slice(0, index).reduce((acc, i) => acc + i.valor, 0)
                    const endPercent = startPercent + item.valor
                    return (
                      <div
                        key={index}
                        className="pie-segment"
                        style={{
                          background: `conic-gradient(from ${startPercent * 3.6}deg, ${item.cor} 0deg ${item.valor * 3.6}deg, transparent ${item.valor * 3.6}deg)`
                        }}
                      />
                    )
                  })}
                  <div className="pie-center">
                    <span className="pie-total">100%</span>
                  </div>
                </div>
              </div>
              <div className="pie-legend">
                {distribuicaoComissoes.map((item, index) => (
                  <div key={index} className="legend-item">
                    <div className="legend-color" style={{ background: item.cor }} />
                    <span className="legend-label">{item.tipo}</span>
                    <span className="legend-value">{item.valor}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Grid de Tabelas */}
        <div className="dashboard-grid">
          {/* Top Corretores */}
          <div className="table-card">
            <div className="table-header">
              <div className="table-title">
                <Award size={20} />
                <h3>Top Corretores</h3>
              </div>
              <button className="btn-view-all">Ver Todos</button>
            </div>
            <div className="table-content">
              <div className="ranking-list">
                {topCorretores.map((corretor) => (
                  <div key={corretor.posicao} className="ranking-item">
                    <div className="ranking-position">
                      {corretor.posicao <= 3 ? (
                        <Award size={18} className="top-three" />
                      ) : (
                        <span className="position-number">#{corretor.posicao}</span>
                      )}
                    </div>
                    <div className="ranking-info">
                      <span className="ranking-name">{corretor.nome}</span>
                      <div className="ranking-stats">
                        <span>{corretor.vendas} vendas</span>
                      </div>
                    </div>
                    <div className="ranking-value">{formatCurrency(corretor.valor)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Vendas Recentes */}
          <div className="table-card">
            <div className="table-header">
              <div className="table-title">
                <Activity size={20} />
                <h3>Vendas Recentes</h3>
              </div>
              <button className="btn-view-all">Ver Todas</button>
            </div>
            <div className="table-content">
              <div className="recent-list">
                {vendasRecentes.map((venda) => (
                  <div key={venda.id} className="recent-item">
                    <div className="recent-icon">
                      <Building2 size={18} />
                    </div>
                    <div className="recent-info">
                      <span className="recent-title">{venda.cliente}</span>
                      <div className="recent-meta">
                        <Calendar size={12} />
                        <span>{new Date(venda.data).toLocaleDateString('pt-BR')}</span>
                      </div>
                    </div>
                    <div className="recent-details">
                      <span className="recent-value">{formatCurrency(venda.valor)}</span>
                      <span className={`status-badge ${venda.status}`}>
                        {venda.status === 'pago' ? (
                          <>
                            <CheckCircle2 size={12} />
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
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default HomeDashboard

