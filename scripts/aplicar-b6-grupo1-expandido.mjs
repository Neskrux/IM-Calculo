// Versao expandida de aplicar-b6-grupo1.mjs — agora generico, sem hard-coding
// de contratos. Le sem_match_amostras do plano amplo e, pra cada venda:
//   1. Descobre max_numero_parcela_sienge lendo income por billId
//   2. Cancela LOCAL pendente cujo numero_parcela > max_sienge
//
// NUNCA cancela status='pago' (defesa em profundidade alem do WHERE).
// Se max_sienge_parcela <= 0 (venda inteira sem match), PULA — caso humano.
//
// Spec: .claude/rules/sincronizacao-sienge.md, .claude/rules/rodadas-b.md
//
// Uso:
//   node scripts/aplicar-b6-grupo1-expandido.mjs          (dry-run)
//   node scripts/aplicar-b6-grupo1-expandido.mjs --apply  (executa)

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const DRY = !process.argv.includes('--apply')
console.log(`Modo: ${DRY ? 'dry-run' : 'apply'}\n`)

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

// 1. Reler cache income pra computar max_sienge por billId
const cacheDir = resolve(process.cwd(), '.sienge-cache')
let income = []
for (const f of readdirSync(cacheDir).filter((f) => f.endsWith('.json'))) {
  try {
    const c = JSON.parse(readFileSync(resolve(cacheDir, f), 'utf8'))
    if (!c.url?.includes('/bulk-data/v1/income')) continue
    const rows = c.data?.results || c.data?.income || c.data?.data || (Array.isArray(c.data) ? c.data : [])
    if (rows.length > 0) { income = rows; break }
  } catch { /* skip */ }
}
const maxParcelaSiengePorBill = new Map()
for (const i of income) {
  if (i.paymentTerm?.id !== 'PM') continue
  const billId = Number(i.billId)
  if (!billId) continue
  const numero = Number(String(i.installmentNumber || '').split('/')[0])
  if (!Number.isFinite(numero) || numero <= 0) continue
  const atual = maxParcelaSiengePorBill.get(billId) || 0
  if (numero > atual) maxParcelaSiengePorBill.set(billId, numero)
}
console.log(`max_parcela_sienge: ${maxParcelaSiengePorBill.size} billIds`)

// 2. Ler plano amplo
const planoFile = readdirSync('docs')
  .filter((f) => f.startsWith('plano-correcao-data-prevista-ampla-') && f.endsWith('.json'))
  .sort()
  .pop()
console.log(`Usando: docs/${planoFile}`)
const plano = JSON.parse(readFileSync(`docs/${planoFile}`, 'utf8'))
const sem_match = plano.sem_match_amostras || []
console.log(`sem_match no plano: ${sem_match.length}`)

// 3. Agrupar por venda
const semMatchPorVenda = new Map()
for (const s of sem_match) {
  if (!semMatchPorVenda.has(s.venda_id)) semMatchPorVenda.set(s.venda_id, [])
  semMatchPorVenda.get(s.venda_id).push(s)
}
console.log(`vendas com sem-match: ${semMatchPorVenda.size}`)

// 4. Pra cada venda, decidir
const planoApply = []
const skipados = []
for (const [vid, arr] of semMatchPorVenda.entries()) {
  const billId = Number(arr[0].bill_id)
  const maxSienge = maxParcelaSiengePorBill.get(billId) || 0
  if (maxSienge === 0) {
    skipados.push({
      venda_id: vid,
      contract: arr[0].contract,
      unidade: arr[0].unidade,
      bill_id: billId,
      motivo: 'venda inteira sem match no Sienge income — REVISAO HUMANA (b6 Grupo 3)',
      total_parcelas_locais: arr.length,
    })
    continue
  }
  // pra cada parcela local sem-match com numero > maxSienge, cancelar (se pendente)
  for (const p of arr) {
    if (p.numero_parcela > maxSienge) {
      // valida no banco que ainda esta pendente
      planoApply.push({
        venda_id: vid,
        contract: arr[0].contract,
        unidade: arr[0].unidade,
        bill_id: billId,
        numero_parcela: p.numero_parcela,
        data_prevista_local: p.data_prevista_local,
        max_sienge: maxSienge,
        status: p.status,
      })
    }
  }
}

console.log(`\nAlvos pra cancelar (num > max_sienge): ${planoApply.length}`)
console.log(`Vendas inteiras sem match (skipadas): ${skipados.length}`)
for (const s of skipados) {
  console.log(`  ⚠️ contrato ${s.contract} (${s.unidade}): ${s.total_parcelas_locais} parcelas locais, bill_id=${s.bill_id}`)
}

// 5. Resolver pagamento_id real e filtrar so pendentes
console.log('\nResolvendo pagamento_id real...')
const finalApply = []
for (const a of planoApply) {
  const { data } = await supa
    .from('pagamentos_prosoluto')
    .select('id, status, tipo, data_prevista')
    .eq('venda_id', a.venda_id)
    .eq('numero_parcela', a.numero_parcela)
    .eq('tipo', 'parcela_entrada')
  for (const p of data || []) {
    if (p.status !== 'pendente') continue
    finalApply.push({
      pagamento_id: p.id,
      ...a,
      data_prevista: p.data_prevista,
    })
  }
}
console.log(`finalApply (pendentes a cancelar): ${finalApply.length}`)

// distribuir por contrato
const porContrato = new Map()
for (const f of finalApply) {
  if (!porContrato.has(f.contract)) porContrato.set(f.contract, 0)
  porContrato.set(f.contract, porContrato.get(f.contract) + 1)
}
for (const [c, n] of porContrato.entries()) console.log(`  contrato ${c}: ${n} parcelas`)

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    spec_ref: '.claude/rules/sincronizacao-sienge.md',
    script: 'scripts/aplicar-b6-grupo1-expandido.mjs',
    modo: DRY ? 'dry-run' : 'apply',
    universo: planoFile,
  },
  counts: { matched: finalApply.length, updated: 0, skipped_idempotent: 0, errors: 0, vendas_revisao_humana: skipados.length },
  drift: [],
  humano_pendente: skipados,
  errors: [],
}

if (DRY) {
  console.log(`\nDry-run apenas. Pra aplicar: --apply`)
  writeFileSync(`docs/aplicacao-b6-g1-expandido-${new Date().toISOString().slice(0, 10)}-dryrun.json`, JSON.stringify(report, null, 2))
  process.exit(0)
}

// APPLY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
let updated = 0
let skipped = 0
let errors = 0
for (const p of finalApply) {
  const url = `${URL}/rest/v1/pagamentos_prosoluto?id=eq.${p.pagamento_id}&status=eq.pendente`
  const body = JSON.stringify({ status: 'cancelado', updated_at: new Date().toISOString() })
  try {
    const res = await fetch(url, { method: 'PATCH', headers: H, body })
    if (!res.ok) {
      report.errors.push({ id: p.pagamento_id, msg: `HTTP ${res.status}` })
      errors++
      continue
    }
    const arr = await res.json()
    if (arr.length === 0) skipped++
    else {
      updated++
      report.drift.push({
        id: p.pagamento_id,
        campo: 'status',
        antes: 'pendente',
        depois: 'cancelado',
        motivo: `parcela extra (gerador antigo, max_sienge=${p.max_sienge}, local_num=${p.numero_parcela}); contrato ${p.contract}`,
      })
    }
  } catch (e) {
    report.errors.push({ id: p.pagamento_id, msg: String(e).slice(0, 200) })
    errors++
  }
}
report.counts.updated = updated
report.counts.skipped_idempotent = skipped
report.counts.errors = errors

const out = `docs/aplicacao-b6-g1-expandido-${new Date().toISOString().slice(0, 10)}.json`
writeFileSync(out, JSON.stringify(report, null, 2))
console.log(`\n=== Aplicacao b6 G1 expandida ===`)
console.log(`  alvo:                   ${finalApply.length}`)
console.log(`  updated:                ${updated}`)
console.log(`  skipped (idemp):        ${skipped}`)
console.log(`  errors:                 ${errors}`)
console.log(`  vendas pra humano:      ${skipados.length}`)
console.log(`Report: ${out}`)
