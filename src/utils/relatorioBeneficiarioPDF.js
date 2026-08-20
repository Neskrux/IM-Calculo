// PDF do relatório do BENEFICIÁRIO (Nohros, Beton, ... — genérico por cargo).
// Mesma filosofia do relatorioCorretorPDF: fonte única, fatia via helper canônico
// (fatiaCargoDoPagamento). Mostra SÓ a fatia do cargo + valores de parcela —
// nunca a fatia dos outros cargos. Ver docs/specs/2026-08-20-spec-visao-beneficiario.md.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fatiaCargoDoPagamento, isPago, isAtivo } from './comissaoCalculator'
import { parseDataLocal, formatDataBR } from './datas'

const fmt = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0)

export function gerarRelatorioBeneficiarioPDF({
  cargo, nomeUsuario, vendas, pagamentos, cargos, coordenadoras, mes, empreendimentoNome,
}) {
  const vendaPorId = new Map(vendas.map(v => [v.id, v]))
  const fatia = (p) => fatiaCargoDoPagamento(p, vendaPorId.get(p.venda_id), cargo, cargos, coordenadoras)

  const noMes = (p) => !mes || (p.data_pagamento || '').slice(0, 7) === mes
  const pagas = pagamentos.filter(isAtivo).filter(isPago).filter(noMes)
    .map(p => ({ ...p, _fatia: fatia(p), _venda: vendaPorId.get(p.venda_id) }))
    .filter(p => p._fatia > 0)
    .sort((a, b) => String(a.data_pagamento).localeCompare(String(b.data_pagamento)) || String(a._venda?.unidade || '').localeCompare(String(b._venda?.unidade || '')))

  const total = pagas.reduce((s, p) => s + p._fatia, 0)

  const doc = new jsPDF()
  doc.setFontSize(16)
  doc.text(`Relatório de comissão — ${cargo}`, 14, 18)
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(`${nomeUsuario} · ${empreendimentoNome}`, 14, 25)
  doc.text(
    `Período: ${mes ? mes.split('-').reverse().join('/') : 'todo o período'} · Gerado em ${new Date().toLocaleDateString('pt-BR')}`,
    14, 30
  )
  doc.setTextColor(0)
  doc.setFontSize(12)
  doc.text(`Total ${cargo} no período: ${fmt(total)} (${pagas.length} parcelas pagas)`, 14, 40)

  autoTable(doc, {
    startY: 46,
    head: [['Unidade', 'Parcela', 'Pago em', 'Valor da parcela', `Comissão ${cargo}`]],
    body: pagas.map(p => [
      p._venda?.unidade || '—',
      `${p.tipo || ''} ${p.numero_parcela || ''}`.trim(),
      p.data_pagamento ? formatDataBR(parseDataLocal(p.data_pagamento)) : '—',
      fmt(parseFloat(p.valor) || 0),
      fmt(p._fatia),
    ]),
    foot: [['', '', '', 'Total', fmt(total)]],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [15, 23, 42] },
  })

  const nomeArq = `relatorio-${cargo.toLowerCase().replace(/\s+/g, '-')}${mes ? '-' + mes : ''}.pdf`
  doc.save(nomeArq)
  return nomeArq
}
