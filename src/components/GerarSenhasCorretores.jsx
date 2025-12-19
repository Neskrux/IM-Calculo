import { useState } from 'react'
import { Download, Key, FileText, CheckCircle, AlertCircle, Upload } from 'lucide-react'
import '../styles/GerarSenhasCorretores.css'

const GerarSenhasCorretores = () => {
  const [corretoresData, setCorretoresData] = useState(null)
  const [corretoresComSenhas, setCorretoresComSenhas] = useState(null)
  const [processando, setProcessando] = useState(false)
  const [arquivoCarregado, setArquivoCarregado] = useState(false)

  // Função para carregar arquivo JSON
  const handleFileChange = (event) => {
    const file = event.target.files[0]
    if (!file) return

    if (!file.name.endsWith('.json')) {
      alert('Por favor, selecione um arquivo JSON')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result)
        if (!Array.isArray(data)) {
          alert('O arquivo JSON deve conter um array de corretores')
          return
        }
        setCorretoresData(data)
        setArquivoCarregado(true)
        setCorretoresComSenhas(null) // Resetar senhas se houver
      } catch (error) {
        console.error('Erro ao ler arquivo:', error)
        alert('Erro ao ler arquivo JSON: ' + error.message)
      }
    }
    reader.readAsText(file)
  }

  // Função para gerar email temporário baseado no nome
  const gerarEmailTemporario = (nome) => {
    const nomeLimpo = nome
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove acentos
      .replace(/\s+/g, '.') // Espaços viram pontos
      .replace(/[^a-z.]/g, '') // Remove caracteres especiais
      .substring(0, 50) // Limita tamanho
    return `${nomeLimpo}@corretor.local`
  }

  // Função para gerar senha segura no navegador
  const gerarSenhaSegura = (length = 12) => {
    // Caracteres permitidos (excluindo similares: 0, O, 1, l, I)
    const maiusculas = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
    const minusculas = 'abcdefghijkmnopqrstuvwxyz'
    const numeros = '23456789'
    const todosCaracteres = maiusculas + minusculas + numeros

    // Garantir pelo menos um de cada tipo
    let senha = ''
    
    // Adicionar pelo menos uma maiúscula
    senha += maiusculas[Math.floor(Math.random() * maiusculas.length)]
    // Adicionar pelo menos uma minúscula
    senha += minusculas[Math.floor(Math.random() * minusculas.length)]
    // Adicionar pelo menos um número
    senha += numeros[Math.floor(Math.random() * numeros.length)]

    // Preencher o resto com caracteres aleatórios
    const array = new Uint32Array(length - 3)
    crypto.getRandomValues(array)
    
    for (let i = 0; i < length - 3; i++) {
      senha += todosCaracteres[array[i] % todosCaracteres.length]
    }

    // Embaralhar a senha para não ter padrão previsível
    const senhaArray = senha.split('')
    for (let i = senhaArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[senhaArray[i], senhaArray[j]] = [senhaArray[j], senhaArray[i]]
    }

    return senhaArray.join('')
  }

  // Gerar senhas para todos os corretores
  const gerarSenhas = () => {
    setProcessando(true)
    
    try {
      const corretoresProcessados = corretoresData.map(corretor => {
        const senha = gerarSenhaSegura(12)

        const email = gerarEmailTemporario(corretor.nome_a_ser_usado)

        return {
          ...corretor,
          senha: senha,
          email: email,
          tipo_corretor: corretor.tipo === 'EXTERNA' ? 'externo' : 'interno'
        }
      })

      setCorretoresComSenhas(corretoresProcessados)
    } catch (error) {
      console.error('Erro ao gerar senhas:', error)
      alert('Erro ao gerar senhas: ' + error.message)
    } finally {
      setProcessando(false)
    }
  }

  // Salvar arquivo JSON
  const salvarArquivoJSON = () => {
    if (!corretoresComSenhas) {
      alert('Gere as senhas primeiro')
      return
    }

    try {
      const jsonContent = JSON.stringify(corretoresComSenhas, null, 2)
      const blob = new Blob([jsonContent], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      
      const dataHora = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      a.download = `corretores_com_senhas_${dataHora}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Erro ao salvar arquivo:', error)
      alert('Erro ao salvar arquivo: ' + error.message)
    }
  }

  // Salvar arquivo CSV (mais fácil de visualizar)
  const salvarArquivoCSV = () => {
    if (!corretoresComSenhas) {
      alert('Gere as senhas primeiro')
      return
    }

    try {
      // Cabeçalho CSV
      const headers = ['Número', 'Nome', 'Tipo', 'Email', 'Senha']
      const csvRows = [headers.join(',')]

      // Dados
      corretoresComSenhas.forEach(corretor => {
        const row = [
          corretor.numero_corretor_criado,
          `"${corretor.nome_a_ser_usado}"`,
          corretor.tipo_corretor,
          corretor.email,
          corretor.senha
        ]
        csvRows.push(row.join(','))
      })

      const csvContent = csvRows.join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      
      const dataHora = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      a.download = `corretores_com_senhas_${dataHora}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Erro ao salvar CSV:', error)
      alert('Erro ao salvar CSV: ' + error.message)
    }
  }

  return (
    <div className="gerar-senhas-container">
      <div className="gerar-senhas-header">
        <h2>
          <Key size={24} />
          Gerar Senhas para Corretores
        </h2>
        <p>Carregue um arquivo JSON com a lista de corretores e gere senhas seguras</p>
      </div>

      {/* Upload de Arquivo */}
      {!arquivoCarregado && (
        <div className="upload-section">
          <div className="upload-area">
            <Upload size={48} />
            <h3>Carregar Arquivo JSON</h3>
            <p>Selecione o arquivo JSON com a lista de corretores</p>
            <input
              type="file"
              accept=".json"
              onChange={handleFileChange}
              className="file-input"
              id="file-upload"
            />
            <label htmlFor="file-upload" className="btn-primary">
              <Upload size={18} />
              Selecionar Arquivo
            </label>
          </div>
        </div>
      )}

      {/* Informações */}
      {arquivoCarregado && corretoresData && (
        <>
          <div className="info-section">
            <div className="info-card">
              <FileText size={20} />
              <div>
                <strong>Total de Corretores:</strong> {corretoresData.length}
              </div>
            </div>
            <div className="info-card">
              <AlertCircle size={20} />
              <div>
                <strong>Importante:</strong> As senhas serão geradas aleatoriamente. Salve o arquivo gerado em local seguro antes de criar os usuários no sistema.
              </div>
            </div>
          </div>

          {/* Botão Gerar */}
          {!corretoresComSenhas && (
            <div className="acoes-section">
              <button
                className="btn-primary btn-gerar"
                onClick={gerarSenhas}
                disabled={processando}
              >
                <Key size={20} />
                {processando ? 'Gerando Senhas...' : `Gerar Senhas para ${corretoresData.length} Corretores`}
              </button>
            </div>
          )}
        </>
      )}

      {/* Resultado */}
      {corretoresComSenhas && (
        <div className="resultado-section">
          <div className="resultado-header">
            <CheckCircle size={20} className="icon-success" />
            <h3>Senhas Geradas com Sucesso!</h3>
          </div>

          <div className="estatisticas-grid">
            <div className="stat-card success">
              <div className="stat-value">{corretoresComSenhas.length}</div>
              <div className="stat-label">Corretores Processados</div>
            </div>
            <div className="stat-card info">
              <div className="stat-value">
                {corretoresComSenhas.filter(c => c.tipo_corretor === 'externo').length}
              </div>
              <div className="stat-label">Externos</div>
            </div>
            <div className="stat-card info">
              <div className="stat-value">
                {corretoresComSenhas.filter(c => c.tipo_corretor === 'interno').length}
              </div>
              <div className="stat-label">Internos</div>
            </div>
          </div>

          {/* Preview da primeira linha */}
          <div className="preview-section">
            <h4>Preview (primeira linha):</h4>
            <div className="preview-item">
              <strong>Nome:</strong> {corretoresComSenhas[0].nome_a_ser_usado}
            </div>
            <div className="preview-item">
              <strong>Email:</strong> {corretoresComSenhas[0].email}
            </div>
            <div className="preview-item">
              <strong>Senha:</strong> <code>{corretoresComSenhas[0].senha}</code>
            </div>
            <div className="preview-item">
              <strong>Tipo:</strong> {corretoresComSenhas[0].tipo_corretor}
            </div>
          </div>

          {/* Botões de Download */}
          <div className="download-section">
            <button
              className="btn-download btn-json"
              onClick={salvarArquivoJSON}
            >
              <Download size={18} />
              Baixar JSON
            </button>
            <button
              className="btn-download btn-csv"
              onClick={salvarArquivoCSV}
            >
              <Download size={18} />
              Baixar CSV
            </button>
          </div>

          {/* Aviso */}
          <div className="aviso-section">
            <AlertCircle size={20} />
            <div>
              <strong>Próximos Passos:</strong>
              <ol>
                <li>Salve o arquivo JSON ou CSV em local seguro</li>
                <li>Distribua as senhas para os corretores de forma segura</li>
                <li>Use este arquivo para criar os usuários no sistema (próxima etapa)</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default GerarSenhasCorretores

