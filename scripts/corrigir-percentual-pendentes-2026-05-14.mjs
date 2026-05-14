// Corrige percentual_comissao_total + fator_comissao_aplicado + comissao_gerada
// das parcelas PENDENTES com percentual divergente do tipo_corretor.
//
// Escopo: SO parcelas status='pendente'. Parcelas pagas tem comissao_gerada
// imutavel (trigger 017) e correcao retroativa exige decisao de negocio —
// ver docs/percentual-divergente-para-revisao-2026-05-14.md.
//
// Verificacao previa (2026-05-14): as 27 vendas tem venda.tipo_corretor ==
// corretor.tipo_corretor (100%) — o percentual certo e inequivoco.
//   interno -> 6.5%   externo -> 7%
//
// Recalculo (formula canonica, .claude/rules/fator-comissao.md):
//   fator_comissao_aplicado = (valor_venda * pct/100) / valor_pro_soluto
//   comissao_gerada         = valor_parcela * fator_comissao_aplicado
//
// Idempotente: WHERE status=eq.pendente & percentual_comissao_total=eq.{errado}
//
// Uso:
//   node scripts/corrigir-percentual-pendentes-2026-05-14.mjs          (dry-run)
//   node scripts/corrigir-percentual-pendentes-2026-05-14.mjs --apply

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const DRY = !process.argv.includes('--apply')
console.log(`Modo: ${DRY ? 'dry-run' : 'apply'}\n`)

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

const PCT_ESPERADO = { interno: 6.5, externo: 7 }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }

const d = JSON.parse(readFileSync('docs/varredura-percentual-vs-tipo-2026-05-14.json', 'utf8'))
const report = {
  meta: { geradoEm: new Date().toISOString(), modo: DRY ? 'dry-run' : 'apply', spec_ref: '.claude/rules/fator-comissao.md' },
  counts: { matched: 0, updated: 0, skipped: 0, errors: 0 },
  drift: [],
  errors: [],
}

for (const caso of d.casos) {
  if (String(caso.sienge_contract_id) === '80') continue // outlier conhecido (pro_soluto bugado)
  const esperado = PCT_ESPERADO[caso.tipo_corretor]
  if (esperado == null) continue

  // dados da venda pro recalculo
  const { data: v } = await supa
    .from('vendas')
    .select('id, valor_venda, valor_pro_soluto, tipo_corretor, corretor_id')
    .eq('id', caso.venda_id)
    .single()
  if (!v) { report.errors.push({ venda: caso.venda_id, msg: 'venda nao encontrada' }); report.counts.errors++; continue }

  // re-verifica tipo do corretor (defesa)
  if (v.corretor_id) {
    const { data: cor } = await supa.from('usuarios').select('tipo_corretor').eq('id', v.corretor_id).maybeSingle()
    if (cor && cor.tipo_corretor !== v.tipo_corretor) {
      console.log(`  ⚠ ${caso.cliente} (${caso.unidade}): venda.tipo=${v.tipo_corretor} != corretor.tipo=${cor.tipo_corretor} — PULANDO (ambiguo)`)
      report.errors.push({ venda: caso.venda_id, msg: 'tipo venda != tipo corretor — ambiguo' })
      report.counts.errors++
      continue
    }
  }

  const valorVenda = Number(v.valor_venda) || 0
  const proSoluto = Number(v.valor_pro_soluto) || 0
  if (proSoluto <= 0) {
    console.log(`  ⚠ ${caso.cliente} (${caso.unidade}): pro_soluto invalido (${proSoluto}) — PULANDO`)
    report.errors.push({ venda: caso.venda_id, msg: `pro_soluto invalido: ${proSoluto}` })
    report.counts.errors++
    continue
  }
  const fatorCorreto = (valorVenda * (esperado / 100)) / proSoluto

  // parcelas PENDENTES com percentual != esperado
  const { data: pags } = await supa
    .from('pagamentos_prosoluto')
    .select('id, numero_parcela, valor, status, percentual_comissao_total, fator_comissao_aplicado, comissao_gerada')
    .eq('venda_id', v.id)
    .eq('status', 'pendente')
  const erradas = (pags || []).filter(
    (p) => p.percentual_comissao_total != null && Number(p.percentual_comissao_total) !== esperado,
  )
  if (erradas.length === 0) continue

  console.log(`${caso.cliente} (${caso.unidade}) — ${caso.tipo_corretor} ${esperado}% — ${erradas.length} pendente(s) errada(s)`)
  for (const p of erradas) {
    report.counts.matched++
    const comissaoNova = Number((Number(p.valor) * fatorCorreto).toFixed(2))
    const pctErrado = Number(p.percentual_comissao_total)
    if (DRY) {
      console.log(
        `  [dry] parc #${p.numero_parcela} (R$ ${p.valor}): ${pctErrado}% -> ${esperado}% | ` +
          `comissao ${p.comissao_gerada} -> ${comissaoNova} | fator ${p.fator_comissao_aplicado} -> ${fatorCorreto.toFixed(6)}`,
      )
      continue
    }
    // APPLY — WHERE garante idempotencia (status pendente + pct errado)
    const url =
      `${URL}/rest/v1/pagamentos_prosoluto` +
      `?id=eq.${p.id}&status=eq.pendente&percentual_comissao_total=eq.${pctErrado}`
    const body = JSON.stringify({
      percentual_comissao_total: esperado,
      fator_comissao_aplicado: Number(fatorCorreto.toFixed(6)),
      comissao_gerada: comissaoNova,
      updated_at: new Date().toISOString(),
    })
    const res = await fetch(url, { method: 'PATCH', headers: H, body })
    if (!res.ok) {
      const txt = await res.text()
      console.log(`  ✗ parc #${p.numero_parcela} HTTP ${res.status}: ${txt.slice(0, 120)}`)
      report.errors.push({ id: p.id, msg: `HTTP ${res.status}` })
      report.counts.errors++
      continue
    }
    const arr = await res.json()
    if (arr.length > 0) {
      console.log(`  ✓ parc #${p.numero_parcela}: ${pctErrado}% -> ${esperado}% | comissao ${p.comissao_gerada} -> ${comissaoNova}`)
      report.counts.updated++
      report.drift.push({
        id: p.id, campo: 'percentual_comissao_total', antes: pctErrado, depois: esperado,
        comissao_antes: p.comissao_gerada, comissao_depois: comissaoNova,
        motivo: `pendente com percentual errado vs tipo_corretor=${caso.tipo_corretor}; verificado contra corretor.tipo_corretor`,
      })
    } else {
      console.log(`  - parc #${p.numero_parcela} ja corrigido (idempotente)`)
      report.counts.skipped++
    }
  }
}

console.log(`\n=== Resumo ===`)
console.log(`  matched: ${report.counts.matched} | updated: ${report.counts.updated} | skipped: ${report.counts.skipped} | errors: ${report.counts.errors}`)
if (!DRY) {
  const out = `docs/aplicacao-percentual-pendentes-${new Date().toISOString().slice(0, 10)}.json`
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(`Report: ${out}`)
} else {
  console.log('\nDry-run apenas. Pra aplicar: --apply')
}
