import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import * as XLSX from 'xlsx'
import { Upload, FileText, CheckCircle, XCircle, AlertCircle, Download, FileDown } from 'lucide-react'
import '../styles/ImportarClientes.css'

const ImportarClientes = ({ clientes = [] }) => {
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
    { nome: 'CLIENTE', descricao: 'Nome completo do cliente', obrigatorio: true },
    { nome: 'CONJUGE', descricao: 'Nome completo do cônjuge', obrigatorio: false },
    { nome: 'CPF CLIENTE', descricao: 'CPF do cliente (formato: 000.000.000-00 ou 00000000000)', obrigatorio: true },
    { nome: 'CPF CONJUGUE', descricao: 'CPF do cônjuge (formato: 000.000.000-00 ou 00000000000)', obrigatorio: false },
    { nome: 'E-MAIL', descricao: 'E-mail do cliente', obrigatorio: false },
    { nome: 'FONE', descricao: 'Telefone do cliente (formato: (00) 00000-0000 ou 00000000000)', obrigatorio: false },
    { nome: 'FONE CONJUGUE', descricao: 'Telefone do cônjuge (formato: (00) 00000-0000 ou 00000000000)', obrigatorio: false },
    { nome: 'ENDERECO', descricao: 'Endereço completo do cliente', obrigatorio: false },
    { nome: 'CEP', descricao: 'CEP do cliente (formato: 00000-000 ou 00000000)', obrigatorio: false }
  ]

  // Funções de normalização
  // Normalizar CPF mantendo letras e números (para CPFs alfanuméricos)
  const normalizarCPF = (cpf) => {
    if (!cpf) return ''
    // Remove apenas formatação (pontos, hífens, espaços), mantém letras e números
    return cpf.toString().replace(/[.\-\s]/g, '').toUpperCase().trim()
  }

  const normalizarTelefone = (telefone) => {
    if (!telefone) return ''
    return telefone.toString().replace(/\D/g, '')
  }

  const normalizarCEP = (cep) => {
    if (!cep) return ''
    return cep.toString().replace(/\D/g, '')
  }

  // Extrair CEP do endereço (formato: "Rua Exemplo, 123 - Cidade, UF 12345-678")
  const extrairCEPDoEndereco = (endereco) => {
    if (!endereco) return null
    // Buscar padrão de CEP (8 dígitos, com ou sem hífen)
    const cepMatch = endereco.match(/\b(\d{5}-?\d{3})\b/)
    if (cepMatch) {
      return normalizarCEP(cepMatch[1])
    }
    return null
  }

  const formatarCPF = (cpf) => {
    if (!cpf) return ''
    const limpo = normalizarCPF(cpf)
    // Só formata se for apenas numérico e tiver 11 caracteres
    if (/^\d+$/.test(limpo) && limpo.length === 11) {
      return limpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
    }
    // Se for alfanumérico ou formato diferente, retorna como está
    return limpo
  }

  const formatarTelefone = (telefone) => {
    const limpo = normalizarTelefone(telefone)
    if (limpo.length === 11) {
      return limpo.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
    } else if (limpo.length === 10) {
      return limpo.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
    }
    return limpo
  }

  const formatarCEP = (cep) => {
    const limpo = normalizarCEP(cep)
    if (limpo.length === 8) {
      return limpo.replace(/(\d{5})(\d{3})/, '$1-$2')
    }
    return limpo
  }

  const validarEmail = (email) => {
    if (!email) return false
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return regex.test(email.toString().trim())
  }

  // Extrair emails múltiplos de uma string (cliente e cônjuge)
  const extrairEmails = (emailString) => {
    if (!emailString || !emailString.trim()) {
      return { email_cliente: null, email_conjuge: null }
    }

    // Limpar a string
    let texto = emailString.toString().trim()
    
    // Remover pontos finais soltos
    texto = texto.replace(/\.\s*$/, '')
    
    // Separar por espaços, barras, ou outros separadores comuns
    const separadores = [/\s+\/\s+/, /\s+/, /\/\s*/, /\s*\/\s*/]
    let partes = []
    
    for (const separador of separadores) {
      if (separador.test(texto)) {
        partes = texto.split(separador).map(p => p.trim()).filter(p => p)
        if (partes.length > 1) break
      }
    }
    
    // Se não separou, tentar uma única vez
    if (partes.length === 0) {
      partes = [texto]
    }

    // Extrair emails válidos
    const emailsValidos = []
    for (const parte of partes) {
      const emailLimpo = parte.trim().replace(/[.,;]$/, '') // Remove pontuação final
      if (validarEmail(emailLimpo)) {
        emailsValidos.push(emailLimpo.toLowerCase())
      }
    }

    return {
      email_cliente: emailsValidos[0] || null,
      email_conjuge: emailsValidos[1] || null
    }
  }

  const validarCPF = (cpf) => {
    if (!cpf) return false
    const limpo = normalizarCPF(cpf)
    // Aceita CPF alfanumérico ou numérico, mínimo 3 caracteres, máximo 14
    if (limpo.length < 3 || limpo.length > 14) return false
    // Validação básica: não pode ser todos os mesmos caracteres
    if (/^(.)\1+$/.test(limpo)) return false
    return true
  }

  // Processar arquivo Excel
  const processarArquivo = async (file) => {
    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array' })
      const primeiraAba = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[primeiraAba]
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' })

      if (jsonData.length < 2) {
        throw new Error('O arquivo deve ter pelo menos uma linha de cabeçalho e uma linha de dados')
      }

      // Primeira linha são os cabeçalhos
      const cabecalhos = jsonData[0].map(h => String(h).trim().toUpperCase())
      
      // Mapear colunas
      const mapearColunas = () => {
        const mapeamento = {}
        
        // Função auxiliar para encontrar coluna com variações
        const encontrarColuna = (variacoes) => {
          for (const variacao of variacoes) {
            const indice = cabecalhos.findIndex(h => {
              const hLimpo = h.replace(/[^A-Z0-9]/g, '')
              const vLimpo = variacao.replace(/[^A-Z0-9]/g, '')
              return h === variacao || 
                     h.includes(variacao) || 
                     variacao.includes(h) ||
                     hLimpo === vLimpo ||
                     hLimpo.includes(vLimpo) ||
                     vLimpo.includes(hLimpo)
            })
            if (indice !== -1) return indice
          }
          return -1
        }
        
        // Mapear colunas do cliente - IMPORTANTE: buscar na ordem correta para evitar conflitos
        mapeamento['cliente'] = encontrarColuna(['CLIENTE', 'NOME CLIENTE', 'NOME', 'NOME DO CLIENTE'])
        mapeamento['conjuge'] = encontrarColuna(['CONJUGE', 'CONJUGUE', 'CÔNJUGE', 'CÔNJUGE', 'NOME CONJUGE', 'NOME CONJUGUE'])
        
        // Buscar CPF CLIENTE de forma específica (não pode pegar CLIENTE)
        // Primeiro tenta encontrar "CPF CLIENTE" completo - deve conter "CPF" no início
        let cpfClienteIdx = -1
        for (const variacao of ['CPF CLIENTE', 'CPF DO CLIENTE', 'CPFCLIENTE']) {
          const indice = cabecalhos.findIndex((h, idx) => {
            const hUpper = h.toUpperCase().trim()
            const vUpper = variacao.toUpperCase().trim()
            // Match exato
            if (hUpper === vUpper) return true
            // Deve começar com "CPF" e conter "CLIENTE" (não pode ser só "CLIENTE")
            if (hUpper.startsWith('CPF') && hUpper.includes('CLIENTE')) return true
            // Match sem espaços/pontuação
            const hLimpo = hUpper.replace(/[^A-Z0-9]/g, '')
            const vLimpo = vUpper.replace(/[^A-Z0-9]/g, '')
            if (hLimpo === vLimpo && hLimpo.startsWith('CPF')) return true
            return false
          })
          if (indice !== -1 && indice !== mapeamento['cliente']) {
            cpfClienteIdx = indice
            break
          }
        }
        
        // Se não encontrou "CPF CLIENTE", buscar apenas "CPF" mas garantir que não é a coluna CLIENTE
        if (cpfClienteIdx === -1) {
          const indiceCPF = cabecalhos.findIndex((h, idx) => {
            const hUpper = h.toUpperCase().trim()
            // Deve ser exatamente "CPF" e não pode ser a coluna CLIENTE
            return hUpper === 'CPF' && idx !== mapeamento['cliente']
          })
          if (indiceCPF !== -1) {
            cpfClienteIdx = indiceCPF
          }
        }
        mapeamento['cpf_cliente'] = cpfClienteIdx
        
        // Buscar CPF CONJUGE de forma específica
        mapeamento['cpf_conjuge'] = encontrarColuna(['CPF CONJUGUE', 'CPF CONJUGE', 'CPF DO CONJUGE', 'CPF DO CÔNJUGE', 'CPFCONJUGUE'])
        mapeamento['email'] = encontrarColuna(['E-MAIL', 'EMAIL', 'E-MAIL CLIENTE', 'EMAIL CLIENTE'])
        mapeamento['fone'] = encontrarColuna(['FONE', 'TELEFONE', 'FONE CLIENTE', 'TELEFONE CLIENTE'])
        mapeamento['fone_conjuge'] = encontrarColuna(['FONE CONJUGUE', 'FONE CONJUGE', 'TELEFONE CONJUGUE', 'TELEFONE CONJUGE'])
        mapeamento['endereco'] = encontrarColuna(['ENDERECO', 'ENDEREÇO', 'ENDEREÇO CLIENTE', 'ENDERECO CLIENTE'])
        mapeamento['cep'] = encontrarColuna(['CEP', 'CEP CLIENTE'])
        
        return mapeamento
      }

      const mapeamento = mapearColunas()
      
      // Debug: mostrar cabeçalhos e mapeamento encontrado
      console.log('📋 Cabeçalhos encontrados:', cabecalhos)
      console.log('🗺️ Mapeamento de colunas:', mapeamento)
      console.log('✅ CLIENTE mapeado para índice:', mapeamento['cliente'], '->', cabecalhos[mapeamento['cliente']])
      console.log('✅ CPF CLIENTE mapeado para índice:', mapeamento['cpf_cliente'], '->', cabecalhos[mapeamento['cpf_cliente']])
      
      // Verificar se todas as colunas obrigatórias foram encontradas
      const colunasObrigatorias = ['cliente', 'cpf_cliente']
      const colunasFaltando = colunasObrigatorias.filter(col => mapeamento[col] === undefined || mapeamento[col] === -1)
      
      if (colunasFaltando.length > 0) {
        const nomesColunas = {
          'cliente': 'CLIENTE',
          'cpf_cliente': 'CPF CLIENTE'
        }
        throw new Error(`Colunas obrigatórias não encontradas: ${colunasFaltando.map(c => nomesColunas[c] || c).join(', ')}`)
      }

      // Processar linhas de dados
      const linhasProcessadas = []
      for (let i = 1; i < jsonData.length; i++) {
        const linha = jsonData[i]
        if (linha.every(cell => !cell || cell.toString().trim() === '')) continue // Pular linhas vazias

        const linhaProcessada = {
          linha_original: i + 1,
          cliente: mapeamento['cliente'] !== undefined && mapeamento['cliente'] !== -1 
            ? linha[mapeamento['cliente']]?.toString().trim() || '' 
            : '',
          conjuge: mapeamento['conjuge'] !== undefined && mapeamento['conjuge'] !== -1 
            ? linha[mapeamento['conjuge']]?.toString().trim() || '' 
            : '',
          cpf_cliente: mapeamento['cpf_cliente'] !== undefined && mapeamento['cpf_cliente'] !== -1 
            ? (linha[mapeamento['cpf_cliente']]?.toString().trim() || '') 
            : '',
          cpf_conjuge: mapeamento['cpf_conjuge'] !== undefined && mapeamento['cpf_conjuge'] !== -1 
            ? linha[mapeamento['cpf_conjuge']]?.toString().trim() || '' 
            : '',
          email: mapeamento['email'] !== undefined && mapeamento['email'] !== -1 
            ? linha[mapeamento['email']]?.toString().trim() || '' 
            : '',
          fone: mapeamento['fone'] !== undefined && mapeamento['fone'] !== -1 
            ? linha[mapeamento['fone']]?.toString().trim() || '' 
            : '',
          fone_conjuge: mapeamento['fone_conjuge'] !== undefined && mapeamento['fone_conjuge'] !== -1 
            ? linha[mapeamento['fone_conjuge']]?.toString().trim() || '' 
            : '',
          endereco: mapeamento['endereco'] !== undefined && mapeamento['endereco'] !== -1 
            ? linha[mapeamento['endereco']]?.toString().trim() || '' 
            : '',
          cep: mapeamento['cep'] !== undefined && mapeamento['cep'] !== -1 
            ? linha[mapeamento['cep']]?.toString().trim() || '' 
            : ''
        }

        // Extrair emails (pode ter cliente e cônjuge no mesmo campo)
        const emailsExtraidos = extrairEmails(linhaProcessada.email)
        linhaProcessada.email = emailsExtraidos.email_cliente || ''
        linhaProcessada.email_conjuge = emailsExtraidos.email_conjuge || ''

        // Extrair CEP do endereço se não foi fornecido separadamente
        if (!linhaProcessada.cep && linhaProcessada.endereco) {
          const cepExtraido = extrairCEPDoEndereco(linhaProcessada.endereco)
          if (cepExtraido) {
            linhaProcessada.cep = cepExtraido
            // Remover CEP do endereço para evitar duplicação
            linhaProcessada.endereco = linhaProcessada.endereco.replace(/\b\d{5}-?\d{3}\b/, '').trim()
          }
        }

        // Debug: log da primeira linha para verificar extração
        if (i === 1) {
          console.log('🔍 Primeira linha processada:', {
            linha_original: linhaProcessada.linha_original,
            cpf_cliente_raw: linha[mapeamento['cpf_cliente']],
            cpf_cliente_processado: linhaProcessada.cpf_cliente,
            indice_cpf: mapeamento['cpf_cliente']
          })
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

  // Criar ou atualizar complementador de renda (cônjuge)
  const criarOuAtualizarConjuge = async (clienteId, dadosCliente) => {
    // Validar se há dados válidos do cônjuge (não vazios, não apenas espaços, não "-")
    const temNome = dadosCliente.conjuge && dadosCliente.conjuge.trim() && dadosCliente.conjuge.trim() !== '-'
    const temCPF = dadosCliente.cpf_conjuge && dadosCliente.cpf_conjuge.trim() && dadosCliente.cpf_conjuge.trim() !== '-'
    const temTelefone = dadosCliente.fone_conjuge && dadosCliente.fone_conjuge.trim() && dadosCliente.fone_conjuge.trim() !== '-'
    const temEmail = dadosCliente.email_conjuge && dadosCliente.email_conjuge.trim() && dadosCliente.email_conjuge.trim() !== '-'
    
    // Só criar se houver pelo menos um dado válido do cônjuge
    if (!temNome && !temCPF && !temTelefone && !temEmail) {
      return
    }

    const cpfConjugeNormalizado = dadosCliente.cpf_conjuge ? normalizarCPF(dadosCliente.cpf_conjuge) : null

    // Verificar se já existe um complementador para este cliente
    // Primeiro tenta buscar por CPF se fornecido, senão busca qualquer complementador do cliente
    let complementadorExistente = null

    if (cpfConjugeNormalizado) {
      const { data } = await supabase
        .from('complementadores_renda')
        .select('*')
        .eq('cliente_id', clienteId)
        .eq('cpf', cpfConjugeNormalizado)
        .maybeSingle()
      
      complementadorExistente = data
    }

    // Se não encontrou por CPF, busca qualquer complementador do cliente (pode ser o cônjuge)
    if (!complementadorExistente) {
      const { data } = await supabase
        .from('complementadores_renda')
        .select('*')
        .eq('cliente_id', clienteId)
        .limit(1)
        .maybeSingle()
      
      complementadorExistente = data
    }

    if (complementadorExistente) {
      // Atualizar complementador existente apenas se houver dados válidos
      const dadosAtualizacao = {}
      
      if (temNome) {
        dadosAtualizacao.nome = dadosCliente.conjuge.trim()
      }
      
      if (temTelefone) {
        dadosAtualizacao.telefone = normalizarTelefone(dadosCliente.fone_conjuge)
      }
      
      if (temEmail) {
        dadosAtualizacao.email = dadosCliente.email_conjuge.trim().toLowerCase()
      }

      // Atualizar CPF se fornecido
      if (cpfConjugeNormalizado) {
        dadosAtualizacao.cpf = cpfConjugeNormalizado
      }

      // Só atualiza se houver pelo menos um campo para atualizar
      if (Object.keys(dadosAtualizacao).length > 0) {
        await supabase
          .from('complementadores_renda')
          .update(dadosAtualizacao)
          .eq('id', complementadorExistente.id)
      }
      
      return
    }

    // Criar novo complementador (cônjuge) - só se tiver pelo menos nome ou CPF
    if (!temNome && !temCPF) {
      return // Não cria se não tiver nome nem CPF
    }

    const novoComplementador = {
      cliente_id: clienteId,
      nome: temNome ? dadosCliente.conjuge.trim() : null, // Não usa "Cônjuge" genérico
      cpf: cpfConjugeNormalizado || null,
      telefone: temTelefone ? normalizarTelefone(dadosCliente.fone_conjuge) : null,
      email: temEmail ? dadosCliente.email_conjuge.trim().toLowerCase() : null
    }

    // Garantir que tem pelo menos nome (obrigatório na tabela)
    if (!novoComplementador.nome) {
      return // Não cria sem nome
    }

    await supabase
      .from('complementadores_renda')
      .insert([novoComplementador])
  }

  // Buscar ou criar cliente
  const buscarOuCriarCliente = async (dadosCliente) => {
    const cpfNormalizado = normalizarCPF(dadosCliente.cpf_cliente || dadosCliente.cpf)
    
    // Buscar por CPF normalizado
    if (cpfNormalizado) {
      const { data: clienteExistente } = await supabase
        .from('clientes')
        .select('*')
        .eq('cpf', cpfNormalizado)
        .single()

      if (clienteExistente) {
        // Criar ou atualizar complementador de renda (cônjuge) se fornecido
        await criarOuAtualizarConjuge(clienteExistente.id, dadosCliente)
        return { cliente: clienteExistente, criado: false }
      }
    }

    // Buscar por email (se fornecido)
    if (dadosCliente.email && dadosCliente.email.trim()) {
      const { data: clientePorEmail } = await supabase
        .from('clientes')
        .select('*')
        .eq('email', dadosCliente.email.trim().toLowerCase())
        .single()

      if (clientePorEmail) {
        // Criar ou atualizar complementador de renda (cônjuge) se fornecido
        await criarOuAtualizarConjuge(clientePorEmail.id, dadosCliente)
        return { cliente: clientePorEmail, criado: false }
      }
    }

    // Criar novo cliente
    const novoCliente = {
      nome_completo: dadosCliente.cliente.trim(),
      cpf: cpfNormalizado || null,
      email: dadosCliente.email && dadosCliente.email.trim() ? dadosCliente.email.trim().toLowerCase() : null,
      telefone: normalizarTelefone(dadosCliente.fone || dadosCliente.telefone) || null,
      endereco: dadosCliente.endereco && dadosCliente.endereco.trim() ? dadosCliente.endereco.trim() : null,
      cep: normalizarCEP(dadosCliente.cep) || null
    }

    try {
      const { data: clienteCriado, error } = await supabase
        .from('clientes')
        .insert([novoCliente])
        .select()
        .single()

      if (error) {
        // Se erro de constraint, tentar buscar novamente
        if (error.code === '23505') {
          // Construir query de busca
          let query = supabase.from('clientes').select('*')
          if (cpfNormalizado) {
            query = query.eq('cpf', cpfNormalizado)
          }
          if (dadosCliente.email && dadosCliente.email.trim()) {
            if (cpfNormalizado) {
              query = query.or(`cpf.eq.${cpfNormalizado},email.eq.${dadosCliente.email.trim().toLowerCase()}`)
            } else {
              query = query.eq('email', dadosCliente.email.trim().toLowerCase())
            }
          }
          const { data: clienteExistente } = await query.single()
          
          if (clienteExistente) {
            // Criar ou atualizar complementador de renda (cônjuge) se fornecido
            await criarOuAtualizarConjuge(clienteExistente.id, dadosCliente)
            return { cliente: clienteExistente, criado: false }
          }
        }
        throw error
      }

      // Criar ou atualizar complementador de renda (cônjuge) se fornecido
      await criarOuAtualizarConjuge(clienteCriado.id, dadosCliente)

      return { cliente: clienteCriado, criado: true }
    } catch (error) {
      console.error('Erro ao criar cliente:', error)
      throw error
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
        clientes_criados: 0,
        clientes_existentes: 0
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
          dados_originais: { ...linha },
          status: 'processando',
          erro: null,
          cliente_id: null,
          cliente_criado: false,
          cliente_existente: false
        }

        try {
          // Validações
          if (!linha.cliente || linha.cliente.trim() === '') {
            throw new Error('Nome do cliente é obrigatório')
          }

          const cpfCliente = linha.cpf_cliente || linha.cpf
          if (!cpfCliente || cpfCliente.trim() === '') {
            throw new Error('CPF do cliente é obrigatório')
          }
          if (!validarCPF(cpfCliente)) {
            throw new Error('CPF do cliente inválido')
          }

          // Validar email do cliente (se fornecido)
          if (linha.email && linha.email.trim() && !validarEmail(linha.email)) {
            throw new Error('E-mail do cliente inválido')
          }
          
          // Validar email do cônjuge (se fornecido)
          if (linha.email_conjuge && linha.email_conjuge.trim() && !validarEmail(linha.email_conjuge)) {
            throw new Error('E-mail do cônjuge inválido')
          }

          // Validar CPF do cônjuge se fornecido
          if (linha.cpf_conjuge && !validarCPF(linha.cpf_conjuge)) {
            throw new Error('CPF do cônjuge inválido')
          }

          // Verificar duplicata
          const cpfNormalizado = normalizarCPF(cpfCliente)
          const { data: clienteDuplicado } = await supabase
            .from('clientes')
            .select('id, nome_completo, cpf')
            .eq('cpf', cpfNormalizado)
            .single()

          if (clienteDuplicado) {
            detalheLinha.status = 'duplicado'
            detalheLinha.cliente_id = clienteDuplicado.id
            detalheLinha.cliente_existente = true
            logAtual.estatisticas.duplicados++
            logAtual.estatisticas.clientes_existentes++
          } else {
            // Buscar ou criar cliente
            const { cliente, criado } = await buscarOuCriarCliente(linha)
            
            detalheLinha.cliente_id = cliente.id
            detalheLinha.cliente_criado = criado
            detalheLinha.cliente_existente = !criado
            
            if (criado) {
              logAtual.estatisticas.clientes_criados++
            } else {
              logAtual.estatisticas.clientes_existentes++
            }

            detalheLinha.status = 'sucesso'
            logAtual.estatisticas.sucesso++
          }
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
      
      a.download = `log_importacao_clientes_${dataHora}_${modo}_${total}linhas_${sucesso}sucesso${cancelado}.json`
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
    <div className="importar-clientes-container">
      <div className="importar-header">
        <h2>Importar Clientes</h2>
        <p>Importe clientes em lote através de arquivo Excel</p>
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
                background: 'rgba(59, 130, 246, 0.1)', 
                border: '1px solid rgba(59, 130, 246, 0.3)', 
                borderRadius: '6px',
                color: '#60a5fa'
              }}>
                ⚠️ Modo completo ativado: Todas as {dadosPreview.length} linhas serão importadas
              </div>
            )}
          </div>
          <div className="preview-table-container">
            <table className="preview-table">
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>Cliente</th>
                  <th>Cônjuge</th>
                  <th>CPF Cliente</th>
                  <th>CPF Cônjuge</th>
                  <th>E-mail</th>
                  <th>Fone</th>
                  <th>Fone Cônjuge</th>
                  <th>Endereço</th>
                  <th>CEP</th>
                </tr>
              </thead>
              <tbody>
                {dadosPreview.slice(0, 20).map((linha, idx) => (
                  <tr key={idx}>
                    <td>{linha.linha_original}</td>
                    <td>{linha.cliente || <span className="text-muted">-</span>}</td>
                    <td>{linha.conjuge || <span className="text-muted">-</span>}</td>
                    <td>{formatarCPF(linha.cpf_cliente || linha.cpf) || <span className="text-muted">-</span>}</td>
                    <td>{formatarCPF(linha.cpf_conjuge) || <span className="text-muted">-</span>}</td>
                    <td>{linha.email || <span className="text-muted">-</span>}</td>
                    <td>{formatarTelefone(linha.fone || linha.telefone) || <span className="text-muted">-</span>}</td>
                    <td>{formatarTelefone(linha.fone_conjuge) || <span className="text-muted">-</span>}</td>
                    <td>{linha.endereco || <span className="text-muted">-</span>}</td>
                    <td>{formatarCEP(linha.cep) || <span className="text-muted">-</span>}</td>
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
              <div className="stat-value">{resultado.estatisticas.clientes_criados}</div>
              <div className="stat-label">Clientes Criados</div>
            </div>
            <div className="stat-card secondary">
              <div className="stat-value">{resultado.estatisticas.clientes_existentes}</div>
              <div className="stat-label">Clientes Existentes</div>
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
        </div>
      )}
    </div>
  )
}

export default ImportarClientes

