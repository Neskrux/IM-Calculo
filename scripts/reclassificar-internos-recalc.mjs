// Reclassifica vendas e pagamentos pendentes dos 5 corretores que foram
// alterados de externo->interno em usuarios hoje 13/05/2026, mas cujas vendas
// ficaram com tipo_corretor='externo'.
//
// Politica (ver .claude/rules/sincronizacao-sienge.md):
//  - vendas: UPDATE tipo_corretor='interno' + fator_comissao novo (com %interno)
//  - pagamentos PENDENTES: UPDATE comissao_gerada, fator_comissao_aplicado,
//    percentual_comissao_total (recalculados pra interno)
//  - pagamentos PAGOS: NAO TOCAR — preserva historico financeiro real
//    (controladoria decide se estorna a diferenca depois).
//
// Trigger 017 ja blinda tipo/valor/comissao_gerada em pago — script erra cedo
// se tentar atualizar.
//
// Uso: node scripts/reclassificar-internos-recalc.mjs [--apply]
// Sem --apply, roda em dry-run.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const APPLY = process.argv.includes('--apply')

const CORRETORES_IDS = [
  // os 5 reclassificados hoje 13/05 18:22-18:24 com origem=sienge
  // mas vendas continuam tipo_corretor=externo
]
// Resolve por sienge_broker_id pra ser mais resiliente
const SIENGE_BROKERS = ['264', '157', '133', '143', '122']

console.log(`MODO: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)

// Carregar corretores
const { data: corretores } = await supa
  .from('usuarios')
  .select('id, nome, sienge_broker_id, tipo_corretor')
  .in('sienge_broker_id', SIENGE_BROKERS)
console.log(`\nCorretores resolvidos: ${corretores.length}`)
for (const c of corretores) console.log(`  ${c.nome} (broker=${c.sienge_broker_id})`)

// Carregar empreendimentos (precisa do %interno)
const { data: emps } = await supa
  .from('empreendimentos')
  .select('id, nome, comissao_total_interno, comissao_total_externo')
const empById = new Map((emps || []).map(e => [e.id, e]))

const relatorio = { vendas_atualizadas: 0, pagamentos_pendentes_atualizados: 0, pagos_preservados: 0, erros: 0, divergencias: [] }

for (const c of corretores) {
  console.log(`\n=== ${c.nome} (id=${c.id}, broker=${c.sienge_broker_id}) ===`)
  const { data: vendas } = await supa
    .from('vendas')
    .select('id, sienge_contract_id, tipo_corretor, valor_venda, valor_pro_soluto, fator_comissao, empreendimento_id')
    .eq('corretor_id', c.id)
    .or('excluido.eq.false,excluido.is.null')

  for (const v of vendas || []) {
    const emp = empById.get(v.empreendimento_id)
    if (!emp) { console.log(`  ⚠️ contract=${v.sienge_contract_id} sem empreendimento — skip`); continue }
    const percentualInterno = parseFloat(emp.comissao_total_interno) || 0
    const valorVenda = parseFloat(v.valor_venda) || 0
    const valorProSoluto = parseFloat(v.valor_pro_soluto) || 0
    if (valorProSoluto <= 0) { console.log(`  ⚠️ contract=${v.sienge_contract_id} sem pro_soluto — skip`); continue }
    const fatorNovo = (valorVenda * percentualInterno / 100) / valorProSoluto
    const fatorAntigo = parseFloat(v.fator_comissao) || 0

    console.log(`  contract=${v.sienge_contract_id}  ${emp.nome}  %ext=${emp.comissao_total_externo} %int=${percentualInterno}`)
    console.log(`    fator: ${fatorAntigo.toFixed(6)} -> ${fatorNovo.toFixed(6)}  (tipo_corretor=${v.tipo_corretor} -> interno)`)

    // Pagamentos
    const { data: pags } = await supa
      .from('pagamentos_prosoluto')
      .select('id, status, valor, comissao_gerada, fator_comissao_aplicado, percentual_comissao_total, numero_parcela, tipo')
      .eq('venda_id', v.id)
    const pagos = pags.filter(p => p.status === 'pago')
    const pendentes = pags.filter(p => p.status === 'pendente')
    const somaPendenteAntes = pendentes.reduce((s,p) => s + (parseFloat(p.comissao_gerada) || 0), 0)
    const somaPendenteDepois = pendentes.reduce((s,p) => s + (parseFloat(p.valor) || 0) * fatorNovo, 0)
    const delta = somaPendenteDepois - somaPendenteAntes
    console.log(`    pendentes: ${pendentes.length}  comissao antes=R$ ${somaPendenteAntes.toFixed(2)}  depois=R$ ${somaPendenteDepois.toFixed(2)}  delta=R$ ${delta.toFixed(2)}`)
    console.log(`    pagos (preservados): ${pagos.length}`)
    relatorio.divergencias.push({ corretor: c.nome, contract: v.sienge_contract_id, delta })

    if (!APPLY) continue

    // Aplicar — venda
    const { error: errV } = await supa
      .from('vendas')
      .update({ tipo_corretor: 'interno', fator_comissao: fatorNovo })
      .eq('id', v.id)
    if (errV) { console.log(`    ❌ erro vendas: ${errV.message}`); relatorio.erros++; continue }
    relatorio.vendas_atualizadas++

    // Aplicar — pagamentos pendentes
    for (const p of pendentes) {
      const valor = parseFloat(p.valor) || 0
      const comissaoNova = valor * fatorNovo
      const { error: errP } = await supa
        .from('pagamentos_prosoluto')
        .update({
          comissao_gerada: comissaoNova,
          fator_comissao_aplicado: fatorNovo,
          percentual_comissao_total: percentualInterno,
        })
        .eq('id', p.id)
      if (errP) { console.log(`    ❌ erro pagamento ${p.id}: ${errP.message}`); relatorio.erros++; continue }
      relatorio.pagamentos_pendentes_atualizados++
    }
    relatorio.pagos_preservados += pagos.length
  }
}

console.log('\n=== RELATORIO ===')
console.log(JSON.stringify(relatorio, null, 2))
if (!APPLY) console.log('\n(dry-run — nada foi alterado. Rode com --apply pra executar.)')
