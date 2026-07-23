// Extrato de pagamentos do CLIENTE — o que ele paga pra IM (plano de pagamentos).
//
// NUNCA incluir comissão aqui (fator, percentual, comissao_gerada): comissão é
// assunto interno IM/corretor e não aparece pra cliente.
// Totais derivam SEMPRE das parcelas (pagamentos_prosoluto), nunca de
// vendas.status/comissao_* — ver .claude/rules/visualizacao-totais.md.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
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

const rotuloParcela = (p) => {
  if (p.tipo === 'sinal') return 'Sinal'
  if (p.tipo === 'entrada') return 'Entrada'
  // Na visão do cliente essa linha é a entrada paga à vista — "comissão" é
  // jargão interno IM↔corretor e não aparece pra ele.
  if (p.tipo === 'comissao_integral') return 'Entrada (a vista)'
  if (p.tipo === 'bens') return 'Bens'
  const base = p.tipo === 'balao' ? 'Balao' : 'Parcela'
  return p.numero_parcela ? `${base} ${p.numero_parcela}` : base
}

/**
 * Gera (e baixa) o extrato de pagamentos de UMA compra na visão do cliente.
 * @param {object} p
 * @param {object} p.cliente   linha de `clientes` (nome_completo, cpf)
 * @param {object} p.compra    linha de `vendas` enriquecida (unidade, bloco, empreendimentos)
 * @param {string} p.titulo    título da compra na visão do cliente (empreendimento + unidade)
 * @param {array}  p.parcelas  linhas de `pagamentos_prosoluto` da compra (canceladas são filtradas aqui)
 * @param {boolean} p.distratada  contrato distratado — extrato só do que foi pago
 */
export function gerarExtratoClientePDF({ cliente, compra, titulo, parcelas = [], distratada = false }) {
  // Distrato: contrato rescindido — pendentes não são cobrança ativa, ficam fora.
  const ativas = parcelas.filter(p => p.status !== 'cancelado' && (!distratada || p.status === 'pago'))
  const pagas = ativas.filter(p => p.status === 'pago')
  const somar = (lista) => lista.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0)
  const totalPlano = somar(ativas)
  const totalPago = somar(pagas)
  const totalPendente = totalPlano - totalPago
  const pctQuitado = totalPlano > 0 ? (totalPago / totalPlano) * 100 : 0

  const doc = new jsPDF()
  const cores = {
    dourado: [201, 169, 98], preto: [15, 15, 15], branco: [255, 255, 255],
    cinzaClaro: [245, 245, 245], verde: [16, 185, 129], amarelo: [234, 179, 8],
  }

  // Header
  doc.setFillColor(...cores.preto); doc.rect(0, 0, 210, 35, 'F')
  doc.setFillColor(...cores.dourado); doc.rect(0, 35, 210, 2, 'F')
  doc.setTextColor(...cores.dourado); doc.setFontSize(20); doc.setFont('helvetica', 'bold')
  doc.text('EXTRATO DE PAGAMENTOS', 105, 16, { align: 'center' })
  doc.setTextColor(...cores.branco); doc.setFontSize(11); doc.setFont('helvetica', 'normal')
  doc.text(capitalizeName(cliente?.nome_completo || 'Cliente'), 105, 24, { align: 'center' })
  doc.setFontSize(9)
  doc.text(`${titulo || 'Minha compra'}${distratada ? ' — Contrato distratado (valores pagos)' : ''}`, 105, 31, { align: 'center' })

  doc.setTextColor(...cores.dourado); doc.setFontSize(10)
  doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')} as ${new Date().toLocaleTimeString('pt-BR')}`, 105, 45, { align: 'center' })

  // Resumo
  const yPos = 58
  doc.setFillColor(...cores.preto); doc.roundedRect(14, yPos - 5, 182, 34, 3, 3, 'F')
  doc.setTextColor(...cores.branco); doc.setFontSize(9)
  doc.text('Plano de pagamentos', 22, yPos + 4)
  doc.text('Total pago', 78, yPos + 4)
  doc.text('Pendente', 124, yPos + 4)
  doc.text('Quitado', 166, yPos + 4)
  doc.setFontSize(12); doc.setFont('helvetica', 'bold')
  doc.setTextColor(...cores.dourado)
  doc.text(formatCurrency(totalPlano), 22, yPos + 16)
  doc.setTextColor(...cores.verde)
  doc.text(formatCurrency(totalPago), 78, yPos + 16)
  doc.setTextColor(...cores.amarelo)
  doc.text(formatCurrency(totalPendente), 124, yPos + 16)
  doc.setTextColor(...cores.branco)
  doc.text(`${pctQuitado.toFixed(1).replace('.', ',')}%`, 166, yPos + 16)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...cores.branco)
  doc.text(`${pagas.length} de ${ativas.length} parcelas pagas`, 22, yPos + 24)

  // Detalhamento
  doc.setTextColor(...cores.preto); doc.setFontSize(14); doc.setFont('helvetica', 'bold')
  doc.text('Detalhamento das Parcelas', 14, yPos + 42)

  const tableData = ativas
    .slice()
    .sort((a, b) => {
      const da = parseDataLocal(a.data_pagamento || a.data_prevista)?.getTime() || 0
      const db = parseDataLocal(b.data_pagamento || b.data_prevista)?.getTime() || 0
      return da - db
    })
    .map(p => [
      rotuloParcela(p),
      formatDataBR(p.data_prevista),
      p.data_pagamento ? formatDataBR(p.data_pagamento) : '-',
      formatCurrency(p.valor),
      p.status === 'pago' ? 'Pago' : 'Pendente',
    ])

  autoTable(doc, {
    startY: yPos + 48,
    head: [['Parcela', 'Vencimento', 'Pagamento', 'Valor', 'Status']],
    body: tableData,
    headStyles: { fillColor: cores.dourado, textColor: cores.preto, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { textColor: cores.preto, fontSize: 9 },
    alternateRowStyles: { fillColor: cores.cinzaClaro },
    columnStyles: {
      0: { cellWidth: 40 }, 1: { cellWidth: 32 }, 2: { cellWidth: 32 },
      3: { cellWidth: 40 }, 4: { cellWidth: 24, overflow: 'visible' },
    },
  })

  // Footer
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFillColor(...cores.preto); doc.rect(0, 282, 210, 15, 'F')
    doc.setFillColor(...cores.dourado); doc.rect(0, 282, 210, 1, 'F')
    doc.setTextColor(...cores.dourado); doc.setFontSize(8)
    doc.text('IM Incorporadora - Extrato de Pagamentos', 14, 290)
    doc.text(`Pagina ${i} de ${pageCount}`, 196, 290, { align: 'right' })
  }

  const sufixo = compra?.unidade ? `Unidade_${String(compra.unidade).replace(/\s+/g, '_')}` : 'Compra'
  const nomeArquivo = `Extrato_${(cliente?.nome_completo || 'Cliente').replace(/\s+/g, '_')}_${sufixo}_${new Date().toISOString().split('T')[0]}.pdf`
  doc.save(nomeArquivo)
}
