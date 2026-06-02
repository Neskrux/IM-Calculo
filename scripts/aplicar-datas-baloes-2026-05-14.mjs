// Aplica data_prevista nos baloes sem data, conforme respostas da gestora
// em 2026-05-14 (ver docs/pendencias-para-revisao-2026-05-14.md).
//
// Todos os baloes alvo sao status='pendente' — UPDATE de data_prevista em
// pendente nao tem trava (trigger 017 so protege status='pago').
//
// Idempotente: WHERE data_prevista IS NULL — se ja preenchido, nao casa.
//
// Uso:
//   node scripts/aplicar-datas-baloes-2026-05-14.mjs          (dry-run)
//   node scripts/aplicar-datas-baloes-2026-05-14.mjs --apply

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const DRY = !process.argv.includes('--apply')
console.log(`Modo: ${DRY ? 'dry-run' : 'apply'}\n`)

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

// Plano vindo das respostas da gestora. Identifica venda por (cliente ilike, unidade).
// Cada item: numero_parcela -> data_prevista.
const PLANO = [
  {
    cliente: '%LURDES%COLMAN%', unidade: '1305 D',
    datas: { 2: '2027-03-20', 3: '2028-03-20', 4: '2029-03-20', 5: '2030-03-20' },
  },
  {
    cliente: '%CAROLINE%SARAIVA%', unidade: '905 B',
    datas: { 2: '2027-12-20', 3: '2028-12-20', 4: '2029-12-20' },
  },
  {
    cliente: '%CAYO%KAMENAC%', unidade: '603',
    datas: { 1: '2026-12-20', 2: '2027-12-20', 3: '2028-12-20', 4: '2029-12-20' },
  },
  {
    cliente: '%FELIX%ROMAN%MUNIEWEG%', unidade: '1307',
    datas: { 1: '2026-12-20', 2: '2027-12-20', 3: '2028-12-20', 4: '2029-12-20' },
  },
  {
    cliente: '%ALISSON%RODRIGUES%DO%CARMO%', unidade: '1305',
    datas: { 1: '2026-12-20' },
  },
]

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
const report = { meta: { geradoEm: new Date().toISOString(), modo: DRY ? 'dry-run' : 'apply', autorizacao: 'gestora 2026-05-14' }, counts: { matched: 0, updated: 0, skipped: 0, errors: 0 }, drift: [], errors: [] }

for (const item of PLANO) {
  // achar a venda: cliente + unidade
  const { data: clientes } = await supa.from('clientes').select('id, nome_completo').ilike('nome_completo', item.cliente)
  const clienteIds = (clientes || []).map((c) => c.id)
  if (clienteIds.length === 0) {
    console.log(`✗ ${item.cliente} — cliente nao encontrado`)
    report.errors.push({ item: item.cliente, msg: 'cliente nao encontrado' })
    report.counts.errors++
    continue
  }
  const { data: vendas } = await supa
    .from('vendas')
    .select('id, unidade')
    .in('cliente_id', clienteIds)
    .ilike('unidade', item.unidade)
  if (!vendas?.length) {
    console.log(`✗ ${item.cliente} unidade ${item.unidade} — venda nao encontrada`)
    report.errors.push({ item: `${item.cliente}/${item.unidade}`, msg: 'venda nao encontrada' })
    report.counts.errors++
    continue
  }
  if (vendas.length > 1) {
    console.log(`⚠ ${item.cliente} unidade ${item.unidade} — ${vendas.length} vendas! abortando esse item por seguranca`)
    report.errors.push({ item: `${item.cliente}/${item.unidade}`, msg: `${vendas.length} vendas ambiguas` })
    report.counts.errors++
    continue
  }
  const venda = vendas[0]
  console.log(`${item.cliente.replace(/%/g, '')} (${item.unidade}) venda=${venda.id.slice(0, 8)}`)

  for (const [numero, dataPrevista] of Object.entries(item.datas)) {
    report.counts.matched++
    // achar o balao
    const { data: baloes } = await supa
      .from('pagamentos_prosoluto')
      .select('id, numero_parcela, valor, data_prevista, status')
      .eq('venda_id', venda.id)
      .eq('tipo', 'balao')
      .eq('numero_parcela', Number(numero))
    const balao = baloes?.[0]
    if (!balao) {
      console.log(`  ✗ balao #${numero} nao encontrado`)
      report.errors.push({ venda: venda.id, numero, msg: 'balao nao encontrado' })
      report.counts.errors++
      continue
    }
    if (balao.data_prevista) {
      console.log(`  - balao #${numero} ja tem data (${balao.data_prevista}) — skip`)
      report.counts.skipped++
      continue
    }
    if (balao.status === 'pago') {
      console.log(`  ⚠ balao #${numero} esta PAGO — pulando (nao mexer em pago)`)
      report.counts.skipped++
      continue
    }
    if (DRY) {
      console.log(`  [dry] balao #${numero} (R$ ${balao.valor}) -> data_prevista = ${dataPrevista}`)
      continue
    }
    // APPLY — WHERE data_prevista is null (idempotencia)
    const url = `${URL}/rest/v1/pagamentos_prosoluto?id=eq.${balao.id}&data_prevista=is.null`
    const res = await fetch(url, { method: 'PATCH', headers: H, body: JSON.stringify({ data_prevista: dataPrevista, updated_at: new Date().toISOString() }) })
    if (!res.ok) {
      const txt = await res.text()
      console.log(`  ✗ balao #${numero} HTTP ${res.status}: ${txt.slice(0, 120)}`)
      report.errors.push({ id: balao.id, msg: `HTTP ${res.status}` })
      report.counts.errors++
      continue
    }
    const arr = await res.json()
    if (arr.length > 0) {
      console.log(`  ✓ balao #${numero} -> ${dataPrevista}`)
      report.counts.updated++
      report.drift.push({ id: balao.id, campo: 'data_prevista', antes: null, depois: dataPrevista, motivo: `balao sem data — gestora informou 2026-05-14` })
    } else {
      console.log(`  - balao #${numero} ja preenchido (idempotente)`)
      report.counts.skipped++
    }
  }
}

console.log(`\n=== Resumo ===`)
console.log(`  matched: ${report.counts.matched} | updated: ${report.counts.updated} | skipped: ${report.counts.skipped} | errors: ${report.counts.errors}`)

if (!DRY) {
  const out = `docs/aplicacao-datas-baloes-${new Date().toISOString().slice(0, 10)}.json`
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(`Report: ${out}`)
} else {
  console.log('\nDry-run apenas. Pra aplicar: --apply')
}
