import { useState, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { 
  DollarSign, TrendingUp, Users, Target, 
  BarChart3, PieChart, Award, Activity,
  ArrowUpRight, ArrowDownRight, Calendar,
  Building2, Wallet, CheckCircle2, Clock
} from 'lucide-react'
import Ticker from '../components/Ticker'
import '../styles/HomeDashboard.css'

const HomeDashboard = ({ 
  showTicker = true, 
  showHeader = true,
  vendas = [],
  corretores = [],
  pagamentos = [],
  empreendimentos = []
}) => {
  const { userProfile } = useAuth()
  const [periodo, setPeriodo] = useState('mes')

  // Calcular estatísticas reais
  const statsData = useMemo(() => {
    const hoje = new Date()
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
    const inicioMesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)
    const fimMesAnterior = new Date(hoje.getFullYear(), hoje.getMonth(), 0, 23, 59, 59, 999)
    const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 0, 0, 0, 0)
    const fimHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59, 999)

    // Total de vendas
    const vendasTotal = vendas.reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)

    // Vendas do mês atual
    const vendasMes = vendas
      .filter(v => {
        const dataVenda = new Date(v.data_venda)
        return dataVenda >= inicioMes
      })
      .reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)

    // Vendas do mês anterior
    const vendasMesAnterior = vendas
      .filter(v => {
        const dataVenda = new Date(v.data_venda)
        return dataVenda >= inicioMesAnterior && dataVenda <= fimMesAnterior
      })
      .reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)

    // Vendas de hoje
    const vendasHoje = vendas
      .filter(v => {
        const dataVenda = new Date(v.data_venda)
        return dataVenda >= inicioHoje && dataVenda <= fimHoje
      })
      .reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)

    // Comissões pendentes (pagamentos com status pendente)
    const comissoesPendentes = pagamentos
      .filter(p => p.status === 'pendente')
      .reduce((acc, p) => acc + (parseFloat(p.comissao_gerada) || 0), 0)

    // Comissões pagas
    const comissoesPagas = pagamentos
      .filter(p => p.status === 'pago')
      .reduce((acc, p) => acc + (parseFloat(p.comissao_gerada) || 0), 0)

    // Comissões do mês anterior (para comparação)
    const comissoesPendentesMesAnterior = pagamentos
      .filter(p => {
        const dataPag = new Date(p.created_at || p.data_prevista)
        return p.status === 'pendente' && dataPag >= inicioMesAnterior && dataPag <= fimMesAnterior
      })
      .reduce((acc, p) => acc + (parseFloat(p.comissao_gerada) || 0), 0)

    // Corretores ativos (com vendas)
    const corretoresComVendas = new Set(vendas.map(v => v.corretor_id))
    const corretoresAtivos = corretoresComVendas.size

    // Calcular variação percentual
    const variacaoVendas = vendasMesAnterior > 0 
      ? ((vendasMes - vendasMesAnterior) / vendasMesAnterior) * 100 
      : 0

    const variacaoComissoesPendentes = comissoesPendentesMesAnterior > 0
      ? ((comissoesPendentes - comissoesPendentesMesAnterior) / comissoesPendentesMesAnterior) * 100
      : 0

    // Meta mensal (calculada como % do total de vendas do mês vs média mensal)
    const primeiraVenda = vendas.length > 0 ? new Date(vendas.sort((a, b) => new Date(a.data_venda) - new Date(b.data_venda))[0].data_venda) : hoje
    const diasDesdeInicio = Math.max(1, Math.ceil((hoje - primeiraVenda) / (1000 * 60 * 60 * 24)))
    const mesesDesdeInicio = Math.max(1, diasDesdeInicio / 30)
    const mediaMensal = vendasTotal / mesesDesdeInicio
    const metaMensal = mediaMensal > 0 ? Math.round((vendasMes / mediaMensal) * 100) : 0

    return {
      vendasTotal,
      vendasMes,
      vendasHoje,
      comissoesPendentes,
      comissoesPagas,
      corretoresAtivos,
      metaMensal: Math.min(metaMensal, 100),
      variacaoVendas: Math.round(variacaoVendas * 10) / 10,
      variacaoComissoesPendentes: Math.round(variacaoComissoesPendentes * 10) / 10
    }
  }, [vendas, pagamentos, corretores])

  // Calcular vendas mensais dos últimos 6 meses
  const vendasMensais = useMemo(() => {
    const meses = []
    const hoje = new Date()
    
    for (let i = 5; i >= 0; i--) {
      const data = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
      const mesInicio = new Date(data.getFullYear(), data.getMonth(), 1)
      const mesFim = new Date(data.getFullYear(), data.getMonth() + 1, 0, 23, 59, 59, 999)
      
      const valor = vendas
        .filter(v => {
          const dataVenda = new Date(v.data_venda)
          return dataVenda >= mesInicio && dataVenda <= mesFim
        })
        .reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)
      
      const nomesMeses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
      meses.push({
        mes: nomesMeses[data.getMonth()],
        valor
      })
    }
    
    return meses
  }, [vendas])

  // Calcular distribuição de comissões por tipo de corretor
  const distribuicaoComissoes = useMemo(() => {
    const externo = vendas
      .filter(v => v.tipo_corretor === 'externo')
      .reduce((acc, v) => acc + (parseFloat(v.comissao_total) || 0), 0)
    
    const interno = vendas
      .filter(v => v.tipo_corretor === 'interno')
      .reduce((acc, v) => acc + (parseFloat(v.comissao_total) || 0), 0)
    
    const total = externo + interno
    
    if (total === 0) {
      return [
        { tipo: 'Corretor Externo', valor: 0, cor: '#4ade80' },
        { tipo: 'Corretor Interno', valor: 0, cor: '#c9a962' }
      ]
    }

    return [
      { 
        tipo: 'Corretor Externo', 
        valor: Math.round((externo / total) * 100), 
        cor: '#4ade80' 
      },
      { 
        tipo: 'Corretor Interno', 
        valor: Math.round((interno / total) * 100), 
        cor: '#c9a962' 
      }
    ]
  }, [vendas])

  // Calcular top corretores
  const topCorretores = useMemo(() => {
    const corretoresMap = {}
    
    vendas.forEach(venda => {
      const corretorId = venda.corretor_id
      if (!corretorId) return
      
      if (!corretoresMap[corretorId]) {
        const corretor = corretores.find(c => c.id === corretorId)
        corretoresMap[corretorId] = {
          id: corretorId,
          nome: corretor?.nome || 'Corretor Desconhecido',
          vendas: 0,
          valor: 0
        }
      }
      
      corretoresMap[corretorId].vendas++
      corretoresMap[corretorId].valor += parseFloat(venda.valor_venda) || 0
    })
    
    return Object.values(corretoresMap)
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 5)
      .map((c, index) => ({
        ...c,
        posicao: index + 1
      }))
  }, [vendas, corretores])

  // Vendas recentes (últimas 5)
  const vendasRecentes = useMemo(() => {
    return vendas
      .sort((a, b) => new Date(b.data_venda) - new Date(a.data_venda))
      .slice(0, 5)
      .map(v => {
        const empreendimento = empreendimentos.find(e => e.id === v.empreendimento_id)
        const temPagamentoPago = pagamentos.some(p => p.venda_id === v.id && p.status === 'pago')
        
        return {
          id: v.id,
          cliente: v.nome_cliente || empreendimento?.nome || 'Cliente não informado',
          valor: parseFloat(v.valor_venda) || 0,
          data: v.data_venda,
          status: temPagamentoPago ? 'pago' : 'pendente'
        }
      })
  }, [vendas, empreendimentos, pagamentos])

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value)
  }

  const maxVendas = Math.max(...vendasMensais.map(v => v.valor), 1)

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
              {statsData.variacaoVendas !== 0 && (
                <div className={`stat-change ${statsData.variacaoVendas >= 0 ? 'positive' : 'negative'}`}>
                  {statsData.variacaoVendas >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                  <span>{statsData.variacaoVendas >= 0 ? '+' : ''}{statsData.variacaoVendas.toFixed(1)}% vs mês anterior</span>
                </div>
              )}
            </div>
          </div>

          <div className="stat-card success">
            <div className="stat-icon">
              <TrendingUp size={24} />
            </div>
            <div className="stat-content">
              <span className="stat-label">Vendas Este Mês</span>
              <span className="stat-value">{formatCurrency(statsData.vendasMes)}</span>
              {statsData.variacaoVendas !== 0 && (
                <div className={`stat-change ${statsData.variacaoVendas >= 0 ? 'positive' : 'negative'}`}>
                  {statsData.variacaoVendas >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                  <span>{statsData.variacaoVendas >= 0 ? '+' : ''}{statsData.variacaoVendas.toFixed(1)}% vs mês anterior</span>
                </div>
              )}
            </div>
          </div>

          <div className="stat-card warning">
            <div className="stat-icon">
              <Clock size={24} />
            </div>
            <div className="stat-content">
              <span className="stat-label">Comissões Pendentes</span>
              <span className="stat-value">{formatCurrency(statsData.comissoesPendentes)}</span>
              {statsData.variacaoComissoesPendentes !== 0 && (
                <div className={`stat-change ${statsData.variacaoComissoesPendentes >= 0 ? 'positive' : 'negative'}`}>
                  {statsData.variacaoComissoesPendentes >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                  <span>{statsData.variacaoComissoesPendentes >= 0 ? '+' : ''}{statsData.variacaoComissoesPendentes.toFixed(1)}% vs mês anterior</span>
                </div>
              )}
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
                <span>Total acumulado</span>
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
                <span>Com vendas registradas</span>
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
                <span>Progresso do mês</span>
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
                {distribuicaoComissoes.length > 0 ? (
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
                ) : (
                  <div className="pie-chart-empty">
                    <span>Sem dados</span>
                  </div>
                )}
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
              {topCorretores.length > 0 ? (
                <div className="ranking-list">
                  {topCorretores.map((corretor) => (
                    <div key={corretor.id} className="ranking-item">
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
                          <span>{corretor.vendas} {corretor.vendas === 1 ? 'venda' : 'vendas'}</span>
                        </div>
                      </div>
                      <div className="ranking-value">{formatCurrency(corretor.valor)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <span>Nenhum corretor com vendas registradas</span>
                </div>
              )}
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
              {vendasRecentes.length > 0 ? (
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
              ) : (
                <div className="empty-state">
                  <span>Nenhuma venda registrada</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default HomeDashboard

