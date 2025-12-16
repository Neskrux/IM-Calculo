import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import '../styles/Ticker.css'

const Ticker = ({ data = null }) => {
  // Dados estáticos para demonstração
  const staticData = [
    { name: 'VENDAS HOJE', value: 'R$ 2.450.000', change: '+12.5%', type: 'positive' },
    { name: 'COMISSÕES PENDENTES', value: 'R$ 156.800', change: '-3.2%', type: 'negative' },
    { name: 'TOTAL EM VENDAS', value: 'R$ 18.750.000', change: '+8.1%', type: 'positive' },
    { name: 'CORRETORES ATIVOS', value: '24', change: '+2', type: 'positive' },
    { name: 'MÉDIA POR VENDA', value: 'R$ 485.000', change: '+5.3%', type: 'positive' },
    { name: 'PAGAMENTOS HOJE', value: 'R$ 89.200', change: '0%', type: 'neutral' },
    { name: 'META MENSAL', value: '78%', change: '+4%', type: 'positive' },
    { name: 'LEADS NOVOS', value: '12', change: '+3', type: 'positive' }
  ]

  const tickerData = data || staticData
  
  // Duplicar dados para scroll infinito
  const duplicatedData = [...tickerData, ...tickerData]

  const formatChange = (change, type) => {
    // Se não houver change ou for vazio, não mostrar nada
    if (!change || change === '' || change === '0%' || change === '0') {
      return null
    }
    
    if (type === 'neutral') {
      return (
        <span className="ticker-change neutral">
          <Minus size={10} />
          {change}
        </span>
      )
    }
    
    if (type === 'positive') {
      return (
        <span className="ticker-change positive">
          <TrendingUp size={10} />
          {change}
        </span>
      )
    }
    
    return (
      <span className="ticker-change negative">
        <TrendingDown size={10} />
        {change}
      </span>
    )
  }

  return (
    <div className="ticker-container">
      <div className="ticker-label">
        <TrendingUp size={12} />
        <span>Mercado</span>
      </div>
      <div className="ticker-content">
        <div className="ticker-scroll">
          {duplicatedData.map((item, index) => (
            <div key={index} className="ticker-item">
              <span className="ticker-name">{item.name}</span>
              <span className={`ticker-value ${item.type}`}>{item.value}</span>
              {formatChange(item.change, item.type)}
              <span className="ticker-separator">•</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Ticker

