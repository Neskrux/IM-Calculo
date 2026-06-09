// Cruza a planilha THAI (porcentagem corretores) com vendas.tipo_corretor por unidade.
// Pergunta: os casos "NOHROS" sao todos corretores INTERNOS? READ-ONLY.
import { readFileSync } from 'node:fs'

const env = readFileSync('.env', 'utf8')
const KEY = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim()
const URL = 'https://jdkkusrxullttyeakwib.supabase.co'
const FIG = '0d7d01f4-c398-4d9a-a280-13f44c957279'
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

const norm = (u) => (u || '').toUpperCase().replace(/\s+/g, '')

// 1. CSV
const buf = readFileSync('docs/controladoria/porcentagem corretores(THAI).csv', 'latin1')
const pct = (s) => { s = (s || '').trim().replace('%', '').replace(',', '.'); return s === '' ? null : parseFloat(s) }
const rows = []
for (const l of buf.split(/\r?\n/).slice(1)) {
  if (!l.trim() || l.startsWith(',')) continue
  const c = l.split(',')
  if (!c[0].trim()) continue
  rows.push({ corretor: c[0].trim(), unidade: c[1]?.trim(), atual: pct(c[3]), correta: pct(c[5]),
    correcao: (c[6] || '').trim(), tag: (c[7] || '').trim() })
}

// 2. vendas FIGUEIRA -> unidade => tipo_corretor (pode haver +1 por unidade; pega ativa)
const r = await fetch(`${URL}/rest/v1/vendas?select=unidade,tipo_corretor,excluido,situacao_contrato&empreendimento_id=eq.${FIG}`, { headers: H })
const vendas = await r.json()
const tipoPorUnidade = new Map()
for (const v of vendas) {
  const k = norm(v.unidade)
  // prioriza venda ativa (nao excluida, nao distrato)
  const ativa = !v.excluido && v.situacao_contrato !== '3'
  if (!tipoPorUnidade.has(k) || ativa) tipoPorUnidade.set(k, v.tipo_corretor)
}

// 3. cruzar
const cat = { NOHROS: {}, CORRETA: {}, OUTRO: {} }
const semMatch = []
for (const row of rows) {
  const tipo = tipoPorUnidade.get(norm(row.unidade))
  let bucket = /NOHROS/i.test(row.tag) ? 'NOHROS' : (/CORRETA/i.test(row.correcao) ? 'CORRETA' : 'OUTRO')
  const t = tipo || '(sem match)'
  if (!tipo) semMatch.push(`${row.corretor} ${row.unidade}`)
  cat[bucket][t] = (cat[bucket][t] || 0) + 1
}
console.log('=== tipo_corretor por categoria de veredito ===')
for (const [b, dist] of Object.entries(cat)) {
  console.log(`\n${b}:`)
  for (const [t, n] of Object.entries(dist).sort((a, b2) => b2[1] - a[1])) console.log(`  ${t.padEnd(14)} ${n}`)
}
if (semMatch.length) console.log(`\nsem match de unidade (${semMatch.length}):`, semMatch.slice(0, 15).join(' | '))
