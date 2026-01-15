import { useState, useEffect } from 'react'
import { 
  syncCompleto, 
  apenasIngestaoRaw, 
  apenasSyncCore,
  getEstatisticas,
  getVendasNaoSincronizadas
} from '../services/sienge/syncOrchestrator'
import { RefreshCw, CheckCircle, XCircle, AlertCircle, Database, Users, FileText, TrendingUp } from 'lucide-react'
import '../styles/SincronizarSienge.css'

const SincronizarSiengeV2 = () => {
  const [sincronizando, setSincronizando] = useState(false)
  const [progresso, setProgresso] = useState(null)
  const [resultado, setResultado] = useState(null)
  const [erro, setErro] = useState(null)
  const [logs, setLogs] = useState([])
  const [estatisticas, setEstatisticas] = useState(null)
  const [vendasPendentes, setVendasPendentes] = useState([])
  const [modoOperacao, setModoOperacao] = useState('completo') // completo | raw | core | dryrun

  // Carregar estatísticas ao montar
  useEffect(() => {
    carregarEstatisticas()
  }, [])

  const carregarEstatisticas = async () => {
    try {
      const stats = await getEstatisticas()
      setEstatisticas(stats)
      
      const pendentes = await getVendasNaoSincronizadas()
      setVendasPendentes(pendentes.slice(0, 10)) // Mostrar apenas 10
    } catch (error) {
      console.error('Erro ao carregar estatísticas:', error)
    }
  }

  const adicionarLog = (mensagem, tipo = 'info') => {
    const timestamp = new Date().toLocaleTimeString('pt-BR')
    setLogs(prev => [...prev, { timestamp, mensagem, tipo }])
  }

  const limparLogs = () => {
    setLogs([])
    setResultado(null)
    setErro(null)
    setProgresso(null)
  }

  const executarSincronizacao = async () => {
    setSincronizando(true)
    setErro(null)
    setResultado(null)
    setProgresso(null)
    limparLogs()

    const modoTexto = {
      'completo': 'COMPLETO (RAW + Core)',
      'raw': 'APENAS RAW (Ingestão)',
      'core': 'APENAS CORE (Sync)',
      'dryrun': 'DRY RUN (Simulação)'
    }[modoOperacao]

    adicionarLog(`Iniciando sincronização: ${modoTexto}`, 'info')
    adicionarLog('⚠️ IMPORTANTE: Sync NÃO usa Supabase Auth (sem rate limit)', 'warning')

    try {
      let stats = null

      const onProgress = (info) => {
        setProgresso(info)
        if (info.mensagem) {
          adicionarLog(info.mensagem, 'info')
        }
        if (info.item) {
          adicionarLog(`  → ${info.item} (${info.current}/${info.total})`, 'info')
        }
      }

      switch (modoOperacao) {
        case 'completo':
          stats = await syncCompleto({ onProgress, dryRun: false })
          break
        case 'raw':
          stats = await apenasIngestaoRaw({ onProgress })
          break
        case 'core':
          stats = await apenasSyncCore({ onProgress, dryRun: false })
          break
        case 'dryrun':
          stats = await syncCompleto({ onProgress, dryRun: true })
          break
      }

      setResultado(stats)
      
      // Logs de resultado
      if (stats.metricas) {
        adicionarLog(`✅ RAW: ${stats.metricas.raw?.creditors || 0} corretores, ${stats.metricas.raw?.customers || 0} clientes, ${stats.metricas.raw?.contracts || 0} contratos`, 'success')
        adicionarLog(`✅ Core: ${stats.metricas.core?.corretores || 0} corretores, ${stats.metricas.core?.clientes || 0} clientes, ${stats.metricas.core?.vendas || 0} vendas`, 'success')
        if (stats.metricas.core?.pagamentos > 0) {
          adicionarLog(`💰 Pagamentos Pro-Soluto: ${stats.metricas.core?.pagamentos} parcelas criadas`, 'success')
        }
      }

      if (stats.erros && stats.erros.length > 0) {
        stats.erros.forEach(e => adicionarLog(`⚠️ ${e}`, 'warning'))
      }

      adicionarLog('Sincronização concluída!', 'success')
      
      // Recarregar estatísticas
      await carregarEstatisticas()

    } catch (error) {
      console.error('Erro na sincronização:', error)
      setErro(error.message || 'Erro desconhecido')
      adicionarLog(`❌ Erro: ${error.message}`, 'error')
    } finally {
      setSincronizando(false)
      setProgresso(null)
    }
  }

  return (
    <div className="sincronizar-sienge">
      <div className="sincronizar-header">
        <h2>Sincronização Sienge V2</h2>
        <p className="subtitle">RAW-first + Sync sem Auth (sem rate limit)</p>
      </div>

      {/* Estatísticas */}
      {estatisticas && (
        <div className="stats-grid">
          <div className="stat-card">
            <Database size={24} />
            <div className="stat-content">
              <h4>RAW (Sienge)</h4>
              <p>{estatisticas.raw.creditors} corretores</p>
              <p>{estatisticas.raw.customers} clientes</p>
              <p>{estatisticas.raw.contracts} contratos</p>
            </div>
          </div>
          
          <div className="stat-card">
            <Users size={24} />
            <div className="stat-content">
              <h4>Core (Supabase)</h4>
              <p>{estatisticas.core.corretores} corretores</p>
              <p>{estatisticas.core.clientes} clientes</p>
              <p>{estatisticas.core.vendas} vendas</p>
            </div>
          </div>
          
          <div className="stat-card">
            <TrendingUp size={24} />
            <div className="stat-content">
              <h4>Cobertura</h4>
              <p>Corretores: {estatisticas.cobertura.corretores}%</p>
              <p>Clientes: {estatisticas.cobertura.clientes}%</p>
              <p>Vendas: {estatisticas.cobertura.vendas}%</p>
            </div>
          </div>
        </div>
      )}

      {/* Modo de Operação */}
      <div className="modos-operacao">
        <h4>Modo de Operação</h4>
        <div className="modo-options">
          <label className={modoOperacao === 'completo' ? 'selected' : ''}>
            <input
              type="radio"
              name="modo"
              value="completo"
              checked={modoOperacao === 'completo'}
              onChange={(e) => setModoOperacao(e.target.value)}
              disabled={sincronizando}
            />
            <span>🚀 Completo (RAW + Core)</span>
          </label>
          
          <label className={modoOperacao === 'raw' ? 'selected' : ''}>
            <input
              type="radio"
              name="modo"
              value="raw"
              checked={modoOperacao === 'raw'}
              onChange={(e) => setModoOperacao(e.target.value)}
              disabled={sincronizando}
            />
            <span>📥 Apenas RAW (Ingestão)</span>
          </label>
          
          <label className={modoOperacao === 'core' ? 'selected' : ''}>
            <input
              type="radio"
              name="modo"
              value="core"
              checked={modoOperacao === 'core'}
              onChange={(e) => setModoOperacao(e.target.value)}
              disabled={sincronizando}
            />
            <span>🔄 Apenas Core (Sync)</span>
          </label>
          
          <label className={modoOperacao === 'dryrun' ? 'selected' : ''}>
            <input
              type="radio"
              name="modo"
              value="dryrun"
              checked={modoOperacao === 'dryrun'}
              onChange={(e) => setModoOperacao(e.target.value)}
              disabled={sincronizando}
            />
            <span>🧪 Dry Run (Simulação)</span>
          </label>
        </div>
      </div>

      {/* Botão de ação */}
      <div className="sync-buttons">
        <button
          onClick={executarSincronizacao}
          disabled={sincronizando}
          className="btn-sync btn-todos"
        >
          <RefreshCw size={18} className={sincronizando ? 'spinning' : ''} />
          {sincronizando ? 'Sincronizando...' : 'Executar Sincronização'}
        </button>
        
        <button
          onClick={carregarEstatisticas}
          disabled={sincronizando}
          className="btn-sync btn-clientes"
        >
          <TrendingUp size={18} />
          Atualizar Estatísticas
        </button>
      </div>

      {/* Progresso */}
      {sincronizando && progresso && (
        <div className="progress-container">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{
                width: progresso.total 
                  ? `${(progresso.current / progresso.total) * 100}%`
                  : '0%'
              }}
            />
          </div>
          <p className="progress-text">
            {progresso.etapa && `${progresso.etapa.toUpperCase()}: `}
            {progresso.mensagem || `${progresso.current || 0} / ${progresso.total || 0}`}
          </p>
        </div>
      )}

      {/* Resultado */}
      {resultado && (
        <div className={`resultado-container ${resultado.status === 'OK' ? 'success' : resultado.status === 'PARTIAL' ? 'warning' : 'error'}`}>
          {resultado.status === 'OK' ? <CheckCircle size={20} /> : 
           resultado.status === 'PARTIAL' ? <AlertCircle size={20} /> : <XCircle size={20} />}
          <div>
            <h3>Sincronização {resultado.status === 'OK' ? 'Concluída' : resultado.status === 'PARTIAL' ? 'Parcial' : 'com Erros'}</h3>
            {resultado.metricas && (
              <div className="stats-individual">
                <p><strong>RAW:</strong> {resultado.metricas.raw?.contracts || 0} contratos ingeridos</p>
                <p><strong>Core:</strong> {resultado.metricas.core?.vendas || 0} vendas sincronizadas</p>
                <p><strong>💰 Pagamentos:</strong> {resultado.metricas.core?.pagamentos || 0} parcelas pro-soluto criadas</p>
                {resultado.metricas.raw?.contracts > 0 && (
                  <p><strong>Taxa:</strong> {((resultado.metricas.core?.vendas / resultado.metricas.raw?.contracts) * 100).toFixed(1)}%</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Erro */}
      {erro && (
        <div className="resultado-container error">
          <XCircle size={20} />
          <div>
            <h3>Erro na Sincronização</h3>
            <p>{erro}</p>
          </div>
        </div>
      )}

      {/* Vendas Pendentes */}
      {vendasPendentes.length > 0 && (
        <div className="vendas-pendentes">
          <h4>⚠️ Vendas não sincronizadas (primeiras 10)</h4>
          <table>
            <thead>
              <tr>
                <th>ID Sienge</th>
                <th>Número</th>
                <th>Valor</th>
                <th>Cliente</th>
                <th>Corretor ID</th>
              </tr>
            </thead>
            <tbody>
              {vendasPendentes.map((v, i) => (
                <tr key={i}>
                  <td>{v.sienge_id}</td>
                  <td>{v.numero || '-'}</td>
                  <td>R$ {v.valor?.toLocaleString('pt-BR') || '-'}</td>
                  <td>{v.cliente || '-'}</td>
                  <td>{v.corretor_id || '❌ Sem corretor'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Logs */}
      {logs.length > 0 && (
        <div className="logs-container">
          <div className="logs-header">
            <h3>Logs</h3>
            <button onClick={limparLogs} className="btn-limpar-logs">
              Limpar
            </button>
          </div>
          <div className="logs-content">
            {logs.map((log, index) => (
              <div key={index} className={`log-item log-${log.tipo}`}>
                <span className="log-time">{log.timestamp}</span>
                <span className="log-message">{log.mensagem}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Aviso importante */}
      <div className="aviso-importante">
        <AlertCircle size={18} />
        <div>
          <strong>Arquitetura V2 - RAW-first:</strong>
          <ul>
            <li>✅ 100% dos dados do Sienge são salvos no RAW (nunca perde)</li>
            <li>✅ Sync para Core NÃO usa Supabase Auth (sem rate limit 429)</li>
            <li>✅ Corretores são criados com UUID gerado no banco</li>
            <li>✅ Placeholders criados automaticamente para dependências</li>
            <li>✅ Upsert por Sienge ID (sem duplicatas)</li>
            <li>💰 <strong>Pagamentos Pro-Soluto:</strong> AT=Sinal, PM=Entrada, BA=Balão → parcelas com comissão</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default SincronizarSiengeV2
