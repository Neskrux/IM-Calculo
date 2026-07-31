// Realinha data_prevista -> dueDate do Sienge PELA ANCORA (sienge_bill_id, sienge_installment_id).
// ver .claude/rules/sincronizacao-sienge.md  +  .claude/rules/numeracao-parcelas-sienge.md
//
// NUNCA casa por numero_parcela nem por installmentNumber ("n/total", que e por SERIE) — foi
// exatamente esse erro que deslocou 305 parcelas em 9 vendas (regressao de 2026-07-11).
//
// Escopo DERIVADO DO ESTADO ATUAL (nunca de arquivo congelado — licao da b11 supersedida).
// Toca SO data_prevista. Nunca valor / comissao_gerada / status / data_pagamento / tipo.
//
// Gate da spec:
//   - status pendente            -> AUTO (cronograma futuro, qualquer delta e seguro)
//   - status pago, drift <= 30d  -> AUTO (correcao que reaproxima do Sienge)
//   - status pago, drift  > 30d  -> RODADA-B (revisao humana; pode denunciar ancora errada/renegociacao)
//
// ATENCAO OPERACIONAL: o cron roda da `main`. Enquanto o passo legado
// (gerar-plano/aplicar-correcao-data-prevista) estiver no workflow da main, QUALQUER apply feito aqui
// e desfeito na madrugada seguinte. Ja aconteceu 2x (b12 25/06 e wf-data 10/07). DESARMAR ANTES DE CURAR.
//
// Uso: node scripts/realinhar-data-prevista-ancora.mjs            (dry-run, nao grava)
//      node scripts/realinhar-data-prevista-ancora.mjs --apply
//      node scripts/realinhar-data-prevista-ancora.mjs --rollback

import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const APPLY = process.argv.includes('--apply')
const ROLLBACK = process.argv.includes('--rollback')
// --sem-pagos: NENHUMA linha status='pago' entra no apply, nem as de drift <=30d que a spec
// permitiria. Decisao do usuario (2026-07-31): pagamento real nao se mexe sem revisar caso a caso.
const SEM_PAGOS = process.argv.includes('--sem-pagos')
// --incluir-pagos: inclui tambem as linhas PAGAS com drift >30d. So use quando a data do Sienge
// estiver corroborada (contrato assinado e/ou a propria data_pagamento). Vendas com ANCORA SUSPEITA
// (ver auditoria abaixo) continuam FORA mesmo com esta flag.
const INCLUIR_PAGOS = process.argv.includes('--incluir-pagos')
const HOJE = new Date().toISOString().slice(0, 10)
const OUT_PLANO = `docs/auditorias/realinhar-data-prevista-${HOJE}-plano.json`
const OUT_APLIC = `docs/auditorias/realinhar-data-prevista-${HOJE}-aplicado.json`
const OUT_RB = `docs/auditorias/realinhar-data-prevista-${HOJE}-rollback.json`

const env = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const get = (k) => process.env[k] || env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL_ = get('VITE_SUPABASE_URL'), KEY = get('VITE_SUPABASE_ANON_KEY')
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function page(tabela, select, filtro = '') {
  let out = [], from = 0
  for (;;) {
    const r = await fetch(`${URL_}/rest/v1/${tabela}?select=${select}${filtro}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    if (!r.ok) throw new Error(`${tabela}: ${r.status} ${await r.text()}`)
    const d = await r.json()
    out = out.concat(d)
    if (d.length < 1000) break
    from += 1000
  }
  return out
}
const patch = async (id, body) => {
  const r = await fetch(`${URL_}/rest/v1/pagamentos_prosoluto?id=eq.${id}`, { method: 'PATCH', headers: H, body: JSON.stringify(body) })
  return r.ok ? null : `${r.status} ${(await r.text()).slice(0, 120)}`
}

// ---------- rollback ----------
if (ROLLBACK) {
  const alvo = readdirSync('docs/auditorias').filter((f) => /^realinhar-data-prevista-.*-rollback\.json$/.test(f)).sort().pop()
  if (!alvo) { console.error('nenhum rollback encontrado'); process.exit(1) }
  const prev = JSON.parse(readFileSync(resolve('docs/auditorias', alvo), 'utf8'))
  let n = 0, e = 0
  for (const r of prev.rows) { const err = await patch(r.id, { data_prevista: r.de }); if (err) { e++; console.error(r.id, err) } else n++ }
  console.log(`rollback (${alvo}): ${n} restauradas · ${e} erros`)
  process.exit(0)
}

// ---------- income do cache (maior pull = bulk completo) ----------
let cache = null
for (const f of readdirSync('.sienge-cache').filter((x) => x.endsWith('.json'))) {
  try {
    const j = JSON.parse(readFileSync(resolve('.sienge-cache', f), 'utf8'))
    const rows = j?.data?.data
    if (Array.isArray(rows) && (!cache || rows.length > cache.rows.length)) cache = { f, rows }
  } catch {}
}
if (!cache) { console.error('.sienge-cache vazio — rode o cron ou baixe o artifact'); process.exit(1) }
const due = new Map(), pagoEm = new Map()
for (const r of cache.rows) if (r.billId != null && r.installmentId != null) {
  const k = `${r.billId}__${r.installmentId}`
  due.set(k, String(r.dueDate || '').slice(0, 10))
  const pd = r.paymentDate || r.receipts?.[0]?.paymentDate || null
  if (pd) pagoEm.set(k, String(pd).slice(0, 10))
}
console.log(`cache income: ${cache.f} — ${cache.rows.length} linhas · ${due.size} installments`)

// ---------- estado atual ----------
const pags = await page('pagamentos_prosoluto', 'id,venda_id,numero_parcela,tipo,valor,status,data_prevista,data_pagamento,sienge_bill_id,sienge_installment_id', '&sienge_installment_id=not.is.null&sienge_bill_id=not.is.null')
const vendas = await page('vendas', 'id,unidade,sienge_contract_id,excluido', '&excluido=eq.false')
const vmap = new Map(vendas.map((v) => [v.id, v]))
console.log(`parcelas ancoradas: ${pags.length} · vendas ativas: ${vendas.length}`)

const d10 = (x) => (x ? String(x).slice(0, 10) : null)
const dias = (a, b) => Math.abs(Math.round((new Date(a) - new Date(b)) / 86400000))

// ---------- AUDITORIA DE ANCORA (guarda-corpo do caso 803 D) ----------
// Se a ancora estiver deslocada, realinhar data_prevista por ela CORROMPE o cronograma.
// Teste: pra cada linha PAGA, a data_pagamento do banco bate com o paymentDate do installment
// ancorado, ou com o do installment SEGUINTE? Se a maioria bate no seguinte, a venda esta
// off-by-one (falta a 1a parcela no banco) -> venda inteira vai pra revisao humana.
const ancoraSuspeita = new Map() // venda_id -> {bate, off}
{
  const acc = new Map()
  for (const p of pags) {
    if (p.status !== 'pago' || !p.data_pagamento) continue
    const i = Number(p.sienge_installment_id)
    if (!Number.isFinite(i)) continue
    const aqui = pagoEm.get(`${p.sienge_bill_id}__${i}`)
    const proximo = pagoEm.get(`${p.sienge_bill_id}__${i + 1}`)
    const perto = (x) => x && Math.abs((new Date(x) - new Date(p.data_pagamento)) / 86400000) <= 5
    if (!acc.has(p.venda_id)) acc.set(p.venda_id, { bate: 0, off: 0 })
    const e = acc.get(p.venda_id)
    if (perto(aqui)) e.bate++
    else if (perto(proximo)) e.off++
  }
  for (const [vid, e] of acc) if (e.off > e.bate) ancoraSuspeita.set(vid, e)
}
if (ancoraSuspeita.size) {
  console.log(`\n⚠️  ANCORA SUSPEITA (off-by-one) em ${ancoraSuspeita.size} venda(s) — ficam FORA do apply:`)
  for (const [vid, e] of ancoraSuspeita) console.log(`   ${vmap.get(vid)?.unidade || vid}: ${e.off} pagas casam com inst+1 vs ${e.bate} com a propria ancora`)
}

const auto = [], humano = []
let exato = 0, semDue = 0, canceladas = 0
for (const p of pags) {
  const v = vmap.get(p.venda_id)
  if (!v) continue
  if (p.status === 'cancelado') { canceladas++; continue }
  const alvo = due.get(`${p.sienge_bill_id}__${p.sienge_installment_id}`)
  if (!alvo) { semDue++; continue }
  if (d10(p.data_prevista) === alvo) { exato++; continue }
  const delta = dias(p.data_prevista, alvo)
  const caso = { id: p.id, unidade: v.unidade, contrato: v.sienge_contract_id, np: p.numero_parcela, tipo: p.tipo, valor: Number(p.valor), status: p.status, inst: p.sienge_installment_id, de: d10(p.data_prevista), para: alvo, dias: delta }
  // Guarda-corpo 1: venda com ancora suspeita NUNCA entra no apply (nem pendente).
  if (ancoraSuspeita.has(p.venda_id)) humano.push({ ...caso, motivo: 'ÂNCORA SUSPEITA (off-by-one): realinhar por ela corromperia o cronograma — re-ancorar antes' })
  // Guarda-corpo 2: linha paga só entra com --incluir-pagos explícito.
  else if (p.status === 'pago' && SEM_PAGOS) humano.push({ ...caso, motivo: 'PAGO — excluído por --sem-pagos' })
  else if (p.status === 'pago' && delta > 30 && !INCLUIR_PAGOS) humano.push({ ...caso, motivo: 'data_prevista em PAGO com drift > 30d — spec exige revisão humana (rodada-b)' })
  else auto.push(caso)
}

// ---------- o realinhamento destrava o guard S4 do reconciliador? ----------
const novaData = new Map(auto.concat(humano).map((c) => [c.id, c.para]))
const porVenda = new Map()
for (const p of pags) {
  if (p.status === 'cancelado') continue
  if (!porVenda.has(p.venda_id)) porVenda.set(p.venda_id, [])
  porVenda.get(p.venda_id).push(p)
}
const s4 = { antes: [], depois: [] }
for (const [vid, lst] of porVenda) {
  const u = vmap.get(vid)?.unidade
  if (!u) continue
  const conta = (usarNova) => {
    const m = new Map()
    for (const p of lst) {
      const dt = usarNova ? (novaData.get(p.id) || d10(p.data_prevista)) : d10(p.data_prevista)
      const k = `${p.tipo}__${Number(p.valor).toFixed(2)}__${dt}`
      m.set(k, (m.get(k) || 0) + 1)
    }
    return [...m.values()].some((n) => n > 1)
  }
  if (conta(false)) s4.antes.push(u)
  if (conta(true)) s4.depois.push(u)
}

const tot = exato + auto.length + humano.length
const uniq = (a) => [...new Set(a)].sort()
console.log(`\n=== data_prevista vs Sienge (pela âncora) ===`)
console.log(`exato:            ${exato}/${tot} (${(100 * exato / tot).toFixed(2)}%)`)
console.log(`AUTO (realinhar): ${auto.length}   — ${auto.filter((c) => c.status === 'pendente').length} pendentes + ${auto.filter((c) => c.status === 'pago').length} pagas ≤30d`)
console.log(`RODADA-B:         ${humano.length}   — pagas com drift >30d (não entram no --apply)`)
console.log(`(ignoradas: ${canceladas} canceladas, ${semDue} sem dueDate no cache)`)

console.log(`\n=== por unidade ===`)
const porUn = new Map()
for (const c of auto.concat(humano)) {
  if (!porUn.has(c.unidade)) porUn.set(c.unidade, { auto: 0, humano: 0, min: 1e9, max: 0 })
  const e = porUn.get(c.unidade)
  e[humano.includes(c) ? 'humano' : 'auto']++
  e.min = Math.min(e.min, c.dias); e.max = Math.max(e.max, c.dias)
}
for (const [u, e] of [...porUn.entries()].sort((a, b) => (b[1].auto + b[1].humano) - (a[1].auto + a[1].humano)))
  console.log(`  ${u.padEnd(9)} auto ${String(e.auto).padStart(3)} · rodada-b ${String(e.humano).padStart(2)} · drift ${e.min}..${e.max}d`)

console.log(`\n=== guard S4 (colisão tipo+valor+data que parqueia a venda) ===`)
console.log(`  antes:  ${s4.antes.length} vendas travadas — ${uniq(s4.antes).join(', ') || '(nenhuma)'}`)
console.log(`  depois: ${s4.depois.length} vendas travadas — ${uniq(s4.depois).join(', ') || '(nenhuma)'}`)

const meta = { geradoEm: new Date().toISOString(), spec_ref: '.claude/rules/sincronizacao-sienge.md', script: 'scripts/realinhar-data-prevista-ancora.mjs', modo: APPLY ? 'apply' : 'dry-run', cache: cache.f }
writeFileSync(OUT_PLANO, JSON.stringify({ meta, resumo: { exato, auto: auto.length, rodada_b: humano.length, s4_antes: uniq(s4.antes), s4_depois: uniq(s4.depois) }, auto, rodada_b: humano }, null, 2))
console.log(`\nplano: ${OUT_PLANO}`)

if (!APPLY) { console.log('\n(dry-run — nada gravado. --apply grava SÓ as AUTO.)'); process.exit(0) }

writeFileSync(OUT_RB, JSON.stringify({ meta, rows: auto.map((c) => ({ id: c.id, de: c.de })) }, null, 2))
let updated = 0, errors = 0
const errosDetalhe = []
for (const c of auto) {
  const err = await patch(c.id, { data_prevista: c.para })
  if (err) { errors++; errosDetalhe.push({ id: c.id, unidade: c.unidade, np: c.np, msg: err }) } else updated++
}
const counts = { matched: auto.length, updated, inserted: 0, skipped_idempotent: exato, drift_detected: auto.length + humano.length, drift_corrected: updated, noMatch: semDue, skipped_humano: humano.length, errors }
writeFileSync(OUT_APLIC, JSON.stringify({ meta, counts, drift: auto.map((c) => ({ id: c.id, campo: 'data_prevista', antes: c.de, depois: c.para, motivo: `Sienge dueDate (bill=${c.sienge_bill_id ?? ''} inst=${c.inst})` })), humano_pendente: humano, errors: errosDetalhe }, null, 2))
console.log(`\naplicadas: ${updated} · erros: ${errors} · rollback: ${OUT_RB}`)
