// Cura de distrato — DRY-RUN (read-only). North Star #3, fase F2 / D2.
//
// Backfill da data_distrato a partir de docs/contexto/2026-06-05-mapa-3-termos.json
// (cada caso tem banco_venda_id + dataDistrato — match 1:1, sem fuzzy) e identifica,
// por contrato, as baixas PoS-distrato a cancelar (paymentDate >= data_distrato),
// preservando as pagas PRE-distrato (reais).
//
// READ-ONLY: so monta o plano. NAO escreve. O apply (gated) faz o two-step
// pago->pendente(data=NULL)->cancelado(motivo='distrato') (trigger 020).
// ver .claude/rules/sincronizacao-sienge.md (distrato: so pre-distrato e real)
//
// Uso: node scripts/curar-distrato-dryrun.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const FIGUEIRA = '0d7d01f4-c398-4d9a-a280-13f44c957279'
const PAGE = 1000
const env = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const get = (k) => process.env[k] || env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const supa = createClient(get('VITE_SUPABASE_URL'), get('VITE_SUPABASE_ANON_KEY'))
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const d10 = (x) => (x ? String(x).slice(0, 10) : null)

// 1. datas do mapa por venda_id
const mapa = JSON.parse(readFileSync('docs/contexto/2026-06-05-mapa-3-termos.json', 'utf8'))
const dataMapa = new Map()
for (const c of mapa.distrato?.casos || []) {
  if (c.banco_venda_id && c.dataDistrato) dataMapa.set(c.banco_venda_id, d10(c.dataDistrato))
}
console.log(`mapa: ${dataMapa.size} distratos com data + venda_id`)

// 2. vendas distrato (situacao=3)
const vendas = []
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supa.from('vendas')
    .select('id, sienge_contract_id, unidade, data_distrato, status')
    .eq('empreendimento_id', FIGUEIRA).eq('excluido', false).eq('situacao_contrato', '3').range(from, from + PAGE - 1)
  if (error) { console.error(error); process.exit(1) }
  if (!data?.length) break
  vendas.push(...data); if (data.length < PAGE) break
}
console.log(`vendas distrato (situacao=3): ${vendas.length}`)

// 3. parcelas PAGAS dessas vendas
const ids = vendas.map((v) => v.id)
const pagasPorVenda = new Map()
for (let i = 0; i < ids.length; i += 50) {
  const chunk = ids.slice(i, i + 50)
  for (let f = 0; ; f += PAGE) {
    const { data } = await supa.from('pagamentos_prosoluto')
      .select('id, venda_id, numero_parcela, tipo, valor, comissao_gerada, data_pagamento, status, motivo_cancelamento_parcela')
      .in('venda_id', chunk).eq('status', 'pago').order('id').range(f, f + PAGE - 1)
    if (!data?.length) break
    for (const p of data) { if (!pagasPorVenda.has(p.venda_id)) pagasPorVenda.set(p.venda_id, []); pagasPorVenda.get(p.venda_id).push(p) }
    if (data.length < PAGE) break
  }
}

// 4. montar plano
const plano = []          // por venda: o que cancelar / manter
const sem_data = []       // venda distrato sem data (db nem mapa) -> nao cura
const cancelar_ids = []   // flat: parcela_ids a cancelar (input do apply)
for (const v of vendas) {
  const dd = d10(v.data_distrato) || dataMapa.get(v.id) || null
  const fonte = v.data_distrato ? 'db' : (dataMapa.get(v.id) ? 'mapa' : null)
  const pagas = pagasPorVenda.get(v.id) || []
  if (!dd) { sem_data.push({ venda_id: v.id, contrato: v.sienge_contract_id, unidade: v.unidade, pagas: pagas.length }); continue }
  const pos = pagas.filter((p) => d10(p.data_pagamento) >= dd) // baixa falsa
  const pre = pagas.filter((p) => d10(p.data_pagamento) < dd)  // real
  for (const p of pos) cancelar_ids.push(p.id)
  plano.push({
    venda_id: v.id, contrato: v.sienge_contract_id, unidade: v.unidade, data_distrato: dd, fonte_data: fonte,
    venda_status_atual: v.status,
    cancelar: pos.length, comissao_falsa: round2(pos.reduce((s, p) => s + (p.comissao_gerada || 0), 0)),
    manter_pre_distrato: pre.length, comissao_real_preservada: round2(pre.reduce((s, p) => s + (p.comissao_gerada || 0), 0)),
    pos_datas: [...new Set(pos.map((p) => d10(p.data_pagamento)))].sort(),
    pre_datas: [...new Set(pre.map((p) => d10(p.data_pagamento)))].sort(),
  })
}

const totalCancelar = plano.reduce((s, x) => s + x.cancelar, 0)
const totalComissaoFalsa = round2(plano.reduce((s, x) => s + x.comissao_falsa, 0))
const totalPreservar = plano.reduce((s, x) => s + x.manter_pre_distrato, 0)
const out = {
  meta: { geradoEm: new Date().toISOString(), spec_ref: '.claude/rules/sincronizacao-sienge.md',
    doc_ref: 'docs/contexto/2026-06-10-north-star-3-ancora-correta.md (F2)', script: 'scripts/curar-distrato-dryrun.mjs',
    modo: 'DRY-RUN (read-only)', regra: 'cancelar baixa paymentDate >= data_distrato; preservar pre-distrato' },
  counts: { vendas_distrato: vendas.length, vendas_curaveis: plano.length, vendas_sem_data: sem_data.length,
    parcelas_a_cancelar: totalCancelar, parcelas_pre_preservadas: totalPreservar },
  comissao_falsa_a_remover: totalComissaoFalsa,
  plano: plano.sort((a, b) => b.comissao_falsa - a.comissao_falsa),
  sem_data,
  cancelar_parcela_ids: cancelar_ids,
}
mkdirSync('docs/auditorias/2026-06-10-distrato', { recursive: true })
writeFileSync('docs/auditorias/2026-06-10-distrato/cura-distrato-dryrun.json', JSON.stringify(out, null, 2))

console.log('\n============ DRY-RUN CURA DE DISTRATO ============')
console.log(`  vendas distrato: ${vendas.length}  |  curaveis (com data): ${plano.length}  |  SEM data: ${sem_data.length}`)
console.log(`  >>> baixas falsas a CANCELAR: ${totalCancelar} parcelas  ->  R$ ${totalComissaoFalsa} comissao falsa`)
console.log(`  >>> pre-distrato PRESERVADAS: ${totalPreservar} parcelas (reais, intactas)`)
console.log('\n  por contrato (top 30):')
for (const x of out.plano.slice(0, 30)) console.log(`    c${x.contrato} ${(x.unidade||'').padEnd(7)} distrato ${x.data_distrato} (${x.fonte_data}) | cancelar ${String(x.cancelar).padStart(2)} (R$${x.comissao_falsa}) | manter ${x.manter_pre_distrato}`)
if (sem_data.length) { console.log(`\n  ⚠️ SEM data (nao cura ate ter a data):`); for (const s of sem_data) console.log(`    c${s.contrato} ${s.unidade} (${s.pagas} pagas)`) }
console.log(`\nSalvo: docs/auditorias/2026-06-10-distrato/cura-distrato-dryrun.json`)
