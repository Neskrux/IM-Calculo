import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Upload, FileText, CheckCircle, XCircle, AlertCircle, Download, UserPlus, Key } from 'lucide-react'
import '../styles/CadastrarCorretores.css'

const CadastrarCorretores = () => {
  const [arquivo, setArquivo] = useState(null)
  const [dadosPreview, setDadosPreview] = useState([])
  const [processando, setProcessando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [log, setLog] = useState(null)
  const [progresso, setProgresso] = useState({ atual: 0, total: 0, corretorAtual: '' })
  const fileInputRef = useRef(null)
  const cancelarRef = useRef(false)

  // Processar arquivo JSON
  const processarArquivo = (file) => {
    const reader = new FileReader()
    
    reader.onload = (e) => {
      try {
        const jsonData = JSON.parse(e.target.result)
        
        if (!Array.isArray(jsonData)) {
          alert('O arquivo JSON deve conter um array de corretores')
          return
        }

        // Validar estrutura básica
        const dadosValidos = jsonData.filter(item => {
          return item.nome_a_ser_usado && item.email && item.senha && item.tipo_corretor
        })

        if (dadosValidos.length === 0) {
          alert('Nenhum corretor válido encontrado no arquivo. Verifique se os campos nome_a_ser_usado, email, senha e tipo_corretor estão presentes.')
          return
        }

        setDadosPreview(dadosValidos)
        setArquivo(file)
      } catch (error) {
        console.error('Erro ao processar arquivo:', error)
        alert('Erro ao processar arquivo JSON: ' + error.message)
      }
    }

    reader.readAsText(file)
  }

  // Normalizar nome para busca
  const normalizarNome = (nome) => {
    if (!nome) return ''
    return nome
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove acentos
      .replace(/\b(de|da|do|dos|das)\b/g, '') // Remove preposições
      .replace(/[^a-z0-9]/g, '') // Remove caracteres especiais
      .trim()
  }

  // Buscar corretor existente
  const buscarCorretorExistente = async (nome, email) => {
    try {
      // Buscar por email
      const { data: porEmail } = await supabase
        .from('usuarios')
        .select('id, nome, email, tipo_corretor')
        .eq('email', email)
        .eq('tipo', 'corretor')
        .maybeSingle()

      if (porEmail) {
        return { encontrado: true, dados: porEmail, metodo: 'email' }
      }

      // Buscar por nome normalizado
      const { data: todosCorretores } = await supabase
        .from('usuarios')
        .select('id, nome, email, tipo_corretor')
        .eq('tipo', 'corretor')

      if (todosCorretores) {
        const nomeNormalizado = normalizarNome(nome)
        const corretorEncontrado = todosCorretores.find(c => {
          const nomeCorretorNormalizado = normalizarNome(c.nome)
          return nomeCorretorNormalizado === nomeNormalizado
        })

        if (corretorEncontrado) {
          return { encontrado: true, dados: corretorEncontrado, metodo: 'nome' }
        }
      }

      return { encontrado: false, dados: null, metodo: null }
    } catch (error) {
      console.error('Erro ao buscar corretor:', error)
      return { encontrado: false, dados: null, metodo: null, erro: error.message }
    }
  }

  // Função auxiliar para delay
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

  // Função para retry com backoff exponencial melhorado
  const signUpComRetry = async (email, password, metadata, maxTentativas = 5) => {
    let tentativa = 0
    let delayMs = 3000 // Começa com 3 segundos (mais conservador)

    while (tentativa < maxTentativas) {
      try {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: metadata,
            emailRedirectTo: undefined // Não redirecionar
          }
        })

        if (error) {
          // Se for rate limit, aguarda mais tempo antes de tentar novamente
          if (error.status === 429 || error.message?.includes('429') || error.message?.includes('Too Many Requests')) {
            tentativa++
            if (tentativa < maxTentativas) {
              const delaySegundos = Math.floor(delayMs / 1000)
              console.log(`⚠️ Rate limit atingido (tentativa ${tentativa}/${maxTentativas}). Aguardando ${delaySegundos}s antes de tentar novamente...`)
              await delay(delayMs)
              // Backoff exponencial mais agressivo: 3s, 6s, 12s, 24s, 48s
              delayMs = Math.min(delayMs * 2, 48000) // Máximo de 48 segundos
              continue
            }
          }
          // Se não for rate limit, retorna o erro imediatamente
          throw error
        }

        return { data, error: null }
      } catch (error) {
        // Se não for rate limit, retorna o erro
        if (error.status !== 429 && !error.message?.includes('429') && !error.message?.includes('Too Many Requests')) {
          return { data: null, error }
        }
        
        // Se for rate limit e ainda tem tentativas
        if (tentativa < maxTentativas - 1) {
          tentativa++
          const delaySegundos = Math.floor(delayMs / 1000)
          console.log(`⚠️ Rate limit (tentativa ${tentativa}/${maxTentativas}). Aguardando ${delaySegundos}s...`)
          await delay(delayMs)
          delayMs = Math.min(delayMs * 2, 48000)
        } else {
          return { data: null, error: new Error('Máximo de tentativas atingido devido a rate limit') }
        }
      }
    }

    return { data: null, error: new Error('Máximo de tentativas atingido') }
  }

  // Executar cadastro em lotes para respeitar limite de requisições
  const executarCadastro = async () => {
    if (!dadosPreview || dadosPreview.length === 0) {
      alert('Nenhum dado para processar')
      return
    }

    setProcessando(true)
    cancelarRef.current = false
    setProgresso({ atual: 0, total: dadosPreview.length, corretorAtual: '' })

    const logDetalhado = {
      data_hora: new Date().toISOString(),
      total_corretores: dadosPreview.length,
      sucesso: 0,
      erros: 0,
      duplicados: 0,
      detalhes: []
    }

    // Configuração de lotes: processa 10 corretores por lote, com pausa de 60s entre lotes
    const TAMANHO_LOTE = 10
    const PAUSA_ENTRE_LOTES = 60000 // 60 segundos entre lotes
    const DELAY_ENTRE_CADASTROS = 3000 // 3 segundos entre cada cadastro dentro do lote
    let rateLimitDetectado = false

    try {
      const totalLotes = Math.ceil(dadosPreview.length / TAMANHO_LOTE)
      
      for (let loteIndex = 0; loteIndex < totalLotes; loteIndex++) {
        if (cancelarRef.current) break
        if (rateLimitDetectado) {
          console.log('⛔ Rate limit detectado. Parando processamento.')
          alert('Rate limit do Supabase atingido. O processamento foi pausado. Aguarde alguns minutos e tente processar os corretores restantes novamente.')
          break
        }

        const inicioLote = loteIndex * TAMANHO_LOTE
        const fimLote = Math.min(inicioLote + TAMANHO_LOTE, dadosPreview.length)
        const lote = dadosPreview.slice(inicioLote, fimLote)

        console.log(`📦 Processando lote ${loteIndex + 1}/${totalLotes} (${lote.length} corretores)...`)

        for (let i = 0; i < lote.length; i++) {
          const indiceGlobal = inicioLote + i
          
          setProgresso({ 
            atual: indiceGlobal + 1, 
            total: dadosPreview.length, 
            corretorAtual: lote[i].nome_a_ser_usado 
          })

          if (cancelarRef.current) {
            logDetalhado.detalhes.push({
              linha: indiceGlobal + 1,
              corretor: lote[i].nome_a_ser_usado,
              status: 'cancelado',
              mensagem: 'Processamento cancelado pelo usuário'
            })
            break
          }

          const corretor = lote[i]
          const detalheLinha = {
            linha: indiceGlobal + 1,
            corretor: corretor.nome_a_ser_usado,
            email: corretor.email,
            tipo: corretor.tipo_corretor,
            dados_originais: { ...corretor },
            status: 'processando'
          }

          try {
            // Verificar se já existe
            const busca = await buscarCorretorExistente(corretor.nome_a_ser_usado, corretor.email)
            
            if (busca.encontrado) {
              detalheLinha.status = 'duplicado'
              detalheLinha.mensagem = `Corretor já existe (encontrado por ${busca.metodo})`
              detalheLinha.corretor_existente = busca.dados
              logDetalhado.duplicados++
              logDetalhado.detalhes.push(detalheLinha)
              continue
            }

            // Criar usuário no Supabase Auth com retry
            const { data: authData, error: authError } = await signUpComRetry(
              corretor.email,
              corretor.senha,
              {
                nome: corretor.nome_a_ser_usado,
                tipo: 'corretor'
              }
            )

            if (authError) {
              // Se for rate limit, marca e para o processamento
              if (authError.message?.includes('rate limit') || 
                  authError.message?.includes('429') || 
                  authError.message?.includes('Too Many Requests') ||
                  authError.message?.includes('Máximo de tentativas atingido devido a rate limit')) {
                rateLimitDetectado = true
                detalheLinha.status = 'erro'
                detalheLinha.mensagem = 'Rate limit do Supabase atingido. Processamento pausado.'
                detalheLinha.erro = authError.message
                logDetalhado.erros++
                logDetalhado.detalhes.push(detalheLinha)
                break
              }
              throw new Error(`Erro ao criar usuário: ${authError.message}`)
            }

            if (!authData?.user) {
              throw new Error('Usuário não foi criado no Auth')
            }

            // Aguardar um pouco para garantir que o Auth processou
            await delay(500)

            // Criar registro na tabela usuarios
            const { error: dbError } = await supabase
              .from('usuarios')
              .insert([{
                id: authData.user.id,
                email: corretor.email,
                nome: corretor.nome_a_ser_usado,
                tipo: 'corretor',
                tipo_corretor: corretor.tipo_corretor,
                ativo: true
              }])

            if (dbError) {
              console.error('Usuário Auth criado mas falhou no DB:', {
                user_id: authData.user.id,
                email: corretor.email,
                erro: dbError.message
              })
              throw new Error(`Erro ao criar registro: ${dbError.message}. O usuário Auth foi criado e precisa ser removido manualmente.`)
            }

            detalheLinha.status = 'sucesso'
            detalheLinha.mensagem = 'Corretor cadastrado com sucesso'
            detalheLinha.user_id = authData.user.id
            logDetalhado.sucesso++

            // Delay entre cadastros dentro do lote (exceto no último do lote)
            if (i < lote.length - 1) {
              await delay(DELAY_ENTRE_CADASTROS)
            }

          } catch (error) {
            detalheLinha.status = 'erro'
            detalheLinha.mensagem = error.message
            detalheLinha.erro = error.message
            logDetalhado.erros++

            // Se for rate limit, marca e para
            if (error.message?.includes('rate limit') || 
                error.message?.includes('429') || 
                error.message?.includes('Too Many Requests')) {
              rateLimitDetectado = true
              break
            }

            // Delay em caso de erro (exceto no último do lote)
            if (i < lote.length - 1) {
              await delay(3000)
            }
          }

          logDetalhado.detalhes.push(detalheLinha)
        }

        // Pausa entre lotes (exceto no último lote e se não houver rate limit)
        if (loteIndex < totalLotes - 1 && !rateLimitDetectado && !cancelarRef.current) {
          const segundosPausa = PAUSA_ENTRE_LOTES / 1000
          console.log(`⏸️ Pausa de ${segundosPausa}s entre lotes (${loteIndex + 1}/${totalLotes} concluído)...`)
          setProgresso({ 
            atual: fimLote, 
            total: dadosPreview.length, 
            corretorAtual: `Pausa entre lotes (${segundosPausa}s)...` 
          })
          await delay(PAUSA_ENTRE_LOTES)
        }
      }

      setResultado({
        sucesso: logDetalhado.sucesso,
        erros: logDetalhado.erros,
        duplicados: logDetalhado.duplicados,
        total: logDetalhado.total_corretores
      })

      setLog(logDetalhado)
      setProcessando(false)
      setProgresso({ atual: 0, total: 0, corretorAtual: '' })

    } catch (error) {
      console.error('Erro geral no cadastro:', error)
      alert('Erro ao processar cadastro: ' + error.message)
      setProcessando(false)
      setProgresso({ atual: 0, total: 0, corretorAtual: '' })
    }
  }

  // Cancelar processamento
  const cancelarProcessamento = () => {
    cancelarRef.current = true
    setProcessando(false)
  }

  // Salvar log JSON
  const salvarLogJson = () => {
    if (!log) {
      alert('Nenhum log disponível')
      return
    }

    try {
      const jsonContent = JSON.stringify(log, null, 2)
      const blob = new Blob([jsonContent], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      
      const dataHora = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      a.download = `log_cadastro_corretores_${dataHora}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Erro ao salvar log:', error)
      alert('Erro ao salvar log: ' + error.message)
    }
  }

  // Resetar
  const resetar = () => {
    setArquivo(null)
    setDadosPreview([])
    setResultado(null)
    setLog(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="cadastrar-corretores-container">
      <div className="cadastrar-corretores-header">
        <h2>
          <UserPlus size={24} />
          Cadastrar Corretores
        </h2>
        <p>Importe o arquivo JSON gerado com as senhas para cadastrar os corretores no sistema</p>
      </div>

      {/* Upload */}
      {!dadosPreview.length && (
        <div className="upload-section">
          <div className="upload-area" onClick={() => fileInputRef.current?.click()}>
            <Upload size={48} />
            <p>Clique para selecionar o arquivo JSON</p>
            <span>ou arraste o arquivo aqui</span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) {
                processarArquivo(file)
              }
            }}
            style={{ display: 'none' }}
          />
        </div>
      )}

      {/* Preview */}
      {dadosPreview.length > 0 && !resultado && (
        <div className="preview-section">
          <div className="preview-header">
            <FileText size={20} />
            <h3>Preview - {dadosPreview.length} Corretor(es) Encontrado(s)</h3>
            <button className="btn-secondary" onClick={resetar}>
              Limpar
            </button>
          </div>

          <div className="preview-table-container">
            <table className="preview-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nome</th>
                  <th>Email</th>
                  <th>Tipo</th>
                </tr>
              </thead>
              <tbody>
                {dadosPreview.slice(0, 10).map((corretor, index) => (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>{corretor.nome_a_ser_usado}</td>
                    <td>{corretor.email}</td>
                    <td>
                      <span className={`badge ${corretor.tipo_corretor === 'externo' ? 'badge-externo' : 'badge-interno'}`}>
                        {corretor.tipo_corretor}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {dadosPreview.length > 10 && (
              <p className="preview-more">... e mais {dadosPreview.length - 10} corretor(es)</p>
            )}
          </div>

          <div className="acoes-section">
            {processando && (
              <div className="progresso-section" style={{
                width: '100%',
                marginBottom: '20px',
                padding: '16px',
                background: 'rgba(59, 130, 246, 0.1)',
                borderRadius: '8px',
                border: '1px solid rgba(59, 130, 246, 0.3)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontWeight: '600', color: '#3b82f6' }}>
                    {progresso.corretorAtual || 'Iniciando...'}
                  </span>
                  <span style={{ color: '#64748b' }}>
                    {progresso.atual} / {progresso.total}
                  </span>
                </div>
                <div style={{
                  width: '100%',
                  height: '8px',
                  background: 'rgba(59, 130, 246, 0.2)',
                  borderRadius: '4px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    width: `${progresso.total > 0 ? (progresso.atual / progresso.total) * 100 : 0}%`,
                    height: '100%',
                    background: '#3b82f6',
                    transition: 'width 0.3s ease',
                    borderRadius: '4px'
                  }} />
                </div>
                <p style={{ marginTop: '8px', fontSize: '12px', color: '#64748b', textAlign: 'center' }}>
                  {progresso.total > 0 ? Math.round((progresso.atual / progresso.total) * 100) : 0}% concluído
                  {progresso.total > 10 && (
                    <span style={{ marginLeft: '8px' }}>
                      • Lote {Math.ceil(progresso.atual / 10)} de {Math.ceil(progresso.total / 10)}
                    </span>
                  )}
                </p>
              </div>
            )}
            <button
              className="btn-primary btn-cadastrar"
              onClick={executarCadastro}
              disabled={processando}
            >
              <UserPlus size={20} />
              {processando ? 'Cadastrando...' : `Cadastrar ${dadosPreview.length} Corretores`}
            </button>
            {processando && (
              <button
                className="btn-danger"
                onClick={cancelarProcessamento}
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}

      {/* Resultado */}
      {resultado && (
        <div className="resultado-section">
          <div className="resultado-header">
            {resultado.erros === 0 ? (
              <CheckCircle size={24} className="icon-success" />
            ) : (
              <AlertCircle size={24} className="icon-warning" />
            )}
            <h3>Resultado do Cadastro</h3>
          </div>

          <div className="estatisticas-grid">
            <div className="stat-card success">
              <div className="stat-value">{resultado.sucesso}</div>
              <div className="stat-label">Sucesso</div>
            </div>
            <div className="stat-card error">
              <div className="stat-value">{resultado.erros}</div>
              <div className="stat-label">Erros</div>
            </div>
            <div className="stat-card warning">
              <div className="stat-value">{resultado.duplicados}</div>
              <div className="stat-label">Duplicados</div>
            </div>
            <div className="stat-card info">
              <div className="stat-value">{resultado.total}</div>
              <div className="stat-label">Total</div>
            </div>
          </div>

          {log && log.detalhes.some(d => d.status === 'erro') && (
            <div className="erros-section">
              <h4>Erros Encontrados</h4>
              <div className="erros-list">
                {log.detalhes
                  .filter(d => d.status === 'erro')
                  .map((erro, index) => (
                    <div key={index} className="erro-item">
                      <strong>Linha {erro.linha}:</strong> {erro.corretor} - {erro.mensagem}
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="acoes-resultado">
            <button className="btn-download" onClick={salvarLogJson}>
              <Download size={18} />
              Baixar Log JSON
            </button>
            <button className="btn-secondary" onClick={resetar}>
              Novo Cadastro
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default CadastrarCorretores

