// Backfill de vendas.data_distrato a partir do relatório oficial de distrato do Sienge
// (docs/controladoria/sienge_relatorio-20260603-174452.xlsx, 36 casos).
//
// Match: unidade (normalizada) + cliente (token-overlap, tolera mojibake do xlsx).
// Unidades com MÚLTIPLOS distratos (604 D ×2, 1707 A ×3) exigem cliente batendo.
// Validação da conversão serial→data: reproduz as 11 datas conhecidas do
// mapa-3-termos.json e as 6 já no banco — aborta se divergir.
//
// ver .claude/rules/sincronizacao-sienge.md — equivale ao backfill A.2 (ponte A.1
// já deployada na edge v21 faz isso pra distratos NOVOS; este script cobre o estoque).
//
// Uso: node scripts/backfill-data-distrato.mjs          # dry-run
//      node scripts/backfill-data-distrato.mjs --apply  # grava data_distrato + status='distrato'

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import XLSX from 'xlsx'

const APPLY = process.argv.includes('--apply')
const FIGUEIRA = '0d7d01f4-c398-4d9a-a280-13f44c957279'
const env = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const get = (k) => process.env[k] || env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const supa = createClient(get('VITE_SUPABASE_URL'), get('VITE_SUPABASE_ANON_KEY'))
const d10 = (x) => (x ? String(x).slice(0, 10) : null)

// serial Excel -> ISO, epoch padrão 1899-12-30. Validado contra ground-truth:
// data da BAIXA EM MASSA no income == data_distrato de c149/c145/c141 == conversão padrão.
// (O mapa-3-termos de 06-05 está 1 dia ADIANTADO — off-by-one daquele parse, inofensivo
// pro corte >= mas não é a verdade; aqui validamos contra mapa+1d.)
const serialToISO = (s) => new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000).toISOString().slice(0, 10)
const plusDay = (iso) => new Date(Date.parse(iso + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
// desfazer mojibake (UTF-8 lido como latin1) + normalizar nome
const fixMojibake = (s) => { try { const f = Buffer.from(String(s), 'latin1').toString('utf8'); return f.includes('�') ? String(s) : f } catch { return String(s) } }
const normNome = (s) => fixMojibake(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim()
const normUnidade = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim()

// 1. xlsx oficial -> 36 casos
const wb = XLSX.readFile('docs/controladoria/sienge_relatorio-20260603-174452.xlsx')
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true }).slice(1)
const casos = rows.filter((r) => r && r[4] != null && r[16] != null).map((r) => ({
  relContrato: String(r[4]), cliente: fixMojibake(r[1]), clienteNorm: normNome(String(r[1]).replace(/^\d+\s*-\s*/, '')),
  unidade: normUnidade(r[6]), dataDistrato: serialToISO(r[16]),
}))
console.log(`xlsx: ${casos.length} casos de distrato com data`)

// 2. VALIDAR conversão serial→data: mapa tem off-by-one conhecido (-1d) → xlsx deve ser mapa+1d
const mapa = JSON.parse(readFileSync('docs/contexto/2026-06-05-mapa-3-termos.json', 'utf8'))
let valOk = 0, valErr = 0
for (const m of mapa.distrato?.casos || []) {
  const c = casos.find((x) => x.relContrato === String(m.relContrato))
  if (!c) continue
  if (c.dataDistrato === plusDay(d10(m.dataDistrato))) valOk++
  else { valErr++; console.error(`  ❌ conversão diverge rel ${m.relContrato}: xlsx=${c.dataDistrato} esperado=${plusDay(d10(m.dataDistrato))} (mapa+1d)`) }
}
console.log(`validação serial→data vs mapa+1d: ${valOk} ok, ${valErr} erro`)
if (valErr > 0) { console.error('ABORTANDO: conversão de data não confere.'); process.exit(1) }

// 3. vendas distrato sem data + clientes
const { data: vendas, error: e1 } = await supa.from('vendas')
  .select('id, sienge_contract_id, unidade, cliente_id, status, data_distrato')
  .eq('empreendimento_id', FIGUEIRA).eq('excluido', false).eq('situacao_contrato', '3')
if (e1) { console.error(e1); process.exit(1) }
const cliIds = [...new Set(vendas.map((v) => v.cliente_id).filter(Boolean))]
const cliMap = new Map()
for (let i = 0; i < cliIds.length; i += 200) {
  const { data } = await supa.from('clientes').select('id, nome_completo').in('id', cliIds.slice(i, i + 200))
  for (const c of data || []) cliMap.set(c.id, c.nome_completo)
}
const semData = vendas.filter((v) => !v.data_distrato)
const comData = vendas.filter((v) => v.data_distrato)
console.log(`vendas situacao=3: ${vendas.length} (${comData.length} com data, ${semData.length} sem)`)

// 3b. VALIDAR match unidade+cliente também nas 6 que JÁ têm data (sanidade do método)
for (const v of comData) {
  const cands = casos.filter((c) => c.unidade === normUnidade(v.unidade))
  const cli = normNome(cliMap.get(v.cliente_id) || '')
  const hit = cands.find((c) => c.clienteNorm && cli && (c.clienteNorm.includes(cli.split(' ')[0]) || cli.includes(c.clienteNorm.split(' ')[0])) &&
    overlap(c.clienteNorm, cli) >= 2)
  if (hit && hit.dataDistrato !== d10(v.data_distrato)) {
    const soOffByOne = hit.dataDistrato === plusDay(d10(v.data_distrato))
    console.log(`  ${soOffByOne ? 'ℹ️ banco -1d (parse do mapa, inofensivo)' : '⚠️ DIVERGÊNCIA REAL'}: c${v.sienge_contract_id} ${v.unidade} banco=${d10(v.data_distrato)} xlsx=${hit.dataDistrato}`)
  }
}
function overlap(a, b) { const A = new Set(a.split(' ')), B = new Set(b.split(' ')); let n = 0; for (const t of A) if (t.length > 2 && B.has(t)) n++; return n }

// 4. match das sem-data
// Override 1707 A: ISABEL CRISTINA MAÇANEIRO tem 2 distratos no Sienge (rel 253 + 215,
// datas 2025-12-04/05). Desambiguado pela DATA DA BAIXA EM MASSA no banco (ground-truth):
//   c307 = 61 pagas todas em 2025-12-05 (baixa pura) -> rel 215 (2025-12-05)
//   c355 = baixa em massa 2025-12-04 (paga real 2025-10-09 preservada) -> rel 253 (2025-12-04)
const OVERRIDE = new Map([['307', '215'], ['355', '253']])
const usados = new Set()
const plano = [], falhas = []
for (const v of semData) {
  const u = normUnidade(v.unidade)
  const cli = normNome(cliMap.get(v.cliente_id) || '')
  const cands = casos.filter((c) => c.unidade === u && !usados.has(c.relContrato))
  let hit = null, criterio = null
  if (OVERRIDE.has(v.sienge_contract_id)) {
    hit = casos.find((c) => c.relContrato === OVERRIDE.get(v.sienge_contract_id))
    criterio = 'override por data da baixa em massa (ground-truth income)'
  } else if (cands.length === 1) {
    hit = cands[0]; criterio = 'unidade única'
    if (cli && overlap(hit.clienteNorm, cli) < 1) { falhas.push({ venda: v, motivo: `unidade única mas cliente NÃO bate: banco="${cli}" xlsx="${hit.clienteNorm}"` }); continue }
  } else if (cands.length > 1) {
    const porCliente = cands.filter((c) => overlap(c.clienteNorm, cli) >= 2)
    if (porCliente.length === 1) { hit = porCliente[0]; criterio = `unidade ×${cands.length} desambiguada por cliente` }
    else { falhas.push({ venda: v, motivo: `unidade com ${cands.length} candidatos, cliente não desambigua (matches=${porCliente.length})` }); continue }
  } else { falhas.push({ venda: v, motivo: 'nenhum caso no xlsx com essa unidade (disponível)' }); continue }
  usados.add(hit.relContrato)
  plano.push({ venda_id: v.id, contrato: v.sienge_contract_id, unidade: v.unidade, cliente_banco: cliMap.get(v.cliente_id),
    cliente_xlsx: hit.cliente, rel_contrato: hit.relContrato, data_distrato: hit.dataDistrato, status_atual: v.status, criterio })
}

console.log(`\n=== PLANO (${plano.length} matches, ${falhas.length} falhas) ===`)
for (const p of plano) console.log(`  c${p.contrato} ${p.unidade.padEnd(7)} -> ${p.data_distrato} | banco="${(p.cliente_banco || '').slice(0, 28)}" xlsx="${p.cliente_xlsx.slice(0, 32)}" [${p.criterio}]`)
if (falhas.length) { console.log('\n=== FALHAS (revisão humana) ==='); for (const f of falhas) console.log(`  c${f.venda.sienge_contract_id} ${f.venda.unidade}: ${f.motivo}`) }

// 5. LIMBO: distratados no Sienge mas situacao stale ('2') no banco — o sync incremental
// nunca re-tocou esses contratos de abril. situation + cancellationDate CONFIRMADOS via
// REST /sales-contracts/{id} em 2026-06-11 (todos "Cancelado"); baixa em massa no income
// coincide com a data. Mesma convergência que um full-sync da ponte A.1 faria.
const LIMBO = [
  { c: '196', data: '2026-04-23' }, { c: '229', data: '2026-04-29' }, { c: '246', data: '2026-04-23' },
  { c: '259', data: '2026-04-23' }, { c: '266', data: '2026-04-23' }, { c: '357', data: '2026-04-23' },
  { c: '195', data: '2026-04-23' },
]
const planoLimbo = []
for (const l of LIMBO) {
  const { data } = await supa.from('vendas').select('id, sienge_contract_id, unidade, status, situacao_contrato, data_distrato')
    .eq('empreendimento_id', FIGUEIRA).eq('excluido', false).eq('sienge_contract_id', l.c)
  const v = (data || [])[0]
  if (!v) { falhas.push({ venda: { sienge_contract_id: l.c, unidade: '?' }, motivo: 'limbo: venda não encontrada' }); continue }
  if (v.situacao_contrato === '3' && d10(v.data_distrato) === l.data) continue // idempotente
  planoLimbo.push({ venda_id: v.id, contrato: v.sienge_contract_id, unidade: v.unidade, data_distrato: l.data,
    status_atual: v.status, criterio: 'limbo: REST /sales-contracts confirma Cancelado + cancellationDate' })
}
console.log(`\n=== LIMBO (situacao stale no banco, Cancelado no Sienge): ${planoLimbo.length} ===`)
for (const p of planoLimbo) console.log(`  c${p.contrato} ${p.unidade.padEnd(7)} -> situacao 3 + data ${p.data_distrato}`)

const out = {
  meta: { geradoEm: new Date().toISOString(), spec_ref: '.claude/rules/sincronizacao-sienge.md',
    script: 'scripts/backfill-data-distrato.mjs', modo: APPLY ? 'apply' : 'dry-run',
    fonte: 'sienge_relatorio-20260603-174452.xlsx (relatório oficial) + REST /sales-contracts (limbo)' },
  counts: { matched: plano.length, limbo: planoLimbo.length, noMatch: falhas.length, updated: 0, skipped_idempotent: comData.length, errors: 0 },
  plano, plano_limbo: planoLimbo, falhas: falhas.map((f) => ({ contrato: f.venda.sienge_contract_id, unidade: f.venda.unidade, motivo: f.motivo })),
  errors: [],
}

if (APPLY) {
  console.log('\nAplicando UPDATE vendas.data_distrato + status=distrato...')
  for (const p of plano) {
    const { error } = await supa.from('vendas').update({ data_distrato: p.data_distrato, status: 'distrato' }).eq('id', p.venda_id)
    if (error) { out.counts.errors++; out.errors.push({ id: p.venda_id, msg: error.message }); console.error(`  erro c${p.contrato}: ${error.message}`) }
    else out.counts.updated++
  }
  for (const p of planoLimbo) {
    const { error } = await supa.from('vendas').update({ situacao_contrato: '3', data_distrato: p.data_distrato, status: 'distrato' }).eq('id', p.venda_id)
    if (error) { out.counts.errors++; out.errors.push({ id: p.venda_id, msg: error.message }); console.error(`  erro limbo c${p.contrato}: ${error.message}`) }
    else out.counts.updated++
  }
  console.log(`  updated=${out.counts.updated} errors=${out.counts.errors}`)
}

mkdirSync('docs/auditorias/2026-06-10-distrato', { recursive: true })
const f = `docs/auditorias/2026-06-10-distrato/backfill-data-distrato-${APPLY ? 'apply' : 'dryrun'}.json`
writeFileSync(f, JSON.stringify(out, null, 2))
console.log(`\nSalvo: ${f}`)
