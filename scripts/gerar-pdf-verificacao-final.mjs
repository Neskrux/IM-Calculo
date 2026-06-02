// Gera PDF da verificacao final consolidada (health-check pos-correcoes 2026-05-14).
// Roda a verificacao read-only e produz docs/verificacao-final-2026-05-14.pdf

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

const PAGE = 1000
async function loadAll(table, select) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa.from(table).select(select).range(from, from + PAGE - 1)
    if (error) { console.error(`erro ${table}:`, error.message); process.exit(1) }
    if (!data?.length) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

console.log('Carregando dados...')
const vendas = await loadAll('vendas', 'id, sienge_contract_id, numero_contrato, unidade, cliente_id, excluido, valor_venda, status, created_at')
const pagamentos = await loadAll('pagamentos_prosoluto', 'id, venda_id, numero_parcela, tipo, valor, data_prevista, data_pagamento, status')
const ativasVendas = vendas.filter((v) => v.excluido !== true)
const vendaAtivaIds = new Set(ativasVendas.map((v) => v.id))
const vMap = new Map(vendas.map((v) => [v.id, v]))

// --- 1. invariantes ---
const anoAbsurdo = (d) => d && (Number(String(d).slice(0, 4)) < 2020 || Number(String(d).slice(0, 4)) > 2035)
const inv = {
  pagoSemData: pagamentos.filter((p) => p.status === 'pago' && !p.data_pagamento).length,
  pendComData: pagamentos.filter((p) => p.status === 'pendente' && p.data_pagamento).length,
  anoAbsurdoPag: pagamentos.filter((p) => anoAbsurdo(p.data_pagamento)).length,
  anoAbsurdoPrev: pagamentos.filter((p) => anoAbsurdo(p.data_prevista)).length,
  valorInvalido: pagamentos.filter((p) => !(Number(p.valor) > 0)).length,
}

// --- 2. duplicidade numero_parcela ---
const norm = (v) => Number(v).toFixed(2)
const porChave = new Map()
for (const p of pagamentos) {
  if (!vendaAtivaIds.has(p.venda_id) || p.numero_parcela == null) continue
  const k = `${p.venda_id}__${p.tipo}__${p.numero_parcela}`
  if (!porChave.has(k)) porChave.set(k, [])
  porChave.get(k).push(p)
}
let multiPaga = 0, pendRedundante = 0, cancAtivo = 0, outros = 0
for (const arr of porChave.values()) {
  if (arr.length < 2) continue
  const pagas = arr.filter((p) => p.status === 'pago')
  const pendentes = arr.filter((p) => p.status === 'pendente')
  if (pagas.length > 1) { multiPaga++; continue }
  if (pendentes.some((pd) => pagas.some((pg) => norm(pg.valor) === norm(pd.valor) && pg.data_prevista === pd.data_prevista))) { pendRedundante++; continue }
  const temCanc = arr.some((p) => p.status === 'cancelado')
  const ativos = arr.filter((p) => p.status !== 'cancelado')
  if (temCanc && ativos.length === 1) { cancAtivo++; continue }
  outros++
}

// --- 3. vendas duplicadas (cliente+unidade) ---
const porCU = new Map()
for (const v of ativasVendas) {
  if (!v.cliente_id || !v.unidade) continue
  const k = `${v.cliente_id}__${v.unidade.trim().toUpperCase()}`
  if (!porCU.has(k)) porCU.set(k, [])
  porCU.get(k).push(v)
}
const vendasDup = []
for (const arr of porCU.values()) {
  if (arr.length > 1) vendasDup.push(arr)
}
// enriquecer com nome do cliente + contagem de pagas
for (const grupo of vendasDup) {
  const { data: cli } = await supa.from('clientes').select('nome_completo').eq('id', grupo[0].cliente_id).maybeSingle()
  grupo._cliente = cli?.nome_completo || '?'
  for (const v of grupo) {
    v._pagas = pagamentos.filter((p) => p.venda_id === v.id && p.status === 'pago').length
    v._total = pagamentos.filter((p) => p.venda_id === v.id).length
  }
}

// ---------- PDF ----------
const BRL = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const AZUL = [27, 47, 82], DOURADO = [201, 169, 98], VERDE = [22, 130, 70], VERMELHO = [180, 50, 50]
const CINZA = [110, 120, 135], CINZA_CLARO = [238, 240, 243], LARANJA = [200, 130, 30]
const doc = new jsPDF({ unit: 'mm', format: 'a4' })
const PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight(), M = 15
const dataRef = '2026-05-14'
let y = 0

// cabecalho
doc.setFillColor(...AZUL); doc.rect(0, 0, PW, 32, 'F')
doc.setTextColor(...DOURADO); doc.setFont('helvetica', 'bold'); doc.setFontSize(17)
doc.text('IM FIGUEIRA GARCIA', M, 14)
doc.setTextColor(255, 255, 255); doc.setFontSize(12)
doc.text('Verificacao final do banco de pagamentos', M, 22)
doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(210, 215, 225)
doc.text(`Health-check apos as correcoes  |  gerado em ${dataRef}`, M, 28)
y = 42

doc.setTextColor(60, 65, 75); doc.setFontSize(9.5)
const intro = doc.splitTextToSize(
  `Verificacao read-only de ${vendas.length} vendas e ${pagamentos.length} pagamentos. ` +
  'Confere invariantes financeiras, duplicidade de parcelas e vendas duplicadas.', PW - 2 * M)
doc.text(intro, M, y)
y += intro.length * 4.6 + 6

// SECAO 1 — invariantes
doc.setTextColor(...AZUL); doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
doc.text('1. Invariantes financeiras', M, y); y += 2
const invRows = [
  ['Parcelas pagas sem data de pagamento', inv.pagoSemData],
  ['Parcelas pendentes com data de pagamento', inv.pendComData],
  ['Ano invalido em data de pagamento', inv.anoAbsurdoPag],
  ['Ano invalido em data prevista', inv.anoAbsurdoPrev],
  ['Parcelas com valor zero ou negativo', inv.valorInvalido],
]
autoTable(doc, {
  startY: y,
  head: [['Verificacao', 'Problemas', 'Status']],
  body: invRows.map(([nome, n]) => [nome, String(n), n === 0 ? 'OK' : 'ATENCAO']),
  theme: 'grid',
  headStyles: { fillColor: AZUL, textColor: 255, fontSize: 9 },
  bodyStyles: { fontSize: 9 },
  columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center', fontStyle: 'bold' } },
  didParseCell: (d) => {
    if (d.section === 'body' && d.column.index === 2) {
      d.cell.styles.textColor = d.cell.raw === 'OK' ? VERDE : VERMELHO
    }
  },
  margin: { left: M, right: M },
})
y = doc.lastAutoTable.finalY + 8

// SECAO 2 — duplicidade de parcela
doc.setTextColor(...AZUL); doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
doc.text('2. Duplicidade de numero de parcela', M, y); y += 2
autoTable(doc, {
  startY: y,
  head: [['Situacao', 'Grupos', 'Acao']],
  body: [
    ['Pendente redundante (copia identica de uma paga)', String(pendRedundante), pendRedundante === 0 ? 'Resolvido' : 'Pendente'],
    ['Multiplas parcelas pagas no mesmo numero', String(multiPaga), 'Revisao (precisa Sienge)'],
    ['Pendente/pago com valores diferentes', String(outros), 'Revisao (precisa Sienge)'],
    ['Cancelado + 1 ativa (estado consistente)', String(cancAtivo), 'OK - nao entra em totais'],
  ],
  theme: 'grid',
  headStyles: { fillColor: AZUL, textColor: 255, fontSize: 9 },
  bodyStyles: { fontSize: 9 },
  columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' } },
  didParseCell: (d) => {
    if (d.section === 'body' && d.column.index === 2) {
      const t = String(d.cell.raw)
      if (t.startsWith('Resolvido') || t.startsWith('OK')) d.cell.styles.textColor = VERDE
      else d.cell.styles.textColor = LARANJA
    }
  },
  margin: { left: M, right: M },
})
y = doc.lastAutoTable.finalY + 8

// SECAO 3 — vendas duplicadas
doc.setTextColor(...AZUL); doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
doc.text('3. Vendas duplicadas (mesmo cliente + unidade)', M, y); y += 2
const dupBody = []
for (const grupo of vendasDup) {
  for (let i = 0; i < grupo.length; i++) {
    const v = grupo[i]
    dupBody.push([
      i === 0 ? grupo._cliente : '',
      i === 0 ? grupo[0].unidade : '',
      v.sienge_contract_id ? `Sienge ${v.sienge_contract_id}` : 'cadastro manual',
      `${v._pagas}/${v._total}`,
      v.created_at?.slice(0, 10) || '-',
    ])
  }
}
autoTable(doc, {
  startY: y,
  head: [['Cliente', 'Unidade', 'Contrato', 'Pagas/Total', 'Criada em']],
  body: dupBody,
  theme: 'striped',
  headStyles: { fillColor: CINZA, textColor: 255, fontSize: 8.5 },
  bodyStyles: { fontSize: 8.5 },
  alternateRowStyles: { fillColor: CINZA_CLARO },
  columnStyles: { 3: { halign: 'center' }, 4: { halign: 'center' } },
  margin: { left: M, right: M },
})
y = doc.lastAutoTable.finalY + 4
doc.setTextColor(...CINZA); doc.setFont('helvetica', 'italic'); doc.setFontSize(8)
doc.text('Todas tem parcelas pagas nas duas versoes — precisam de decisao da gestora (mesmo caso do CLAUDIO/RAYLTON).', M, y)
y += 10

// conclusao
if (y > PH - 45) { doc.addPage(); y = M + 5 }
doc.setDrawColor(...DOURADO); doc.setLineWidth(0.4); doc.line(M, y, PW - M, y); y += 7
doc.setTextColor(...AZUL); doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
doc.text('Conclusao', M, y); y += 6
doc.setTextColor(60, 65, 75); doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
const invOk = Object.values(inv).every((n) => n === 0)
const concl = [
  invOk ? '- Invariantes financeiras: tudo OK (nenhum pago sem data, nenhum valor invalido, nenhuma data com ano errado).' : '- Invariantes: ha problemas — revisar a secao 1.',
  pendRedundante === 0 ? '- Parcelas pendentes redundantes: zeradas (limpeza confirmada).' : `- Ainda ha ${pendRedundante} pendentes redundantes.`,
  `- ${multiPaga + outros} grupos de parcela duplicada precisam de revisao com o Sienge (rodada b7).`,
  `- ${cancAtivo} grupos cancelado+ativa: estado esperado, nao afeta totais (cancelada fica para auditoria).`,
  `- ${vendasDup.length} vendas duplicadas precisam de decisao da gestora (eliminar a versao obsoleta).`,
]
for (const line of doc.splitTextToSize(concl.join('\n'), PW - 2 * M)) { doc.text(line, M, y); y += 4.6 }

// rodape
const totalPages = doc.internal.getNumberOfPages()
for (let i = 1; i <= totalPages; i++) {
  doc.setPage(i)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...CINZA)
  doc.text(`IM Figueira Garcia — Verificacao final — ${dataRef}`, M, PH - 8)
  doc.text(`Pagina ${i} de ${totalPages}`, PW - M, PH - 8, { align: 'right' })
}

const outPath = `docs/verificacao-final-${dataRef}.pdf`
writeFileSync(outPath, Buffer.from(doc.output('arraybuffer')))
console.log(`PDF gerado: ${outPath}`)
console.log(`  invariantes OK: ${invOk} | multiPaga: ${multiPaga} | outros: ${outros} | cancAtivo: ${cancAtivo} | vendasDup: ${vendasDup.length}`)
