import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import * as XLSX from 'xlsx'
import { Upload, FileText, CheckCircle, XCircle, AlertCircle, Download } from 'lucide-react'
import '../styles/ImportarVendas.css'

const ImportarVendas = ({ corretores = [], empreendimentos = [], clientes = [] }) => {
  const [arquivo, setArquivo] = useState(null)
  const [dadosPreview, setDadosPreview] = useState([])
  const [processando, setProcessando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [modoTeste, setModoTeste] = useState(true)
  const [log, setLog] = useState(null)
  const fileInputRef = useRef(null)
  const cancelarRef = useRef(false)

  // Modelo de colunas esperado
  const modeloColunas = [
    { nome: 'EMPREENDIMENTO', descricao: 'Nome do empreendimento', obrigatorio: true },
    { nome: 'Torre(Letra do empreendimento)', descricao: 'Letra/torre do empreendimento', obrigatorio: false },
    { nome: 'Unidade(unidade do empreendimento)', descricao: 'Número da unidade', obrigatorio: false },
    { nome: 'Andar(n°Pav)', descricao: 'Número do andar', obrigatorio: false },
    { nome: 'CLIENTE', descricao: 'Nome completo do cliente', obrigatorio: false },
    { nome: 'DATA DA VENDA', descricao: 'Data da venda (DD/MM/AAAA ou AAAA-MM-DD)', obrigatorio: true },
    { nome: 'TOTAL IMÓVEL', descricao: 'Valor total do imóvel', obrigatorio: true },
    { nome: 'SINAL NEGOCIO', descricao: 'Valor do sinal', obrigatorio: false },
    { nome: 'PARCELAS', descricao: 'Quantidade de parcelas da entrada', obrigatorio: false },
    { nome: 'VALOR PARCELAS', descricao: 'Valor de cada parcela da entrada', obrigatorio: false },
    { nome: 'BALÃO TOTAL', descricao: 'Valor total dos balões', obrigatorio: false },
    { nome: 'QTD BALÃO', descricao: 'Quantidade de balões', obrigatorio: false },
    { nome: 'VALOR BALÃO', descricao: 'Valor de cada balão', obrigatorio: false },
    { nome: 'SALDO REMANECENTE', descricao: 'Saldo remanescente', obrigatorio: false },
    { nome: 'CORRETOR(corretor da venda)', descricao: 'Nome do corretor', obrigatorio: true }
  ]

  // Normalizar nome para busca
  const normalizarNome = (nome) => {
    if (!nome) return ''
    return nome
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\b(de|da|do|dos|das)\b/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim()
  }

  // Buscar empreendimento por nome
  const buscarEmpreendimento = (nome) => {
    if (!nome) return null
    const nomeNormalizado = normalizarNome(nome)
    return empreendimentos.find(emp => {
      const nomeEmp = normalizarNome(emp.nome)
      return nomeEmp === nomeNormalizado || 
             nomeEmp.includes(nomeNormalizado) || 
             nomeNormalizado.includes(nomeEmp)
    })
  }

  // Buscar corretor por nome
  const buscarCorretor = (nome) => {
    if (!nome) return null
    const nomeNormalizado = normalizarNome(nome)
    return corretores.find(c => {
      const nomeCorretor = normalizarNome(c.nome)
      return nomeCorretor === nomeNormalizado || 
             nomeCorretor.includes(nomeNormalizado) || 
             nomeNormalizado.includes(nomeCorretor)
    })
  }

  // Buscar cliente por nome
  const buscarCliente = (nome) => {
    if (!nome) return null
    const nomeNormalizado = normalizarNome(nome)
    return clientes.find(cli => {
      const nomeCliente = normalizarNome(cli.nome_completo)
      return nomeCliente === nomeNormalizado || 
             nomeCliente.includes(nomeNormalizado) || 
             nomeNormalizado.includes(nomeCliente)
    })
  }

  // Converter data para formato ISO (DD/MM/AAAA, M/D/AA, ou número serial do Excel)
  const converterData = (dataStr) => {
    if (!dataStr) return null
    
    // Se já está no formato ISO (AAAA-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}/.test(dataStr)) {
      return dataStr.split(' ')[0]
    }
    
    // Se está no formato DD/MM/AAAA - CONVERTER DIRETAMENTE (PRIORIDADE MÁXIMA)
    if (/^\d{2}\/\d{2}\/\d{4}/.test(dataStr)) {
      const [dia, mes, ano] = dataStr.split('/')
      const diaNum = parseInt(dia, 10)
      const mesNum = parseInt(mes, 10)
      const anoNum = parseInt(ano, 10)
      
      // Validar valores básicos
      if (diaNum >= 1 && diaNum <= 31 && mesNum >= 1 && mesNum <= 12 && anoNum >= 1900 && anoNum <= 2100) {
        // Retornar no formato ISO: AAAA-MM-DD
        return `${anoNum}-${String(mesNum).padStart(2, '0')}-${String(diaNum).padStart(2, '0')}`
      }
      return null
    }
    
    // Se está no formato M/D/AA ou MM/DD/AA (mês/dia/ano com 2 dígitos) - FORMATO AMERICANO DO EXCEL
    // Exemplos: "9/5/25" = 05/09/2025 (5 de setembro), "7/11/25" = 11/07/2025 (11 de julho)
    // Formato: M/D/AA onde M=mês, D=dia, AA=ano (25=2025, 24=2024)
    if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(dataStr)) {
      const partes = dataStr.split('/')
      const mesNum = parseInt(partes[0], 10)
      const diaNum = parseInt(partes[1], 10)
      const ano2Digitos = parseInt(partes[2], 10)
      
      // Converter ano de 2 dígitos para 4 dígitos (25 -> 2025, 24 -> 2024)
      // Assumir que anos 00-99 são 2000-2099
      const anoNum = ano2Digitos + 2000
      
      // Validar valores básicos
      if (diaNum >= 1 && diaNum <= 31 && mesNum >= 1 && mesNum <= 12 && anoNum >= 2000 && anoNum <= 2099) {
        // Retornar no formato ISO: AAAA-MM-DD
        // O Excel retorna M/D/AA (mês/dia/ano), então mantemos essa ordem
        return `${anoNum}-${String(mesNum).padStart(2, '0')}-${String(diaNum).padStart(2, '0')}`
      }
      return null
    }
    
    // Se é um número (data serial do Excel) - SÓ CONVERTER SE FOR NÚMERO GRANDE (>= 2000)
    // Números pequenos (2, 7, 9, 10, 12, etc.) NÃO são datas seriais válidas
    let numeroData = null
    if (typeof dataStr === 'number') {
      // Só considerar como data serial se for >= 36526 (aproximadamente 01/01/2000)
      // Isso evita converter números pequenos incorretos que resultam em 1900
      if (dataStr >= 36526 && dataStr <= 73000) {
        numeroData = dataStr
      }
    } else if (typeof dataStr === 'string') {
      // Se é um número inteiro no range válido do Excel para datas modernas
      const numeroExtraido = parseFloat(dataStr.trim())
      // Só considerar se for >= 36526 (01/01/2000) para evitar datas antigas incorretas
      if (!isNaN(numeroExtraido) && numeroExtraido >= 36526 && numeroExtraido <= 73000 && numeroExtraido === Math.floor(numeroExtraido)) {
        numeroData = numeroExtraido
      }
    }
    
    // Converter número serial do Excel para data (só se for um número válido >= 2000)
    if (numeroData !== null) {
      // Excel: 1 = 01/01/1900
      // Ajuste para bug do 29/02/1900 (datas >= 60)
      const diasAjustados = numeroData >= 60 ? numeroData - 2 : numeroData - 1
      
      // Calcular data a partir de 01/01/1900
      const excelEpoch = new Date(1900, 0, 1)
      const date = new Date(excelEpoch)
      date.setDate(date.getDate() + diasAjustados)
      
      if (!isNaN(date.getTime())) {
        const ano = date.getFullYear()
        const mes = date.getMonth() + 1
        const dia = date.getDate()
        
        // Validar: só aceitar se ano >= 2000 (para garantir que não são números incorretos)
        if (ano >= 2000 && ano <= 2100) {
          return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
        }
      }
    }
    
    return null
  }

  // Validar valor numérico (suporta formato brasileiro: 230.112,00)
  const validarValor = (valor) => {
    if (!valor) return { valido: true, valor: 0 }
    
    // Se já é um número, validar e retornar
    if (typeof valor === 'number') {
      return { valido: !isNaN(valor) && valor >= 0, valor: valor }
    }
    
    const valorStr = valor.toString().trim()
    
    // Remover espaços e caracteres não numéricos exceto ponto e vírgula
    let valorLimpo = valorStr.replace(/[^\d,.-]/g, '')
    
    // Detectar formato: brasileiro (230.112,00) vs americano (230112.00)
    const temVirgula = valorLimpo.includes(',')
    const temPonto = valorLimpo.includes('.')
    
    if (temVirgula && temPonto) {
      // Tem ambos: verificar qual vem por último
      const ultimaVirgula = valorLimpo.lastIndexOf(',')
      const ultimoPonto = valorLimpo.lastIndexOf('.')
      
      if (ultimaVirgula > ultimoPonto) {
        // Formato brasileiro: 230.112,00 (ponto = milhar, vírgula = decimal)
        valorLimpo = valorLimpo.replace(/\./g, '') // Remove pontos (milhares)
        valorLimpo = valorLimpo.replace(',', '.')  // Vírgula vira ponto decimal
      } else {
        // Formato incomum: tratar ponto como decimal
        valorLimpo = valorLimpo.replace(/,/g, '')
      }
    } else if (temVirgula) {
      // Só vírgula: formato brasileiro ou europeu (230,00)
      valorLimpo = valorLimpo.replace(',', '.')
    } else if (temPonto) {
      // Só ponto: pode ser formato americano (230112.00) ou brasileiro sem decimal (230.112)
      // Se tem mais de 3 dígitos após o ponto, provavelmente é milhar brasileiro
      const partes = valorLimpo.split('.')
      if (partes.length === 2 && partes[1].length > 3) {
        // Formato brasileiro sem decimal: 230.112 = 230112
        valorLimpo = valorLimpo.replace('.', '')
      }
      // Caso contrário, manter ponto como decimal
    }
    
    const valorNum = parseFloat(valorLimpo)
    if (isNaN(valorNum) || valorNum < 0) {
      return { valido: false, valor: null }
    }
    return { valido: true, valor: valorNum }
  }

  // Validar se venda já existe (duplicata)
  const verificarVendaDuplicada = async (empreendimentoId, unidade, bloco, clienteId, corretorId, dataVenda) => {
    try {
      const { data, error } = await supabase
        .from('vendas')
        .select('id')
        .eq('empreendimento_id', empreendimentoId)
        .eq('cliente_id', clienteId)
        .eq('corretor_id', corretorId)
        .eq('data_venda', dataVenda)
      
      if (error) {
        console.error('Erro ao verificar duplicata:', error)
        return false
      }

      // Se encontrou vendas, verificar se unidade e bloco também coincidem
      if (data && data.length > 0) {
        if (unidade || bloco) {
          // Buscar vendas com mesmo empreendimento, cliente, corretor e data
          const { data: vendasDetalhes } = await supabase
            .from('vendas')
            .select('id, unidade, bloco')
            .eq('empreendimento_id', empreendimentoId)
            .eq('cliente_id', clienteId)
            .eq('corretor_id', corretorId)
            .eq('data_venda', dataVenda)
          
          if (vendasDetalhes) {
            const duplicata = vendasDetalhes.find(v => {
              const mesmaUnidade = (!unidade && !v.unidade) || (unidade && v.unidade && unidade === v.unidade)
              const mesmoBloco = (!bloco && !v.bloco) || (bloco && v.bloco && bloco === v.bloco)
              return mesmaUnidade && mesmoBloco
            })
            return !!duplicata
          }
        }
        return true
      }

      return false
    } catch (error) {
      console.error('Erro ao verificar duplicata:', error)
      return false
    }
  }

  // Calcular comissões (similar ao AdminDashboard)
  const calcularComissoesDinamicas = (valorVenda, empreendimentoId, tipoCorretor) => {
    const empreendimento = empreendimentos.find(e => e.id === empreendimentoId)
    if (!empreendimento || !empreendimento.cargos) {
      return { cargos: [], total: 0, percentualTotal: 0 }
    }

    const cargos = empreendimento.cargos.filter(c => c.tipo_corretor === tipoCorretor)
    const comissoes = cargos.map(cargo => ({
      cargo_id: cargo.id,
      nome_cargo: cargo.nome_cargo,
      percentual: cargo.percentual,
      valor: (valorVenda * cargo.percentual) / 100
    }))

    const total = comissoes.reduce((sum, c) => sum + c.valor, 0)
    const percentualTotal = comissoes.reduce((sum, c) => sum + c.percentual, 0)

    return { cargos: comissoes, total, percentualTotal }
  }

  // Processar arquivo Excel
  const processarArquivo = async (file) => {
    try {
      const data = await file.arrayBuffer()
      // Ler Excel: usar raw: true para obter valores numéricos corretos, depois formatar manualmente
      const workbook = XLSX.read(data, { type: 'array', cellDates: false, raw: true })
      const primeiraAba = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[primeiraAba]
      // Usar raw: true para números, mas converter para string quando necessário
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: true })

      if (jsonData.length < 2) {
        throw new Error('O arquivo deve ter pelo menos uma linha de cabeçalho e uma linha de dados')
      }

      const cabecalhos = jsonData[0].map(h => String(h).trim())
      
      // Mapear colunas
      const mapearColunas = () => {
        const mapeamento = {}
        
        const encontrarColuna = (variacoes, evitarPalavras = []) => {
          for (const variacao of variacoes) {
            const vUpper = variacao.toUpperCase().trim()
            
            // Primeiro, tentar correspondência exata
            const indiceExato = cabecalhos.findIndex(h => {
              const hUpper = h.toUpperCase().trim()
              return hUpper === vUpper
            })
            if (indiceExato !== -1) return indiceExato
            
            // Depois, tentar correspondências que começam com a variacao (mais específico)
            const indiceInicio = cabecalhos.findIndex(h => {
              const hUpper = h.toUpperCase().trim()
              // Verificar se começa com a variacao
              if (hUpper.startsWith(vUpper)) {
                // Se há palavras a evitar, verificar se o cabeçalho não é exatamente uma delas
                if (evitarPalavras.length > 0) {
                  const ehEvitar = evitarPalavras.some(evitar => 
                    hUpper === evitar.toUpperCase().trim()
                  )
                  return !ehEvitar
                }
                return true
              }
              return false
            })
            if (indiceInicio !== -1) return indiceInicio
            
            // Por último, tentar includes (menos específico)
            const indice = cabecalhos.findIndex(h => {
              const hUpper = h.toUpperCase().trim()
              // Verificar se contém a variacao OU a variacao contém o cabeçalho
              const corresponde = hUpper.includes(vUpper) || vUpper.includes(hUpper)
              if (corresponde) {
                // Se há palavras a evitar, verificar se o cabeçalho não é exatamente uma delas
                // E também verificar se não estamos pegando uma palavra menor quando procuramos uma maior
                if (evitarPalavras.length > 0) {
                  const evitarUpper = evitarPalavras.map(e => e.toUpperCase().trim())
                  // Se o cabeçalho é exatamente uma palavra a evitar, não usar
                  if (evitarUpper.includes(hUpper)) return false
                  // Se estamos procurando uma palavra maior (ex: "VALOR PARCELAS") e encontramos uma menor (ex: "PARCELAS"), evitar
                  if (vUpper.length > hUpper.length && vUpper.includes(hUpper)) {
                    // Verificar se a palavra menor está na lista de evitar
                    if (evitarUpper.includes(hUpper)) return false
                  }
                }
                return true
              }
              return false
            })
            if (indice !== -1) return indice
          }
          return -1
        }
        
        mapeamento['empreendimento'] = encontrarColuna(['EMPREENDIMENTO', 'EMPRENDIMENTO'])
        mapeamento['torre'] = encontrarColuna(['TORRE', 'BLOCO', 'TORRE(LETRA DO EMPREENDIMENTO)', 'TORRE (LETRA DO EMPREENDIMENTO)'])
        mapeamento['unidade'] = encontrarColuna(['UNIDADE', 'UNIDADE(UNIDADE DO EMPREENDIMENTO)', 'UNIDADE (UNIDADE DO EMPREENDIMENTO)'])
        mapeamento['andar'] = encontrarColuna(['ANDAR', 'N°PAV', 'ANDAR(N°PAV)', 'ANDAR (N°PAV)', 'PAVIMENTO', 'PAV'])
        mapeamento['cliente'] = encontrarColuna(['CLIENTE', 'NOME CLIENTE'])
        mapeamento['data_venda'] = encontrarColuna(['DATA DA VENDA', 'DATA VENDA', 'DATA'])
        mapeamento['total_imovel'] = encontrarColuna(['TOTAL IMÓVEL', 'TOTAL IMOVEL', 'VALOR TOTAL', 'VALOR'])
        mapeamento['sinal'] = encontrarColuna(['SINAL NEGOCIO', 'SINAL', 'SINAL NEGÓCIO'])
        // IMPORTANTE: Buscar VALOR PARCELAS primeiro, evitando a palavra "PARCELAS" sozinha
        mapeamento['valor_parcelas'] = encontrarColuna(['VALOR PARCELAS', 'VALOR PARCELA'], ['PARCELAS'])
        // Buscar PARCELAS, mas só se não for "VALOR PARCELAS"
        mapeamento['parcelas'] = encontrarColuna(['PARCELAS', 'QTD PARCELAS'], ['VALOR'])
        mapeamento['balao_total'] = encontrarColuna(['BALÃO TOTAL', 'BALAO TOTAL', 'TOTAL BALÃO'])
        mapeamento['qtd_balao'] = encontrarColuna(['QTD BALÃO', 'QUANTIDADE BALÃO', 'QTD BALAO'])
        mapeamento['valor_balao'] = encontrarColuna(['VALOR BALÃO', 'VALOR BALAO'])
        mapeamento['saldo_remanescente'] = encontrarColuna(['SALDO REMANECENTE', 'SALDO'])
        mapeamento['corretor'] = encontrarColuna(['CORRETOR', 'CORRETOR(CORRETOR DA VENDA)', 'CORRETOR (CORRETOR DA VENDA)', 'VENDEDOR'])
        
        return mapeamento
      }

      const mapeamento = mapearColunas()
      
      // DEBUG: Log do mapeamento de colunas
      console.log('🔍 DEBUG Mapeamento de colunas:', {
        parcelas_col: mapeamento['parcelas'],
        valor_parcelas_col: mapeamento['valor_parcelas'],
        cabecalhos: cabecalhos.map((h, i) => ({ indice: i, nome: h }))
      })
      
      // Verificar colunas obrigatórias (CLIENTE é opcional)
      const colunasObrigatorias = ['empreendimento', 'data_venda', 'total_imovel', 'corretor']
      const colunasFaltando = colunasObrigatorias.filter(col => 
        mapeamento[col] === undefined || mapeamento[col] === -1
      )
      
      if (colunasFaltando.length > 0) {
        const nomesColunas = {
          'empreendimento': 'EMPREENDIMENTO',
          'cliente': 'CLIENTE',
          'data_venda': 'DATA DA VENDA',
          'total_imovel': 'TOTAL IMÓVEL',
          'corretor': 'CORRETOR'
        }
        throw new Error(`Colunas obrigatórias não encontradas: ${colunasFaltando.map(c => nomesColunas[c] || c).join(', ')}`)
      }

      // Processar linhas
      const linhasProcessadas = []
      for (let i = 1; i < jsonData.length; i++) {
        const linha = jsonData[i]
        if (linha.every(cell => !cell || cell.toString().trim() === '')) continue

        const linhaProcessada = {
          linha_original: i + 1,
          empreendimento_nome: mapeamento['empreendimento'] !== -1 
            ? linha[mapeamento['empreendimento']]?.toString().trim() || '' 
            : '',
          torre: mapeamento['torre'] !== -1 
            ? linha[mapeamento['torre']]?.toString().trim().toUpperCase() || '' 
            : '',
          unidade: mapeamento['unidade'] !== -1 
            ? linha[mapeamento['unidade']]?.toString().trim() || '' 
            : '',
          andar: mapeamento['andar'] !== -1 
            ? linha[mapeamento['andar']]?.toString().trim() || '' 
            : '',
          cliente_nome: mapeamento['cliente'] !== -1 
            ? linha[mapeamento['cliente']]?.toString().trim() || '' 
            : '',
          data_venda: mapeamento['data_venda'] !== -1 
            ? (linha[mapeamento['data_venda']] !== undefined && linha[mapeamento['data_venda']] !== null 
                ? (typeof linha[mapeamento['data_venda']] === 'number' 
                    ? linha[mapeamento['data_venda']] 
                    : linha[mapeamento['data_venda']].toString().trim()) 
                : '') 
            : '',
          total_imovel: mapeamento['total_imovel'] !== -1 
            ? linha[mapeamento['total_imovel']]?.toString().trim() || '' 
            : '',
          sinal: mapeamento['sinal'] !== -1 
            ? linha[mapeamento['sinal']]?.toString().trim() || '' 
            : '',
          parcelas: mapeamento['parcelas'] !== -1 
            ? (linha[mapeamento['parcelas']] !== undefined && linha[mapeamento['parcelas']] !== null
                ? (typeof linha[mapeamento['parcelas']] === 'number'
                    ? linha[mapeamento['parcelas']].toString()
                    : linha[mapeamento['parcelas']].toString().trim())
                : '')
            : '',
          valor_parcelas: mapeamento['valor_parcelas'] !== -1 
            ? (linha[mapeamento['valor_parcelas']] !== undefined && linha[mapeamento['valor_parcelas']] !== null
                ? (typeof linha[mapeamento['valor_parcelas']] === 'number'
                    ? linha[mapeamento['valor_parcelas']].toString()
                    : linha[mapeamento['valor_parcelas']].toString().trim())
                : '')
            : '',
          balao_total: mapeamento['balao_total'] !== -1 
            ? linha[mapeamento['balao_total']]?.toString().trim() || '' 
            : '',
          qtd_balao: mapeamento['qtd_balao'] !== -1 
            ? linha[mapeamento['qtd_balao']]?.toString().trim() || '' 
            : '',
          valor_balao: mapeamento['valor_balao'] !== -1 
            ? linha[mapeamento['valor_balao']]?.toString().trim() || '' 
            : '',
          saldo_remanescente: mapeamento['saldo_remanescente'] !== -1 
            ? linha[mapeamento['saldo_remanescente']]?.toString().trim() || '' 
            : '',
          corretor_nome: mapeamento['corretor'] !== -1 
            ? linha[mapeamento['corretor']]?.toString().trim() || '' 
            : ''
        }

        linhasProcessadas.push(linhaProcessada)
      }

      if (linhasProcessadas.length === 0) {
        throw new Error('Nenhuma linha de dados válida encontrada')
      }

      setDadosPreview(linhasProcessadas)
      setResultado(null)
      setLog(null)
    } catch (error) {
      console.error('Erro ao processar arquivo:', error)
      alert(`Erro ao processar arquivo: ${error.message}`)
    }
  }

  // Executar importação
  const executarImportacao = async () => {
    if (!dadosPreview || dadosPreview.length === 0) {
      alert('Nenhum dado para importar')
      return
    }

    setProcessando(true)
    cancelarRef.current = false
    setResultado(null)

    const linhasProcessar = modoTeste ? dadosPreview.slice(0, 10) : dadosPreview
    const logInicial = {
      data_importacao: new Date().toISOString(),
      modo: modoTeste ? 'teste' : 'completo',
      total_linhas: dadosPreview.length,
      linhas_processadas: linhasProcessar.length,
      estatisticas: {
        sucesso: 0,
        erros: 0,
        duplicados: 0,
        vendas_criadas: 0
      },
      detalhes: []
    }

    let logAtual = { ...logInicial }

    try {
      for (let i = 0; i < linhasProcessar.length; i++) {
        if (cancelarRef.current) {
          logAtual.estatisticas.cancelado = true
          break
        }

        const linha = linhasProcessar[i]
        const detalheLinha = {
          linha: linha.linha_original,
          status: 'processando',
          erro: null,
          venda_id: null,
          avisos: []
        }

        try {
          // ========== VALIDAÇÕES OBRIGATÓRIAS ==========
          
          // 1. Validar campos obrigatórios
          if (!linha.empreendimento_nome || linha.empreendimento_nome.trim() === '') {
            throw new Error('Empreendimento é obrigatório')
          }
          if (!linha.data_venda || linha.data_venda.toString().trim() === '') {
            throw new Error('Data da venda é obrigatória')
          }
          if (!linha.total_imovel || linha.total_imovel.toString().trim() === '') {
            throw new Error('Valor total do imóvel é obrigatório')
          }
          if (!linha.corretor_nome || linha.corretor_nome.trim() === '') {
            throw new Error('Corretor é obrigatório')
          }

          // 2. Buscar e validar relacionamentos
          const empreendimento = buscarEmpreendimento(linha.empreendimento_nome)
          if (!empreendimento) {
            throw new Error(`Empreendimento não encontrado: "${linha.empreendimento_nome}". Verifique se o nome está correto.`)
          }

          const corretor = buscarCorretor(linha.corretor_nome)
          if (!corretor) {
            throw new Error(`Corretor não encontrado: "${linha.corretor_nome}". Verifique se o nome está correto.`)
          }

          // CLIENTE é OPCIONAL - se não encontrar, usar null
          const cliente = linha.cliente_nome && linha.cliente_nome.trim() 
            ? buscarCliente(linha.cliente_nome) 
            : null
          
          if (linha.cliente_nome && linha.cliente_nome.trim() && !cliente) {
            detalheLinha.avisos.push(`Cliente não encontrado: "${linha.cliente_nome}". A venda será criada sem cliente associado.`)
          }

          // 3. Validar e converter valores numéricos
          const valorVendaValidacao = validarValor(linha.total_imovel)
          if (!valorVendaValidacao.valido || valorVendaValidacao.valor <= 0) {
            throw new Error(`Valor do imóvel inválido: "${linha.total_imovel}". Deve ser um número maior que zero.`)
          }
          const valorVenda = valorVendaValidacao.valor

          // 4. Validar e converter data
          const dataVenda = converterData(linha.data_venda)
          if (!dataVenda) {
            throw new Error(`Data da venda inválida: "${linha.data_venda}". Use o formato DD/MM/AAAA, AAAA-MM-DD ou uma data válida do Excel.`)
          }

          // Validação adicional: verificar se a data não é absurda
          const dataVendaObj = new Date(dataVenda)
          const ano = dataVendaObj.getFullYear()
          if (ano < 1900 || ano > 2100) {
            throw new Error(`Ano da data inválido: ${ano}. A data deve estar entre 1900 e 2100.`)
          }

          // Validar se data não é futura (aviso, não bloqueia)
          const hoje = new Date()
          hoje.setHours(23, 59, 59, 999)
          if (dataVendaObj > hoje) {
            detalheLinha.avisos.push(`Data da venda é futura: ${dataVenda}`)
          }

          // 5. Validar valores opcionais
          const valorSinalValidacao = validarValor(linha.sinal)
          if (!valorSinalValidacao.valido && linha.sinal) {
            detalheLinha.avisos.push(`Valor do sinal inválido: "${linha.sinal}". Será ignorado.`)
          }
          const valorSinal = valorSinalValidacao.valido ? valorSinalValidacao.valor : 0

          const qtdParcelas = linha.parcelas ? parseInt(linha.parcelas) || 0 : 0
          if (qtdParcelas < 0) {
            detalheLinha.avisos.push(`Quantidade de parcelas inválida: "${linha.parcelas}". Será considerada como 0.`)
          }

          // DEBUG: Log dos valores lidos (apenas primeiras 3 linhas para não poluir o console)
          if ((linha.parcelas || linha.valor_parcelas) && linha.linha_original <= 4) {
            console.log(`🔍 DEBUG Linha ${linha.linha_original}:`, {
              parcelas_raw: linha.parcelas,
              valor_parcelas_raw: linha.valor_parcelas,
              tipo_parcelas: typeof linha.parcelas,
              tipo_valor_parcelas: typeof linha.valor_parcelas
            })
          }

          const valorParcelaValidacao = validarValor(linha.valor_parcelas)
          if (!valorParcelaValidacao.valido && linha.valor_parcelas) {
            detalheLinha.avisos.push(`Valor da parcela inválido: "${linha.valor_parcelas}". Será ignorado.`)
          }
          const valorParcela = valorParcelaValidacao.valido ? valorParcelaValidacao.valor : 0
          
          // Validação: valor da parcela deve ser >= 100
          if (qtdParcelas > 0 && valorParcela > 0 && valorParcela < 100) {
            throw new Error(`Valor da parcela (R$ ${valorParcela.toFixed(2)}) é menor que R$ 100,00. Verifique se está usando a coluna correta "VALOR PARCELAS" e não "PARCELAS".`)
          }
          
          // DEBUG: Log dos valores processados
          if (qtdParcelas > 0 || valorParcela > 0) {
            console.log(`✅ DEBUG Linha ${linha.linha_original} processada:`, {
              qtdParcelas,
              valorParcela,
              valorParcelaValidacao
            })
          }

          const qtdBalao = linha.qtd_balao ? parseInt(linha.qtd_balao) || 0 : 0
          if (qtdBalao < 0) {
            detalheLinha.avisos.push(`Quantidade de balões inválida: "${linha.qtd_balao}". Será considerada como 0.`)
          }

          const valorBalaoValidacao = validarValor(linha.valor_balao)
          if (!valorBalaoValidacao.valido && linha.valor_balao) {
            detalheLinha.avisos.push(`Valor do balão inválido: "${linha.valor_balao}". Será ignorado.`)
          }
          const valorBalao = valorBalaoValidacao.valido ? valorBalaoValidacao.valor : 0

          // 6. Validar lógica de negócio
          if (qtdParcelas > 0 && valorParcela <= 0) {
            throw new Error('Se informou quantidade de parcelas, o valor da parcela deve ser maior que zero')
          }
          if (qtdBalao > 0 && valorBalao <= 0) {
            throw new Error('Se informou quantidade de balões, o valor do balão deve ser maior que zero')
          }

          // 7. Verificar duplicata
          const isDuplicata = await verificarVendaDuplicada(
            empreendimento.id,
            linha.unidade || null,
            linha.torre || null,
            cliente.id,
            corretor.id,
            dataVenda
          )

          if (isDuplicata) {
            detalheLinha.status = 'duplicado'
            detalheLinha.erro = 'Venda duplicada: Já existe uma venda com os mesmos dados (Empreendimento, Cliente, Corretor, Data, Unidade e Bloco)'
            logAtual.estatisticas.duplicados++
            logAtual.detalhes.push(detalheLinha)
            setLog({ ...logAtual })
            continue
          }

          // 8. Calcular pro-soluto e fator de comissão
          const valorProSoluto = valorSinal + (qtdParcelas * valorParcela) + (qtdBalao * valorBalao)
          
          // Validar se pro-soluto não excede valor da venda
          if (valorProSoluto > valorVenda) {
            detalheLinha.avisos.push(`Valor pro-soluto (${valorProSoluto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}) excede o valor da venda (${valorVenda.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}).`)
          }

          // Fator pro-soluto (quanto do valor da venda é pro-soluto)
          const fatorProSoluto = valorProSoluto > 0 && valorVenda > 0 ? valorProSoluto / valorVenda : 0

          // 9. Calcular comissões
          const tipoCorretor = corretor.tipo_corretor || 'externo'
          const comissoesDinamicas = calcularComissoesDinamicas(valorVenda, empreendimento.id, tipoCorretor)
          
          if (comissoesDinamicas.cargos.length === 0) {
            throw new Error(`Nenhum cargo de comissão encontrado para o empreendimento "${empreendimento.nome}" e tipo de corretor "${tipoCorretor}". Configure os cargos no empreendimento primeiro.`)
          }

          // Fator de comissão = percentual total de comissão / 100
          // Ex: 7% -> 0.07, então parcela de R$ 1.000 x 0.07 = R$ 70 de comissão
          const fatorComissao = comissoesDinamicas.percentualTotal / 100

          // 10. Calcular comissão do corretor
          const cargoCorretor = comissoesDinamicas.cargos.find(c => 
            c.nome_cargo.toLowerCase().includes('corretor') || 
            c.nome_cargo.toLowerCase().includes('autônomo')
          )
          const comissaoCorretor = cargoCorretor ? cargoCorretor.valor : 0

          // Calcular primeiro vencimento (primeira parcela ou data da venda se não houver parcelas)
          let primeiroVencimento = dataVenda
          if (qtdParcelas > 0) {
            const dataPrimeiraParcela = new Date(dataVenda)
            dataPrimeiraParcela.setMonth(dataPrimeiraParcela.getMonth() + 1)
            primeiroVencimento = dataPrimeiraParcela.toISOString().split('T')[0]
          }

          // Calcular valor da entrada à vista (se não parcelou mas tem entrada)
          // Entrada à vista = valorProSoluto - valorSinal (se não houver parcelas)
          const valorEntradaAvista = qtdParcelas === 0 && valorProSoluto > valorSinal 
            ? valorProSoluto - valorSinal 
            : 0

          // ========== PREPARAR DADOS DA VENDA ==========
          const vendaData = {
            corretor_id: corretor.id,
            empreendimento_id: empreendimento.id,
            cliente_id: cliente?.id || null, // CLIENTE OPCIONAL
            nome_cliente: cliente?.nome_completo || linha.cliente_nome?.trim() || null,
            unidade: linha.unidade || null,
            bloco: linha.torre || null,
            andar: linha.andar || null,
            valor_venda: valorVenda,
            tipo_corretor: tipoCorretor,
            data_venda: dataVenda,
            descricao: `Unidade: ${linha.unidade || 'N/A'} | Torre: ${linha.torre || 'N/A'} | Andar: ${linha.andar || 'N/A'}`,
            status: 'pendente',
            teve_sinal: valorSinal > 0,
            valor_sinal: valorSinal || null,
            teve_entrada: qtdParcelas > 0 || valorEntradaAvista > 0,
            parcelou_entrada: qtdParcelas > 0,
            qtd_parcelas_entrada: qtdParcelas > 0 ? qtdParcelas : null,
            valor_parcela_entrada: qtdParcelas > 0 && valorParcela > 0 ? valorParcela : null,
            valor_entrada: valorEntradaAvista > 0 ? valorEntradaAvista : null, // Entrada à vista
            teve_balao: qtdBalao > 0 ? 'sim' : 'nao',
            qtd_balao: qtdBalao || null,
            valor_balao: valorBalao || null, // VALOR BALÃO → valor_balao
            valor_pro_soluto: valorProSoluto || null,
            fator_comissao: fatorProSoluto || null, // Fator pro-soluto (valorProSoluto / valorVenda)
            comissao_total: comissoesDinamicas.total,
            comissao_corretor: comissaoCorretor,
            primeiro_vencimento: primeiroVencimento,
            condicao: 'FINANCIAMENTO' // Padrão, pode ser ajustado se houver campo no Excel
          }

          // ========== INSERIR VENDA ==========
          const { data: vendaCriada, error: vendaError } = await supabase
            .from('vendas')
            .insert([vendaData])
            .select()
            .single()

          if (vendaError) {
            throw new Error(`Erro ao criar venda no banco de dados: ${vendaError.message}`)
          }

          const vendaId = vendaCriada.id

          // ========== SALVAR COMISSÕES POR CARGO ==========
          if (comissoesDinamicas.cargos.length > 0) {
            const comissoesData = comissoesDinamicas.cargos.map(c => ({
              venda_id: vendaId,
              cargo_id: c.cargo_id,
              nome_cargo: c.nome_cargo,
              percentual: c.percentual,
              valor_comissao: c.valor
            }))
            
            const { error: comissoesError } = await supabase
              .from('comissoes_venda')
              .insert(comissoesData)
            
            if (comissoesError) {
              throw new Error(`Erro ao salvar comissões: ${comissoesError.message}`)
            }
          }

          // ========== CRIAR PAGAMENTOS PRO-SOLUTO ==========
          // Só criar pagamentos se houver valor_pro_soluto > 0
          if (valorProSoluto > 0) {
            const pagamentos = []
            
            // Sinal
            if (valorSinal > 0) {
              pagamentos.push({
                venda_id: vendaId,
                tipo: 'sinal',
                valor: valorSinal,
                data_prevista: dataVenda,
                comissao_gerada: valorSinal * fatorComissao
              })
            }

            // Entrada à vista (se não parcelou mas tem entrada)
            if (qtdParcelas === 0 && valorEntradaAvista > 0) {
              pagamentos.push({
                venda_id: vendaId,
                tipo: 'entrada',
                valor: valorEntradaAvista,
                data_prevista: dataVenda,
                comissao_gerada: valorEntradaAvista * fatorComissao
              })
            }

            // Parcelas da entrada (se parcelou)
            if (qtdParcelas > 0 && valorParcela > 0) {
              for (let p = 1; p <= qtdParcelas; p++) {
                // Calcular data da parcela (mensalmente a partir da data da venda)
                const dataParcela = new Date(dataVenda)
                dataParcela.setMonth(dataParcela.getMonth() + p)
                
                pagamentos.push({
                  venda_id: vendaId,
                  tipo: 'parcela_entrada',
                  numero_parcela: p,
                  valor: valorParcela,
                  data_prevista: dataParcela.toISOString().split('T')[0],
                  comissao_gerada: valorParcela * fatorComissao
                })
              }
            }

            // Balões
            if (qtdBalao > 0 && valorBalao > 0) {
              // Calcular data do primeiro balão (se houver primeiro_vencimento, usar como base)
              const dataBaseBalao = primeiroVencimento ? new Date(primeiroVencimento) : new Date(dataVenda)
              
              for (let b = 1; b <= qtdBalao; b++) {
                // Calcular data do balão (mensalmente a partir da data base)
                const dataBalao = new Date(dataBaseBalao)
                dataBalao.setMonth(dataBalao.getMonth() + b)
                
                pagamentos.push({
                  venda_id: vendaId,
                  tipo: 'balao',
                  numero_parcela: b,
                  valor: valorBalao,
                  data_prevista: dataBalao.toISOString().split('T')[0],
                  comissao_gerada: valorBalao * fatorComissao
                })
              }
            }

            // Inserir pagamentos apenas se houver algum para inserir
            if (pagamentos.length > 0) {
              const { error: pagamentosError } = await supabase
                .from('pagamentos_prosoluto')
                .insert(pagamentos)
              
              if (pagamentosError) {
                console.error('Erro ao criar pagamentos:', pagamentosError)
                detalheLinha.avisos.push(`Aviso: Venda criada mas alguns pagamentos não foram salvos: ${pagamentosError.message}`)
              }
            }
          }

          // ========== SUCESSO ==========
          detalheLinha.status = 'sucesso'
          detalheLinha.venda_id = vendaId
          logAtual.estatisticas.sucesso++
          logAtual.estatisticas.vendas_criadas++

        } catch (error) {
          detalheLinha.status = 'erro'
          detalheLinha.erro = error.message
          logAtual.estatisticas.erros++
        }

        logAtual.detalhes.push(detalheLinha)
        setLog({ ...logAtual })
      }
    } catch (error) {
      console.error('Erro na importação:', error)
      alert(`Erro crítico na importação: ${error.message}`)
    } finally {
      setProcessando(false)
      setResultado(logAtual)
    }
  }

  // Cancelar importação
  const cancelarImportacao = () => {
    cancelarRef.current = true
    setProcessando(false)
  }

  // Salvar log JSON
  const salvarLogJson = () => {
    if (!log) {
      alert('Nenhum log disponível para salvar')
      return
    }

    try {
      const logParaSalvar = JSON.stringify(log, null, 2)
      const blob = new Blob([logParaSalvar], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      
      const dataHora = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const modo = log.modo || 'completo'
      const total = log.total_linhas || 0
      const sucesso = log.estatisticas?.sucesso || 0
      const cancelado = log.estatisticas?.cancelado ? '_cancelada' : ''
      
      a.download = `log_importacao_vendas_${dataHora}_${modo}_${total}linhas_${sucesso}sucesso${cancelado}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Erro ao salvar log:', error)
      alert('Erro ao salvar log JSON')
    }
  }

  return (
    <div className="importar-vendas-container">
      <div className="importar-header">
        <h2>Importar Vendas</h2>
        <p>Importe vendas em lote através de arquivo Excel com validação completa de dados</p>
      </div>

      {/* Modelo de Colunas */}
      <div className="modelo-colunas">
        <h3>
          <FileText size={20} />
          Modelo de Colunas Esperado
        </h3>
        <div className="modelo-tabela">
          <table>
            <thead>
              <tr>
                <th>Coluna</th>
                <th>Descrição</th>
                <th>Obrigatório</th>
              </tr>
            </thead>
            <tbody>
              {modeloColunas.map((col, idx) => (
                <tr key={idx}>
                  <td><strong>{col.nome}</strong></td>
                  <td>{col.descricao}</td>
                  <td>
                    {col.obrigatorio ? (
                      <span className="badge-obrigatorio">Sim</span>
                    ) : (
                      <span className="badge-opcional">Opcional</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload de Arquivo */}
      <div className="upload-section">
        <h3>
          <Upload size={20} />
          Selecionar Arquivo
        </h3>
        <div className="upload-area">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => {
              const file = e.target.files[0]
              if (file) {
                setArquivo(file)
                processarArquivo(file)
              }
            }}
            style={{ display: 'none' }}
          />
          <button
            className="btn-upload"
            onClick={() => fileInputRef.current?.click()}
            disabled={processando}
          >
            <Upload size={20} />
            {arquivo ? 'Trocar Arquivo' : 'Selecionar Arquivo Excel'}
          </button>
          {arquivo && (
            <div className="arquivo-info">
              <FileText size={16} />
              <span>{arquivo.name}</span>
            </div>
          )}
        </div>
      </div>

      {/* Preview dos Dados */}
      {dadosPreview.length > 0 && (
        <div className="preview-section">
          <h3>
            <FileText size={20} />
            Preview dos Dados ({dadosPreview.length} linha{dadosPreview.length !== 1 ? 's' : ''})
          </h3>
          <div className="preview-controls">
            <label className="modo-teste">
              <input
                type="checkbox"
                checked={modoTeste}
                onChange={(e) => setModoTeste(e.target.checked)}
                disabled={processando}
              />
              <span>Testar com as primeiras 10 linhas</span>
            </label>
            {!modoTeste && (
              <div style={{ 
                marginTop: '10px', 
                padding: '10px', 
                background: 'rgba(34, 197, 94, 0.1)', 
                border: '1px solid rgba(34, 197, 94, 0.3)', 
                borderRadius: '6px',
                color: '#22c55e'
              }}>
                ✅ Modo completo ativado: Todas as {dadosPreview.length} linhas serão importadas
              </div>
            )}
          </div>
          <div className="preview-table-container">
            <table className="preview-table">
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>Empreendimento</th>
                  <th>Torre</th>
                  <th>Unidade</th>
                  <th>Andar</th>
                  <th>Cliente</th>
                  <th>Corretor</th>
                  <th>Data Venda</th>
                  <th>Valor Total</th>
                </tr>
              </thead>
              <tbody>
                {dadosPreview.slice(0, 20).map((linha, idx) => (
                  <tr key={idx}>
                    <td>{linha.linha_original}</td>
                    <td>{linha.empreendimento_nome || <span className="text-muted">-</span>}</td>
                    <td>{linha.torre || <span className="text-muted">-</span>}</td>
                    <td>{linha.unidade || <span className="text-muted">-</span>}</td>
                    <td>{linha.andar || <span className="text-muted">-</span>}</td>
                    <td>{linha.cliente_nome || <span className="text-muted">-</span>}</td>
                    <td>{linha.corretor_nome || <span className="text-muted">-</span>}</td>
                    <td>
                      {linha.data_venda ? (
                        (() => {
                          const dataConvertida = converterData(linha.data_venda)
                          if (dataConvertida) {
                            const [ano, mes, dia] = dataConvertida.split('-')
                            return `${dia}/${mes}/${ano}`
                          }
                          return linha.data_venda.toString()
                        })()
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td>{linha.total_imovel || <span className="text-muted">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {dadosPreview.length > 20 && (
              <p className="preview-more">Mostrando 20 de {dadosPreview.length} linhas</p>
            )}
          </div>
        </div>
      )}

      {/* Botões de Ação */}
      {dadosPreview.length > 0 && !processando && !resultado && (
        <div className="acoes-section">
          <div style={{ marginBottom: '15px', padding: '12px', background: modoTeste ? 'rgba(251, 191, 36, 0.1)' : 'rgba(34, 197, 94, 0.1)', border: `1px solid ${modoTeste ? 'rgba(251, 191, 36, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`, borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: modoTeste ? '#fbbf24' : '#22c55e', fontWeight: '500' }}>
              {modoTeste ? (
                <>
                  <span>⚠️</span>
                  <span>Modo TESTE: Apenas as primeiras 10 linhas serão importadas</span>
                </>
              ) : (
                <>
                  <span>✅</span>
                  <span>Modo COMPLETO: Todas as {dadosPreview.length} linhas serão importadas</span>
                </>
              )}
            </div>
            <div style={{ marginTop: '8px', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)' }}>
              {modoTeste ? 'Desmarque o checkbox acima para importar todas as linhas' : 'Clique no botão abaixo para iniciar a importação completa'}
            </div>
          </div>
          <button
            className="btn-primary"
            onClick={executarImportacao}
            style={{ width: '100%' }}
          >
            <Upload size={20} />
            {modoTeste ? `Testar Importação (10 linhas)` : `Importar Tudo (${dadosPreview.length} linhas)`}
          </button>
        </div>
      )}

      {/* Processando */}
      {processando && (
        <div className="processando-section">
          <div className="processando-spinner"></div>
          <p>Processando importação...</p>
          <button
            className="btn-cancelar"
            onClick={cancelarImportacao}
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Resultado */}
      {resultado && (
        <div className="resultado-section">
          <h3>
            {resultado.estatisticas.erros === 0 ? (
              <CheckCircle size={20} className="icon-success" />
            ) : (
              <AlertCircle size={20} className="icon-warning" />
            )}
            Resultado da Importação
          </h3>
          
          <div className="estatisticas-grid">
            <div className="stat-card success">
              <div className="stat-value">{resultado.estatisticas.sucesso}</div>
              <div className="stat-label">Sucesso</div>
            </div>
            <div className="stat-card error">
              <div className="stat-value">{resultado.estatisticas.erros}</div>
              <div className="stat-label">Erros</div>
            </div>
            <div className="stat-card info">
              <div className="stat-value">{resultado.estatisticas.duplicados}</div>
              <div className="stat-label">Duplicados</div>
            </div>
            <div className="stat-card primary">
              <div className="stat-value">{resultado.estatisticas.vendas_criadas}</div>
              <div className="stat-label">Vendas Criadas</div>
            </div>
          </div>

          {log && (
            <div className="log-section">
              <button
                className="btn-download-log"
                onClick={salvarLogJson}
              >
                <Download size={16} />
                Salvar Log JSON
              </button>
            </div>
          )}

          {/* Detalhes dos Erros */}
          {resultado.estatisticas.erros > 0 && (
            <div className="erros-section">
              <h4>Erros Encontrados</h4>
              <div className="erros-list">
                {resultado.detalhes
                  .filter(d => d.status === 'erro')
                  .map((detalhe, idx) => (
                    <div key={idx} className="erro-item">
                      <strong>Linha {detalhe.linha}:</strong> {detalhe.erro}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Detalhes dos Duplicados */}
          {resultado.estatisticas.duplicados > 0 && (
            <div className="erros-section">
              <h4>Vendas Duplicadas (Ignoradas)</h4>
              <div className="erros-list">
                {resultado.detalhes
                  .filter(d => d.status === 'duplicado')
                  .map((detalhe, idx) => (
                    <div key={idx} className="erro-item" style={{ background: 'rgba(251, 191, 36, 0.1)', borderLeftColor: '#fbbf24' }}>
                      <strong>Linha {detalhe.linha}:</strong> {detalhe.erro}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ImportarVendas

