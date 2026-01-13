import { useState } from 'react'
import { syncClientes, syncVendas, syncCorretores } from '../services/sienge'
import { RefreshCw, CheckCircle, XCircle, AlertCircle, Play, Square } from 'lucide-react'
import '../styles/SincronizarSienge.css'

const SincronizarSienge = () => {
  const [sincronizando, setSincronizando] = useState(false)
  const [tipoSync, setTipoSync] = useState(null) // 'clientes', 'vendas', 'corretores', 'todos'
  const [progresso, setProgresso] = useState(null)
  const [resultado, setResultado] = useState(null)
  const [erro, setErro] = useState(null)
  const [dryRun, setDryRun] = useState(true) // Modo teste por padrão
  const [validate, setValidate] = useState(true) // Modo validação: faz requisições reais mas não salva
  const [logs, setLogs] = useState([])

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

  const executarSincronizacao = async (tipo) => {
    setSincronizando(true)
    setTipoSync(tipo)
    setErro(null)
    setResultado(null)
    setProgresso(null)
    limparLogs()

    adicionarLog(`Iniciando sincronização de ${tipo}...`, 'info')
    
    // Determinar modo de operação
    let modoTexto = 'PRODUÇÃO'
    if (validate && dryRun) {
      modoTexto = 'VALIDAÇÃO (requisições reais, sem salvar)'
    } else if (dryRun) {
      modoTexto = 'TESTE (dry-run - sem requisições)'
    }
    adicionarLog(`Modo: ${modoTexto}`, 'warning')

    try {
      let stats = null

      const onProgress = (info) => {
        setProgresso(info)
        if (info.contract) {
          adicionarLog(`Processando contrato ${info.contract}... (${info.current}/${info.total})`, 'info')
        } else if (info.cliente) {
          adicionarLog(`Processando cliente ${info.cliente}... (${info.current}/${info.total})`, 'info')
        }
      }

      switch (tipo) {
        case 'corretores':
          adicionarLog('Buscando corretores do Sienge...', 'info')
          stats = await syncCorretores({
            enterpriseId: 2104, // Empreendimento FIGUEIRA GARCIA
            dryRun,
            validate, // Modo validação: faz requisições reais mas não salva
            onProgress
          })
          
          // Se modo validação, mostrar dados encontrados
          if (validate && stats.dadosValidados && stats.dadosValidados.length > 0) {
            adicionarLog(`✅ Encontrados ${stats.dadosValidados.length} corretores na API:`, 'success')
            stats.dadosValidados.forEach((item, idx) => {
              const dados = item.dados
              adicionarLog(
                `  ${idx + 1}. ID Sienge: ${item.siengeId} | Nome: ${dados.name || 'N/A'} | CPF: ${dados.cpf || 'N/A'} | Email: ${dados.email || 'N/A'}`,
                'info'
              )
            })
            adicionarLog('⚠️ Nenhum dado foi salvo no banco (modo validação)', 'warning')
          }
          break

        case 'clientes':
          adicionarLog('Buscando clientes do Sienge...', 'info')
          stats = await syncClientes({
            enterpriseId: 2104, // Empreendimento FIGUEIRA GARCIA
            modifiedAfter: null, // Sincronizar tudo por enquanto
            dryRun,
            onProgress
          })
          break

        case 'vendas':
          adicionarLog('Buscando contratos de venda do Sienge...', 'info')
          stats = await syncVendas({
            enterpriseId: 2104, // Empreendimento FIGUEIRA GARCIA
            modifiedAfter: null, // Sincronizar tudo por enquanto
            dryRun,
            onProgress
          })
          break

        case 'todos':
          adicionarLog('Iniciando sincronização completa...', 'info')
          
          // 1. Corretores primeiro (precisam existir para vincular nas vendas)
          adicionarLog('1/3: Sincronizando corretores...', 'info')
          const statsCorretores = await syncCorretores({
            enterpriseId: 2104, // Empreendimento FIGUEIRA GARCIA
            dryRun,
            validate,
            onProgress: (info) => setProgresso({ ...info, etapa: 'corretores' })
          })
          
          if (validate && statsCorretores.dadosValidados) {
            adicionarLog(`Corretores: ${statsCorretores.dadosValidados.length} encontrados na API`, 'success')
          } else {
            adicionarLog(`Corretores: ${statsCorretores.criados} criados`, 'success')
          }

          // 2. Clientes
          adicionarLog('2/3: Sincronizando clientes...', 'info')
          const statsClientes = await syncClientes({
            enterpriseId: 2104, // Empreendimento FIGUEIRA GARCIA
            dryRun,
            onProgress: (info) => setProgresso({ ...info, etapa: 'clientes' })
          })
          adicionarLog(`Clientes: ${statsClientes.criados} criados, ${statsClientes.atualizados} atualizados`, 'success')

          // 3. Vendas (por último, depende de clientes e corretores)
          // OTIMIZADO: Verifica Supabase antes de buscar na API
          adicionarLog('3/3: Sincronizando vendas...', 'info')
          const statsVendas = await syncVendas({
            enterpriseId: 2104, // Empreendimento FIGUEIRA GARCIA
            dryRun,
            onProgress: (info) => setProgresso({ ...info, etapa: 'vendas' })
          })
          adicionarLog(`Vendas: ${statsVendas.criadas} criadas, ${statsVendas.atualizadas} atualizadas`, 'success')

          stats = {
            corretores: statsCorretores,
            clientes: statsClientes,
            vendas: statsVendas
          }
          break

        default:
          throw new Error('Tipo de sincronização inválido')
      }

      setResultado(stats)
      adicionarLog('Sincronização concluída!', 'success')

      if (validate && dryRun) {
        adicionarLog('✅ Modo VALIDAÇÃO: Requisições reais feitas, mas NENHUM dado foi salvo no banco', 'warning')
      } else if (dryRun) {
        adicionarLog('⚠️ Modo DRY-RUN: Nenhuma requisição foi feita, nenhum dado foi salvo', 'warning')
      }
    } catch (error) {
      console.error('Erro na sincronização:', error)
      setErro(error.message || 'Erro desconhecido')
      adicionarLog(`❌ Erro: ${error.message}`, 'error')
    } finally {
      setSincronizando(false)
      setProgresso(null)
    }
  }

  const formatarEstatisticas = (stats) => {
    if (!stats) return null

    if (stats.corretores) {
      // Sincronização completa
      return (
        <div className="stats-completas">
          <div className="stat-group">
            <h4>Corretores</h4>
            <p>Total: {stats.corretores.total} | Criados: {stats.corretores.criados} | Erros: {stats.corretores.erros}</p>
          </div>
          <div className="stat-group">
            <h4>Clientes</h4>
            <p>Total: {stats.clientes.total} | Criados: {stats.clientes.criados} | Atualizados: {stats.clientes.atualizados} | Erros: {stats.clientes.erros}</p>
          </div>
          <div className="stat-group">
            <h4>Vendas</h4>
            <p>Total: {stats.vendas.total} | Criadas: {stats.vendas.criadas} | Atualizadas: {stats.vendas.atualizadas} | Erros: {stats.vendas.erros}</p>
          </div>
        </div>
      )
    }

    // Sincronização individual
    return (
      <div className="stats-individual">
        <p><strong>Total processado:</strong> {stats.total || 0}</p>
        <p><strong>Criados:</strong> {stats.criados || stats.criadas || 0}</p>
        <p><strong>Atualizados:</strong> {stats.atualizados || 0}</p>
        <p><strong>Pulados:</strong> {stats.pulados || 0}</p>
        <p><strong>Erros:</strong> {stats.erros || 0}</p>
      </div>
    )
  }

  return (
    <div className="sincronizar-sienge">
      <div className="sincronizar-header">
        <h2>Sincronização com Sienge</h2>
        <p className="subtitle">Sincronize dados do Sienge para o sistema</p>
      </div>

      {/* Modos de Operação */}
      <div className="modos-operacao">
        <div className="dry-run-toggle">
          <label>
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => {
                setDryRun(e.target.checked)
                // Se desativar dryRun, também desativa validate
                if (!e.target.checked) {
                  setValidate(false)
                }
              }}
              disabled={sincronizando}
            />
            <span>Modo TESTE (dry-run) - Não faz requisições à API</span>
          </label>
        </div>
        
        {dryRun && (
          <div className="validate-toggle">
            <label>
              <input
                type="checkbox"
                checked={validate}
                onChange={(e) => setValidate(e.target.checked)}
                disabled={sincronizando}
              />
              <span>✅ Validação com API - Faz requisições reais mas NÃO salva no banco</span>
            </label>
          </div>
        )}
        
        <div className="modo-badge">
          {dryRun && validate && (
            <span className="badge badge-validate">🔍 MODO VALIDAÇÃO</span>
          )}
          {dryRun && !validate && (
            <span className="badge badge-dry">⚠️ MODO DRY-RUN</span>
          )}
          {!dryRun && (
            <span className="badge badge-production">🚀 MODO PRODUÇÃO</span>
          )}
        </div>
      </div>

      {/* Botões de ação */}
      <div className="sync-buttons">
        <button
          onClick={() => executarSincronizacao('corretores')}
          disabled={sincronizando}
          className="btn-sync btn-corretores"
        >
          <RefreshCw size={18} />
          Sincronizar Corretores
        </button>

        <button
          onClick={() => executarSincronizacao('clientes')}
          disabled={sincronizando}
          className="btn-sync btn-clientes"
        >
          <RefreshCw size={18} />
          Sincronizar Clientes
        </button>

        <button
          onClick={() => executarSincronizacao('vendas')}
          disabled={sincronizando}
          className="btn-sync btn-vendas"
        >
          <RefreshCw size={18} />
          Sincronizar Vendas
        </button>

        <button
          onClick={() => executarSincronizacao('todos')}
          disabled={sincronizando}
          className="btn-sync btn-todos"
        >
          <RefreshCw size={18} />
          Sincronizar Tudo
        </button>
      </div>

      {/* Progresso */}
      {sincronizando && (
        <div className="progress-container">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{
                width: progresso
                  ? `${(progresso.current / progresso.total) * 100}%`
                  : '0%'
              }}
            />
          </div>
          {progresso && (
            <p className="progress-text">
              {progresso.etapa && `${progresso.etapa.toUpperCase()}: `}
              {progresso.current} / {progresso.total}
            </p>
          )}
        </div>
      )}

      {/* Resultado */}
      {resultado && (
        <div className="resultado-container success">
          <CheckCircle size={20} />
          <div>
            <h3>Sincronização Concluída</h3>
            {formatarEstatisticas(resultado)}
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
          <strong>Importante:</strong>
          <ul>
            <li>Use o modo TESTE primeiro para verificar o que será sincronizado</li>
            <li>A sincronização pode demorar dependendo da quantidade de dados</li>
            <li>Dados já existentes serão atualizados, não duplicados</li>
            <li>Verifique os logs para acompanhar o progresso</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default SincronizarSienge

