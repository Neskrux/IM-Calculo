import { useState, useEffect, useRef, useCallback } from 'react'
import { 
  syncCompleto, 
  apenasIngestaoRaw, 
  apenasSyncCore,
  getEstatisticas,
  getVendasNaoSincronizadas,
  getLastSyncDate,
  setLastSyncDate
} from '../services/sienge/syncOrchestrator'
import { backfillConjuges } from '../services/sienge/backfillConjuges'
import { backfillUnidades } from '../services/sienge/backfillUnidades'
import { RefreshCw, CheckCircle, XCircle, AlertCircle, Database, Users, FileText, TrendingUp, Clock, Zap } from 'lucide-react'
import '../styles/SincronizarSienge.css'

// Intervalo de polling: 1 hora em milissegundos
const POLLING_INTERVAL = 60 * 60 * 1000 // 1 hora

const SincronizarSiengeV2 = () => {
  const [sincronizando, setSincronizando] = useState(false)
  const [progresso, setProgresso] = useState(null)
  const [resultado, setResultado] = useState(null)
  const [erro, setErro] = useState(null)
  const [logs, setLogs] = useState([])
  const [estatisticas, setEstatisticas] = useState(null)
  const [vendasPendentes, setVendasPendentes] = useState([])
  const [modoOperacao, setModoOperacao] = useState('completo') // completo | raw | core | dryrun
  const [modoIncremental, setModoIncremental] = useState(true) // true = incremental, false = completo
  const [lastSyncDateState, setLastSyncDateState] = useState(null)
  
  // Estados para polling automático
  const [ultimaSync, setUltimaSync] = useState(null)
  const [proximaSync, setProximaSync] = useState(null)
  const [tempoRestante, setTempoRestante] = useState(null)
  const pollingRef = useRef(null)
  const sincronizandoRef = useRef(false)
  
  // Estados para timer de sincronização
  const [tempoDecorrido, setTempoDecorrido] = useState(0)
  const [inicioSync, setInicioSync] = useState(null)
  const timerRef = useRef(null)

  // Função de sincronização automática (em background)
  const executarSyncAutomatica = useCallback(async () => {
    // Usar ref para evitar problemas de closure
    if (sincronizandoRef.current) {
      console.log('⏭️ [AUTO-SYNC] Sincronização já em andamento, pulando...')
      return
    }
    
    console.log('🔄 [AUTO-SYNC] Executando sincronização automática...')
    sincronizandoRef.current = true
    
    try {
      const stats = await syncCompleto({ dryRun: false })
      
      const agora = new Date()
      setUltimaSync(agora)
      localStorage.setItem('sienge_ultima_sync', agora.toISOString())
      
      console.log('✅ [AUTO-SYNC] Sincronização automática concluída:', stats.status)
    } catch (error) {
      console.error('❌ [AUTO-SYNC] Erro na sincronização automática:', error)
    } finally {
      sincronizandoRef.current = false
    }
  }, [])

  // Iniciar polling automático ao montar o componente
  useEffect(() => {
    // Carregar última sincronização
    const saved = localStorage.getItem('sienge_ultima_sync')
    if (saved) {
      setUltimaSync(new Date(saved))
    }
    
    // Carregar data da última sync incremental
    const lastSyncDate = getLastSyncDate()
    setLastSyncDateState(lastSyncDate)
    
    carregarEstatisticas()
    
    // Calcular próxima sync
    const calcularProximaSync = () => {
      const proxima = new Date(Date.now() + POLLING_INTERVAL)
      setProximaSync(proxima)
      return proxima
    }
    
    calcularProximaSync()
    
    // Iniciar polling automático (sempre ativo)
    console.log('▶️ [AUTO-SYNC] Polling automático iniciado - sincroniza a cada 1 hora')
    
    pollingRef.current = setInterval(() => {
      executarSyncAutomatica()
      calcularProximaSync()
    }, POLLING_INTERVAL)
    
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [executarSyncAutomatica])

  // Atualizar countdown a cada segundo
  useEffect(() => {
    if (!proximaSync) return
    
    const updateCountdown = () => {
      const diff = proximaSync.getTime() - Date.now()
      if (diff > 0) {
        const horas = Math.floor(diff / 3600000)
        const minutos = Math.floor((diff % 3600000) / 60000)
        const segundos = Math.floor((diff % 60000) / 1000)
        if (horas > 0) {
          setTempoRestante(`${horas}h ${minutos}m ${segundos}s`)
        } else if (minutos > 0) {
          setTempoRestante(`${minutos}m ${segundos}s`)
        } else {
          setTempoRestante(`${segundos}s`)
        }
      } else {
        setTempoRestante('Sincronizando...')
      }
    }
    
    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [proximaSync])

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
  
  const executarBackfillConjuges = async () => {
    if (!confirm('Isso irá criar cônjuges a partir dos clientes já sincronizados.\n\nDeseja continuar?')) {
      return
    }
    
    setSincronizando(true)
    setErro(null)
    setProgresso(null)
    adicionarLog('👫 Iniciando backfill de cônjuges...', 'info')
    
    try {
      const resultado = await backfillConjuges({
        dryRun: false,
        onProgress: (info) => {
          setProgresso(info)
          adicionarLog(`${info.current}/${info.total} - ${info.item}`, 'info')
        }
      })
      
      adicionarLog(`✅ Backfill concluído: ${resultado.criados} criados, ${resultado.jaExistentes} já existiam`, 'success')
      
      // Atualizar estatísticas
      await carregarEstatisticas()
      
    } catch (error) {
      console.error('Erro no backfill de cônjuges:', error)
      adicionarLog(`❌ Erro: ${error.message}`, 'error')
      setErro(error.message)
    } finally {
      setSincronizando(false)
      setProgresso(null)
    }
  }
  
  const executarBackfillUnidades = async () => {
    if (!confirm('Isso irá buscar unidades do Sienge e criar na tabela.\n\nDeseja continuar?')) {
      return
    }
    
    setSincronizando(true)
    setErro(null)
    setProgresso(null)
    adicionarLog('🏠 Iniciando backfill de unidades...', 'info')
    
    try {
      const resultado = await backfillUnidades({
        dryRun: false,
        onProgress: (info) => {
          setProgresso(info)
          adicionarLog(`${info.current}/${info.total} - ${info.item}`, 'info')
        }
      })
      
      adicionarLog(`✅ Backfill concluído: ${resultado.criadas} criadas, ${resultado.jaExistentes} já existiam`, 'success')
      
      // Atualizar estatísticas
      await carregarEstatisticas()
      
    } catch (error) {
      console.error('Erro no backfill de unidades:', error)
      adicionarLog(`❌ Erro: ${error.message}`, 'error')
      setErro(error.message)
    } finally {
      setSincronizando(false)
      setProgresso(null)
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
    
    // Iniciar timer
    const inicio = Date.now()
    setInicioSync(inicio)
    setTempoDecorrido(0)
    
    // Atualizar timer a cada segundo
    timerRef.current = setInterval(() => {
      setTempoDecorrido(Math.floor((Date.now() - inicio) / 1000))
    }, 1000)

    const incrementalTexto = modoIncremental && lastSyncDateState ? ` ⚡ INCREMENTAL (após ${lastSyncDateState})` : ' (COMPLETO - primeira sync)'
    const modoTexto = {
      'completo': `COMPLETO (RAW + Core)${incrementalTexto}`,
      'raw': 'APENAS RAW (Ingestão)',
      'core': 'APENAS CORE (Sync)',
      'dryrun': `DRY RUN (Simulação)${incrementalTexto}`
    }[modoOperacao]

    adicionarLog(`Iniciando sincronização: ${modoTexto}`, 'info')
    
    if (modoIncremental && lastSyncDateState) {
      adicionarLog(`⚡ Modo INCREMENTAL: buscando apenas dados modificados após ${lastSyncDateState}`, 'success')
    } else {
      adicionarLog(`📦 Modo COMPLETO: buscando todos os dados (primeira sync ou incremental desativado)`, 'warning')
    }
    
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
          stats = await syncCompleto({ onProgress, dryRun: false, incremental: modoIncremental })
          break
        case 'raw':
          stats = await apenasIngestaoRaw({ onProgress })
          break
        case 'core':
          stats = await apenasSyncCore({ onProgress, dryRun: false })
          break
        case 'dryrun':
          stats = await syncCompleto({ onProgress, dryRun: true, incremental: modoIncremental })
          break
      }

      setResultado(stats)
      
      // Atualizar data da última sync no estado
      const newLastSync = getLastSyncDate()
      setLastSyncDateState(newLastSync)
      
      // Logs de resultado
      if (stats.incremental) {
        adicionarLog(`⚡ Modo INCREMENTAL: buscou apenas dados modificados após ${stats.modifiedAfter}`, 'success')
      }
      
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
      
      // Salvar timestamp da última sync
      const agora = new Date()
      setUltimaSync(agora)
      localStorage.setItem('sienge_ultima_sync', agora.toISOString())
      
      // Recarregar estatísticas
      await carregarEstatisticas()

    } catch (error) {
      console.error('Erro na sincronização:', error)
      setErro(error.message || 'Erro desconhecido')
      adicionarLog(`❌ Erro: ${error.message}`, 'error')
    } finally {
      // Parar timer
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setSincronizando(false)
      setProgresso(null)
    }
  }
  
  // Formatar tempo em mm:ss
  const formatarTempo = (segundos) => {
    const mins = Math.floor(segundos / 60)
    const secs = segundos % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="sincronizar-sienge">
      <div className="sincronizar-header">
        <h2>Sincronização Sienge V2</h2>
        <p className="subtitle">RAW-first + Sync sem Auth (sem rate limit)</p>
      </div>

      {/* Status da Sincronização Automática */}
      <div className="polling-container" style={{
        background: 'rgba(16, 185, 129, 0.1)',
        border: '1px solid rgba(16, 185, 129, 0.3)',
        borderRadius: '12px',
        padding: '16px 20px',
        marginBottom: '24px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          {/* Indicador de status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: '#10b981',
              animation: 'pulse 2s infinite',
              boxShadow: '0 0 8px rgba(16, 185, 129, 0.5)'
            }} />
            <div>
              <span style={{ fontWeight: '600', color: '#10b981' }}>Sincronização Automática Ativa</span>
              <span style={{ color: 'rgba(255,255,255,0.5)', marginLeft: '8px', fontSize: '13px' }}>
                (atualiza a cada 1 hora)
              </span>
            </div>
          </div>
          
          {/* Info da última e próxima sync */}
          <div style={{ display: 'flex', gap: '24px', fontSize: '13px' }}>
            <div>
              <Clock size={14} style={{ marginRight: '6px', opacity: 0.6, verticalAlign: 'middle' }} />
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>Última: </span>
              <span style={{ fontWeight: '500' }}>
                {ultimaSync 
                  ? ultimaSync.toLocaleString('pt-BR', { 
                      day: '2-digit', 
                      month: '2-digit', 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })
                  : 'Nunca'
                }
              </span>
            </div>
            
            <div>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>Próxima em: </span>
              <span style={{ fontWeight: '600', color: '#fbbf24' }}>
                {tempoRestante || '-'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Estatísticas */}
      {estatisticas && (
        <div className="stats-grid">
          <div className="stat-card">
            <Database size={24} />
            <div className="stat-content">
              <h4>RAW (Sienge)</h4>
              <p>{estatisticas.raw.enterprises || 0} empreendimentos</p>
              <p>{estatisticas.raw.creditors} corretores</p>
              <p>{estatisticas.raw.customers} clientes</p>
              <p>{estatisticas.raw.contracts} contratos</p>
            </div>
          </div>
          
          <div className="stat-card">
            <Users size={24} />
            <div className="stat-content">
              <h4>Core (Supabase)</h4>
              <p>{estatisticas.core.empreendimentos || 0} empreendimentos</p>
              <p>{estatisticas.core.corretores} corretores</p>
              <p>{estatisticas.core.clientes} clientes</p>
              <p>{estatisticas.core.vendas} vendas</p>
            </div>
          </div>
          
          <div className="stat-card">
            <TrendingUp size={24} />
            <div className="stat-content">
              <h4>Cobertura</h4>
              <p>Empreendimentos: {estatisticas.cobertura.empreendimentos || 0}%</p>
              <p>Corretores: {estatisticas.cobertura.corretores}%</p>
              <p>Clientes: {estatisticas.cobertura.clientes}%</p>
              <p>Vendas: {estatisticas.cobertura.vendas}%</p>
            </div>
          </div>
        </div>
      )}

      {/* Modo Incremental Toggle */}
      <div style={{
        background: modoIncremental ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.05)',
        border: `1px solid ${modoIncremental ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
        borderRadius: '12px',
        padding: '16px 20px',
        marginBottom: '20px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Zap size={20} style={{ color: modoIncremental ? '#10b981' : '#94a3b8' }} />
            <div>
              <span style={{ fontWeight: '600' }}>
                {modoIncremental ? '⚡ Modo Incremental' : '📦 Modo Completo'}
              </span>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
                {modoIncremental 
                  ? `Busca apenas dados modificados após ${lastSyncDateState || 'primeira sync'}`
                  : 'Busca todos os dados do Sienge (mais lento)'
                }
              </p>
            </div>
          </div>
          
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={modoIncremental}
              onChange={(e) => setModoIncremental(e.target.checked)}
              disabled={sincronizando || !lastSyncDateState}
              style={{ 
                width: '44px', 
                height: '24px', 
                cursor: sincronizando ? 'not-allowed' : 'pointer',
                accentColor: '#10b981'
              }}
            />
          </label>
        </div>
        
        {!lastSyncDateState && (
          <p style={{ 
            margin: '12px 0 0', 
            padding: '8px 12px',
            background: 'rgba(251, 191, 36, 0.1)',
            border: '1px solid rgba(251, 191, 36, 0.3)',
            borderRadius: '6px',
            fontSize: '12px', 
            color: '#fbbf24' 
          }}>
            ⚠️ Primeira sincronização será completa. Após isso, as próximas serão incrementais automaticamente.
          </p>
        )}
      </div>

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
          style={{
            background: 'linear-gradient(135deg, #10b981, #059669)',
            fontSize: '16px',
            padding: '14px 28px'
          }}
        >
          <RefreshCw size={20} className={sincronizando ? 'spinning' : ''} />
          {sincronizando ? 'Sincronizando...' : '🚀 Sincronizar Agora'}
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
      
      {/* Botões de Backfill */}
      <div style={{ 
        display: 'flex', 
        gap: '12px', 
        marginBottom: '20px',
        flexWrap: 'wrap'
      }}>
        <button
          onClick={executarBackfillConjuges}
          disabled={sincronizando}
          className="btn-sync"
          style={{ 
            background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
            fontSize: '14px'
          }}
          title="Cria cônjuges a partir dos clientes já sincronizados"
        >
          <Users size={18} />
          Backfill Cônjuges
        </button>
        
        <button
          onClick={executarBackfillUnidades}
          disabled={sincronizando}
          className="btn-sync"
          style={{ 
            background: 'linear-gradient(135deg, #06b6d4, #0891b2)',
            fontSize: '14px'
          }}
          title="Busca e cria unidades dos empreendimentos do Sienge"
        >
          <Database size={18} />
          Backfill Unidades
        </button>
      </div>

      {/* Progresso */}
      {sincronizando && (
        <div className="progress-container" style={{ marginBottom: '20px' }}>
          {/* Timer e Estimativa */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '12px',
            padding: '12px 16px',
            background: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={18} style={{ color: '#3b82f6' }} />
              <span style={{ fontWeight: '600' }}>Tempo decorrido:</span>
              <span style={{ 
                fontFamily: 'monospace', 
                fontSize: '18px', 
                fontWeight: 'bold',
                color: '#3b82f6'
              }}>
                {formatarTempo(tempoDecorrido)}
              </span>
            </div>
            
            {progresso?.total > 0 && progresso?.current > 0 && (
              <div style={{ textAlign: 'right' }}>
                <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>Estimativa restante: </span>
                <span style={{ fontWeight: '600', color: '#fbbf24' }}>
                  {(() => {
                    const velocidade = progresso.current / tempoDecorrido // itens por segundo
                    const restante = progresso.total - progresso.current
                    const tempoRestanteEstimado = Math.ceil(restante / velocidade)
                    return tempoDecorrido > 5 ? `~${formatarTempo(tempoRestanteEstimado)}` : 'calculando...'
                  })()}
                </span>
              </div>
            )}
          </div>
          
          {/* Barra de progresso */}
          {progresso && (
            <>
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
                {progresso.total > 0 && ` (${Math.round((progresso.current / progresso.total) * 100)}%)`}
              </p>
            </>
          )}
          
          {!progresso && (
            <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>
              Iniciando sincronização...
            </p>
          )}
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
