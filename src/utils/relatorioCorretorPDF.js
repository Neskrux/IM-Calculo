// Gerador ÚNICO do PDF do relatório do corretor.
//
// É a FONTE ÚNICA da verdade: tanto o corretor logado (CorretorDashboard) quanto o
// admin ("Ver PDF do corretor", pra validação da controladoria) chamam ESTA função —
// assim o PDF é byte-a-byte igual. Se mudar, muda pros dois juntos (nunca diverge).
//
// Regras: comissão é por PARCELA (data do pagamento), fatia do cargo Corretor via fator
// canônico com pró-soluto. Ver .claude/rules/comissao-corretor.md + fator-comissao.md.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { calcularFatorComissao, calcularComissaoPagamentoCompleto } from './comissaoCalculator'
import { parseDataLocal, formatDataBR } from './datas'

const formatCurrency = (value) => {
  if (value === null || value === undefined || isNaN(value)) return 'R$ 0,00'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

const capitalizeName = (name) => {
  if (!name || typeof name !== 'string') return name
  return name.toLowerCase().split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// Fatia do cargo Corretor por pagamento — MESMA lógica do CorretorDashboard.
function makeCalcularComissao(vendas, corretorProfile) {
  const percentualFallback =
    corretorProfile?.percentual_corretor ||
    (corretorProfile?.tipo_corretor === 'interno' ? 2.5 : 4)

  return (pagamento) => {
    if (!pagamento) return 0
    const valorParcela = parseFloat(pagamento.valor) || 0
    if (valorParcela <= 0) return 0

    const venda = vendas.find(v => v.id === pagamento.venda_id)
    const percentualCorretorVenda = parseFloat(venda?.percentual_corretor) || parseFloat(percentualFallback) || 0
    const valorProSoluto = parseFloat(venda?.valor_pro_soluto) || 0

    if (venda && percentualCorretorVenda > 0 && valorProSoluto > 0) {
      const fatorCorretor = calcularFatorComissao(venda.valor_venda, valorProSoluto, percentualCorretorVenda)
      return valorParcela * fatorCorretor
    }
    const percentualTotalSnapshot = parseFloat(pagamento.percentual_comissao_total) || 0
    const comissaoTotalSnapshot = parseFloat(pagamento.comissao_gerada) || 0
    if (comissaoTotalSnapshot > 0 && percentualCorretorVenda > 0 && percentualTotalSnapshot > 0) {
      return comissaoTotalSnapshot * (percentualCorretorVenda / percentualTotalSnapshot)
    }
    return calcularComissaoPagamentoCompleto(pagamento, { vendas, percentualFallback })
  }
}

// Recorte: empreendimento + status + PERÍODO POR DATA DO PAGAMENTO (não data da venda).
function getRelatorioDados({ vendas, pagamentos, filtros }) {
  const vendasBase = vendas.filter(v =>
    !filtros.empreendimento || v.empreendimento_nome === filtros.empreendimento)
  const vendaIds = new Set(vendasBase.map(v => v.id))

  const dataInicio = parseDataLocal(filtros.dataInicio)
  const dataFim = parseDataLocal(filtros.dataFim)

  const pagamentosFiltrados = (pagamentos || []).filter((p) => {
    if (!vendaIds.has(p.venda_id)) return false
    if (p.status === 'cancelado') return false
    if (filtros.status !== 'todos' && p.status !== filtros.status) return false
    if (dataInicio || dataFim) {
      const dataRef = parseDataLocal(p.data_pagamento || p.data_prevista)
      if (!dataRef) return false
      if (dataInicio && dataRef < dataInicio) return false
      if (dataFim && dataRef > dataFim) return false
    }
    return true
  })

  const comSet = new Set(pagamentosFiltrados.map(p => p.venda_id))
  const vendasFiltradas = vendasBase.filter(v => comSet.has(v.id))
  return { vendasFiltradas, pagamentosFiltrados }
}

const rotuloParcela = (p) => {
  if (p.tipo === 'sinal') return 'Sinal'
  if (p.tipo === 'entrada') return 'Entrada'
  if (p.tipo === 'comissao_integral') return 'Comissao integral'
  if (p.tipo === 'bens') return 'Bens'
  const base = p.tipo === 'balao' ? 'Balao' : 'Parcela'
  return p.numero_parcela ? `${base} ${p.numero_parcela}` : base
}

/**
 * Gera (e baixa) o PDF do relatório do corretor.
 * @param {object} p
 * @param {object} p.corretorProfile  { nome, tipo_corretor, percentual_corretor }
 * @param {array}  p.vendas           todas as vendas do corretor
 * @param {array}  p.pagamentos       todas as parcelas das vendas do corretor
 * @param {object} p.filtros          { empreendimento, status, dataInicio, dataFim }
 */
export function gerarRelatorioCorretorPDF({ corretorProfile, vendas = [], pagamentos = [], filtros = {} }) {
  const calcularComissao = makeCalcularComissao(vendas, corretorProfile)
  const { vendasFiltradas, pagamentosFiltrados } = getRelatorioDados({ vendas, pagamentos, filtros })

  const totalVendas = vendasFiltradas.length
  const valorTotalVendas = vendasFiltradas.reduce((acc, v) => acc + (parseFloat(v.valor_venda) || 0), 0)
  const comissaoTotal = pagamentosFiltrados.reduce((acc, pag) => acc + calcularComissao(pag), 0)
  const comissaoPaga = pagamentosFiltrados.filter(p => p.status === 'pago').reduce((acc, pag) => acc + calcularComissao(pag), 0)
  const comissaoPendente = pagamentosFiltrados.filter(p => p.status === 'pendente').reduce((acc, pag) => acc + calcularComissao(pag), 0)
  const statusFiltroTexto = filtros.status === 'pago' ? 'Pagos' : filtros.status === 'pendente' ? 'Pendentes' : 'Todos'

  const doc = new jsPDF()
  const cores = {
    dourado: [201, 169, 98], douradoEscuro: [161, 129, 58], preto: [15, 15, 15],
    branco: [255, 255, 255], cinzaClaro: [245, 245, 245], verde: [16, 185, 129],
    vermelho: [239, 68, 68], amarelo: [234, 179, 8],
  }

  // Header
  doc.setFillColor(...cores.preto); doc.rect(0, 0, 210, 35, 'F')
  doc.setFillColor(...cores.dourado); doc.rect(0, 35, 210, 2, 'F')
  doc.setTextColor(...cores.dourado); doc.setFontSize(20); doc.setFont('helvetica', 'bold')
  doc.text('RELATORIO DE COMISSOES', 105, 18, { align: 'center' })
  doc.setTextColor(...cores.branco); doc.setFontSize(12); doc.setFont('helvetica', 'normal')
  doc.text(capitalizeName(corretorProfile?.nome || 'Corretor'), 105, 28, { align: 'center' })

  doc.setTextColor(...cores.dourado); doc.setFontSize(10)
  doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')} as ${new Date().toLocaleTimeString('pt-BR')}`, 105, 45, { align: 'center' })
  doc.setTextColor(...cores.preto); doc.setFontSize(9)
  doc.text(`Status: ${statusFiltroTexto}`, 14, 53)

  // Resumo
  let yPos = 64
  doc.setFillColor(...cores.preto); doc.roundedRect(14, yPos - 5, 182, 43, 3, 3, 'F')
  doc.setTextColor(...cores.branco); doc.setFontSize(9)
  doc.text('Total Vendas', 22, yPos + 6)
  doc.text('Volume', 66, yPos + 6)
  doc.text('Comissao Total', 112, yPos + 6)
  doc.text('Recebido', 158, yPos + 6)
  doc.setTextColor(...cores.dourado); doc.setFontSize(12); doc.setFont('helvetica', 'bold')
  doc.text(String(totalVendas), 22, yPos + 19)
  doc.text(formatCurrency(valorTotalVendas), 66, yPos + 19)
  doc.text(formatCurrency(comissaoTotal), 112, yPos + 19)
  doc.setTextColor(...cores.verde)
  doc.text(formatCurrency(comissaoPaga), 158, yPos + 19)
  doc.setTextColor(...cores.amarelo); doc.setFontSize(8)
  doc.text(`Pendente: ${formatCurrency(comissaoPendente)}`, 158, yPos + 31)

  // Detalhamento POR PAGAMENTO (parcela)
  yPos = 116
  doc.setTextColor(...cores.preto); doc.setFontSize(14); doc.setFont('helvetica', 'bold')
  doc.text('Detalhamento dos Pagamentos', 14, yPos)

  const vendaPorId = new Map(vendasFiltradas.map(v => [v.id, v]))
  const tableData = pagamentosFiltrados
    .slice()
    .sort((a, b) => {
      const da = parseDataLocal(a.data_pagamento || a.data_prevista)?.getTime() || 0
      const db = parseDataLocal(b.data_pagamento || b.data_prevista)?.getTime() || 0
      return da - db
    })
    .map(p => {
      const v = vendaPorId.get(p.venda_id) || {}
      return [
        formatDataBR(p.data_prevista),
        p.data_pagamento ? formatDataBR(p.data_pagamento) : '-',
        v.unidade || '-',
        capitalizeName(v.cliente_nome) || '-',
        rotuloParcela(p),
        formatCurrency(p.valor),
        formatCurrency(calcularComissao(p)),
        p.status === 'pago' ? 'Pago' : 'Pendente',
      ]
    })

  autoTable(doc, {
    startY: yPos + 10,
    head: [['Vencimento', 'Pagamento', 'Unidade', 'Cliente', 'Tipo', 'Valor', 'Comissao', 'Status']],
    body: tableData,
    headStyles: { fillColor: cores.dourado, textColor: cores.preto, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { textColor: cores.preto, fontSize: 8 },
    alternateRowStyles: { fillColor: cores.cinzaClaro },
    columnStyles: {
      0: { cellWidth: 23 }, 1: { cellWidth: 23 }, 2: { cellWidth: 15 }, 3: { cellWidth: 33 },
      4: { cellWidth: 20 }, 5: { cellWidth: 22 }, 6: { cellWidth: 24 }, 7: { cellWidth: 15 },
    },
  })

  // Footer
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFillColor(...cores.preto); doc.rect(0, 282, 210, 15, 'F')
    doc.setFillColor(...cores.dourado); doc.rect(0, 282, 210, 1, 'F')
    doc.setTextColor(...cores.dourado); doc.setFontSize(8)
    doc.text('IM Incorporadora - Relatorio de Comissoes', 14, 290)
    doc.text(`Pagina ${i} de ${pageCount}`, 196, 290, { align: 'right' })
  }

  const nomeArquivo = `Relatorio_${corretorProfile?.nome?.replace(/\s+/g, '_') || 'Corretor'}_${new Date().toISOString().split('T')[0]}.pdf`
  doc.save(nomeArquivo)
}
