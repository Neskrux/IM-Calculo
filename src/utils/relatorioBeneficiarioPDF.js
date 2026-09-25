// PDF do relatório do BENEFICIÁRIO (Nohros, Beton, ... — genérico por cargo).
// v2 (2026-09-25): mesma identidade do relatório da Coordenação/corretor (cabeçalho preto e
// dourado, resumo, detalhamento por parcela, rodapé paginado). Fonte única: as linhas e os
// totais vêm de `recorteRelatorioCargo` — o MESMO recorte que a tela mostra, então PDF e
// tela nunca divergem. Mostra SÓ a fatia do cargo + valores de parcela: nunca a fatia de
// outro cargo, a comissão total, cliente ou corretor.
// Ver docs/specs/2026-08-20-spec-visao-beneficiario.md.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { recorteRelatorioCargo, pctCargoDaVenda } from './comissaoCalculator'
import { parseDataLocal, formatDataBR } from './datas'

const fmt = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0)
const fmtPct = (v) => `${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
const STATUS_TXT = { todos: 'Todos', pago: 'Pagos', pendente: 'Pendentes' }

const rotuloParcela = (p) => {
  if (p.tipo === 'sinal') return 'Sinal'
  if (p.tipo === 'entrada') return 'Entrada'
  if (p.tipo === 'comissao_integral') return 'Comissão integral'
  if (p.tipo === 'bens') return 'Bens'
  const base = p.tipo === 'balao' ? 'Balão' : 'Parcela'
  return p.numero_parcela ? `${base} ${p.numero_parcela}` : base
}

/**
 * Gera (e baixa) o PDF do relatório do beneficiário.
 * @param {object} p
 * @param {string} p.cargo              nome do cargo (ex.: 'Nohros')
 * @param {string} p.nomeUsuario
 * @param {Array}  p.vendas             vendas do escopo (já só ativas)
 * @param {Array}  p.pagamentos         parcelas dessas vendas
 * @param {Array}  p.cargos             cargos_empreendimento
 * @param {Array}  p.coordenadoras
 * @param {object} p.filtros            { empreendimentoId, status, dataInicio, dataFim }
 * @param {string} [p.nomeEmpreendimento] rótulo do filtro de empreendimento
 */
export function gerarRelatorioBeneficiarioPDF({
  cargo, nomeUsuario, vendas = [], pagamentos = [], cargos = [], coordenadoras = [],
  filtros = {}, nomeEmpreendimento = '',
}) {
  const { linhas, totais } = recorteRelatorioCargo({ vendas, pagamentos, cargo, cargos, coordenadoras, filtros })

  const doc = new jsPDF()
  const cores = {
    dourado: [201, 169, 98], preto: [15, 15, 15], branco: [255, 255, 255],
    cinzaClaro: [245, 245, 245], verde: [16, 185, 129], amarelo: [234, 179, 8],
  }
  const agora = new Date()

  // Cabeçalho
  doc.setFillColor(...cores.preto); doc.rect(0, 0, 210, 35, 'F')
  doc.setFillColor(...cores.dourado); doc.rect(0, 35, 210, 2, 'F')
  doc.setTextColor(...cores.dourado); doc.setFontSize(20); doc.setFont('helvetica', 'bold')
  doc.text('RELATÓRIO DE COMISSÕES', 105, 18, { align: 'center' })
  doc.setTextColor(...cores.branco); doc.setFontSize(12); doc.setFont('helvetica', 'normal')
  doc.text(`${nomeUsuario} — ${cargo}`, 105, 28, { align: 'center' })
  doc.setTextColor(...cores.dourado); doc.setFontSize(10)
  doc.text(`Gerado em: ${agora.toLocaleDateString('pt-BR')} às ${agora.toLocaleTimeString('pt-BR')}`, 105, 45, { align: 'center' })

  // Resumo
  let y = 64
  doc.setFillColor(...cores.preto); doc.roundedRect(14, y - 5, 182, 43, 3, 3, 'F')
  doc.setTextColor(...cores.branco); doc.setFontSize(9)
  doc.text('Vendas', 22, y + 6)
  doc.text('Parcelas', 66, y + 6)
  doc.text(`Comissão ${cargo}`, 112, y + 6)
  doc.text('Recebido', 158, y + 6)
  doc.setTextColor(...cores.dourado); doc.setFontSize(12); doc.setFont('helvetica', 'bold')
  doc.text(String(totais.nVendas), 22, y + 19)
  doc.text(String(totais.nParcelas), 66, y + 19)
  doc.text(fmt(totais.fatiaTotal), 112, y + 19)
  doc.setTextColor(...cores.verde)
  doc.text(fmt(totais.fatiaPaga), 158, y + 19)
  doc.setTextColor(...cores.amarelo); doc.setFontSize(8)
  doc.text(`A receber: ${fmt(totais.fatiaPendente)}`, 158, y + 31)

  // Recorte aplicado
  const fmtFiltroData = (d) => (parseDataLocal(d) ? formatDataBR(d) : '—')
  doc.setTextColor(...cores.preto); doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text(
    `Filtro:   Empreendimento: ${nomeEmpreendimento || 'Todos'}      Status: ${STATUS_TXT[filtros.status || 'todos'] || 'Todos'}      ` +
    `Data início: ${fmtFiltroData(filtros.dataInicio)}      Data fim: ${fmtFiltroData(filtros.dataFim)}`,
    14, 110,
  )

  // Detalhamento POR PARCELA
  y = 116
  doc.setFontSize(14); doc.setFont('helvetica', 'bold')
  doc.text('Detalhamento das parcelas', 14, y)

  autoTable(doc, {
    startY: y + 10,
    head: [['Vencimento', 'Pagamento', 'Unidade', 'Parcela', 'Valor', 'Taxa', `Comissão ${cargo}`, 'Status']],
    body: linhas.map(({ pagamento: p, venda: v, fatia }) => [
      formatDataBR(p.data_prevista),
      p.data_pagamento ? formatDataBR(p.data_pagamento) : '-',
      v.unidade || '-',
      rotuloParcela(p) + (p.renegociacao_id ? '\n(aditivo)' : ''),
      fmt(p.valor),
      fmtPct(pctCargoDaVenda(v, cargo, cargos, coordenadoras)),
      fmt(fatia),
      p.status === 'pago' ? 'Pago' : 'Pendente',
    ]),
    foot: [['', '', '', '', '', 'Total', fmt(totais.fatiaTotal), '']],
    headStyles: { fillColor: cores.dourado, textColor: cores.preto, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { textColor: cores.preto, fontSize: 8 },
    footStyles: { fillColor: cores.preto, textColor: cores.dourado, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: cores.cinzaClaro },
    columnStyles: {
      0: { cellWidth: 21 }, 1: { cellWidth: 21 },
      2: { cellWidth: 20, overflow: 'visible' }, // Unidade nunca quebra ("1002 B")
      3: { cellWidth: 24 }, 4: { cellWidth: 24 }, 5: { cellWidth: 16 }, 6: { cellWidth: 38 },
      7: { cellWidth: 18, overflow: 'visible' }, // Status nunca quebra ("Pendente")
    },
  })

  // Rodapé
  const paginas = doc.getNumberOfPages()
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i)
    doc.setFillColor(...cores.preto); doc.rect(0, 282, 210, 15, 'F')
    doc.setFillColor(...cores.dourado); doc.rect(0, 282, 210, 1, 'F')
    doc.setTextColor(...cores.dourado); doc.setFontSize(8); doc.setFont('helvetica', 'normal')
    doc.text(`IM Incorporadora - Relatório de Comissões - ${cargo}`, 14, 290)
    doc.text(`Página ${i} de ${paginas}`, 196, 290, { align: 'right' })
  }

  const nomeArq = `Relatorio_${cargo.replace(/\s+/g, '_')}_${agora.toISOString().slice(0, 10)}.pdf`
  doc.save(nomeArq)
  return nomeArq
}
