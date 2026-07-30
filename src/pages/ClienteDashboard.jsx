import { useState, useEffect } from 'react'
import { safeGet, safeSet } from '../utils/storage'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import {
  Home, ShoppingBag, FileText, User as UserIcon, LogOut,
  Menu, X, ChevronLeft, ChevronRight, ChevronDown, Calendar, MapPin,
  Building, DollarSign, CheckCircle, Clock, Download,
  CreditCard, FileCheck, AlertCircle, Eye, Upload,
  IdCard, Copy, Heart, Image as ImageIcon,
  MessageCircle, Phone, Pencil, Save, Lock, ShieldCheck, Building2
} from 'lucide-react'
import logo from '../imgs/logo.png'
import Ticker from '../components/Ticker'
import '../styles/Dashboard.css'
import { parseDataLocal, formatDataBR } from '../utils/datas'
import '../styles/ClienteDashboard.css'
import { sortParcelas } from '../utils/parcelasSort'
import ParcelaCard from '../components/corretor/ParcelaCard'
import { isPago, isPendente, isAtivo } from '../utils/comissaoCalculator'
import { gerarExtratoClientePDF } from '../utils/extratoClientePDF'
import { baixarPdfBase64 } from '../utils/pdfBase64'

// Labels das categorias de fotos (espelha foto_categorias — migrations 005/007)
const CATEGORIA_LABELS = {
  fachada: 'Fachada',
  interior: 'Áreas Internas',
  apartamento: 'Apartamento Modelo',
  planta: 'Planta Baixa',
  area_lazer: 'Área de Lazer',
  area_comum: 'Áreas Comuns',
  implantacao: 'Implantação',
  perspectiva: 'Perspectiva 3D',
  obra: 'Andamento da Obra',
  outros: 'Outros',
}

const ClienteDashboard = () => {
  const { user, userProfile, signOut } = useAuth()
  const { tab } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  
  // Detectar activeTab baseado na URL
  let activeTab = 'dashboard'
  if (location.pathname === '/cliente/dashboard') {
    activeTab = 'dashboard'
  } else if (tab) {
    activeTab = tab
  } else if (location.pathname === '/cliente') {
    activeTab = 'dashboard'
  }
  
  const [cliente, setCliente] = useState(null)
  const [compras, setCompras] = useState([])
  const [pagamentos, setPagamentos] = useState([])
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [uploadingDocType, setUploadingDocType] = useState(null)
  const [compraExpandida, setCompraExpandida] = useState(null)
  const [gruposExpandidos, setGruposExpandidos] = useState({})
  const [visaoParcelas, setVisaoParcelas] = useState('calendario')
  const [editandoPerfil, setEditandoPerfil] = useState(false)
  const [perfilForm, setPerfilForm] = useState({})
  const [salvandoPerfil, setSalvandoPerfil] = useState(false)
  const [senhaForm, setSenhaForm] = useState({ nova: '', confirmar: '' })
  const [salvandoSenha, setSalvandoSenha] = useState(false)
  const [fotosEmpreendimentos, setFotosEmpreendimentos] = useState([])
  const [empreendimentosTodos, setEmpreendimentosTodos] = useState([])
  const [filtroStatusPag, setFiltroStatusPag] = useState('todos')
  const [filtroCompraPag, setFiltroCompraPag] = useState('todas')
  // Modal de detalhes do empreendimento (galeria completa por categoria + lightbox)
  const [empDetalhe, setEmpDetalhe] = useState(null)
  const [catAtivaDetalhe, setCatAtivaDetalhe] = useState('todas')
  const [fotoAmpliada, setFotoAmpliada] = useState(null)
  // Boletos Sicoob das parcelas do cliente
  const [boletos, setBoletos] = useState([])
  const [copiadoKey, setCopiadoKey] = useState(null)
  const [baixandoPdfId, setBaixandoPdfId] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = safeGet('cliente-sidebar-collapsed')
    return saved === 'true'
  })

  useEffect(() => {
    if (user) {
      fetchClienteData()
    }
  }, [user])

  // Redirecionar /cliente para /cliente/dashboard
  useEffect(() => {
    if (!tab && location.pathname === '/cliente') {
      navigate('/cliente/dashboard', { replace: true })
    }
  }, [tab, navigate, location.pathname])

  // Initialize menu state based on screen width
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 1024) {
        setMenuOpen(true)
      } else {
        setMenuOpen(false)
      }
    }
    
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const fetchClienteData = async () => {
    setLoading(true)
    
    try {
      // Catálogo de empreendimentos + fotos (aba Empreendimentos é vitrine de TODOS,
      // não só dos que o cliente comprou) — dispara em paralelo com o resto
      const catalogoPromise = Promise.all([
        supabase
          .from('empreendimentos')
          .select('id, nome, descricao, logo_url, ativo, garantia_url')
          .order('nome'),
        supabase
          .from('empreendimento_fotos')
          .select('empreendimento_id, url, categoria, descricao, ordem, destaque')
          .order('destaque', { ascending: false })
          .order('ordem', { ascending: true })
      ])

      // Buscar dados do cliente
      const { data: clienteData, error: clienteError } = await supabase
        .from('clientes')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()

      const [{ data: empTodosData, error: empTodosError }, { data: fotosData }] = await catalogoPromise
      if (empTodosError) console.error('Erro ao buscar empreendimentos:', empTodosError)
      setEmpreendimentosTodos(empTodosData || [])
      setFotosEmpreendimentos(fotosData || [])

      if (clienteError) {
        console.error('Erro ao buscar cliente:', clienteError)
      } else if (clienteData) {
        setCliente(clienteData)

        // Buscar compras do cliente
        // Nota: A coluna cliente_id precisa existir na tabela vendas
        // Se não existir, execute: ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id);
        const { data: comprasData, error: comprasError } = await supabase
          .from('vendas')
          .select('*')
          .eq('cliente_id', clienteData.id)
          .not('excluido', 'is', true)
          .order('data_venda', { ascending: false })
        
        // Buscar pagamentos + boletos das compras
        let pagamentosData = []
        if (comprasData && comprasData.length > 0) {
          const compraIds = comprasData.map(c => c.id)
          const [{ data: pagData }, { data: boletosData }] = await Promise.all([
            supabase
              .from('pagamentos_prosoluto')
              .select('*')
              .in('venda_id', compraIds),
            supabase
              .from('boletos')
              .select('*')
              .in('venda_id', compraIds)
              .order('created_at', { ascending: false })
          ])

          if (pagData) {
            pagamentosData = pagData
          }
          setBoletos(boletosData || [])
        }
        setPagamentos(pagamentosData)
        
        // Buscar dados relacionados separadamente se necessário
        if (comprasData && comprasData.length > 0) {
          const corretorIds = [...new Set(comprasData.map(c => c.corretor_id).filter(Boolean))]

          // Empreendimentos vêm do catálogo já carregado acima
          const empreendimentosMap = (empTodosData || []).reduce((acc, emp) => {
            acc[emp.id] = emp
            return acc
          }, {})
          let corretoresMap = {}

          if (corretorIds.length > 0) {
            const { data: corrData } = await supabase
              .from('usuarios')
              .select('id, nome, telefone, email')
              .in('id', corretorIds)
            if (corrData) {
              corretoresMap = corrData.reduce((acc, corr) => {
                acc[corr.id] = corr
                return acc
              }, {})
            }
          }
          
          // Adicionar dados relacionados às compras
          const comprasComRelacoes = comprasData.map(compra => {
            // Buscar empreendimento - tentar com ID como string e como UUID
            const empreendimentoId = compra.empreendimento_id
            const empreendimento = empreendimentoId 
              ? (empreendimentosMap[empreendimentoId] || 
                 empreendimentosMap[String(empreendimentoId)] ||
                 null)
              : null
            
            return {
              ...compra,
              empreendimentos: empreendimento,
              empreendimento: empreendimento, // Também adicionar no singular para compatibilidade
              corretores: corretoresMap[compra.corretor_id] || null
            }
          })
          
          setCompras(comprasComRelacoes)
        } else {
          setCompras([])
        }

      }
    } catch (error) {
      console.error('Erro ao buscar dados:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value) => {
    if (!value) return 'R$ 0,00'
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value)
  }

  const formatDate = (date) => {
    if (!date) return '-'
    
    // Se for uma string no formato YYYY-MM-DD, formatar diretamente sem timezone
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)) {
      const [year, month, day] = date.split('T')[0].split('-')
      return `${day}/${month}/${year}`
    }
    
    // Para outros formatos, usar Date mas forçar interpretação local
    const dateObj = new Date(date)
    // Se a data for inválida, retornar '-'
    if (isNaN(dateObj.getTime())) return '-'
    
    // Usar métodos locais para evitar problemas de timezone
    const day = String(dateObj.getDate()).padStart(2, '0')
    const month = String(dateObj.getMonth() + 1).padStart(2, '0')
    const year = dateObj.getFullYear()
    
    return `${day}/${month}/${year}`
  }

  // Agrupar pagamentos por tipo
  const agruparPagamentosPorTipo = (pagamentos) => {
    const grupos = {
      sinal: [],
      entrada: [],
      parcela_entrada: [],
      balao: [],
      comissao_integral: [],
      bens: []
    }

    pagamentos.forEach(pagamento => {
      const tipo = pagamento.tipo
      if (grupos[tipo]) {
        grupos[tipo].push(pagamento)
      }
    })

    // Ordenar cada grupo por número de parcela
    grupos.parcela_entrada.sort((a, b) => (a.numero_parcela || 0) - (b.numero_parcela || 0))
    grupos.balao.sort((a, b) => (a.numero_parcela || 0) - (b.numero_parcela || 0))

    return grupos
  }

  // Obter label do grupo
  const getGrupoLabel = (tipo) => {
    const labels = {
      sinal: 'Sinal',
      entrada: 'Entrada',
      parcela_entrada: 'Parcelas de Entrada',
      balao: 'Balões',
      comissao_integral: 'Entrada (à vista)',
      bens: 'Bens'
    }
    return labels[tipo] || tipo
  }

  // Toggle expansão de grupo (quando tem mais de 10 itens)
  const toggleGrupoExpandido = (compraId, tipo) => {
    const key = `${compraId}-${tipo}`
    setGruposExpandidos(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  // Verificar se grupo está expandido
  const isGrupoExpandido = (compraId, tipo) => {
    const key = `${compraId}-${tipo}`
    return gruposExpandidos[key] || false
  }

  // Título da compra na visão do CLIENTE: empreendimento + unidade (mundo dele),
  // NUNCA o "Contrato N" (descricao) — que é id interno do Sienge.
  const tituloCompra = (c) => {
    const emp = c?.empreendimentos?.nome || c?.empreendimento?.nome || c?.empreendimento_nome
    const uni = c?.unidade
      ? `Unidade ${c.unidade}${c.bloco ? ` · Bloco ${c.bloco}` : ''}`
      : null
    return [emp, uni].filter(Boolean).join(' · ') || 'Minha compra'
  }

  // Dashboard -> abre a compra escolhida já expandida na aba Compras (cross-nav).
  const verCompra = (compraId) => {
    setCompraExpandida(compraId)
    navigate('/cliente/compras')
  }

  // Resumo financeiro REAL da compra — derivado das parcelas (pagamentos_prosoluto),
  // nunca de vendas.status/valor_venda. Ver .claude/rules/visualizacao-totais.md.
  const resumoFinanceiroCompra = (compraId) => {
    const parcelas = pagamentos.filter(p => String(p.venda_id) === String(compraId)).filter(isAtivo)
    const somar = (lista) => lista.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0)
    const pagas = parcelas.filter(isPago)
    const totalPlano = somar(parcelas)
    const totalPago = somar(pagas)
    const proxima = parcelas
      .filter(isPendente)
      .filter(p => p.data_prevista)
      .sort((a, b) => (a.data_prevista < b.data_prevista ? -1 : 1))[0] || null
    return {
      totalPlano,
      totalPago,
      totalPendente: totalPlano - totalPago,
      pct: totalPlano > 0 ? (totalPago / totalPlano) * 100 : 0,
      qtdTotal: parcelas.length,
      qtdPagas: pagas.length,
      proxima,
      quitado: parcelas.length > 0 && pagas.length === parcelas.length,
    }
  }

  // Tag de status da compra derivada das parcelas (não de vendas.status agregado).
  const statusCompra = (compra) => {
    if (compra.status === 'distrato') return { classe: 'distrato', Icone: X, label: 'Distrato' }
    const r = resumoFinanceiroCompra(compra.id)
    if (r.qtdTotal === 0) return { classe: 'pendente', Icone: Clock, label: 'Pendente' }
    if (r.quitado) return { classe: 'pago', Icone: CheckCircle, label: 'Quitado' }
    return { classe: 'pendente', Icone: Clock, label: `${r.qtdPagas}/${r.qtdTotal} pagas` }
  }

  const baixarExtratoCompra = (compra) => {
    gerarExtratoClientePDF({
      cliente,
      compra,
      titulo: tituloCompra(compra),
      parcelas: pagamentos.filter(p => String(p.venda_id) === String(compra.id)),
      distratada: compra.status === 'distrato',
    })
  }

  // Link de WhatsApp a partir do telefone BR (assume DDI 55 quando ausente).
  const linkWhatsApp = (telefone) => {
    const digitos = String(telefone || '').replace(/\D/g, '')
    if (!digitos) return null
    return `https://wa.me/${digitos.length <= 11 ? `55${digitos}` : digitos}`
  }

  // Corretores únicos das compras — canal de contato do cliente.
  const corretoresDasCompras = () => {
    const mapa = new Map()
    compras.forEach(c => {
      if (c.corretores?.id && c.corretores?.nome && !mapa.has(c.corretores.id)) {
        mapa.set(c.corretores.id, c.corretores)
      }
    })
    return [...mapa.values()]
  }

  // ── Boletos Sicoob ──
  // Boleto vivo da parcela (cancelado/baixado/erro não contam; lista já vem
  // ordenada por created_at desc do fetch)
  const boletoAtivoDaParcela = (pagamentoId) =>
    boletos.find(
      b => String(b.pagamento_id) === String(pagamentoId) &&
        !['cancelado', 'baixado', 'erro'].includes(b.status)
    ) || null

  const statusBoletoInfo = (boleto) => {
    const hoje = new Date().toISOString().slice(0, 10)
    if (boleto.status === 'pago') {
      return {
        classe: 'pago',
        label: boleto.data_pagamento ? `Pago em ${formatDataBR(boleto.data_pagamento)}` : 'Pago',
      }
    }
    if (boleto.status === 'vencido' || (boleto.data_vencimento && boleto.data_vencimento < hoje)) {
      return { classe: 'atrasado', label: 'Atrasado' }
    }
    return { classe: 'pendente', label: 'Aguardando pagamento' }
  }

  const copiarTexto = async (texto, key) => {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiadoKey(key)
      setTimeout(() => setCopiadoKey(prev => (prev === key ? null : prev)), 2000)
    } catch (error) {
      console.error('Erro ao copiar:', error)
      alert('Não foi possível copiar. Copie manualmente: ' + texto)
    }
  }

  const baixarPdfBoleto = async (boleto) => {
    setBaixandoPdfId(boleto.id)
    try {
      const { data, error } = await supabase.functions.invoke('sicoob-boletos', {
        body: { acao: 'segunda_via', boleto_id: boleto.id },
      })
      if (error) {
        let msg = error.message
        try {
          const ctx = await error.context?.json?.()
          if (ctx?.error) msg = ctx.error
        } catch { /* mantém msg genérica */ }
        throw new Error(msg)
      }
      if (data?.error) throw new Error(data.error)
      if (!data?.pdf_base64) throw new Error('PDF não disponível no momento')

      baixarPdfBase64(data.pdf_base64, `Boleto_${boleto.nosso_numero || boleto.id}.pdf`)
    } catch (error) {
      console.error('Erro ao baixar PDF do boleto:', error)
      alert('Erro ao baixar o boleto: ' + error.message)
    } finally {
      setBaixandoPdfId(null)
    }
  }

  // Strip de boleto exibido sob a parcela na aba Pagamentos
  const renderBoletoStrip = (boleto) => {
    const info = statusBoletoInfo(boleto)
    return (
      <div className={`boleto-strip ${info.classe}`}>
        <div className="boleto-strip-header">
          <span className="boleto-strip-titulo">
            <CreditCard size={14} />
            Boleto
          </span>
          <span className={`boleto-status-chip ${info.classe}`}>{info.label}</span>
        </div>
        {boleto.linha_digitavel && (
          <div className="boleto-linha" title={boleto.linha_digitavel}>
            {boleto.linha_digitavel}
          </div>
        )}
        {boleto.status !== 'pago' && (
          <div className="boleto-acoes">
            {boleto.linha_digitavel && (
              <button
                className="btn-boleto-acao"
                onClick={() => copiarTexto(boleto.linha_digitavel, `linha-${boleto.id}`)}
              >
                <Copy size={13} />
                {copiadoKey === `linha-${boleto.id}` ? 'Copiado!' : 'Copiar linha digitável'}
              </button>
            )}
            {boleto.qrcode_pix && (
              <button
                className="btn-boleto-acao"
                onClick={() => copiarTexto(boleto.qrcode_pix, `pix-${boleto.id}`)}
              >
                <Copy size={13} />
                {copiadoKey === `pix-${boleto.id}` ? 'Copiado!' : 'Copiar Pix'}
              </button>
            )}
            <button
              className="btn-boleto-acao"
              onClick={() => baixarPdfBoleto(boleto)}
              disabled={baixandoPdfId === boleto.id}
            >
              <Download size={13} />
              {baixandoPdfId === boleto.id ? 'Baixando...' : 'Baixar PDF'}
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Detalhe do empreendimento (galeria completa) ──
  // Fotos de um empreendimento (logo fica de fora — não é foto de galeria)
  const fotosDoEmp = (empId) => fotosEmpreendimentos.filter(
    f => String(f.empreendimento_id) === String(empId) && f.categoria !== 'logo'
  )

  const abrirDetalheEmp = (emp) => {
    if (!emp) return
    setEmpDetalhe(emp)
    setCatAtivaDetalhe('todas')
    setFotoAmpliada(null)
  }

  const fecharDetalheEmp = () => {
    setEmpDetalhe(null)
    setFotoAmpliada(null)
  }

  const fotosDetalhe = empDetalhe ? fotosDoEmp(empDetalhe.id) : []
  const categoriasDetalhe = [...new Set(fotosDetalhe.map(f => f.categoria || 'outros'))]
  const fotosFiltradasDetalhe = catAtivaDetalhe === 'todas'
    ? fotosDetalhe
    : fotosDetalhe.filter(f => (f.categoria || 'outros') === catAtivaDetalhe)

  // Navegação por teclado no lightbox (Esc fecha, setas navegam)
  useEffect(() => {
    if (fotoAmpliada === null) return
    const total = fotosFiltradasDetalhe.length
    if (total === 0) return
    const handler = (e) => {
      if (e.key === 'Escape') setFotoAmpliada(null)
      if (e.key === 'ArrowRight') setFotoAmpliada(i => (i + 1) % total)
      if (e.key === 'ArrowLeft') setFotoAmpliada(i => (i - 1 + total) % total)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fotoAmpliada, fotosFiltradasDetalhe.length])

  // Campos que o próprio cliente pode corrigir. Identidade (CPF/RG/nascimento),
  // email de login e renda continuam só com o admin.
  const CAMPOS_PERFIL_EDITAVEIS = [
    { campo: 'telefone', label: 'Telefone' },
    { campo: 'endereco', label: 'Endereço' },
    { campo: 'cep', label: 'CEP' },
    { campo: 'profissao', label: 'Profissão' },
    { campo: 'empresa_trabalho', label: 'Empresa' },
  ]

  const iniciarEdicaoPerfil = () => {
    setPerfilForm(Object.fromEntries(CAMPOS_PERFIL_EDITAVEIS.map(({ campo }) => [campo, cliente?.[campo] || ''])))
    setEditandoPerfil(true)
  }

  const salvarPerfil = async () => {
    setSalvandoPerfil(true)
    try {
      const updates = Object.fromEntries(
        CAMPOS_PERFIL_EDITAVEIS.map(({ campo }) => [campo, perfilForm[campo]?.trim() || null])
      )
      const { data, error } = await supabase
        .from('clientes')
        .update(updates)
        .eq('id', cliente.id)
        .eq('user_id', user.id)
        .select('id')
      if (error) throw error
      // 0 linhas afetadas (ex.: RLS bloqueou) volta sem error — não fingir sucesso.
      if (!data || data.length === 0) throw new Error('Nenhum registro atualizado')
      setCliente(prev => ({ ...prev, ...updates }))
      setEditandoPerfil(false)
    } catch (error) {
      console.error('Erro ao salvar perfil:', error)
      alert('Erro ao salvar os dados. Tente novamente.')
    } finally {
      setSalvandoPerfil(false)
    }
  }

  const trocarSenha = async () => {
    if (!senhaForm.nova || senhaForm.nova.length < 8) {
      alert('A nova senha precisa ter pelo menos 8 caracteres.')
      return
    }
    if (senhaForm.nova !== senhaForm.confirmar) {
      alert('As senhas não conferem.')
      return
    }
    setSalvandoSenha(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: senhaForm.nova })
      if (error) throw error
      setSenhaForm({ nova: '', confirmar: '' })
      alert('Senha alterada com sucesso!')
    } catch (error) {
      console.error('Erro ao trocar senha:', error)
      alert(
        error.message?.includes('different from the old')
          ? 'A nova senha precisa ser diferente da atual.'
          : 'Erro ao alterar a senha. Tente novamente.'
      )
    } finally {
      setSalvandoSenha(false)
    }
  }

  // Os 6 documentos do cliente (mesma lista do contador de "documentos enviados").
  const DOCS_CLIENTE = [
    { campo: 'rg_frente_url', label: 'RG Frente' },
    { campo: 'rg_verso_url', label: 'RG Verso' },
    { campo: 'cpf_url', label: 'CPF' },
    { campo: 'comprovante_residencia_url', label: 'Comp. Residência' },
    { campo: 'comprovante_renda_url', label: 'Comp. Renda' },
    { campo: 'certidao_casamento_url', label: 'Certidão Casamento' },
  ]

  // Formatação para Ticker (valor completo)
  const formatTicker = (value) => {
    if (value === null || value === undefined || isNaN(value)) {
      return 'R$ 0,00'
    }
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value)
  }

  // Dados dinâmicos para o Ticker
  const getTickerData = () => {
    const totalCompras = compras.reduce((acc, c) => acc + (parseFloat(c.valor_venda) || 0), 0)
    // Total já pago vem das PARCELAS pagas (pagamentos_prosoluto), nunca do
    // status agregado da venda — ver .claude/rules/visualizacao-totais.md.
    const parcelasPagas = pagamentos.filter(isAtivo).filter(isPago)
    const totalJaPago = parcelasPagas.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0)
    const comprasMes = compras.filter(c => {
      const dataVenda = parseDataLocal(c.data_venda)
      const hoje = new Date()
      return dataVenda && dataVenda.getMonth() === hoje.getMonth() && dataVenda.getFullYear() === hoje.getFullYear()
    })
    const totalComprasMes = comprasMes.reduce((acc, c) => acc + (parseFloat(c.valor_venda) || 0), 0)
    const mediaPorCompra = compras.length > 0 ? totalCompras / compras.length : 0
    const documentosEnviados = [
      cliente?.rg_frente_url,
      cliente?.rg_verso_url,
      cliente?.cpf_url,
      cliente?.comprovante_residencia_url,
      cliente?.comprovante_renda_url,
      cliente?.certidao_casamento_url
    ].filter(Boolean).length

    return [
      {
        name: 'TOTAL JÁ PAGO',
        value: formatTicker(totalJaPago),
        change: parcelasPagas.length > 0 ? `${parcelasPagas.length} parcelas` : '0',
        type: parcelasPagas.length > 0 ? 'positive' : 'neutral'
      },
      {
        name: 'TOTAL EM COMPRAS',
        value: formatTicker(totalCompras),
        change: compras.length > 0 ? `${compras.length} compras` : '0',
        type: 'positive'
      },
      {
        name: 'COMPRAS ESTE MÊS',
        value: formatTicker(totalComprasMes),
        change: comprasMes.length > 0 ? `${comprasMes.length} compras` : '0',
        type: 'positive'
      },
      {
        name: 'MÉDIA POR COMPRA',
        value: formatTicker(mediaPorCompra),
        change: '0%',
        type: 'neutral'
      },
      {
        name: 'DOCUMENTOS ENVIADOS',
        value: `${documentosEnviados}/6`,
        change: documentosEnviados === 6 ? '100%' : `${Math.round((documentosEnviados / 6) * 100)}%`,
        type: documentosEnviados === 6 ? 'positive' : documentosEnviados > 0 ? 'neutral' : 'negative'
      }
    ]
  }

  // Helper para adicionar cache busting na URL
  const getUrlComCacheBust = (url) => {
    if (!url) return url
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}t=${Date.now()}`
  }

  // Upload de documento do cliente
  const uploadDocumentoCliente = async (file, tipo) => {
    if (!file || !cliente || !user) {
      alert('Você precisa estar autenticado para fazer upload de documentos.')
      return
    }

    // Verificar se o usuário está autenticado
    if (!user || !user.id) {
      alert('Você precisa estar autenticado para fazer upload de documentos.')
      return
    }
    
    setUploadingDoc(true)
    setUploadingDocType(tipo)
    
    try {
      // Verificar se a sessão está ativa
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      
      if (sessionError || !session) {
        throw new Error('Sessão não encontrada. Por favor, faça login novamente.')
      }

      // ========== VALIDAÇÕES DE SEGURANÇA ==========
      
      // 1. Validar tipo de documento permitido
      const tiposPermitidos = [
        'rg_frente',
        'rg_verso',
        'cpf',
        'comprovante_residencia',
        'comprovante_renda',
        'certidao_casamento'
      ]
      
      if (!tiposPermitidos.includes(tipo)) {
        throw new Error('Tipo de documento inválido.')
      }

      // 2. Validar extensão do arquivo
      const extensoesPermitidas = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp']
      const fileExt = file.name.split('.').pop()?.toLowerCase()
      
      if (!fileExt || !extensoesPermitidas.includes(fileExt)) {
        throw new Error(`Tipo de arquivo não permitido. Use: ${extensoesPermitidas.join(', ').toUpperCase()}`)
      }

      // 2.1. Validar tipo MIME do arquivo (segurança adicional)
      const mimeTypesPermitidos = [
        'application/pdf',
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp'
      ]
      
      if (!mimeTypesPermitidos.includes(file.type)) {
        throw new Error('Tipo de arquivo inválido. Apenas PDF e imagens são permitidos.')
      }

      // 3. Validar tamanho do arquivo (máximo 10MB)
      const maxSize = 10 * 1024 * 1024 // 10MB em bytes
      if (file.size > maxSize) {
        throw new Error('Arquivo muito grande. Tamanho máximo: 10MB')
      }

      if (file.size === 0) {
        throw new Error('Arquivo vazio não é permitido.')
      }

      // 4. Garantir que user.id existe
      if (!user || !user.id) {
        throw new Error('Erro de autenticação. Faça login novamente.')
      }

      // 5. Construir caminho igual ao AdminDashboard
      // Se já existe documento, usar o mesmo nome para substituir, senão criar novo
      let fileName, filePath
      const documentoExistente = cliente[`${tipo}_url`]
      
      if (documentoExistente) {
        // Se já existe, extrair o nome do arquivo da URL existente
        try {
          const urlParts = documentoExistente.split('/')
          let nomeExistente = urlParts[urlParts.length - 1]
          // Remover query parameters se existirem (ex: ?token=xyz)
          nomeExistente = nomeExistente.split('?')[0]
          // Validar se o nome extraído é válido
          if (nomeExistente && nomeExistente.length > 0) {
            fileName = nomeExistente
            filePath = `clientes/${fileName}`
          } else {
            // Se não conseguir extrair, criar novo arquivo
            fileName = `${tipo}_${Date.now()}.${fileExt}`
            filePath = `clientes/${fileName}`
          }
        } catch (error) {
          // Se houver erro na extração, criar novo arquivo
          console.warn('Erro ao extrair nome do arquivo existente, criando novo:', error)
          fileName = `${tipo}_${Date.now()}.${fileExt}`
          filePath = `clientes/${fileName}`
        }
      } else {
        // Se não existe, criar novo arquivo
        fileName = `${tipo}_${Date.now()}.${fileExt}`
        filePath = `clientes/${fileName}`
      }

      // 6. Validação final do caminho (prevenir path traversal)
      if (filePath.includes('..') || filePath.includes('//') || !filePath.startsWith('clientes/')) {
        throw new Error('Caminho de arquivo inválido.')
      }

      // Fazer upload - se já existe, vai substituir automaticamente
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('documentos')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true // Permite substituir se já existir
        })

      if (uploadError) {
        throw uploadError
      }

      const { data: { publicUrl } } = supabase.storage
        .from('documentos')
        .getPublicUrl(uploadData?.path || filePath)

      // Atualizar cliente no banco - usar user.id para garantir segurança
      const { error: updateError } = await supabase
        .from('clientes')
        .update({ [`${tipo}_url`]: publicUrl })
        .eq('id', cliente.id)
        .eq('user_id', user.id) // Garantir que só atualiza usando o user.id logado

      if (updateError) {
        console.error('Erro ao atualizar cliente:', updateError)
        throw new Error('Erro ao salvar o documento. Verifique suas permissões.')
      }

      // Atualizar estado local com URL atualizada
      setCliente(prev => ({ ...prev, [`${tipo}_url`]: publicUrl }))
      
      // Pequeno delay para garantir que o arquivo foi processado no storage
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Recarregar dados para garantir sincronização
      await fetchClienteData()
      
    } catch (error) {
      console.error('Erro no upload:', error)
      
      let errorMessage = 'Erro ao fazer upload do documento.'
      
      if (error.message?.includes('row-level security') || error.message?.includes('RLS')) {
        errorMessage = 'Você não tem permissão para fazer upload de documentos. Entre em contato com o administrador.'
      } else if (error.message) {
        errorMessage = error.message
      }
      
      alert(errorMessage)
    } finally {
      setUploadingDoc(false)
      setUploadingDocType(null)
    }
  }

  // Toggle sidebar collapsed state
  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const newValue = !prev
      safeSet('cliente-sidebar-collapsed', String(newValue))
      return newValue
    })
  }

  if (loading && !cliente) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <div className="loading-spinner-screen"></div>
          <p>Carregando...</p>
        </div>
      </div>
    )
  }

  if (!cliente) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <p style={{ color: '#ef4444', marginBottom: '10px' }}>Cliente não encontrado</p>
          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>
            Entre em contato com a administração
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard-container">
      {/* Sidebar Overlay for Mobile */}
      <div 
        className={`sidebar-overlay ${menuOpen ? 'active' : ''}`}
        onClick={() => setMenuOpen(false)}
      />

      {/* Sidebar */}
      <aside className={`sidebar ${menuOpen ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="logo">
            <img src={logo} alt="IM Incorporadora" className="logo-sidebar" />
            <span className="logo-text">IM Incorporadora</span>
          </div>
          <button className="close-menu" onClick={() => setMenuOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <button 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => navigate('/cliente/dashboard')}
            title="Dashboard"
          >
            <Home size={20} />
            <span>Dashboard</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'compras' ? 'active' : ''}`}
            onClick={() => navigate('/cliente/compras')}
            title="Minhas Compras"
          >
            <ShoppingBag size={20} />
            <span>Minhas Compras</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'pagamentos' ? 'active' : ''}`}
            onClick={() => navigate('/cliente/pagamentos')}
            title="Pagamentos"
          >
            <CreditCard size={20} />
            <span>Pagamentos</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'imovel' ? 'active' : ''}`}
            onClick={() => navigate('/cliente/imovel')}
            title="Meu Imóvel"
          >
            <Building size={20} />
            <span>Meu Imóvel</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'empreendimentos' ? 'active' : ''}`}
            onClick={() => navigate('/cliente/empreendimentos')}
            title="Empreendimentos"
          >
            <Building2 size={20} />
            <span>Empreendimentos</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'garantia' ? 'active' : ''}`}
            onClick={() => navigate('/cliente/garantia')}
            title="Garantia"
          >
            <ShieldCheck size={20} />
            <span>Garantia</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'documentos' ? 'active' : ''}`}
            onClick={() => navigate('/cliente/documentos')}
            title="Documentos"
          >
            <FileText size={20} />
            <span>Documentos</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'perfil' ? 'active' : ''}`}
            onClick={() => navigate('/cliente/perfil')}
            title="Meu Perfil"
          >
            <UserIcon size={20} />
            <span>Meu Perfil</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <button 
            className="collapse-btn" 
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Expandir' : 'Recolher'}
          >
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
          <div className="user-info">
            <div className="user-avatar">
              <UserIcon size={20} />
            </div>
            <div className="user-details">
              <span className="user-name">{cliente.nome_completo || 'Cliente'}</span>
              <span className="user-role">Cliente</span>
            </div>
          </div>
          <button className="logout-btn" onClick={signOut} title="Sair">
            <LogOut size={20} />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        {/* Ticker */}
        <Ticker data={getTickerData()} />
        
        {/* Header */}
        <header className="main-header">
          <button className="menu-toggle" onClick={() => setMenuOpen(true)}>
            <Menu size={24} />
          </button>
          <h1>
            {activeTab === 'dashboard' && 'Dashboard'}
            {activeTab === 'compras' && 'Minhas Compras'}
            {activeTab === 'pagamentos' && 'Pagamentos'}
            {activeTab === 'imovel' && 'Meu Imóvel'}
            {activeTab === 'empreendimentos' && 'Empreendimentos'}
            {activeTab === 'garantia' && 'Garantia'}
            {activeTab === 'documentos' && 'Meus Documentos'}
            {activeTab === 'perfil' && 'Meu Perfil'}
          </h1>
        </header>

        {/* Content Section */}
        <div className="content-section">
          {/* Dashboard Tab */}
          {activeTab === 'dashboard' && (
            <>
              {/* Welcome Section */}
              <section className="welcome-section-cliente">
                <div className="welcome-content">
                  <h1>Bem-vindo, {cliente.nome_completo?.split(' ')[0] || 'Cliente'}</h1>
                  <p>Acompanhe suas compras e documentos</p>
                </div>
              </section>

              {/* Stats Cards */}
              <section className="stats-section">
                <div className="stat-card-cliente primary">
                  <div className="stat-card-icon">
                    <ShoppingBag size={28} />
                  </div>
                  <div className="stat-card-content">
                    <span className="stat-card-label">Total de Compras</span>
                    <span className="stat-card-value">{compras.length}</span>
                  </div>
                  <div className="stat-card-decoration"></div>
                </div>

                <div className="stat-card-cliente success">
                  <div className="stat-card-icon">
                    <DollarSign size={28} />
                  </div>
                  <div className="stat-card-content">
                    <span className="stat-card-label">Valor Total Investido</span>
                    <span className="stat-card-value">
                      {formatCurrency(compras.reduce((acc, c) => acc + (c.valor_venda || 0), 0))}
                    </span>
                  </div>
                  <div className="stat-card-decoration"></div>
                </div>

                <div className="stat-card-cliente primary">
                  <div className="stat-card-icon">
                    <CheckCircle size={28} />
                  </div>
                  <div className="stat-card-content">
                    <span className="stat-card-label">Valor Já Pago</span>
                    <span className="stat-card-value">
                      {formatCurrency(pagamentos.filter(isAtivo).filter(isPago).reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0))}
                    </span>
                  </div>
                  <div className="stat-card-decoration"></div>
                </div>

                <div className="stat-card-cliente info">
                  <div className="stat-card-icon">
                    <FileText size={28} />
                  </div>
                  <div className="stat-card-content">
                    <span className="stat-card-label">Documentos</span>
                    <span className="stat-card-value">
                      {DOCS_CLIENTE.filter(d => cliente[d.campo]).length} enviados
                    </span>
                  </div>
                  <div className="stat-card-decoration"></div>
                </div>
              </section>

              {/* Últimas Compras */}
              {compras.length > 0 && (
                <section className="ultimas-compras-section">
                  <h2>
                    <ShoppingBag size={24} />
                    Últimas Compras
                  </h2>
                  <div className="compras-list-mini">
                    {compras.slice(0, 3).map((compra) => (
                      <div
                        key={compra.id}
                        className="compra-card-mini compra-card-mini-clicavel"
                        role="button"
                        tabIndex={0}
                        onClick={() => verCompra(compra.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); verCompra(compra.id) } }}
                        title="Ver detalhes desta compra"
                      >
                        <div className="compra-info-mini">
                          <h4>{tituloCompra(compra)}</h4>
                          <div className="compra-meta-mini">
                            <span>
                              <Calendar size={14} />
                              {formatDate(compra.data_venda)}
                            </span>
                            {(() => {
                              const tag = statusCompra(compra)
                              return (
                                <span className={`status-tag ${tag.classe}`}>
                                  <tag.Icone size={12} />
                                  {tag.label}
                                </span>
                              )
                            })()}
                          </div>
                        </div>
                        <div className="compra-valor-mini">
                          {formatCurrency(compra.valor_venda)}
                        </div>
                        <ChevronRight size={18} className="compra-card-mini-seta" />
                      </div>
                    ))}
                  </div>
                  {compras.length > 3 && (
                    <button 
                      className="btn-ver-todas"
                      onClick={() => navigate('/cliente/compras')}
                    >
                      Ver todas as compras
                    </button>
                  )}
                </section>
              )}

              {/* Documentos — resumo + atalho pra aba */}
              {cliente && (
                <section className="ultimas-compras-section">
                  <h2>
                    <FileText size={24} />
                    Meus Documentos
                  </h2>
                  <div className="docs-resumo-grid">
                    {DOCS_CLIENTE.map((d) => {
                      const enviado = !!cliente[d.campo]
                      return (
                        <div key={d.campo} className="doc-resumo-item">
                          <span className={`doc-status-badge ${enviado ? 'success' : 'warning'}`}>
                            {enviado ? <CheckCircle size={14} /> : <Clock size={14} />}
                            {enviado ? 'Enviado' : 'Pendente'}
                          </span>
                          <span className="doc-resumo-label">{d.label}</span>
                        </div>
                      )
                    })}
                  </div>
                  <button
                    className="btn-ver-todas"
                    onClick={() => navigate('/cliente/documentos')}
                  >
                    Ver / enviar documentos
                  </button>
                </section>
              )}

              {/* Contato — corretores das compras do cliente */}
              {corretoresDasCompras().length > 0 && (
                <section className="ultimas-compras-section">
                  <h2>
                    <MessageCircle size={24} />
                    Fale com seu corretor
                  </h2>
                  <div className="contato-corretor-list">
                    {corretoresDasCompras().map((corr) => (
                      <div key={corr.id} className="contato-corretor-card">
                        <div className="contato-corretor-avatar">
                          {(corr.nome || 'C').charAt(0).toUpperCase()}
                        </div>
                        <div className="contato-corretor-info">
                          <span className="contato-corretor-nome">{corr.nome}</span>
                          {corr.telefone ? (
                            <span className="contato-corretor-tel">
                              <Phone size={13} />
                              {corr.telefone}
                            </span>
                          ) : corr.email ? (
                            <span className="contato-corretor-tel">{corr.email}</span>
                          ) : null}
                        </div>
                        {corr.telefone && (
                          <a
                            className="btn-whatsapp"
                            href={linkWhatsApp(corr.telefone)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <MessageCircle size={16} />
                            WhatsApp
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {/* Compras Tab */}
          {activeTab === 'compras' && (
            <section className="compras-section">
              {loading ? (
                <div className="loading-container">
                  <div className="loading-spinner-large"></div>
                  <p>Carregando suas compras...</p>
                </div>
              ) : compras.length === 0 ? (
                <div className="empty-state">
                  <ShoppingBag size={48} />
                  <h3>Nenhuma compra encontrada</h3>
                  <p>Suas compras aparecerão aqui quando forem registradas</p>
                </div>
              ) : (
                <div className="compras-list">
                  {compras.map((compra) => (
                    <div key={compra.id} className="compra-card">
                      <div className="compra-header">
                        <div className="compra-title">
                          <h3>{tituloCompra(compra)}</h3>
                          {(() => {
                            const tag = statusCompra(compra)
                            return (
                              <span className={`status-tag ${tag.classe}`}>
                                <tag.Icone size={12} />
                                {tag.label}
                              </span>
                            )
                          })()}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                          <div className="compra-valor-principal">
                            {formatCurrency(compra.valor_venda)}
                          </div>
                          <button
                            className="btn-extrato-pdf"
                            onClick={() => baixarExtratoCompra(compra)}
                            title="Baixar extrato de pagamentos em PDF"
                          >
                            <Download size={16} />
                            <span>Extrato</span>
                          </button>
                          {/* Botão Ver mais */}
                          <div className="venda-expand-btn-wrapper">
                            <button 
                              className="venda-expand-btn"
                              onClick={() => setCompraExpandida(compraExpandida === compra.id ? null : compra.id)}
                            >
                              <ChevronDown 
                                size={18} 
                                className={compraExpandida === compra.id ? 'rotated' : ''} 
                              />
                              <span>Ver mais</span>
                            </button>
                          </div>
                        </div>
                      </div>
                      
                      <div className="compra-details">
                        <div className="detail-item">
                          <Calendar size={18} />
                          <div>
                            <span className="detail-label">DATA DA COMPRA</span>
                            <span className="detail-value">{formatDate(compra.data_venda)}</span>
                          </div>
                        </div>
                        
                        {compra.corretores && (
                          <div className="detail-item">
                            <UserIcon size={18} />
                            <div>
                              <span className="detail-label">CORRETOR</span>
                              <span className="detail-value">{compra.corretores.nome}</span>
                              {compra.corretores.telefone && (
                                <a
                                  className="detail-whatsapp"
                                  href={linkWhatsApp(compra.corretores.telefone)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Falar com o corretor no WhatsApp"
                                >
                                  <MessageCircle size={13} />
                                  {compra.corretores.telefone}
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {compra.unidade && (
                          <div className="detail-item">
                            <MapPin size={18} />
                            <div>
                              <span className="detail-label">UNIDADE</span>
                              <span className="detail-value">
                                {compra.bloco ? `${compra.bloco} - ` : ''}{compra.unidade}{compra.andar ? ` | ${compra.andar}` : ''}
                              </span>
                            </div>
                          </div>
                        )}
                        
                        {(compra.empreendimentos || compra.empreendimento) && (
                          <div className="detail-item">
                            <Building size={18} />
                            <div>
                              <span className="detail-label">EMPREENDIMENTO</span>
                              <span className="detail-value">
                                {compra.empreendimentos?.nome || compra.empreendimento?.nome || '-'}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Resumo financeiro — derivado das parcelas (pagamentos_prosoluto) */}
                      {(() => {
                        const r = resumoFinanceiroCompra(compra.id)
                        if (r.qtdTotal === 0) return null
                        // Distrato: contrato rescindido — mostrar só o histórico pago,
                        // nunca "falta"/"próxima parcela" (parece cobrança ativa).
                        if (compra.status === 'distrato') {
                          if (r.qtdPagas === 0) return null
                          return (
                            <div className="compra-financeiro">
                              <div className="compra-financeiro-header">
                                <span className="compra-financeiro-titulo">Contrato distratado</span>
                              </div>
                              <div className="compra-financeiro-valores">
                                <span>Total pago até o distrato: <strong className="valor-pago">{formatCurrency(r.totalPago)}</strong></span>
                                <span className="compra-financeiro-contador">{r.qtdPagas} parcelas pagas</span>
                              </div>
                            </div>
                          )
                        }
                        return (
                          <div className="compra-financeiro">
                            <div className="compra-financeiro-header">
                              <span className="compra-financeiro-titulo">Plano de pagamentos</span>
                              <span className="compra-financeiro-pct">{r.pct.toFixed(0)}% quitado</span>
                            </div>
                            <div className="progress-bar-cliente">
                              <div className="progress-bar-fill" style={{ width: `${Math.min(100, r.pct)}%` }} />
                            </div>
                            <div className="compra-financeiro-valores">
                              <span>Pago: <strong className="valor-pago">{formatCurrency(r.totalPago)}</strong></span>
                              <span>Falta: <strong className="valor-pendente">{formatCurrency(r.totalPendente)}</strong></span>
                              <span className="compra-financeiro-contador">{r.qtdPagas}/{r.qtdTotal} parcelas pagas</span>
                            </div>
                            {r.proxima && (
                              <div className="compra-proxima-parcela">
                                <Calendar size={14} />
                                <span>
                                  Próxima parcela: <strong>{formatCurrency(r.proxima.valor)}</strong> — vence {formatDataBR(r.proxima.data_prevista)}
                                </span>
                              </div>
                            )}
                          </div>
                        )
                      })()}

                      {/* Seção expandida com detalhes dos pagamentos */}
                      {compraExpandida === compra.id && (
                        <div className="compra-pagamentos-detalhes">
                          {(() => {
                            const pagamentosCompra = pagamentos.filter(p => String(p.venda_id) === String(compra.id))
                            
                            if (pagamentosCompra.length === 0) {
                              return (
                                <div className="parcelas-empty">
                                  <p>Nenhum pagamento cadastrado para esta compra</p>
                                </div>
                              )
                            }
                            
                            return (
                              <>
                                <div className="parcelas-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <h5>Detalhamento de Pagamentos</h5>
                                  <div style={{ display: 'flex', gap: '4px' }}>
                                    <button
                                      onClick={() => setVisaoParcelas('contrato')}
                                      style={{
                                        padding: '4px 10px', fontSize: '11px', borderRadius: '5px', cursor: 'pointer',
                                        border: visaoParcelas === 'contrato' ? '1px solid #c9a962' : '1px solid rgba(255,255,255,0.15)',
                                        background: visaoParcelas === 'contrato' ? '#c9a962' : 'transparent',
                                        color: visaoParcelas === 'contrato' ? '#000' : 'rgba(255,255,255,0.7)',
                                        fontWeight: visaoParcelas === 'contrato' ? 600 : 400
                                      }}
                                    >Contrato</button>
                                    <button
                                      onClick={() => setVisaoParcelas('calendario')}
                                      style={{
                                        padding: '4px 10px', fontSize: '11px', borderRadius: '5px', cursor: 'pointer',
                                        border: visaoParcelas === 'calendario' ? '1px solid #c9a962' : '1px solid rgba(255,255,255,0.15)',
                                        background: visaoParcelas === 'calendario' ? '#c9a962' : 'transparent',
                                        color: visaoParcelas === 'calendario' ? '#000' : 'rgba(255,255,255,0.7)',
                                        fontWeight: visaoParcelas === 'calendario' ? 600 : 400
                                      }}
                                    >
                                      <Calendar size={11} style={{ marginRight: '3px', verticalAlign: 'middle' }} />
                                      Calendário
                                    </button>
                                  </div>
                                </div>
                                
                                {visaoParcelas === 'calendario' ? (() => {
                                  const parcelasCal = sortParcelas(pagamentosCompra, 'calendario')
                                    .filter((pagamento) => pagamento.status !== 'cancelado')
                                  const temMaisDe10 = parcelasCal.length > 10
                                  const estaExpandido = isGrupoExpandido(compra.id, 'calendario')
                                  const exibidas = temMaisDe10 && !estaExpandido ? parcelasCal.slice(0, 10) : parcelasCal
                                  return (
                                    <>
                                      <div className="parcelas-list">
                                        {exibidas.map((pagamento) => (
                                          <ParcelaCard key={pagamento.id} pagamento={pagamento} modo="cliente" />
                                        ))}
                                      </div>
                                      {temMaisDe10 && (
                                        <div className="grupo-expand-btn-wrapper">
                                          <button
                                            className="grupo-expand-btn"
                                            onClick={() => toggleGrupoExpandido(compra.id, 'calendario')}
                                          >
                                            {estaExpandido ? (
                                              <>
                                                <ChevronDown size={16} className="rotated" />
                                                <span>Ver menos ({parcelasCal.length - 10} itens ocultos)</span>
                                              </>
                                            ) : (
                                              <>
                                                <ChevronDown size={16} />
                                                <span>Ver mais ({parcelasCal.length - 10} itens restantes)</span>
                                              </>
                                            )}
                                          </button>
                                        </div>
                                      )}
                                    </>
                                  )
                                })() : (
                                  (() => {
                                    const pagamentosAtivosCompra = pagamentosCompra.filter((pagamento) => pagamento.status !== 'cancelado')
                                    const grupos = agruparPagamentosPorTipo(pagamentosAtivosCompra)
                                    const tiposOrdem = ['sinal', 'entrada', 'parcela_entrada', 'balao', 'comissao_integral', 'bens']
                                    return tiposOrdem.map(tipo => {
                                      const pagamentosGrupo = grupos[tipo]
                                      if (!pagamentosGrupo || pagamentosGrupo.length === 0) return null
                                      
                                      const totalValor = pagamentosGrupo.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0)
                                      const pagos = pagamentosGrupo.filter(p => p.status === 'pago').length
                                      const pendentes = pagamentosGrupo.filter(p => p.status === 'pendente').length
                                      
                                      const temMaisDe10 = pagamentosGrupo.length > 10
                                      const estaExpandido = isGrupoExpandido(compra.id, tipo)
                                      const itensParaMostrar = temMaisDe10 && !estaExpandido ? 10 : pagamentosGrupo.length
                                      const pagamentosExibidos = pagamentosGrupo.slice(0, itensParaMostrar)
                                      
                                      return (
                                        <div key={tipo} className="pagamento-grupo">
                                          <div className="grupo-header">
                                            <h6 className="grupo-titulo">{getGrupoLabel(tipo)}</h6>
                                            <div className="grupo-resumo">
                                              <span className="grupo-total-valor">{formatCurrency(totalValor)}</span>
                                              <span className="grupo-contador">
                                                {pagamentosGrupo.length} {pagamentosGrupo.length === 1 ? 'item' : 'itens'}
                                                {pagos > 0 && ` • ${pagos} pago${pagos > 1 ? 's' : ''}`}
                                                {pendentes > 0 && ` • ${pendentes} pendente${pendentes > 1 ? 's' : ''}`}
                                              </span>
                                            </div>
                                          </div>
                                          <div className="parcelas-list">
                                            {pagamentosExibidos.map((pagamento) => (
                                              <ParcelaCard key={pagamento.id} pagamento={pagamento} modo="cliente" />
                                            ))}
                                          </div>
                                          {temMaisDe10 && (
                                            <div className="grupo-expand-btn-wrapper">
                                              <button 
                                                className="grupo-expand-btn"
                                                onClick={() => toggleGrupoExpandido(compra.id, tipo)}
                                              >
                                                {estaExpandido ? (
                                                  <>
                                                    <ChevronDown size={16} className="rotated" />
                                                    <span>Ver menos ({pagamentosGrupo.length - 10} itens ocultos)</span>
                                                  </>
                                                ) : (
                                                  <>
                                                    <ChevronDown size={16} />
                                                    <span>Ver mais ({pagamentosGrupo.length - 10} itens restantes)</span>
                                                  </>
                                                )}
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })
                                  })()
                                )}
                              </>
                            )
                          })()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Pagamentos Tab — consolidado de todas as parcelas do cliente */}
          {activeTab === 'pagamentos' && (() => {
            const ativos = pagamentos.filter(isAtivo)
            const pagos = ativos.filter(isPago)
            const pendentes = ativos.filter(isPendente)
            const somar = (lista) => lista.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0)
            const proxima = pendentes
              .filter(p => p.data_prevista)
              .sort((a, b) => (a.data_prevista < b.data_prevista ? -1 : 1))[0]
            const comprasFiltradas = filtroCompraPag === 'todas'
              ? compras
              : compras.filter(c => String(c.id) === filtroCompraPag)

            return (
              <section className="pagamentos-section-cliente">
                {/* Resumo — derivado das parcelas (visualizacao-totais.md) */}
                <div className="stats-section">
                  <div className="stat-card-cliente success">
                    <div className="stat-card-icon"><CheckCircle size={28} /></div>
                    <div className="stat-card-content">
                      <span className="stat-card-label">Total Pago</span>
                      <span className="stat-card-value">{formatCurrency(somar(pagos))}</span>
                      <span className="stat-card-sub">{pagos.length} parcelas</span>
                    </div>
                    <div className="stat-card-decoration"></div>
                  </div>
                  <div className="stat-card-cliente primary">
                    <div className="stat-card-icon"><Clock size={28} /></div>
                    <div className="stat-card-content">
                      <span className="stat-card-label">Em Aberto</span>
                      <span className="stat-card-value">{formatCurrency(somar(pendentes))}</span>
                      <span className="stat-card-sub">{pendentes.length} parcelas</span>
                    </div>
                    <div className="stat-card-decoration"></div>
                  </div>
                  <div className="stat-card-cliente info">
                    <div className="stat-card-icon"><Calendar size={28} /></div>
                    <div className="stat-card-content">
                      <span className="stat-card-label">Próxima Parcela</span>
                      <span className="stat-card-value">{proxima ? formatCurrency(proxima.valor) : '—'}</span>
                      <span className="stat-card-sub">{proxima ? `vence ${formatDataBR(proxima.data_prevista)}` : 'nada em aberto'}</span>
                    </div>
                    <div className="stat-card-decoration"></div>
                  </div>
                </div>

                {/* Filtros */}
                <div className="pag-filtros">
                  <div className="pag-filtros-chips">
                    {[
                      { id: 'todos', label: 'Todas' },
                      { id: 'pago', label: 'Pagas' },
                      { id: 'pendente', label: 'Pendentes' },
                    ].map(f => (
                      <button
                        key={f.id}
                        className={`chip-filtro ${filtroStatusPag === f.id ? 'ativo' : ''}`}
                        onClick={() => setFiltroStatusPag(f.id)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  {compras.length > 1 && (
                    <select
                      className="pag-filtro-compra"
                      value={filtroCompraPag}
                      onChange={(e) => setFiltroCompraPag(e.target.value)}
                    >
                      <option value="todas">Todas as compras</option>
                      {compras.map(c => (
                        <option key={c.id} value={String(c.id)}>{tituloCompra(c)}</option>
                      ))}
                    </select>
                  )}
                </div>

                {comprasFiltradas.every(compra =>
                  ativos.filter(p => String(p.venda_id) === String(compra.id))
                    .filter(p => filtroStatusPag === 'todos' || p.status === filtroStatusPag).length === 0
                ) ? (
                  <div className="empty-state">
                    <CreditCard size={48} />
                    <h3>Nenhuma parcela encontrada</h3>
                    <p>Ajuste os filtros ou aguarde o registro dos pagamentos</p>
                  </div>
                ) : (
                  comprasFiltradas.map(compra => {
                    const doCompra = ativos
                      .filter(p => String(p.venda_id) === String(compra.id))
                      .filter(p => filtroStatusPag === 'todos' || p.status === filtroStatusPag)
                      .sort((a, b) => {
                        const da = a.data_pagamento || a.data_prevista || ''
                        const db = b.data_pagamento || b.data_prevista || ''
                        return da < db ? -1 : da > db ? 1 : 0
                      })
                    if (doCompra.length === 0) return null
                    const estaExpandido = isGrupoExpandido(compra.id, 'pagtab')
                    const exibidas = doCompra.length > 12 && !estaExpandido ? doCompra.slice(0, 12) : doCompra
                    return (
                      <div key={compra.id} className="pag-grupo-compra">
                        {compras.length > 1 && (
                          <h3 className="pag-grupo-titulo">
                            <Building size={16} />
                            {tituloCompra(compra)}
                          </h3>
                        )}
                        <div className="parcelas-list">
                          {exibidas.map(pagamento => {
                            const boleto = boletoAtivoDaParcela(pagamento.id)
                            return (
                              <div key={pagamento.id} className="parcela-com-boleto">
                                <ParcelaCard pagamento={pagamento} modo="cliente" />
                                {boleto && renderBoletoStrip(boleto)}
                              </div>
                            )
                          })}
                        </div>
                        {doCompra.length > 12 && (
                          <div className="grupo-expand-btn-wrapper">
                            <button
                              className="grupo-expand-btn"
                              onClick={() => toggleGrupoExpandido(compra.id, 'pagtab')}
                            >
                              <ChevronDown size={16} className={estaExpandido ? 'rotated' : ''} />
                              <span>
                                {estaExpandido
                                  ? `Ver menos (${doCompra.length - 12} itens ocultos)`
                                  : `Ver mais (${doCompra.length - 12} itens restantes)`}
                              </span>
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </section>
            )
          })()}

          {/* Meu Imóvel Tab — empreendimento + fotos */}
          {activeTab === 'imovel' && (
            <section className="imovel-section">
              {compras.length === 0 ? (
                <div className="empty-state">
                  <Building size={48} />
                  <h3>Nenhum imóvel encontrado</h3>
                  <p>Seu imóvel aparecerá aqui quando a compra for registrada</p>
                </div>
              ) : (
                compras.map(compra => {
                  const emp = compra.empreendimentos || compra.empreendimento
                  const fotos = fotosEmpreendimentos.filter(
                    f => String(f.empreendimento_id) === String(emp?.id) && f.categoria !== 'logo'
                  )
                  const fachada = fotos.find(f => f.categoria === 'fachada' && f.destaque)
                    || fotos.find(f => f.categoria === 'fachada')
                    || fotos[0]
                  const galeria = fotos.filter(f => f !== fachada)
                  return (
                    <div key={compra.id} className="imovel-card">
                      {fachada && (
                        <a className="imovel-hero" href={fachada.url} target="_blank" rel="noopener noreferrer">
                          <img src={fachada.url} alt={emp?.nome || 'Empreendimento'} loading="lazy" />
                        </a>
                      )}
                      <div className="imovel-info">
                        <h3>{emp?.nome || 'Empreendimento'}</h3>
                        <div className="imovel-meta">
                          {compra.unidade && (
                            <span className="imovel-chip"><MapPin size={13} /> Unidade {compra.unidade}</span>
                          )}
                          {compra.bloco && <span className="imovel-chip">Bloco {compra.bloco}</span>}
                          {compra.andar && <span className="imovel-chip">{compra.andar}</span>}
                          {(() => {
                            const tag = statusCompra(compra)
                            return (
                              <span className={`status-tag ${tag.classe}`}>
                                <tag.Icone size={12} />
                                {tag.label}
                              </span>
                            )
                          })()}
                        </div>
                        {emp?.descricao && <p className="imovel-descricao">{emp.descricao}</p>}
                      </div>
                      {galeria.length > 0 && (
                        <div className="imovel-galeria">
                          {galeria.slice(0, 12).map((f, i) => (
                            <a key={`${f.url}-${i}`} href={f.url} target="_blank" rel="noopener noreferrer" title={f.descricao || f.categoria}>
                              <img src={f.url} alt={f.descricao || f.categoria || 'Foto'} loading="lazy" />
                            </a>
                          ))}
                        </div>
                      )}
                      {fotos.length > 0 && emp && (
                        <div className="imovel-ver-tudo-wrapper">
                          <button className="btn-ver-todas" onClick={() => abrirDetalheEmp(emp)}>
                            Ver todas as fotos, plantas e detalhes
                          </button>
                        </div>
                      )}
                      {fotos.length === 0 && (
                        <div className="imovel-sem-fotos">
                          <ImageIcon size={20} />
                          <span>Fotos do empreendimento em breve</span>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </section>
          )}

          {/* Empreendimentos Tab — vitrine de todos os empreendimentos da IM */}
          {activeTab === 'empreendimentos' && (() => {
            const meusEmpIds = new Set(
              compras.map(c => String(c.empreendimento_id)).filter(Boolean)
            )
            const lista = empreendimentosTodos.filter(e => e.ativo !== false)
            return (
              <section className="empreendimentos-section-cliente">
                <p className="emp-catalogo-intro">
                  Conheça os empreendimentos da IM Incorporadora
                </p>
                {lista.length === 0 ? (
                  <div className="empty-state">
                    <Building2 size={48} />
                    <h3>Nenhum empreendimento disponível</h3>
                    <p>Os empreendimentos aparecerão aqui em breve</p>
                  </div>
                ) : (
                  <div className="empreendimentos-grid-cliente">
                    {lista.map(emp => {
                      const fotos = fotosEmpreendimentos.filter(
                        f => String(f.empreendimento_id) === String(emp.id) && f.categoria !== 'logo'
                      )
                      const fachada = fotos.find(f => f.categoria === 'fachada' && f.destaque)
                        || fotos.find(f => f.categoria === 'fachada')
                        || fotos[0]
                      const galeria = fotos.filter(f => f !== fachada)
                      const ehMeu = meusEmpIds.has(String(emp.id))
                      return (
                        <div
                          key={emp.id}
                          className={`emp-card-cliente ${ehMeu ? 'meu' : ''}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => abrirDetalheEmp(emp)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirDetalheEmp(emp) } }}
                          title="Ver detalhes do empreendimento"
                        >
                          {fachada ? (
                            <div className="emp-card-hero">
                              <img src={fachada.url} alt={emp.nome} loading="lazy" />
                            </div>
                          ) : (
                            <div className="emp-card-hero placeholder">
                              {emp.logo_url
                                ? <img src={emp.logo_url} alt={emp.nome} loading="lazy" className="emp-card-logo-placeholder" />
                                : <Building2 size={40} />}
                            </div>
                          )}
                          <div className="emp-card-body">
                            <div className="emp-card-titulo">
                              <h3>{emp.nome}</h3>
                              {ehMeu && (
                                <span className="emp-badge-meu">
                                  <CheckCircle size={12} />
                                  Meu empreendimento
                                </span>
                              )}
                            </div>
                            {emp.descricao && <p className="emp-card-descricao">{emp.descricao}</p>}
                            <div className="emp-card-rodape">
                              {galeria.length > 0 && (
                                <div className="emp-card-galeria">
                                  {galeria.slice(0, 4).map((f, i) => (
                                    <span key={`${f.url}-${i}`} className="emp-card-thumb" title={f.descricao || CATEGORIA_LABELS[f.categoria] || f.categoria}>
                                      <img src={f.url} alt={f.descricao || f.categoria || 'Foto'} loading="lazy" />
                                    </span>
                                  ))}
                                  {galeria.length > 4 && (
                                    <span className="emp-card-mais-fotos">+{galeria.length - 4}</span>
                                  )}
                                </div>
                              )}
                              <span className="emp-card-ver-detalhes">
                                <Eye size={14} />
                                Ver detalhes
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })()}

          {/* Garantia Tab — portal oficial por empreendimento + como acionar + prazos */}
          {activeTab === 'garantia' && (() => {
            const meusEmpIds = new Set(compras.map(c => String(c.empreendimento_id)).filter(Boolean))
            const empsComPortal = empreendimentosTodos.filter(
              e => meusEmpIds.has(String(e.id)) && e.garantia_url
            )
            return (
            <section className="garantia-section">
              {empsComPortal.length > 0 && (
                <div className="garantia-card garantia-portal-card">
                  <h2>
                    <ShieldCheck size={24} />
                    Portal de Garantia
                  </h2>
                  <p className="garantia-intro">
                    Abra e acompanhe os chamados de garantia do seu imóvel direto no portal
                    oficial do seu empreendimento:
                  </p>
                  <div className="garantia-portal-lista">
                    {empsComPortal.map(emp => (
                      <a
                        key={emp.id}
                        className="btn-portal-garantia"
                        href={emp.garantia_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span className="btn-portal-garantia-info">
                          {emp.logo_url
                            ? <img src={emp.logo_url} alt="" className="btn-portal-garantia-logo" />
                            : <Building2 size={18} />}
                          <span>
                            <strong>{emp.nome}</strong>
                            <small>Abrir chamado de garantia</small>
                          </span>
                        </span>
                        <ChevronRight size={18} />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="garantia-card">
                <h2>
                  <ShieldCheck size={24} />
                  Garantia do seu imóvel
                </h2>
                <p className="garantia-intro">
                  Encontrou algum problema no seu imóvel? A IM Incorporadora oferece garantia
                  conforme o contrato e o Manual do Proprietário. Veja como acionar:
                </p>
                <div className="garantia-passos">
                  <div className="garantia-passo">
                    <span className="garantia-passo-num">1</span>
                    <div>
                      <strong>Registre o problema</strong>
                      <p>Descreva o que aconteceu e tire fotos ou vídeos que mostrem o problema.</p>
                    </div>
                  </div>
                  <div className="garantia-passo">
                    <span className="garantia-passo-num">2</span>
                    <div>
                      <strong>Abra o chamado</strong>
                      <p>
                        {empsComPortal.length > 0
                          ? 'Use o Portal de Garantia do seu empreendimento (acima) anexando a descrição e as fotos. Se preferir, fale com seu corretor.'
                          : 'Mande a descrição e as fotos pelo WhatsApp do seu corretor ou pelo contato da administração.'}
                      </p>
                    </div>
                  </div>
                  <div className="garantia-passo">
                    <span className="garantia-passo-num">3</span>
                    <div>
                      <strong>Acompanhe a visita técnica</strong>
                      <p>Nossa equipe avalia o chamado e agenda a vistoria ou o reparo quando coberto pela garantia.</p>
                    </div>
                  </div>
                </div>
                {(() => {
                  const corr = corretoresDasCompras().find(c => c.telefone)
                  if (!corr) return null
                  return (
                    <a
                      className="btn-whatsapp garantia-whatsapp"
                      href={linkWhatsApp(corr.telefone)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MessageCircle size={16} />
                      Falar com {corr.nome?.split(' ')[0]}
                    </a>
                  )
                })()}
              </div>

              <div className="garantia-card">
                <h3>Prazos usuais de garantia (referência)</h3>
                <div className="garantia-prazos">
                  <div className="garantia-prazo">
                    <span className="garantia-prazo-anos">5 anos</span>
                    <span>Solidez e segurança estrutural (fundações, estrutura)</span>
                  </div>
                  <div className="garantia-prazo">
                    <span className="garantia-prazo-anos">3 anos</span>
                    <span>Impermeabilização</span>
                  </div>
                  <div className="garantia-prazo">
                    <span className="garantia-prazo-anos">2 anos</span>
                    <span>Instalações hidráulicas e elétricas</span>
                  </div>
                  <div className="garantia-prazo">
                    <span className="garantia-prazo-anos">1 ano</span>
                    <span>Revestimentos, pintura e acabamentos</span>
                  </div>
                </div>
                <p className="garantia-disclaimer">
                  <AlertCircle size={14} />
                  Prazos de referência do mercado. Valem os prazos do seu contrato e do Manual
                  do Proprietário do seu empreendimento — em caso de dúvida, fale com a administração.
                </p>
              </div>
            </section>
            )
          })()}

          {/* Documentos Tab */}
          {activeTab === 'documentos' && (
            <section className="documentos-section">
              <div className="docs-upload-grid-cliente">
                {/* RG Frente */}
                <div className="form-group-doc">
                  <label className="doc-label">
                    RG Frente
                    {cliente.rg_frente_url ? (
                      <span className="doc-status-badge success">
                        <CheckCircle size={14} />
                        Enviado
                      </span>
                    ) : (
                      <span className="doc-status-badge warning">
                        <Clock size={14} />
                        Pendente
                      </span>
                    )}
                  </label>
                  <div className="file-upload-wrapper">
                    {cliente.rg_frente_url ? (
                      <div className="file-upload-info">
                        <span className="file-name" title={cliente.rg_frente_url.split('/').pop()?.split('?')[0]}>
                          {cliente.rg_frente_url.split('/').pop()?.split('?')[0]}
                        </span>
                        <a href={getUrlComCacheBust(cliente.rg_frente_url)} target="_blank" rel="noopener noreferrer" className="doc-preview">
                          Ver arquivo
                        </a>
                      </div>
                    ) : null}
                    <label className="file-upload-label">
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => e.target.files[0] && uploadDocumentoCliente(e.target.files[0], 'rg_frente')}
                        className="file-upload-input"
                        disabled={uploadingDoc && uploadingDocType === 'rg_frente'}
                      />
                      <span className="file-upload-button">
                        {uploadingDoc && uploadingDocType === 'rg_frente' ? (
                          <>
                            <div className="loading-spinner-small"></div>
                            Enviando...
                          </>
                        ) : (
                          'Escolher Arquivo'
                        )}
                      </span>
                    </label>
                  </div>
                </div>

                {/* RG Verso */}
                <div className="form-group-doc">
                  <label className="doc-label">
                    RG Verso
                    {cliente.rg_verso_url ? (
                      <span className="doc-status-badge success">
                        <CheckCircle size={14} />
                        Enviado
                      </span>
                    ) : (
                      <span className="doc-status-badge warning">
                        <Clock size={14} />
                        Pendente
                      </span>
                    )}
                  </label>
                  <div className="file-upload-wrapper">
                    {cliente.rg_verso_url ? (
                      <div className="file-upload-info">
                        <span className="file-name" title={cliente.rg_verso_url.split('/').pop()?.split('?')[0]}>
                          {cliente.rg_verso_url.split('/').pop()?.split('?')[0]}
                        </span>
                        <a href={getUrlComCacheBust(cliente.rg_verso_url)} target="_blank" rel="noopener noreferrer" className="doc-preview">
                          Ver arquivo
                        </a>
                      </div>
                    ) : null}
                    <label className="file-upload-label">
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => e.target.files[0] && uploadDocumentoCliente(e.target.files[0], 'rg_verso')}
                        className="file-upload-input"
                        disabled={uploadingDoc && uploadingDocType === 'rg_verso'}
                      />
                      <span className="file-upload-button">
                        {uploadingDoc && uploadingDocType === 'rg_verso' ? (
                          <>
                            <div className="loading-spinner-small"></div>
                            Enviando...
                          </>
                        ) : (
                          'Escolher Arquivo'
                        )}
                      </span>
                    </label>
                  </div>
                </div>

                {/* CPF */}
                <div className="form-group-doc">
                  <label className="doc-label">
                    CPF
                    {cliente.cpf_url ? (
                      <span className="doc-status-badge success">
                        <CheckCircle size={14} />
                        Enviado
                      </span>
                    ) : (
                      <span className="doc-status-badge warning">
                        <Clock size={14} />
                        Pendente
                      </span>
                    )}
                  </label>
                  <div className="file-upload-wrapper">
                    {cliente.cpf_url ? (
                      <div className="file-upload-info">
                        <span className="file-name" title={cliente.cpf_url.split('/').pop()?.split('?')[0]}>
                          {cliente.cpf_url.split('/').pop()?.split('?')[0]}
                        </span>
                        <a href={getUrlComCacheBust(cliente.cpf_url)} target="_blank" rel="noopener noreferrer" className="doc-preview">
                          Ver arquivo
                        </a>
                      </div>
                    ) : null}
                    <label className="file-upload-label">
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => e.target.files[0] && uploadDocumentoCliente(e.target.files[0], 'cpf')}
                        className="file-upload-input"
                        disabled={uploadingDoc && uploadingDocType === 'cpf'}
                      />
                      <span className="file-upload-button">
                        {uploadingDoc && uploadingDocType === 'cpf' ? (
                          <>
                            <div className="loading-spinner-small"></div>
                            Enviando...
                          </>
                        ) : (
                          'Escolher Arquivo'
                        )}
                      </span>
                    </label>
                  </div>
                </div>

                {/* Comprovante de Residência */}
                <div className="form-group-doc">
                  <label className="doc-label">
                    Comprovante de Residência
                    {cliente.comprovante_residencia_url ? (
                      <span className="doc-status-badge success">
                        <CheckCircle size={14} />
                        Enviado
                      </span>
                    ) : (
                      <span className="doc-status-badge warning">
                        <Clock size={14} />
                        Pendente
                      </span>
                    )}
                  </label>
                  <div className="file-upload-wrapper">
                    {cliente.comprovante_residencia_url ? (
                      <div className="file-upload-info">
                        <span className="file-name" title={cliente.comprovante_residencia_url.split('/').pop()?.split('?')[0]}>
                          {cliente.comprovante_residencia_url.split('/').pop()?.split('?')[0]}
                        </span>
                        <a href={getUrlComCacheBust(cliente.comprovante_residencia_url)} target="_blank" rel="noopener noreferrer" className="doc-preview">
                          Ver arquivo
                        </a>
                      </div>
                    ) : null}
                    <label className="file-upload-label">
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => e.target.files[0] && uploadDocumentoCliente(e.target.files[0], 'comprovante_residencia')}
                        className="file-upload-input"
                        disabled={uploadingDoc && uploadingDocType === 'comprovante_residencia'}
                      />
                      <span className="file-upload-button">
                        {uploadingDoc && uploadingDocType === 'comprovante_residencia' ? (
                          <>
                            <div className="loading-spinner-small"></div>
                            Enviando...
                          </>
                        ) : (
                          'Escolher Arquivo'
                        )}
                      </span>
                    </label>
                  </div>
                </div>

                {/* Comprovante de Renda */}
                <div className="form-group-doc">
                  <label className="doc-label">
                    Comprovante de Renda
                    {cliente.comprovante_renda_url ? (
                      <span className="doc-status-badge success">
                        <CheckCircle size={14} />
                        Enviado
                      </span>
                    ) : (
                      <span className="doc-status-badge warning">
                        <Clock size={14} />
                        Pendente
                      </span>
                    )}
                  </label>
                  <div className="file-upload-wrapper">
                    {cliente.comprovante_renda_url ? (
                      <div className="file-upload-info">
                        <span className="file-name" title={cliente.comprovante_renda_url.split('/').pop()?.split('?')[0]}>
                          {cliente.comprovante_renda_url.split('/').pop()?.split('?')[0]}
                        </span>
                        <a href={getUrlComCacheBust(cliente.comprovante_renda_url)} target="_blank" rel="noopener noreferrer" className="doc-preview">
                          Ver arquivo
                        </a>
                      </div>
                    ) : null}
                    <label className="file-upload-label">
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => e.target.files[0] && uploadDocumentoCliente(e.target.files[0], 'comprovante_renda')}
                        className="file-upload-input"
                        disabled={uploadingDoc && uploadingDocType === 'comprovante_renda'}
                      />
                      <span className="file-upload-button">
                        {uploadingDoc && uploadingDocType === 'comprovante_renda' ? (
                          <>
                            <div className="loading-spinner-small"></div>
                            Enviando...
                          </>
                        ) : (
                          'Escolher Arquivo'
                        )}
                      </span>
                    </label>
                  </div>
                </div>

                {/* Certidão de Casamento */}
                <div className="form-group-doc">
                  <label className="doc-label">
                    Certidão de Casamento/União
                    {cliente.certidao_casamento_url ? (
                      <span className="doc-status-badge success">
                        <CheckCircle size={14} />
                        Enviado
                      </span>
                    ) : (
                      <span className="doc-status-badge warning">
                        <Clock size={14} />
                        Pendente
                      </span>
                    )}
                  </label>
                  <div className="file-upload-wrapper">
                    {cliente.certidao_casamento_url ? (
                      <div className="file-upload-info">
                        <span className="file-name" title={cliente.certidao_casamento_url.split('/').pop()?.split('?')[0]}>
                          {cliente.certidao_casamento_url.split('/').pop()?.split('?')[0]}
                        </span>
                        <a href={getUrlComCacheBust(cliente.certidao_casamento_url)} target="_blank" rel="noopener noreferrer" className="doc-preview">
                          Ver arquivo
                        </a>
                      </div>
                    ) : null}
                    <label className="file-upload-label">
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => e.target.files[0] && uploadDocumentoCliente(e.target.files[0], 'certidao_casamento')}
                        className="file-upload-input"
                        disabled={uploadingDoc && uploadingDocType === 'certidao_casamento'}
                      />
                      <span className="file-upload-button">
                        {uploadingDoc && uploadingDocType === 'certidao_casamento' ? (
                          <>
                            <div className="loading-spinner-small"></div>
                            Enviando...
                          </>
                        ) : (
                          'Escolher Arquivo'
                        )}
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Perfil Tab */}
          {activeTab === 'perfil' && (
            <section className="perfil-section">
              <div className="perfil-card-cliente">
                <div className="perfil-header-cliente">
                  <div className="avatar-large">
                    {cliente.nome_completo?.charAt(0).toUpperCase() || 'C'}
                  </div>
                  <div className="perfil-info-header">
                    <h3>{cliente.nome_completo}</h3>
                    <p>Cliente IM Incorporadora</p>
                  </div>
                  {!editandoPerfil && (
                    <button className="btn-editar-perfil" onClick={iniciarEdicaoPerfil}>
                      <Pencil size={15} />
                      <span>Editar dados</span>
                    </button>
                  )}
                </div>

                {editandoPerfil && (
                  <div className="perfil-edit-form">
                    <div className="perfil-edit-grid">
                      {CAMPOS_PERFIL_EDITAVEIS.map(({ campo, label }) => (
                        <div key={campo} className="perfil-edit-field">
                          <label htmlFor={`perfil-${campo}`}>{label}</label>
                          <input
                            id={`perfil-${campo}`}
                            type="text"
                            value={perfilForm[campo] ?? ''}
                            onChange={(e) => setPerfilForm(prev => ({ ...prev, [campo]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="perfil-edit-actions">
                      <button className="btn-salvar-perfil" onClick={salvarPerfil} disabled={salvandoPerfil}>
                        <Save size={15} />
                        {salvandoPerfil ? 'Salvando...' : 'Salvar'}
                      </button>
                      <button className="btn-cancelar-perfil" onClick={() => setEditandoPerfil(false)} disabled={salvandoPerfil}>
                        Cancelar
                      </button>
                    </div>
                    <p className="perfil-edit-aviso">
                      CPF, RG, data de nascimento, email e renda só podem ser alterados pela administração.
                    </p>
                  </div>
                )}

                <div className="perfil-details-grid">
                  <div className="perfil-detail-card">
                    <span className="perfil-detail-label">CPF</span>
                    <span className="perfil-detail-value">{cliente.cpf || '-'}</span>
                  </div>
                  
                  <div className="perfil-detail-card">
                    <span className="perfil-detail-label">RG</span>
                    <span className="perfil-detail-value">{cliente.rg || '-'}</span>
                  </div>
                  
                  <div className="perfil-detail-card">
                    <span className="perfil-detail-label">DATA DE NASCIMENTO</span>
                    <span className="perfil-detail-value">{formatDate(cliente.data_nascimento) || '-'}</span>
                  </div>
                  
                  <div className="perfil-detail-card">
                    <span className="perfil-detail-label">EMAIL</span>
                    <span className="perfil-detail-value">{cliente.email || '-'}</span>
                  </div>
                  
                  <div className="perfil-detail-card">
                    <span className="perfil-detail-label">TELEFONE</span>
                    <span className="perfil-detail-value">{cliente.telefone || '-'}</span>
                  </div>
                  
                  <div className="perfil-detail-card">
                    <span className="perfil-detail-label">ENDEREÇO</span>
                    <span className="perfil-detail-value">{cliente.endereco || '-'}</span>
                  </div>
                  
                  {cliente.cep && (
                    <div className="perfil-detail-card">
                      <span className="perfil-detail-label">CEP</span>
                      <span className="perfil-detail-value">{cliente.cep}</span>
                    </div>
                  )}
                  
                  <div className="perfil-detail-card">
                    <span className="perfil-detail-label">PROFISSÃO</span>
                    <span className="perfil-detail-value">{cliente.profissao || '-'}</span>
                  </div>
                  
                  <div className="perfil-detail-card">
                    <span className="perfil-detail-label">EMPRESA</span>
                    <span className="perfil-detail-value">{cliente.empresa_trabalho || '-'}</span>
                  </div>
                  
                  <div className="perfil-detail-card highlight">
                    <span className="perfil-detail-label">RENDA MENSAL</span>
                    <span className="perfil-detail-value">{formatCurrency(cliente.renda_mensal)}</span>
                  </div>
                </div>

                {(cliente.tem_complemento_renda || cliente.possui_3_anos_fgts) && (
                  <div className="perfil-badges-section">
                    {cliente.possui_3_anos_fgts && (
                      <div className="perfil-badge success">
                        <CheckCircle size={18} />
                        <span>Possui 3 anos de FGTS</span>
                      </div>
                    )}
                    
                    {cliente.tem_complemento_renda && (
                      <div className="perfil-badge info">
                        <UserIcon size={18} />
                        <span>Complemento de Renda Cadastrado</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Troca de senha — supabase.auth.updateUser na sessão do próprio cliente */}
                <div className="perfil-senha-section">
                  <h4>
                    <Lock size={16} />
                    Alterar senha
                  </h4>
                  <div className="perfil-senha-form">
                    <input
                      type="password"
                      placeholder="Nova senha (mín. 8 caracteres)"
                      value={senhaForm.nova}
                      onChange={(e) => setSenhaForm(prev => ({ ...prev, nova: e.target.value }))}
                      autoComplete="new-password"
                    />
                    <input
                      type="password"
                      placeholder="Confirmar nova senha"
                      value={senhaForm.confirmar}
                      onChange={(e) => setSenhaForm(prev => ({ ...prev, confirmar: e.target.value }))}
                      autoComplete="new-password"
                    />
                    <button
                      className="btn-salvar-perfil"
                      onClick={trocarSenha}
                      disabled={salvandoSenha || !senhaForm.nova}
                    >
                      {salvandoSenha ? 'Alterando...' : 'Alterar senha'}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>

      {/* Modal de detalhes do empreendimento — galeria completa por categoria */}
      {empDetalhe && (
        <div className="modal-overlay-cliente" onClick={fecharDetalheEmp}>
          <div className="emp-detalhe-modal" onClick={(e) => e.stopPropagation()}>
            <div className="emp-detalhe-header">
              <div className="emp-detalhe-header-titulo">
                {empDetalhe.logo_url && (
                  <img src={empDetalhe.logo_url} alt="" className="emp-detalhe-logo" />
                )}
                <h2>{empDetalhe.nome}</h2>
              </div>
              <button className="emp-detalhe-fechar" onClick={fecharDetalheEmp} title="Fechar">
                <X size={22} />
              </button>
            </div>

            <div className="emp-detalhe-body">
              {empDetalhe.descricao && (
                <p className="emp-detalhe-descricao">{empDetalhe.descricao}</p>
              )}

              {fotosDetalhe.length === 0 ? (
                <div className="imovel-sem-fotos">
                  <ImageIcon size={20} />
                  <span>Fotos do empreendimento em breve</span>
                </div>
              ) : (
                <>
                  <div className="emp-detalhe-cats">
                    <button
                      className={`chip-filtro ${catAtivaDetalhe === 'todas' ? 'ativo' : ''}`}
                      onClick={() => { setCatAtivaDetalhe('todas'); setFotoAmpliada(null) }}
                    >
                      Todas ({fotosDetalhe.length})
                    </button>
                    {categoriasDetalhe.map(cat => (
                      <button
                        key={cat}
                        className={`chip-filtro ${catAtivaDetalhe === cat ? 'ativo' : ''}`}
                        onClick={() => { setCatAtivaDetalhe(cat); setFotoAmpliada(null) }}
                      >
                        {CATEGORIA_LABELS[cat] || cat} ({fotosDetalhe.filter(f => (f.categoria || 'outros') === cat).length})
                      </button>
                    ))}
                  </div>

                  <div className="emp-detalhe-grid">
                    {fotosFiltradasDetalhe.map((f, i) => (
                      <button
                        key={`${f.url}-${i}`}
                        className="emp-detalhe-foto"
                        onClick={() => setFotoAmpliada(i)}
                        title={f.descricao || CATEGORIA_LABELS[f.categoria] || ''}
                      >
                        <img src={f.url} alt={f.descricao || f.categoria || 'Foto'} loading="lazy" />
                        <span className="emp-detalhe-foto-cat">
                          {CATEGORIA_LABELS[f.categoria] || f.categoria}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox — foto ampliada com navegação */}
      {empDetalhe && fotoAmpliada !== null && fotosFiltradasDetalhe[fotoAmpliada] && (
        <div className="lightbox-overlay" onClick={() => setFotoAmpliada(null)}>
          <button
            className="lightbox-fechar"
            onClick={(e) => { e.stopPropagation(); setFotoAmpliada(null) }}
            title="Fechar (Esc)"
          >
            <X size={26} />
          </button>
          {fotosFiltradasDetalhe.length > 1 && (
            <button
              className="lightbox-nav prev"
              onClick={(e) => {
                e.stopPropagation()
                setFotoAmpliada(i => (i - 1 + fotosFiltradasDetalhe.length) % fotosFiltradasDetalhe.length)
              }}
              title="Anterior (←)"
            >
              <ChevronLeft size={30} />
            </button>
          )}
          <figure className="lightbox-conteudo" onClick={(e) => e.stopPropagation()}>
            <img
              src={fotosFiltradasDetalhe[fotoAmpliada].url}
              alt={fotosFiltradasDetalhe[fotoAmpliada].descricao || 'Foto'}
            />
            <figcaption>
              <span className="lightbox-cat">
                {CATEGORIA_LABELS[fotosFiltradasDetalhe[fotoAmpliada].categoria] || fotosFiltradasDetalhe[fotoAmpliada].categoria}
              </span>
              {fotosFiltradasDetalhe[fotoAmpliada].descricao && (
                <span>{fotosFiltradasDetalhe[fotoAmpliada].descricao}</span>
              )}
              <span className="lightbox-contador">
                {fotoAmpliada + 1} / {fotosFiltradasDetalhe.length}
              </span>
            </figcaption>
          </figure>
          {fotosFiltradasDetalhe.length > 1 && (
            <button
              className="lightbox-nav next"
              onClick={(e) => {
                e.stopPropagation()
                setFotoAmpliada(i => (i + 1) % fotosFiltradasDetalhe.length)
              }}
              title="Próxima (→)"
            >
              <ChevronRight size={30} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default ClienteDashboard


