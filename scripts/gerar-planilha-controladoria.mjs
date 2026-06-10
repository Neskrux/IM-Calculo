import ExcelJS from 'exceljs'
import { readFileSync, mkdirSync } from 'node:fs'

const load = (p) => JSON.parse(readFileSync(p, 'utf8'))
const b9 = load('docs/rodadas/b9/b9-duplicatas-comissao.json')
const b10 = load('docs/rodadas/b10/b10-prosoluto-divergente.json')

const distratos = [
 ['25','508 A','11728f4d-67d3-4629-a6b2-d93ec06dbea0','2025-09-23',232413.12],
 ['42','609 A','5cfdabb1-25aa-4633-a6e0-b3c4651cf052','2026-02-06',402356.42],
 ['79','904 A','39d7aad3-aa7b-459c-820a-17a00e1aa7f4','2026-02-24',418341.97],
 ['141','1105 A','c2c465e1-cec4-42bc-8f40-db0d7d7d3106','2026-02-02',426750.63],
 ['145','1103 A','472d7dfe-e95a-40d7-8739-328d2b576c44','2026-01-06',422991.12],
 ['149','1304 A','e1c0ca9b-452f-4955-aeb3-a0e1fc36642c','2026-02-04',435328.32],
 ['168','1702 A','64aa2405-0068-4c20-8d15-736e1a1d6b1b','2025-11-17',444567.92],
 ['181','603 B','eb4ac0bc-7de5-49fd-a933-3ab7de549dac','2026-02-02',402356.42],
 ['186','803 B','1ed61c21-97b9-4409-bf45-403cb41e3889','2026-01-14',410443.77],
 ['209','403 C','8b74adf9-e6dc-404b-8144-d026dbb256ed','2026-01-13',375638.57],
 ['255','1405 C','84b74c27-fa97-4cb0-9e22-be95f88237d2','2025-12-29',363369.59],
 ['268','604 D','335e0f43-2a77-4399-ae27-eb4af0a56a68','2026-01-06',383196.59],
 ['278','901 D','ac19aefe-53c9-4f4c-a519-e603fc6aa05e','2025-12-15',345733.70],
 ['284','1001 D','64ffc2fb-b265-41d3-b7d5-cc101d813220','2025-12-09',443660.52],
 ['290','1008 D','67240a63-fd0f-4d21-8dd6-5ea34e4c0c76','2025-11-17',349191.04],
 ['307','1707 A','6065c4ff-1bb2-42ab-85f5-b769f7f97253','2025-12-05',435808.19],
 ['311','803 A','16f0a4fd-e669-49be-814d-76789ed6bb4c','2025-11-24',410443.77],
 ['315','406 A','36965dcf-4d05-42f6-b066-ac480bb1a561','2026-04-09',292366.06],
 ['341','503 B','9581a13a-5d34-44a0-b54d-62a841d757a7','2026-03-25',398372.68],
 ['354','510 C','908fbcdb-ac7a-45f0-95c1-5e4f45e67736','2026-01-15',379402.55],
 ['355','1707 A','83b8f727-e9a9-4a88-846c-272f6970356a','2025-12-04',435808.19],
 ['361','1707 A','7787a154-ec62-469f-b330-d9b3b6142dd2','2026-01-29',444567.92],
 ['362','906 A','5cbed8bd-36a1-4ec6-ace1-0aa9da2023b1','2026-01-15',372000.00],
 ['380','507 A','54497681-10e3-4a1a-89d8-b3356fdec09a','2026-02-08',292366.06],
 ['384','604 D','d77a7a35-7c36-450a-b4af-9648bc44adc7','2026-03-17',426900.16],
]
const distVendas = new Set(distratos.map(d => d[2]))
const distUnid = {}; distratos.forEach(d => (distUnid[d[1]] ||= []).push(d[0]))
const b10ByUnit = new Map(b10.casos.map(c => [c.unidade, c.numero_contrato]))
const TIPO = { parcela_entrada: 'Parcela mensal', sinal: 'Sinal/entrada', balao: 'Parcela balão' }
const brDate = (s) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}` }
const titlecase = (s) => (s || '').trim().toLowerCase().replace(/\b\p{L}/gu, (m) => m.toUpperCase())

const wb = new ExcelJS.Workbook()
const FONT = 'Arial'
const MONEY = '"R$" #,##0.00'
const HFILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }
const RESP_HFILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBF8F00' } }
const RESP_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }
const HFONT = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
const CELLFONT = { name: FONT, size: 10 }
const thin = { style: 'thin', color: { argb: 'FFD9D9D9' } }
const BORDER = { top: thin, left: thin, right: thin, bottom: thin }

function buildSheet(name, title, subtitle, headers, rows, opts) {
  const { widths, respCol, moneyCols = [], centerCols = [] } = opts
  const ws = wb.addWorksheet(name, { views: [{ showGridLines: false }] })
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w))
  const n = headers.length
  ws.mergeCells(1, 1, 1, n)
  const t = ws.getCell(1, 1); t.value = title
  t.font = { name: FONT, bold: true, size: 14, color: { argb: 'FF1F4E78' } }
  ws.getRow(1).height = 26
  ws.mergeCells(2, 1, 2, n)
  const s = ws.getCell(2, 1); s.value = subtitle
  s.font = { name: FONT, size: 10, color: { argb: 'FF444444' } }
  s.alignment = { wrapText: true, vertical: 'top' }
  ws.getRow(2).height = 56
  const hr = ws.getRow(4)
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1); c.value = h; c.font = HFONT; c.border = BORDER
    c.alignment = { horizontal: 'center', vertical: 'center', wrapText: true }
    c.fill = i === respCol ? RESP_HFILL : HFILL
  })
  hr.height = 34
  rows.forEach((row, ri) => {
    const r = ws.getRow(5 + ri)
    row.forEach((val, i) => {
      const c = r.getCell(i + 1); c.value = val; c.font = CELLFONT; c.border = BORDER
      if (moneyCols.includes(i)) c.numFmt = MONEY
      c.alignment = centerCols.includes(i)
        ? { horizontal: 'center', vertical: 'center' }
        : { wrapText: true, vertical: 'top' }
      if (i === respCol) c.fill = RESP_FILL
    })
  })
  ws.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }]
  return ws
}

// ---------- ABA INÍCIO ----------
const ws0 = wb.addWorksheet('Início', { views: [{ showGridLines: false }] })
ws0.getColumn(1).width = 3; ws0.getColumn(2).width = 105
const put = (r, txt, font, h) => {
  const c = ws0.getCell(r, 2); c.value = txt; c.font = font
  c.alignment = { wrapText: true, vertical: 'top' }; if (h) ws0.getRow(r).height = h
}
put(2, 'Conferência de contratos — IM x Sienge', { name: FONT, bold: true, size: 16, color: { argb: 'FF1F4E78' } }, 24)
put(4, 'Olá! Levantamos três pontos onde o nosso sistema e o Sienge não estão batendo. Precisamos da sua conferência no Sienge para corrigir. Cada aba abaixo trata de um assunto. A coluna amarela (RESPOSTA) é para você preencher.', { name: FONT, size: 11 }, 48)
const itens = [
 ['Aba "1. Parcelas a conferir"', 'Parcelas que aparecem no nosso sistema mas não encontramos no Sienge. Precisamos saber se cada uma realmente existe / foi paga pelo cliente.'],
 ['Aba "2. Saldo divergente"', 'Contratos em que o saldo devedor (pró-soluto) do nosso sistema é diferente da soma das parcelas no Sienge. Precisamos saber qual valor é o correto.'],
 ['Aba "3. Distratos a confirmar"', 'Contratos que constam como distratados no Sienge mas ainda aparecem como ativos aqui. A comissão já paga é mantida — só precisamos confirmar o distrato.'],
 ['Aba "4. Em análise interna"', 'Contratos com possível duplicidade de parcelas. Ficam com a nossa equipe — informativos, não precisam de resposta.'],
]
let r = 6
for (const [t, d] of itens) {
  put(r, t, { name: FONT, bold: true, size: 11, color: { argb: 'FF1F4E78' } }); r++
  put(r, '   ' + d, { name: FONT, size: 10 }, 32); r += 2
}
put(r + 1, 'Qualquer dúvida sobre o que cada coluna significa, é só chamar. Obrigado!', { name: FONT, italic: true, size: 10, color: { argb: 'FF444444' } })

// ---------- ABA 1 ----------
const casos1 = b9.casos.filter((c) => c.grupo === 1 || c.grupo === 2)
casos1.sort((a, b) => (distVendas.has(a.venda_id) === distVendas.has(b.venda_id) ? (+a.numero_contrato) - (+b.numero_contrato) : (distVendas.has(b.venda_id) ? 1 : -1)))
const rows1 = []
for (const c of casos1) {
  const obs = distVendas.has(c.venda_id) ? 'Contrato distratado' : ''
  for (const l of c.estado_atual.linhas) {
    rows1.push(['c' + c.numero_contrato, c.unidade, titlecase(c.cliente), TIPO[l.tipo] || l.tipo,
      Number(l.valor), l.status === 'pago' ? 'Paga' : 'Pendente',
      l.data_pagamento ? brDate(l.data_pagamento) : '—', obs, ''])
  }
}
buildSheet('1. Parcelas a conferir',
  '1. Parcelas que não encontramos no Sienge',
  'Cada linha é uma parcela registrada no NOSSO sistema que não localizamos no Sienge. Por favor, confirme no Sienge se a parcela existe e foi paga pelo cliente. Se NÃO existir, vamos removê-la do nosso sistema.',
  ['Contrato', 'Unidade', 'Cliente', 'Tipo de parcela', 'Valor da parcela', 'Situação no nosso sistema', 'Data do pagamento (nosso sistema)', 'Observação', 'RESPOSTA: existe no Sienge? (Sim / Não)'],
  rows1, { widths: [10, 10, 30, 16, 16, 16, 18, 18, 30], respCol: 8, moneyCols: [4], centerCols: [0, 1, 5, 6] })

// ---------- ABA 2 ----------
const rows2 = [...b10.casos].sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca)).map((c) => {
  const obs = distUnid[c.unidade] ? 'Unidade revendida (o contrato anterior foi distratado)' : ''
  return ['c' + c.numero_contrato, c.unidade, Number(c.pro_soluto_local), Number(c.soma_income_sienge), Number(c.diferenca), c.parcelas_pagas, obs, '']
})
buildSheet('2. Saldo divergente',
  '2. Saldo devedor (pró-soluto) diferente do Sienge',
  'Para estes contratos, o saldo devedor registrado aqui é diferente da soma das parcelas no Sienge. Por favor, indique qual valor é o correto.',
  ['Contrato', 'Unidade', 'Saldo no nosso sistema', 'Saldo no Sienge', 'Diferença', 'Parcelas já pagas', 'Observação', 'RESPOSTA: qual valor é o correto?'],
  rows2, { widths: [10, 10, 18, 18, 16, 14, 36, 30], respCol: 7, moneyCols: [2, 3, 4], centerCols: [0, 1, 5] })

// ---------- ABA 3 ----------
const rows3 = [...distratos].sort((a, b) => (+a[0]) - (+b[0])).map(([contrato, unid, vid, data, valor]) => {
  const obs = []
  if (distUnid[unid].length > 1) obs.push(`Unidade distratada ${distUnid[unid].length}x`)
  if (b10ByUnit.has(unid)) obs.push(`Revendida (contrato novo c${b10ByUnit.get(unid)})`)
  return ['c' + contrato, unid, brDate(data), Number(valor), obs.join('; '), '']
})
buildSheet('3. Distratos a confirmar',
  '3. Contratos distratados (confirmar)',
  'Estes contratos constam como DISTRATADOS no Sienge mas ainda aparecem como ativos no nosso sistema. A comissão já paga será mantida. Por favor, confirme o distrato e a data.',
  ['Contrato', 'Unidade', 'Data do distrato (Sienge)', 'Valor da venda', 'Observação', 'RESPOSTA: confirma o distrato? (Sim / Não)'],
  rows3, { widths: [10, 10, 22, 18, 36, 32], respCol: 5, moneyCols: [3], centerCols: [0, 1, 2] })

// ---------- ABA 4 ----------
const rows4 = b9.casos.filter((c) => c.grupo === 3).sort((a, b) => (+a.numero_contrato) - (+b.numero_contrato))
  .map((c) => ['c' + c.numero_contrato, c.unidade, titlecase(c.cliente), 'Possível parcela duplicada — verificar internamente'])
buildSheet('4. Em análise interna',
  '4. Contratos com possível duplicidade (análise interna)',
  'Estes contratos têm parcelas que podem estar duplicadas no sistema. Ficam com a nossa equipe para análise individual — são informativos e NÃO precisam de resposta da controladoria.',
  ['Contrato', 'Unidade', 'Cliente', 'Situação'],
  rows4, { widths: [10, 10, 32, 44], respCol: -1, moneyCols: [], centerCols: [0, 1] })

mkdirSync('docs/controladoria', { recursive: true })
const out = 'docs/controladoria/conferencia-sienge-2026-06-02.xlsx'
await wb.xlsx.writeFile(out)
console.log('Salvo:', out)
console.log(`Linhas: aba1=${rows1.length} aba2=${rows2.length} aba3=${rows3.length} aba4=${rows4.length}`)
