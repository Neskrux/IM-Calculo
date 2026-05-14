// Gera PDF do relatorio de acerto de comissao (Opcao B, 2026-05-14).
// Le docs/relatorio-acerto-percentual-2026-05-14.json e produz um PDF
// formatado pra gestora.
//
// Saida: docs/relatorio-acerto-percentual-2026-05-14.pdf

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

// acha o JSON mais recente
const jsonFile = readdirSync('docs')
  .filter((f) => f.startsWith('relatorio-acerto-percentual-') && f.endsWith('.json'))
  .sort()
  .pop()
if (!jsonFile) {
  console.error('JSON do relatorio nao encontrado. Rode antes scripts/relatorio-acerto-percentual-*.mjs')
  process.exit(1)
}
const rel = JSON.parse(readFileSync(`docs/${jsonFile}`, 'utf8'))
const dataRef = jsonFile.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || new Date().toISOString().slice(0, 10)

const BRL = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// paleta
const AZUL = [27, 47, 82] // azul-escuro IM
const DOURADO = [201, 169, 98]
const VERDE = [22, 130, 70]
const VERMELHO = [180, 50, 50]
const CINZA = [110, 120, 135]
const CINZA_CLARO = [238, 240, 243]

const doc = new jsPDF({ unit: 'mm', format: 'a4' })
const PW = doc.internal.pageSize.getWidth()
const PH = doc.internal.pageSize.getHeight()
const M = 15 // margem

let y = 0

// ---------- CABECALHO ----------
doc.setFillColor(...AZUL)
doc.rect(0, 0, PW, 32, 'F')
doc.setTextColor(...DOURADO)
doc.setFont('helvetica', 'bold')
doc.setFontSize(17)
doc.text('IM FIGUEIRA GARCIA', M, 14)
doc.setTextColor(255, 255, 255)
doc.setFontSize(12)
doc.text('Relatorio de acerto de comissao', M, 22)
doc.setFont('helvetica', 'normal')
doc.setFontSize(9)
doc.setTextColor(210, 215, 225)
doc.text(`Percentual 7% aplicado quando o correto era 6,5%  |  gerado em ${dataRef}`, M, 28)
y = 42

// ---------- CONTEXTO ----------
doc.setTextColor(60, 65, 75)
doc.setFont('helvetica', 'normal')
doc.setFontSize(9.5)
const intro =
  'Auditoria identificou 23 vendas de corretor interno cujas parcelas ja pagas foram calculadas a 7% ' +
  '(percentual de corretor externo) quando o correto seria 6,5%. As parcelas pagas nao foram alteradas no ' +
  'sistema — pagamento auditado e protegido. O acerto e operacional: descontar nos proximos repasses.'
const introLines = doc.splitTextToSize(intro, PW - 2 * M)
doc.text(introLines, M, y)
y += introLines.length * 4.6 + 4

// ---------- CARDS DE RESUMO ----------
const cardW = (PW - 2 * M - 8) / 2
const cardH = 24
// card 1 — total comissao
doc.setFillColor(...CINZA_CLARO)
doc.roundedRect(M, y, cardW, cardH, 2, 2, 'F')
doc.setTextColor(...CINZA)
doc.setFontSize(8)
doc.setFont('helvetica', 'normal')
doc.text('COMISSAO TOTAL PAGA A MAIS', M + 5, y + 7)
doc.setTextColor(...VERMELHO)
doc.setFont('helvetica', 'bold')
doc.setFontSize(15)
doc.text(BRL(rel.meta.somaTotal), M + 5, y + 16)
doc.setTextColor(...CINZA)
doc.setFont('helvetica', 'normal')
doc.setFontSize(7.5)
doc.text('todos os cargos (corretor + diretor + nohros + etc)', M + 5, y + 21)
// card 2 — parte corretor
doc.setFillColor(...AZUL)
doc.roundedRect(M + cardW + 8, y, cardW, cardH, 2, 2, 'F')
doc.setTextColor(...DOURADO)
doc.setFontSize(8)
doc.text('A DESCONTAR DOS CORRETORES', M + cardW + 13, y + 7)
doc.setTextColor(255, 255, 255)
doc.setFont('helvetica', 'bold')
doc.setFontSize(15)
doc.text(BRL(rel.meta.somaCorretor), M + cardW + 13, y + 16)
doc.setTextColor(210, 215, 225)
doc.setFont('helvetica', 'normal')
doc.setFontSize(7.5)
doc.text('somente a fatia do corretor — use este valor', M + cardW + 13, y + 21)
y += cardH + 8

// ---------- RANKING POR CORRETOR ----------
doc.setTextColor(...AZUL)
doc.setFont('helvetica', 'bold')
doc.setFontSize(11)
doc.text('Resumo por corretor', M, y)
y += 3

autoTable(doc, {
  startY: y,
  head: [['Corretor', 'Vendas', 'Parcelas', 'A descontar (parte do corretor)']],
  body: rel.corretores.map((c) => [
    c.corretor,
    String(c.vendas.length),
    String(c.parcelas),
    BRL(c.dif_parte_corretor),
  ]),
  foot: [[
    'TOTAL',
    String(rel.corretores.reduce((s, c) => s + c.vendas.length, 0)),
    String(rel.meta.totalParcelas),
    BRL(rel.meta.somaCorretor),
  ]],
  theme: 'grid',
  headStyles: { fillColor: AZUL, textColor: 255, fontStyle: 'bold', fontSize: 9 },
  footStyles: { fillColor: DOURADO, textColor: AZUL, fontStyle: 'bold', fontSize: 9 },
  bodyStyles: { fontSize: 9 },
  columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'right', fontStyle: 'bold' } },
  margin: { left: M, right: M },
})
y = doc.lastAutoTable.finalY + 10

// ---------- DETALHE POR CORRETOR ----------
for (const c of rel.corretores) {
  // quebra de pagina se nao couber o cabecalho + ao menos 3 linhas
  if (y > PH - 50) {
    doc.addPage()
    y = M + 5
  }
  // faixa do corretor
  doc.setFillColor(...AZUL)
  doc.roundedRect(M, y, PW - 2 * M, 9, 1.5, 1.5, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(c.corretor, M + 4, y + 6)
  doc.setTextColor(...DOURADO)
  doc.setFontSize(9.5)
  doc.text(`A descontar: ${BRL(c.dif_parte_corretor)}`, PW - M - 4, y + 6, { align: 'right' })
  y += 12

  autoTable(doc, {
    startY: y,
    head: [['Cliente', 'Unidade', 'Parcelas', 'Parte do corretor', 'Comissao total']],
    body: c.vendas
      .slice()
      .sort((a, b) => b.dif_parte_corretor - a.dif_parte_corretor)
      .map((v) => [
        v.cliente || '-',
        v.unidade || '-',
        String(v.parcelas_pagas_erradas),
        BRL(v.dif_parte_corretor),
        BRL(v.dif_total),
      ]),
    theme: 'striped',
    headStyles: { fillColor: CINZA, textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
    bodyStyles: { fontSize: 8.5 },
    alternateRowStyles: { fillColor: CINZA_CLARO },
    columnStyles: {
      2: { halign: 'center' },
      3: { halign: 'right', fontStyle: 'bold', textColor: VERDE },
      4: { halign: 'right', textColor: CINZA },
    },
    margin: { left: M, right: M },
  })
  y = doc.lastAutoTable.finalY + 9
}

// ---------- RODAPE / OBSERVACAO ----------
if (y > PH - 38) {
  doc.addPage()
  y = M + 5
}
doc.setDrawColor(...DOURADO)
doc.setLineWidth(0.4)
doc.line(M, y, PW - M, y)
y += 6
doc.setTextColor(...CINZA)
doc.setFont('helvetica', 'italic')
doc.setFontSize(8)
const obs = [
  'Observacoes:',
  '- "Parte do corretor" assume o cargo Corretor padrao (interno 2,5% / externo 4%). Se algum corretor tem percentual',
  '  individual diferente cadastrado, o valor exato pode variar.',
  '- As parcelas ja pagas NAO foram alteradas no sistema (protecao de pagamento auditado). O acerto deve ser feito',
  '  manualmente nos proximos repasses, usando a coluna "A descontar (parte do corretor)".',
  '- As parcelas pendentes dessas vendas ja foram corrigidas automaticamente para o percentual correto.',
]
for (const line of obs) {
  doc.text(line, M, y)
  y += 4.2
}

// numero de pagina no rodape de todas
const totalPages = doc.internal.getNumberOfPages()
for (let i = 1; i <= totalPages; i++) {
  doc.setPage(i)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...CINZA)
  doc.text(`IM Figueira Garcia — Relatorio de acerto de comissao — ${dataRef}`, M, PH - 8)
  doc.text(`Pagina ${i} de ${totalPages}`, PW - M, PH - 8, { align: 'right' })
}

const outPath = `docs/relatorio-acerto-percentual-${dataRef}.pdf`
const ab = doc.output('arraybuffer')
writeFileSync(outPath, Buffer.from(ab))
console.log(`PDF gerado: ${outPath}`)
console.log(`  ${totalPages} pagina(s) | ${rel.corretores.length} corretores | ${rel.meta.totalParcelas} parcelas`)
