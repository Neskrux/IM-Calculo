// Corrige os casos reportados pela administracao em 2026-05-21.
//
// Politica:
// - vendas: atualiza tipo/fator/valor-base quando a decisao de negocio e explicita;
// - pagamentos pendentes: recalcula comissao_gerada pelo fator canonico corrigido;
// - pagamentos pagos: preserva comissao_gerada; registra diferenca para acerto humano.
//
// ver .claude/rules/fator-comissao.md
// ver .claude/rules/sincronizacao-sienge.md
//
// Uso:
//   node scripts/corrigir-comissoes-reportadas-2026-05-21.mjs
//   node scripts/corrigir-comissoes-reportadas-2026-05-21.mjs --apply

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const DATA = new Date().toISOString().slice(0, 10)

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const env = Object.fromEntries(
  envFile
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)

const URL = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL
const KEY = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
const supa = createClient(URL, KEY)

const TARGETS = [
  {
    contractId: '390',
    motivo: 'ERICA FAERBER: corretora reclassificada como interna; venda ainda estava externa',
    tipoCorretor: 'interno',
    protegerOrigemManual: true,
  },
  {
    contractId: '314',
    motivo: 'FRANCISCO ASSIS / MATHEUS 408 A: fator do corretor deve ser 20.08%',
    tipoCorretor: 'externo',
    fatorCorretorPercentual: 20.08,
    protegerOrigemManual: true,
  },
  {
    contractId: '254',
    motivo: 'GABRIEL LUZ / JACKSON 1404 C: fator do corretor deve ser 22%',
    tipoCorretor: 'externo',
    fatorCorretorPercentual: 22,
    protegerOrigemManual: true,
  },
]

function n(v) {
  return Number(v ?? 0)
}

function round2(v) {
  return Number(n(v).toFixed(2))
}

function round6(v) {
  return Number(n(v).toFixed(6))
}

function close(a, b, eps = 0.005) {
  return Math.abs(n(a) - n(b)) <= eps
}

function fmt(v) {
  return n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    modo: APPLY ? 'apply' : 'dry-run',
    script: 'scripts/corrigir-comissoes-reportadas-2026-05-21.mjs',
    spec_ref: '.claude/rules/fator-comissao.md + .claude/rules/sincronizacao-sienge.md',
  },
  counts: {
    vendas_matched: 0,
    vendas_updated: 0,
    pagamentos_pendentes_matched: 0,
    pagamentos_pendentes_updated: 0,
    skipped_idempotent: 0,
    pagos_preservados: 0,
    errors: 0,
  },
  drift: [],
  humano_pendente: [],
  errors: [],
}

console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`)

const { data: cargos, error: cargosErr } = await supa
  .from('cargos_empreendimento')
  .select('id, empreendimento_id, nome_cargo, tipo_corretor, percentual')
if (cargosErr) throw cargosErr

for (const target of TARGETS) {
  console.log(`\n=== Contrato ${target.contractId} ===`)

  const { data: venda, error: vendaErr } = await supa
    .from('vendas')
    .select('id, sienge_contract_id, numero_contrato, unidade, valor_venda, valor_venda_total, valor_pro_soluto, fator_comissao, comissao_total, tipo_corretor, corretor_id, corretor_id_origem, cliente_id, empreendimento_id, excluido')
    .eq('sienge_contract_id', target.contractId)
    .or('excluido.eq.false,excluido.is.null')
    .maybeSingle()

  if (vendaErr || !venda) {
    const msg = vendaErr?.message || 'venda ativa nao encontrada'
    console.log(`  ERRO: ${msg}`)
    report.errors.push({ contractId: target.contractId, msg })
    report.counts.errors++
    continue
  }
  report.counts.vendas_matched++

  const [{ data: emp }, { data: corretor }, { data: cliente }, { data: pagamentos, error: pagErr }] =
    await Promise.all([
      supa.from('empreendimentos').select('id, nome, comissao_total_externo, comissao_total_interno').eq('id', venda.empreendimento_id).maybeSingle(),
      supa.from('usuarios').select('id, nome, tipo_corretor, imobiliaria, sienge_broker_id').eq('id', venda.corretor_id).maybeSingle(),
      supa.from('clientes').select('id, nome_completo').eq('id', venda.cliente_id).maybeSingle(),
      supa
        .from('pagamentos_prosoluto')
        .select('id, tipo, numero_parcela, status, valor, comissao_gerada, fator_comissao_aplicado, percentual_comissao_total')
        .eq('venda_id', venda.id)
        .neq('status', 'cancelado'),
    ])

  if (pagErr) {
    console.log(`  ERRO pagamentos: ${pagErr.message}`)
    report.errors.push({ venda_id: venda.id, msg: pagErr.message })
    report.counts.errors++
    continue
  }

  const tipoFinal = target.tipoCorretor || venda.tipo_corretor || 'externo'
  const percentualTotal =
    tipoFinal === 'interno'
      ? n(emp?.comissao_total_interno || 6.5)
      : n(emp?.comissao_total_externo || 7)

  const cargoCorretor = cargos.find(
    (c) =>
      c.empreendimento_id === venda.empreendimento_id &&
      c.tipo_corretor === tipoFinal &&
      /corretor/i.test(c.nome_cargo || ''),
  )
  const percentualCorretor = n(cargoCorretor?.percentual)
  if (!percentualTotal || !percentualCorretor || !n(venda.valor_pro_soluto)) {
    const msg = `base invalida: percentualTotal=${percentualTotal}, percentualCorretor=${percentualCorretor}, proSoluto=${venda.valor_pro_soluto}`
    console.log(`  ERRO: ${msg}`)
    report.errors.push({ venda_id: venda.id, msg })
    report.counts.errors++
    continue
  }

  const fatorTotal =
    target.fatorCorretorPercentual != null
      ? (target.fatorCorretorPercentual / 100) * (percentualTotal / percentualCorretor)
      : (n(venda.valor_venda) * (percentualTotal / 100)) / n(venda.valor_pro_soluto)
  const valorVendaCanonico = round2((fatorTotal * n(venda.valor_pro_soluto)) / (percentualTotal / 100))

  const pendentes = (pagamentos || []).filter((p) => p.status === 'pendente')
  const pagos = (pagamentos || []).filter((p) => p.status === 'pago')
  const somaAtual = (pagamentos || []).reduce((s, p) => s + n(p.comissao_gerada), 0)
  const somaPendenteAtual = pendentes.reduce((s, p) => s + n(p.comissao_gerada), 0)
  const somaPendenteNova = pendentes.reduce((s, p) => s + round2(n(p.valor) * fatorTotal), 0)
  const deltaPagos = pagos.reduce((s, p) => s + (round2(n(p.valor) * fatorTotal) - n(p.comissao_gerada)), 0)

  console.log(`  ${cliente?.nome_completo || '-'} | ${corretor?.nome || '-'} | unidade ${venda.unidade}`)
  console.log(`  tipo: ${venda.tipo_corretor} -> ${tipoFinal}; origem: ${venda.corretor_id_origem || '-'}${target.protegerOrigemManual ? ' -> manual' : ''}`)
  console.log(`  fator total: ${(n(venda.fator_comissao) * 100).toFixed(4)}% -> ${(fatorTotal * 100).toFixed(4)}%`)
  console.log(`  fator corretor: ${((n(venda.fator_comissao) * percentualCorretor / percentualTotal) * 100).toFixed(4)}% -> ${target.fatorCorretorPercentual ?? ((fatorTotal * percentualCorretor / percentualTotal) * 100).toFixed(4)}%`)
  console.log(`  valor venda: R$ ${fmt(venda.valor_venda)} -> R$ ${fmt(valorVendaCanonico)}`)
  console.log(`  pendentes: ${pendentes.length}; comissao pendente R$ ${fmt(somaPendenteAtual)} -> R$ ${fmt(somaPendenteNova)}`)
  console.log(`  pagos preservados: ${pagos.length}; diferenca teorica em pagos R$ ${fmt(deltaPagos)}`)

  const vendaPatch = {
    tipo_corretor: tipoFinal,
    valor_venda: valorVendaCanonico,
    valor_venda_total: valorVendaCanonico,
    fator_comissao: round6(fatorTotal),
    updated_at: new Date().toISOString(),
  }
  if (target.protegerOrigemManual) vendaPatch.corretor_id_origem = 'manual'

  const vendaJaOk =
    venda.tipo_corretor === vendaPatch.tipo_corretor &&
    close(venda.valor_venda, vendaPatch.valor_venda) &&
    close(venda.valor_venda_total, vendaPatch.valor_venda_total) &&
    close(venda.fator_comissao, vendaPatch.fator_comissao, 0.000001) &&
    (!target.protegerOrigemManual || venda.corretor_id_origem === 'manual')

  if (!vendaJaOk) {
    report.drift.push({
      venda_id: venda.id,
      contrato: target.contractId,
      campo: 'vendas',
      antes: {
        tipo_corretor: venda.tipo_corretor,
        valor_venda: venda.valor_venda,
        valor_venda_total: venda.valor_venda_total,
        fator_comissao: venda.fator_comissao,
        corretor_id_origem: venda.corretor_id_origem,
      },
      depois: vendaPatch,
      motivo: target.motivo,
    })

    if (APPLY) {
      const { error: updVendaErr } = await supa.from('vendas').update(vendaPatch).eq('id', venda.id)
      if (updVendaErr) {
        console.log(`  ERRO update venda: ${updVendaErr.message}`)
        report.errors.push({ venda_id: venda.id, msg: updVendaErr.message })
        report.counts.errors++
        continue
      }
      report.counts.vendas_updated++
    }
  } else {
    report.counts.skipped_idempotent++
  }

  for (const p of pendentes) {
    report.counts.pagamentos_pendentes_matched++
    const comissaoNova = round2(n(p.valor) * fatorTotal)
    const patch = {
      comissao_gerada: comissaoNova,
      fator_comissao_aplicado: round6(fatorTotal),
      percentual_comissao_total: percentualTotal,
      updated_at: new Date().toISOString(),
    }

    const jaOk =
      close(p.comissao_gerada, patch.comissao_gerada) &&
      close(p.fator_comissao_aplicado, patch.fator_comissao_aplicado, 0.000001) &&
      close(p.percentual_comissao_total, patch.percentual_comissao_total, 0.000001)

    if (jaOk) {
      report.counts.skipped_idempotent++
      continue
    }

    report.drift.push({
      id: p.id,
      venda_id: venda.id,
      contrato: target.contractId,
      parcela: p.numero_parcela,
      status: p.status,
      campo: 'pagamentos_prosoluto',
      antes: {
        comissao_gerada: p.comissao_gerada,
        fator_comissao_aplicado: p.fator_comissao_aplicado,
        percentual_comissao_total: p.percentual_comissao_total,
      },
      depois: patch,
      motivo: `${target.motivo}; parcela pendente recalculada pela formula canonica`,
    })

    if (!APPLY) continue

    const { error: updPagErr } = await supa
      .from('pagamentos_prosoluto')
      .update(patch)
      .eq('id', p.id)
      .eq('status', 'pendente')
    if (updPagErr) {
      console.log(`  ERRO pagamento ${p.id}: ${updPagErr.message}`)
      report.errors.push({ id: p.id, msg: updPagErr.message })
      report.counts.errors++
      continue
    }
    report.counts.pagamentos_pendentes_updated++
  }

  report.counts.pagos_preservados += pagos.length
  if (pagos.length > 0 && Math.abs(deltaPagos) > 0.01) {
    report.humano_pendente.push({
      venda_id: venda.id,
      contrato: target.contractId,
      cliente: cliente?.nome_completo || null,
      corretor: corretor?.nome || null,
      pagos_preservados: pagos.length,
      diferenca_teorica_pagos: round2(deltaPagos),
      motivo: 'pagamentos status=pago preservam comissao_gerada; eventual acerto deve ser decidido pela controladoria',
    })
  }

  if (APPLY) {
    const { data: linhasAtualizadas } = await supa
      .from('pagamentos_prosoluto')
      .select('comissao_gerada, status')
      .eq('venda_id', venda.id)
      .neq('status', 'cancelado')
    const novaComissaoTotal = round2((linhasAtualizadas || []).reduce((s, p) => s + n(p.comissao_gerada), 0))
    await supa.from('vendas').update({ comissao_total: novaComissaoTotal }).eq('id', venda.id)
  } else {
    const novaComissaoTotal = round2(somaAtual - somaPendenteAtual + somaPendenteNova)
    console.log(`  comissao total apos pendentes: R$ ${fmt(somaAtual)} -> R$ ${fmt(novaComissaoTotal)}`)
  }
}

console.log('\n=== Resumo ===')
console.log(JSON.stringify(report.counts, null, 2))
if (report.humano_pendente.length > 0) {
  console.log('\nPagos preservados com acerto humano pendente:')
  for (const h of report.humano_pendente) {
    console.log(`  contrato ${h.contrato}: ${h.pagos_preservados} pago(s), diferenca teorica R$ ${fmt(h.diferenca_teorica_pagos)}`)
  }
}

if (APPLY) {
  const out = `docs/aplicacao-comissoes-reportadas-${DATA}.json`
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(`\nReport: ${out}`)
} else {
  console.log('\nDry-run apenas. Use --apply para aplicar.')
}
