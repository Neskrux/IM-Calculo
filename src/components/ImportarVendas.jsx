import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { Upload, FileText, CheckCircle, AlertCircle, Download, Loader, X } from 'lucide-react'
import '../styles/ImportarVendas.css'

const ImportarVendas = ({ corretores, empreendimentos, clientes, onImportComplete }) => {
  const [arquivo, setArquivo] = useState(null)
  const [dadosProcessados, setDadosProcessados] = useState([])
  const [previewDados, setPreviewDados] = useState([])
  const [modoImportacao, setModoImportacao] = useState('teste') // 'teste' ou 'completo'
  const [processando, setProcessando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [logJson, setLogJson] = useState(null)
  const [mostrarPreview, setMostrarPreview] = useState(false)
  const fileInputRef = useRef(null)

  // Mapeamento de colunas da planilha para campos do banco
  const mapearColunas = (linha) => {
    return {
      // Dados básicos
      empreendimento_nome: linha['EMPREENDIMENTO'] || linha['Empreendimento'] || '',
      torre: linha['Torre'] || linha['TORRE'] || '',
      unidade: linha['Unidade'] || linha['UNIDADE'] || '',
      andar: linha['Andar'] || linha['ANDAR'] || '',
      situacao: linha['SITUAÇÃO'] || linha['Situação'] || '',
      aditivos: linha['ADITIVOS'] || linha['Aditivos'] || '',
      distratos: linha['DISTRATOS'] || linha['Distratos'] || '',
      cesao_direito: linha['CESÃO DE DIREITO'] || linha['Cesão de Direito'] || '',
      
      // Cliente
      cliente_nome: linha['CLIENTE'] || linha['Cliente'] || '',
      cliente_cpf: linha['CPF'] || '',
      cliente_email: linha['E-MAIL'] || linha['E-mail'] || linha['EMAIL'] || '',
      cliente_telefone: linha['TELEFONE'] || linha['Telefone'] || '',
      cliente_endereco: linha['ENDEREÇO - CEP'] || linha['Endereço - CEP'] || linha['ENDEREÇO'] || '',
      cliente_cep: linha['CEP'] || '',
      
      // Venda
      valor_venda: linha['TOTAL IMÓVEL(valor)'] || linha['TOTAL IMÓVEL'] || linha['Valor Total'] || '',
      sinal: linha['SINAL NEGOCIO'] || linha['Sinal Negócio'] || linha['SINAL'] || '',
      parcelas: linha['PARCELAS'] || linha['Parcelas'] || '',
      valor_parcela: linha['VALOR PARCELA'] || linha['Valor Parcela'] || linha['VALOR PARCELA'] || '',
      primeiro_vencimento: linha['1° VENCIMENTO'] || linha['1º VENCIMENTO'] || linha['Primeiro Vencimento'] || '',
      balao_total: linha['BALÃO TOTAL'] || linha['Balão Total'] || '',
      qtd_balao: linha['QTD BALÃO'] || linha['Qtd Balão'] || '',
      valor_balao: linha['VALOR BALÃO'] || linha['Valor Balão'] || '',
      vencimento_balao: linha['VENCIMENTO BALÃO'] || linha['Vencimento Balão'] || '',
      fgts: linha['FGTS'] || '',
      saldo_remanescente: linha['SALDO REMANECEN'] || linha['SALDO REMANESCENTE'] || '',
      condicao: linha['CONDIÇÃO'] || linha['Condição'] || 'FINANCIAMENTO',
      data_entrega: linha['DATA DE ENTREGA (contrato)'] || linha['Data de Entrega'] || '',
      data_assinatura: linha['ASSINATURA CONTRATO'] || linha['Assinatura Contrato'] || '',
      
      // Corretor
      corretor_nome: linha['CORRETOR'] || linha['Corretor'] || '',
      tipo_corretor: linha['INTERNA EXTERNA'] || linha['Interna Externa'] || linha['TIPO'] || '',
      
      // Linha original para referência
      linha_original: linha
    }
  }

  // Detectar irregularidades em valores
  const detectarIrregularidadesValor = (valor, campo) => {
    const irregularidades = []
    if (!valor || valor === '' || valor === '-') return irregularidades

    const str = String(valor).trim()

    // Verificar se tem múltiplos valores separados
    if (str.includes('  ') || str.match(/\d+[,\d]*\s+\d+[,\d]*/)) {
      irregularidades.push({
        tipo: 'multiplos_valores',
        descricao: 'Múltiplos valores detectados no mesmo campo',
        valor_original: str
      })
    }

    // Verificar se tem texto descritivo
    if (str.match(/[a-zA-Z]{3,}/) && !str.match(/^R\$\s*\d/)) {
      irregularidades.push({
        tipo: 'texto_descritivo',
        descricao: 'Campo contém texto descritivo ao invés de valor numérico',
        valor_original: str
      })
    }

    // Verificar se tem formatação estranha (R$ no meio, símbolos)
    if (str.includes('R$') && !str.match(/^R\$\s*\d/)) {
      irregularidades.push({
        tipo: 'formatacao_irregular',
        descricao: 'Formatação de moeda irregular',
        valor_original: str
      })
    }

    // Verificar se tem operadores matemáticos
    if (str.includes('+') || str.includes('-') || str.includes('*') || str.includes('/')) {
      irregularidades.push({
        tipo: 'operacao_matematica',
        descricao: 'Campo contém operação matemática',
        valor_original: str
      })
    }

    // Verificar se tem grupos (4X, 5X, etc)
    if (str.match(/\d+X\s*\d/)) {
      irregularidades.push({
        tipo: 'grupos_parcelas',
        descricao: 'Campo contém grupos de parcelas (ex: 4X 500,00)',
        valor_original: str
      })
    }

    return irregularidades
  }

  // Detectar irregularidades em datas
  const detectarIrregularidadesData = (data, campo) => {
    const irregularidades = []
    if (!data || data === '' || data === '-') return irregularidades

    const str = String(data).trim()

    // Verificar se tem texto adicional
    if (str.match(/[a-zA-Z]{3,}/)) {
      irregularidades.push({
        tipo: 'texto_adicional',
        descricao: 'Data contém texto adicional',
        valor_original: str
      })
    }

    // Verificar formato de data inválido
    const match = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
    if (match) {
      const [, dia, mes, ano] = match
      const diaNum = parseInt(dia)
      const mesNum = parseInt(mes)
      const anoNum = parseInt(ano.length === 2 ? `20${ano}` : ano)

      if (diaNum > 31 || mesNum > 12) {
        irregularidades.push({
          tipo: 'data_invalida',
          descricao: `Data com valores inválidos (dia: ${diaNum}, mês: ${mesNum})`,
          valor_original: str
        })
      }

      // Verificar se é data muito no passado ou futuro
      const hoje = new Date()
      const dataObj = new Date(anoNum, mesNum - 1, diaNum)
      const diffAnos = (dataObj - hoje) / (1000 * 60 * 60 * 24 * 365)
      
      if (diffAnos < -5) {
        irregularidades.push({
          tipo: 'data_passado_distante',
          descricao: 'Data muito no passado',
          valor_original: str
        })
      }
      
      if (diffAnos > 10) {
        irregularidades.push({
          tipo: 'data_futuro_distante',
          descricao: 'Data muito no futuro',
          valor_original: str
        })
      }
    } else if (!str.match(/^\d{4}-\d{2}-\d{2}$/)) {
      irregularidades.push({
        tipo: 'formato_data_invalido',
        descricao: 'Formato de data não reconhecido',
        valor_original: str
      })
    }

    // Verificar múltiplas datas
    const matches = str.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/g)
    if (matches && matches.length > 1) {
      irregularidades.push({
        tipo: 'multiplas_datas',
        descricao: `Múltiplas datas detectadas (${matches.length})`,
        valor_original: str
      })
    }

    return irregularidades
  }

  // Detectar irregularidades em parcelas
  const detectarIrregularidadesParcelas = (parcelas, valorParcela) => {
    const irregularidades = []
    
    if (parcelas) {
      const strParcelas = String(parcelas).trim()
      
      // Verificar se tem texto
      if (strParcelas.match(/[a-zA-Z]{3,}/)) {
        irregularidades.push({
          tipo: 'parcelas_texto',
          descricao: 'Campo parcelas contém texto',
          valor_original: strParcelas
        })
      }

      // Verificar se tem múltiplos valores
      if (strParcelas.match(/\d+\s+\d+/)) {
        irregularidades.push({
          tipo: 'parcelas_multiplas',
          descricao: 'Múltiplos valores de parcelas',
          valor_original: strParcelas
        })
      }
    }

    if (valorParcela) {
      const irregValor = detectarIrregularidadesValor(valorParcela, 'valor_parcela')
      irregularidades.push(...irregValor)
    }

    return irregularidades
  }

  // Detectar irregularidades em balões
  const detectarIrregularidadesBalao = (balaoTotal, qtdBalao, valorBalao, vencimentoBalao) => {
    const irregularidades = []

    if (balaoTotal) {
      const irreg = detectarIrregularidadesValor(balaoTotal, 'balao_total')
      irregularidades.push(...irreg)
    }

    if (qtdBalao) {
      const strQtd = String(qtdBalao).trim()
      if (strQtd.match(/[a-zA-Z]/)) {
        irregularidades.push({
          tipo: 'qtd_balao_texto',
          descricao: 'Quantidade de balão contém texto',
          valor_original: strQtd
        })
      }
    }

    if (valorBalao) {
      const irreg = detectarIrregularidadesValor(valorBalao, 'valor_balao')
      irregularidades.push(...irreg)
    }

    if (vencimentoBalao) {
      const irreg = detectarIrregularidadesData(vencimentoBalao, 'vencimento_balao')
      irregularidades.push(...irreg)
    }

    return irregularidades
  }

  // Normalizar valores (com detecção de irregularidades)
  const normalizarValor = (valor) => {
    if (!valor || valor === '' || valor === '-') return null
    if (typeof valor === 'number') return valor
    
    const str = String(valor).trim()
    
    // Tentar extrair primeiro valor numérico se houver múltiplos
    let strLimpa = str
    
    // Remover R$ e símbolos
    strLimpa = strLimpa.replace(/R\$\s*/g, '').replace(/\$/g, '')
    
    // Se tiver múltiplos valores, pegar o primeiro
    const primeiroValor = strLimpa.match(/(\d+[,\d]*\.?\d*)/)
    if (primeiroValor) {
      strLimpa = primeiroValor[0]
    }
    
    strLimpa = strLimpa.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
    const num = parseFloat(strLimpa)
    return isNaN(num) ? null : num
  }

  const normalizarData = (data) => {
    if (!data || data === '' || data === '-') return null
    if (data instanceof Date) return data.toISOString().split('T')[0]
    const str = String(data)
    // Tentar vários formatos: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
    const match = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
    if (match) {
      const [, dia, mes, ano] = match
      const anoCompleto = ano.length === 2 ? `20${ano}` : ano
      return `${anoCompleto}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`
    }
    return null
  }

  const normalizarCPF = (cpf) => {
    if (!cpf) return null
    return String(cpf).replace(/[^\d]/g, '')
  }

  const normalizarTelefone = (telefone) => {
    if (!telefone) return null
    return String(telefone).replace(/[^\d]/g, '')
  }

  const normalizarCEP = (cep) => {
    if (!cep) return null
    const cepStr = String(cep).replace(/[^\d]/g, '')
    return cepStr.length === 8 ? cepStr : null
  }

  // Buscar ou criar corretor
  const buscarOuCriarCorretor = async (nome, tipo) => {
    if (!nome) return null

    const nomeNormalizado = nome.trim().toLowerCase()
    const tipoNormalizado = tipo?.trim().toLowerCase() || 'externo'
    const tipoFinal = tipoNormalizado.includes('intern') ? 'interno' : 'externo'

    // Buscar corretor existente
    const corretorExistente = corretores.find(c => 
      c.nome?.toLowerCase() === nomeNormalizado
    )

    if (corretorExistente) {
      return corretorExistente.id
    }

    // Criar novo corretor (sem email/senha por enquanto)
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: `${nomeNormalizado.replace(/\s+/g, '.')}@importado.temp`,
        password: 'Temp123!@#',
        options: {
          data: { nome }
        }
      })

      if (authError) {
        console.error('Erro ao criar corretor:', authError)
        return null
      }

      const { data: userData, error: userError } = await supabase
        .from('usuarios')
        .insert([{
          id: authData.user.id,
          email: `${nomeNormalizado.replace(/\s+/g, '.')}@importado.temp`,
          nome,
          tipo: 'corretor',
          tipo_corretor: tipoFinal
        }])
        .select()
        .single()

      if (userError) {
        console.error('Erro ao salvar corretor:', userError)
        return null
      }

      return userData.id
    } catch (error) {
      console.error('Erro ao criar corretor:', error)
      return null
    }
  }

  // Buscar ou criar cliente
  const buscarOuCriarCliente = async (dados) => {
    if (!dados.cliente_nome) return null

    const cpfNormalizado = normalizarCPF(dados.cliente_cpf)

    // Buscar por CPF se houver
    if (cpfNormalizado) {
      const clienteExistente = clientes.find(c => 
        normalizarCPF(c.cpf) === cpfNormalizado
      )

      if (clienteExistente) {
        return clienteExistente.id
      }
    }

    // Buscar por nome se não houver CPF
    if (!cpfNormalizado) {
      const clientePorNome = clientes.find(c => 
        c.nome_completo?.toLowerCase() === dados.cliente_nome.trim().toLowerCase()
      )

      if (clientePorNome) {
        return clientePorNome.id
      }
    }

    // Criar novo cliente
    try {
      const enderecoCompleto = dados.cliente_endereco || ''
      const cepSeparado = dados.cliente_cep || normalizarCEP(enderecoCompleto.split('-').pop()?.trim())

      const clienteData = {
        nome_completo: dados.cliente_nome.trim(),
        cpf: cpfNormalizado || null,
        email: dados.cliente_email || null,
        telefone: normalizarTelefone(dados.cliente_telefone) || null,
        endereco: enderecoCompleto.split('-')[0]?.trim() || null,
        cep: cepSeparado,
        valor_fgts: normalizarValor(dados.fgts)
      }

      const { data: clienteNovo, error: clienteError } = await supabase
        .from('clientes')
        .insert([clienteData])
        .select()
        .single()

      if (clienteError) {
        console.error('Erro ao criar cliente:', clienteError)
        return null
      }

      return clienteNovo.id
    } catch (error) {
      console.error('Erro ao criar cliente:', error)
      return null
    }
  }

  // Buscar empreendimento
  const buscarEmpreendimento = (nome) => {
    if (!nome) return null

    const nomeNormalizado = nome.trim().toLowerCase()
    const empreendimento = empreendimentos.find(e => 
      e.nome?.toLowerCase() === nomeNormalizado
    )

    return empreendimento?.id || null
  }

  // Validar linha
  const validarLinha = (dados, indice) => {
    const erros = []

    if (!dados.empreendimento_nome) {
      erros.push('Empreendimento não informado')
    }

    if (!dados.cliente_nome) {
      erros.push('Cliente não informado')
    }

    if (!dados.valor_venda || normalizarValor(dados.valor_venda) === null) {
      erros.push('Valor da venda inválido')
    }

    if (!dados.corretor_nome) {
      erros.push('Corretor não informado')
    }

    return {
      valida: erros.length === 0,
      erros
    }
  }

  // Processar arquivo Excel
  const processarArquivo = async (file) => {
    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array' })
      
      // Pegar primeira planilha
      const primeiraSheet = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[primeiraSheet]
      
      // Converter para JSON
      const dadosJson = XLSX.utils.sheet_to_json(worksheet)
      
      if (dadosJson.length === 0) {
        throw new Error('Planilha vazia')
      }

      // Mapear colunas
      const dadosMapeados = dadosJson.map((linha, indice) => ({
        indice: indice + 2, // +2 porque linha 1 é cabeçalho e arrays começam em 0
        ...mapearColunas(linha),
        validacao: validarLinha(mapearColunas(linha), indice)
      }))

      setDadosProcessados(dadosMapeados)
      setPreviewDados(dadosMapeados.slice(0, 5)) // Preview das 5 primeiras
      setMostrarPreview(true)
      setArquivo(file)
      setResultado(null)
      setLogJson(null)

    } catch (error) {
      console.error('Erro ao processar arquivo:', error)
      alert(`Erro ao processar arquivo: ${error.message}`)
    }
  }

  // Executar importação
  const executarImportacao = async () => {
    if (!dadosProcessados.length) return

    setProcessando(true)
    setResultado(null)
    setLogJson(null)

    const linhasParaProcessar = modoImportacao === 'teste' 
      ? dadosProcessados.slice(0, 10)
      : dadosProcessados

    const log = {
      timestamp: new Date().toISOString(),
      modo: modoImportacao,
      total_linhas: linhasParaProcessar.length,
      processadas: 0,
      sucesso: 0,
      erros: 0,
      detalhes: [],
      relacionamentos: {
        corretores_criados: [],
        clientes_criados: [],
        empreendimentos_nao_encontrados: []
      },
      irregularidades: [] // Nova seção para irregularidades
    }

    try {
      for (let i = 0; i < linhasParaProcessar.length; i++) {
        const linha = linhasParaProcessar[i]
        const detalheLinha = {
          linha: linha.indice,
          status: 'processando',
          erros: [],
          avisos: [],
          venda_id: null,
          relacionamentos: {}
        }

        try {
          // Detectar irregularidades ANTES de validar
          const irregularidades = []
          
          // Irregularidades em valor_parcela
          const irregValorParcela = detectarIrregularidadesValor(linha.valor_parcela, 'valor_parcela')
          if (irregValorParcela.length > 0) {
            irregularidades.push({
              campo: 'valor_parcela',
              valor_original: linha.valor_parcela,
              tipos: irregValorParcela
            })
          }

          // Irregularidades em parcelas
          const irregParcelas = detectarIrregularidadesParcelas(linha.parcelas, linha.valor_parcela)
          if (irregParcelas.length > 0) {
            irregularidades.push({
              campo: 'parcelas',
              valor_original: linha.parcelas,
              tipos: irregParcelas
            })
          }

          // Irregularidades em primeiro_vencimento
          const irregPrimeiroVenc = detectarIrregularidadesData(linha.primeiro_vencimento, 'primeiro_vencimento')
          if (irregPrimeiroVenc.length > 0) {
            irregularidades.push({
              campo: 'primeiro_vencimento',
              valor_original: linha.primeiro_vencimento,
              tipos: irregPrimeiroVenc
            })
          }

          // Irregularidades em balões
          const irregBalao = detectarIrregularidadesBalao(
            linha.balao_total,
            linha.qtd_balao,
            linha.valor_balao,
            linha.vencimento_balao
          )
          if (irregBalao.length > 0) {
            irregularidades.push({
              campo: 'balao',
              valor_original: {
                balao_total: linha.balao_total,
                qtd_balao: linha.qtd_balao,
                valor_balao: linha.valor_balao,
                vencimento_balao: linha.vencimento_balao
              },
              tipos: irregBalao
            })
          }

          // Registrar irregularidades no log
          if (irregularidades.length > 0) {
            const registroIrregularidade = {
              linha: linha.indice,
              irregularidades: irregularidades,
              processada: false,
              venda_id: null,
              campos_processados: {},
              campos_com_erro: []
            }
            log.irregularidades.push(registroIrregularidade)
          }

          // Validar linha
          if (!linha.validacao.valida) {
            detalheLinha.status = 'erro'
            detalheLinha.erros = linha.validacao.erros
            
            // Atualizar registro de irregularidade se existir
            if (irregularidades.length > 0) {
              const regIrreg = log.irregularidades.find(r => r.linha === linha.indice)
              if (regIrreg) {
                regIrreg.processada = false
                regIrreg.campos_com_erro.push('validacao_geral')
                regIrreg.erro_impediu_geracao = true
                regIrreg.mensagem_erro = linha.validacao.erros.join('; ')
              }
            }
            
            log.erros++
            log.detalhes.push(detalheLinha)
            continue
          }

          // Buscar/criar relacionamentos
          const empreendimentoId = buscarEmpreendimento(linha.empreendimento_nome)
          if (!empreendimentoId) {
            detalheLinha.avisos.push(`Empreendimento "${linha.empreendimento_nome}" não encontrado`)
            log.relacionamentos.empreendimentos_nao_encontrados.push(linha.empreendimento_nome)
          }

          const corretorId = await buscarOuCriarCorretor(linha.corretor_nome, linha.tipo_corretor)
          if (!corretorId) {
            detalheLinha.erros.push('Não foi possível criar/buscar corretor')
            detalheLinha.status = 'erro'
            log.erros++
            log.detalhes.push(detalheLinha)
            continue
          }

          if (corretorId && !corretores.find(c => c.id === corretorId)) {
            detalheLinha.avisos.push(`Corretor "${linha.corretor_nome}" foi criado automaticamente`)
            log.relacionamentos.corretores_criados.push(linha.corretor_nome)
          }

          const clienteId = await buscarOuCriarCliente(linha)
          if (!clienteId) {
            detalheLinha.erros.push('Não foi possível criar/buscar cliente')
            detalheLinha.status = 'erro'
            log.erros++
            log.detalhes.push(detalheLinha)
            continue
          }

          if (clienteId && !clientes.find(c => c.id === clienteId)) {
            detalheLinha.avisos.push(`Cliente "${linha.cliente_nome}" foi criado automaticamente`)
            log.relacionamentos.clientes_criados.push(linha.cliente_nome)
          }

          detalheLinha.relacionamentos = {
            empreendimento_id: empreendimentoId,
            corretor_id: corretorId,
            cliente_id: clienteId
          }

          // Preparar dados da venda
          const valorVenda = normalizarValor(linha.valor_venda)
          const tipoCorretor = linha.tipo_corretor?.toLowerCase().includes('intern') ? 'interno' : 'externo'

          // Calcular comissões
          let comissaoTotal = 0
          let comissaoCorretor = 0
          let fatorComissao = 0

          // Buscar corretor atualizado (pode ter sido criado)
          const { data: corretorAtualizado } = await supabase
            .from('usuarios')
            .select('*')
            .eq('id', corretorId)
            .single()

          const corretor = corretorAtualizado || corretores.find(c => c.id === corretorId)
          const isCorretorAutonomo = corretor && !corretor.empreendimento_id && corretor.percentual_corretor

          if (isCorretorAutonomo) {
            // Corretor autônomo: usa percentual do corretor
            const percentualCorretor = parseFloat(corretor.percentual_corretor) || 0
            comissaoCorretor = (valorVenda * percentualCorretor) / 100
            comissaoTotal = comissaoCorretor
            fatorComissao = percentualCorretor / 100
          } else if (empreendimentoId) {
            // Corretor vinculado: usa cargos do empreendimento
            const emp = empreendimentos.find(e => e.id === empreendimentoId)
            if (emp && emp.cargos) {
              const cargosDoTipo = emp.cargos.filter(c => c.tipo_corretor === tipoCorretor) || []
              const percentualTotal = cargosDoTipo.reduce((acc, c) => acc + parseFloat(c.percentual || 0), 0)
              comissaoTotal = (valorVenda * percentualTotal) / 100
              fatorComissao = percentualTotal / 100

              // Encontrar comissão do corretor específico
              const cargoCorretor = cargosDoTipo.find(c => c.id === corretor?.cargo_id)
              if (cargoCorretor) {
                comissaoCorretor = (valorVenda * parseFloat(cargoCorretor.percentual)) / 100
              } else {
                // Fallback: usar percentual padrão
                const percentualPadrao = tipoCorretor === 'interno' ? 2.5 : 3.5
                comissaoCorretor = (valorVenda * percentualPadrao) / 100
              }
            } else {
              // Fallback se não encontrar empreendimento
              const percentualPadrao = tipoCorretor === 'interno' ? 2.5 : 3.5
              comissaoCorretor = (valorVenda * percentualPadrao) / 100
              comissaoTotal = comissaoCorretor
              fatorComissao = percentualPadrao / 100
            }
          } else {
            // Sem empreendimento: usar percentual padrão
            const percentualPadrao = tipoCorretor === 'interno' ? 2.5 : 3.5
            comissaoCorretor = (valorVenda * percentualPadrao) / 100
            comissaoTotal = comissaoCorretor
            fatorComissao = percentualPadrao / 100
          }

          const vendaData = {
            corretor_id: corretorId,
            empreendimento_id: empreendimentoId,
            cliente_id: clienteId,
            unidade: linha.unidade || null,
            bloco: linha.torre?.toUpperCase() || null,
            andar: linha.andar || null,
            valor_venda: valorVenda,
            tipo_corretor: tipoCorretor,
            data_venda: normalizarData(linha.data_assinatura) || new Date().toISOString().split('T')[0],
            condicao: linha.condicao || 'FINANCIAMENTO',
            primeiro_vencimento: normalizarData(linha.primeiro_vencimento),
            valor_balao_unitario: normalizarValor(linha.valor_balao),
            vencimento_balao: normalizarData(linha.vencimento_balao),
            status: 'pendente',
            comissao_total: comissaoTotal,
            comissao_corretor: comissaoCorretor,
            fator_comissao: fatorComissao
          }

          // Inserir venda
          const { data: vendaInserida, error: vendaError } = await supabase
            .from('vendas')
            .insert([vendaData])
            .select()
            .single()

          if (vendaError) {
            detalheLinha.erros.push(`Erro ao inserir venda: ${vendaError.message}`)
            detalheLinha.status = 'erro'
            log.erros++
            log.detalhes.push(detalheLinha)
            continue
          }

          detalheLinha.venda_id = vendaInserida.id
          detalheLinha.status = 'sucesso'
          log.sucesso++
          log.processadas++

          // Atualizar registro de irregularidade se existir (marcar como processada)
          if (irregularidades.length > 0) {
            const regIrreg = log.irregularidades.find(r => r.linha === linha.indice)
            if (regIrreg) {
              regIrreg.processada = true
              regIrreg.venda_id = vendaInserida.id
              regIrreg.campos_processados = {
                venda: true,
                relacionamentos: {
                  corretor: !!corretorId,
                  cliente: !!clienteId,
                  empreendimento: !!empreendimentoId
                }
              }
              
              // Verificar quais campos irregulares foram processados com sucesso
              const camposProcessadosComSucesso = []
              const camposComErro = []
              
              // Tentar processar valor_parcela mesmo com irregularidades
              if (irregularidades.some(i => i.campo === 'valor_parcela')) {
                const valorNormalizado = normalizarValor(linha.valor_parcela)
                if (valorNormalizado !== null) {
                  camposProcessadosComSucesso.push('valor_parcela (normalizado)')
                } else {
                  camposComErro.push('valor_parcela (não foi possível normalizar)')
                }
              }
              
              // Tentar processar primeiro_vencimento
              if (irregularidades.some(i => i.campo === 'primeiro_vencimento')) {
                const dataNormalizada = normalizarData(linha.primeiro_vencimento)
                if (dataNormalizada !== null) {
                  camposProcessadosComSucesso.push('primeiro_vencimento (normalizado)')
                } else {
                  camposComErro.push('primeiro_vencimento (não foi possível normalizar)')
                }
              }
              
              regIrreg.campos_processados.irregularidades = {
                processados_com_sucesso: camposProcessadosComSucesso,
                com_erro: camposComErro
              }
            }
          }

          // Criar pagamentos se houver dados
          const pagamentos = []

          // Sinal
          const valorSinal = normalizarValor(linha.sinal)
          if (valorSinal && valorSinal > 0) {
            pagamentos.push({
              venda_id: vendaInserida.id,
              tipo: 'sinal',
              valor: valorSinal,
              data_prevista: normalizarData(linha.data_assinatura) || vendaData.data_venda,
              status: 'pendente',
              comissao_gerada: valorSinal * fatorComissao
            })
          }

          // Entrada (se houver valor_parcela e parcelas)
          // Tentar extrair quantidade de parcelas mesmo com irregularidades
          let qtdParcelas = 0
          const strParcelas = String(linha.parcelas || '').trim()
          const matchParcelas = strParcelas.match(/^(\d+)/)
          if (matchParcelas) {
            qtdParcelas = parseInt(matchParcelas[1]) || 0
          } else {
            qtdParcelas = parseInt(linha.parcelas) || 0
          }
          
          const valorParcela = normalizarValor(linha.valor_parcela)
          
          // Se houver irregularidades mas conseguimos normalizar, criar pagamentos
          if (qtdParcelas > 0 && valorParcela && valorParcela > 0) {
            const primeiroVencimento = normalizarData(linha.primeiro_vencimento) || vendaData.data_venda
            const dataBase = new Date(primeiroVencimento)

            for (let p = 1; p <= qtdParcelas; p++) {
              const dataVencimento = new Date(dataBase)
              dataVencimento.setMonth(dataVencimento.getMonth() + (p - 1))

              pagamentos.push({
                venda_id: vendaInserida.id,
                tipo: 'parcela_entrada',
                numero_parcela: p,
                valor: valorParcela,
                data_prevista: dataVencimento.toISOString().split('T')[0],
                status: 'pendente',
                comissao_gerada: valorParcela * fatorComissao
              })
            }
          }

          // Balões
          // Tentar extrair quantidade mesmo com irregularidades
          let qtdBalao = 0
          const strQtdBalao = String(linha.qtd_balao || '').trim()
          const matchQtdBalao = strQtdBalao.match(/^(\d+)/)
          if (matchQtdBalao) {
            qtdBalao = parseInt(matchQtdBalao[1]) || 0
          } else {
            qtdBalao = parseInt(linha.qtd_balao) || 0
          }
          
          const valorBalaoUnitario = normalizarValor(linha.valor_balao)
          
          // Se houver irregularidades mas conseguimos normalizar, criar balões
          if (qtdBalao > 0 && valorBalaoUnitario && valorBalaoUnitario > 0) {
            const vencimentoBalao = normalizarData(linha.vencimento_balao)
            const dataBase = vencimentoBalao ? new Date(vencimentoBalao) : new Date()

            for (let b = 1; b <= qtdBalao; b++) {
              const dataVencimento = new Date(dataBase)
              dataVencimento.setMonth(dataVencimento.getMonth() + (b - 1))

              pagamentos.push({
                venda_id: vendaInserida.id,
                tipo: 'balao',
                numero_parcela: b,
                valor: valorBalaoUnitario,
                data_prevista: dataVencimento.toISOString().split('T')[0],
                status: 'pendente',
                comissao_gerada: valorBalaoUnitario * fatorComissao
              })
            }
          }

          // Inserir pagamentos se houver
          if (pagamentos.length > 0) {
            const { error: pagError } = await supabase
              .from('pagamentos_prosoluto')
              .insert(pagamentos)

            if (pagError) {
              detalheLinha.avisos.push(`Aviso: Erro ao criar pagamentos: ${pagError.message}`)
              
              // Atualizar registro de irregularidade se existir
              if (irregularidades.length > 0) {
                const regIrreg = log.irregularidades.find(r => r.linha === linha.indice)
                if (regIrreg) {
                  regIrreg.campos_com_erro.push('pagamentos')
                  regIrreg.erro_pagamentos = pagError.message
                }
              }
            } else {
              // Atualizar registro de irregularidade - pagamentos criados com sucesso
              if (irregularidades.length > 0) {
                const regIrreg = log.irregularidades.find(r => r.linha === linha.indice)
                if (regIrreg && regIrreg.campos_processados.irregularidades) {
                  regIrreg.campos_processados.irregularidades.pagamentos_criados = pagamentos.length
                }
              }
            }
          } else if (irregularidades.length > 0) {
            // Se não criou pagamentos mas tinha irregularidades, registrar
            const regIrreg = log.irregularidades.find(r => r.linha === linha.indice)
            if (regIrreg) {
              regIrreg.campos_com_erro.push('pagamentos_nao_criados')
              regIrreg.mensagem_erro = 'Não foi possível criar pagamentos devido a irregularidades nos dados'
            }
          }

          log.detalhes.push(detalheLinha)

        } catch (error) {
          detalheLinha.status = 'erro'
          detalheLinha.erros.push(`Erro inesperado: ${error.message}`)
          
          // Atualizar registro de irregularidade se existir
          if (irregularidades.length > 0) {
            const regIrreg = log.irregularidades.find(r => r.linha === linha.indice)
            if (regIrreg) {
              regIrreg.processada = false
              regIrreg.erro_impediu_geracao = true
              regIrreg.mensagem_erro = `Erro inesperado: ${error.message}`
              regIrreg.campos_com_erro.push('erro_inesperado')
            }
          }
          
          log.erros++
          log.detalhes.push(detalheLinha)
        }
      }

      log.processadas = linhasParaProcessar.length

      setResultado({
        sucesso: log.sucesso,
        erros: log.erros,
        total: log.total_linhas
      })

      setLogJson(log)

      if (onImportComplete) {
        onImportComplete()
      }

    } catch (error) {
      console.error('Erro na importação:', error)
      alert(`Erro na importação: ${error.message}`)
    } finally {
      setProcessando(false)
    }
  }

  // Download do log JSON
  const downloadLog = () => {
    if (!logJson) return

    const jsonStr = JSON.stringify(logJson, null, 2)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `log_importacao_${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Resetar
  const resetar = () => {
    setArquivo(null)
    setDadosProcessados([])
    setPreviewDados([])
    setResultado(null)
    setLogJson(null)
    setMostrarPreview(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="importar-vendas-container">
      <div className="importar-vendas-header">
        <h2>Importar Vendas da Planilha</h2>
        <p>Faça upload de um arquivo Excel (.xlsx) para importar vendas em lote</p>
      </div>

      {!arquivo && (
        <div className="upload-area">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => {
              const file = e.target.files[0]
              if (file) processarArquivo(file)
            }}
            style={{ display: 'none' }}
          />
          <div
            className="upload-box"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={48} />
            <h3>Clique para selecionar arquivo Excel</h3>
            <p>Formatos suportados: .xlsx, .xls</p>
          </div>
        </div>
      )}

      {arquivo && !resultado && (
        <div className="importar-vendas-content">
          <div className="arquivo-info">
            <FileText size={20} />
            <span>{arquivo.name}</span>
            <button className="btn-remove" onClick={resetar}>
              <X size={16} />
            </button>
          </div>

          <div className="preview-section">
            <h3>Preview dos Dados</h3>
            <p>Total de linhas encontradas: <strong>{dadosProcessados.length}</strong></p>
            
            {mostrarPreview && (
              <div className="preview-table">
                <table>
                  <thead>
                    <tr>
                      <th>Linha</th>
                      <th>Empreendimento</th>
                      <th>Cliente</th>
                      <th>Corretor</th>
                      <th>Valor</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewDados.map((linha, idx) => (
                      <tr key={idx} className={!linha.validacao.valida ? 'erro' : ''}>
                        <td>{linha.indice}</td>
                        <td>{linha.empreendimento_nome || '-'}</td>
                        <td>{linha.cliente_nome || '-'}</td>
                        <td>{linha.corretor_nome || '-'}</td>
                        <td>
                          {linha.valor_venda 
                            ? `R$ ${normalizarValor(linha.valor_venda)?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '-'}`
                            : '-'
                          }
                        </td>
                        <td>
                          {linha.validacao.valida ? (
                            <CheckCircle size={16} className="status-ok" />
                          ) : (
                            <AlertCircle size={16} className="status-erro" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {dadosProcessados.length > 5 && (
                  <p className="preview-note">
                    Mostrando 5 de {dadosProcessados.length} linhas
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="modo-importacao">
            <h3>Modo de Importação</h3>
            <div className="radio-group">
              <label className={modoImportacao === 'teste' ? 'active' : ''}>
                <input
                  type="radio"
                  value="teste"
                  checked={modoImportacao === 'teste'}
                  onChange={(e) => setModoImportacao(e.target.value)}
                />
                <span>Teste (10 primeiras linhas)</span>
              </label>
              <label className={modoImportacao === 'completo' ? 'active' : ''}>
                <input
                  type="radio"
                  value="completo"
                  checked={modoImportacao === 'completo'}
                  onChange={(e) => setModoImportacao(e.target.value)}
                />
                <span>Importação Completa ({dadosProcessados.length} linhas)</span>
              </label>
            </div>
          </div>

          <div className="opcoes-importacao">
            <h3>Opções</h3>
            <label>
              <input type="checkbox" defaultChecked disabled />
              <span>Gerar log JSON detalhado</span>
            </label>
            <label>
              <input type="checkbox" defaultChecked disabled />
              <span>Validar duplicados</span>
            </label>
            <label>
              <input type="checkbox" defaultChecked disabled />
              <span>Criar relacionamentos automaticamente</span>
            </label>
          </div>

          <div className="importar-actions">
            <button className="btn-secondary" onClick={resetar} disabled={processando}>
              Cancelar
            </button>
            <button
              className="btn-primary"
              onClick={executarImportacao}
              disabled={processando || dadosProcessados.length === 0}
            >
              {processando ? (
                <>
                  <Loader size={18} className="spinning" />
                  <span>Processando...</span>
                </>
              ) : (
                <>
                  <Upload size={18} />
                  <span>
                    {modoImportacao === 'teste' 
                      ? `Importar 10 Primeiras Linhas`
                      : `Importar ${dadosProcessados.length} Linhas`
                    }
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {resultado && (
        <div className="resultado-section">
          <h3>Resultado da Importação</h3>
          <div className="resultado-stats">
            <div className="stat-card success">
              <CheckCircle size={24} />
              <div>
                <span className="stat-value">{resultado.sucesso}</span>
                <span className="stat-label">Sucesso</span>
              </div>
            </div>
            <div className="stat-card error">
              <AlertCircle size={24} />
              <div>
                <span className="stat-value">{resultado.erros}</span>
                <span className="stat-label">Erros</span>
              </div>
            </div>
            <div className="stat-card info">
              <FileText size={24} />
              <div>
                <span className="stat-value">{resultado.total}</span>
                <span className="stat-label">Total</span>
              </div>
            </div>
          </div>

          {logJson && (
            <div className="log-section">
              <h4>Detalhes do Processamento</h4>
              {logJson.relacionamentos.corretores_criados.length > 0 && (
                <div className="info-box">
                  <strong>Corretores criados:</strong> {logJson.relacionamentos.corretores_criados.join(', ')}
                </div>
              )}
              {logJson.relacionamentos.clientes_criados.length > 0 && (
                <div className="info-box">
                  <strong>Clientes criados:</strong> {logJson.relacionamentos.clientes_criados.join(', ')}
                </div>
              )}
              {logJson.relacionamentos.empreendimentos_nao_encontrados.length > 0 && (
                <div className="warning-box">
                  <strong>Empreendimentos não encontrados:</strong> {logJson.relacionamentos.empreendimentos_nao_encontrados.join(', ')}
                </div>
              )}

              {logJson.irregularidades && logJson.irregularidades.length > 0 && (
                <div className="irregularidades-section">
                  <h4>⚠️ Irregularidades Detectadas</h4>
                  <p className="irregularidades-resumo">
                    <strong>{logJson.irregularidades.length}</strong> linha(s) com irregularidades encontradas
                  </p>
                  <div className="irregularidades-list">
                    {logJson.irregularidades.slice(0, 10).map((irreg, idx) => (
                      <div key={idx} className="irregularidade-item">
                        <div className="irregularidade-header">
                          <span className="irregularidade-linha">Linha {irreg.linha}</span>
                          {irreg.processada ? (
                            <span className="badge-success">Processada (ID: {irreg.venda_id})</span>
                          ) : (
                            <span className="badge-error">Erro - Não processada</span>
                          )}
                        </div>
                        <div className="irregularidade-detalhes">
                          {irreg.irregularidades.map((irr, i) => (
                            <div key={i} className="irregularidade-campo">
                              <strong>Campo:</strong> {irr.campo} | 
                              <strong> Tipos:</strong> {irr.tipos.map(t => t.tipo).join(', ')}
                            </div>
                          ))}
                          {irreg.erro_impediu_geracao && (
                            <div className="erro-impediu">
                              <strong>❌ Erro impediu geração:</strong> {irreg.mensagem_erro}
                            </div>
                          )}
                          {irreg.campos_processados.irregularidades && (
                            <div className="campos-processados">
                              <strong>✅ Campos processados com sucesso:</strong> {
                                irreg.campos_processados.irregularidades.processados_com_sucesso?.join(', ') || 'Nenhum'
                              }
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {logJson.irregularidades.length > 10 && (
                      <p className="irregularidades-note">
                        Mostrando 10 de {logJson.irregularidades.length} irregularidades. 
                        Veja o log JSON completo para todos os detalhes.
                      </p>
                    )}
                  </div>
                </div>
              )}

              <button className="btn-download" onClick={downloadLog}>
                <Download size={18} />
                <span>Baixar Log JSON</span>
              </button>
            </div>
          )}

          <div className="resultado-actions">
            <button className="btn-primary" onClick={resetar}>
              Nova Importação
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ImportarVendas

