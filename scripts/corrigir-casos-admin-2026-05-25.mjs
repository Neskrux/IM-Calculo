// Correcao cirurgica dos casos reportados pela administracao em 2026-05-25.
//
// Casos:
// - 1603 A / contrato 163: grade local tinha duplicidades ativas e parcelas
//   deslocadas. Reconstroi a grade pelo income Sienge do bill 235.
// - 1804 A / contrato 320: venda correta e a do Sienge, mas veio no corretor
//   Adriana. Reatribui para Matheus, recalcula como interno e exclui as duas
//   vendas locais duplicadas sem contrato Sienge.
// - 905 A / contrato 80: venda estava interna, mas com valor_pro_soluto igual
//   ao valor de venda, deixando fator/comissoes errados. Reconstroi pelo bill
//   272 e corrige a base do pro-soluto.
//
// Politica:
// - Sienge income e a fonte da verdade para data, status e valor das parcelas.
// - Nao faz DELETE.
// - Para linhas antigas com status=pago que precisam sair da visao ativa,
//   usa o fluxo explicito permitido: pago -> pendente + data_pagamento=null;
//   em seguida status=cancelado.
// - Novas linhas sao inseridas com snapshot canonico de fator/comissao.
//
// Uso:
//   node scripts/corrigir-casos-admin-2026-05-25.mjs
//   node scripts/corrigir-casos-admin-2026-05-25.mjs --apply

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { siengeGet, extractRows } from './_sienge-http.mjs'

const APPLY = process.argv.includes('--apply')
const DATA = new Date().toISOString().slice(0, 10)
const SCRIPT = 'scripts/corrigir-casos-admin-2026-05-25.mjs'
const FIGUEIRA_ID = '0d7d01f4-c398-4d9a-a280-13f44c957279'
const EXCLUIDO_POR = 'c8cff026-b79f-41e1-a9c1-93547d484758'

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
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY
if (!URL || !KEY) {
  console.error('faltando VITE_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY/VITE_SUPABASE_ANON_KEY')
  process.exit(1)
}

const supa = createClient(URL, KEY, { auth: { persistSession: false } })

const CASOS_REBUILD = [
  {
    label: '1603 A / Diogo / contrato 163',
    vendaId: '7c3ca9b3-8251-469b-ae71-5f8a433a6d3e',
    contractId: '163',
    billId: 235,
    tipoCorretor: 'interno',
    protegerOrigemManual: false,
    motivo: 'grade local com parcelas duplicadas/deslocadas; Sienge bill 235 e fonte da verdade',
  },
  {
    label: '1804 A / Giovane / contrato 320',
    vendaId: '556ddcf8-acd6-4cb3-bbc3-084d90850026',
    contractId: '320',
    billId: 232,
    tipoCorretor: 'interno',
    corretorOrigemVendaId: 'ac644733-d731-44e5-8573-99b9231e90a8',
    protegerOrigemManual: true,
    motivo: 'venda Sienge correta reatribuida para o corretor Matheus e recalculada como interno',
  },
  {
    label: '905 A / Tayara / contrato 80',
    vendaId: '8daa3121-fcfa-42fa-8318-8e39fdac8800',
    contractId: '80',
    billId: 272,
    tipoCorretor: 'interno',
    protegerOrigemManual: true,
    motivo: 'valor_pro_soluto estava igual ao valor de venda; recalculo pela base real do Sienge',
  },
]

const VENDAS_DUPLICADAS_PARA_EXCLUIR = [
  {
    vendaId: 'ac644733-d731-44e5-8573-99b9231e90a8',
    preservadaId: '556ddcf8-acd6-4cb3-bbc3-084d90850026',
    motivo: 'duplicata local sem contrato Sienge; contrato 320 preservado e reatribuido para Matheus',
  },
  {
    vendaId: '9d279176-e4de-4e3f-8ec2-9aa4b6c7f62a',
    preservadaId: '556ddcf8-acd6-4cb3-bbc3-084d90850026',
    motivo: 'duplicata local sem contrato Sienge; contrato 320 preservado e reatribuido para Matheus',
  },
]

const MAPA_TIPO = {
  PM: 'parcela_entrada',
  SN: 'sinal',
  AT: 'sinal',
  BA: 'balao',
  B1: 'balao',
  B2: 'balao',
  B3: 'balao',
  B4: 'balao',
  B5: 'balao',
  B6: 'balao',
  B7: 'balao',
  B8: 'balao',
}

function n(v) {
  return Number(v || 0)
}

function round2(v) {
  return Number(n(v).toFixed(2))
}

function round6(v) {
  return Number(n(v).toFixed(6))
}

function money(v) {
  return n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function tipoInterno(row) {
  return MAPA_TIPO[row.paymentTerm?.id] || null
}

function dataPagamento(row) {
  return row.paymentDate || row.receipts?.find((r) => r?.paymentDate)?.paymentDate || null
}

function isPagoSienge(row) {
  const pago = dataPagamento(row)
  const recebido = (row.receipts || []).reduce((s, r) => s + n(r.netAmount || r.grossAmount || r.amount), 0)
  return !!pago && (recebido > 0 || n(row.balanceAmount) === 0)
}

function canonicalKey(row) {
  return [
    row.tipo,
    row.numero_parcela ?? '',
    money(row.valor),
    row.status,
    row.data_prevista || '',
    row.data_pagamento || '',
    row.sienge_installment_id || '',
    money(row.comissao_gerada),
    String(row.fator_comissao_aplicado ?? ''),
    String(row.percentual_comissao_total ?? ''),
  ].join('|')
}

async function buscarVenda(id) {
  const { data, error } = await supa
    .from('vendas')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) throw new Error(error?.message || `venda nao encontrada: ${id}`)
  return data
}

async function buscarPagamentos(vendaId) {
  const { data, error } = await supa
    .from('pagamentos_prosoluto')
    .select('*')
    .eq('venda_id', vendaId)
    .order('data_prevista', { ascending: true })
    .order('numero_parcela', { ascending: true, nullsFirst: true })
  if (error) throw error
  return data || []
}

async function reverterPagos(ids, report, etapa) {
  if (!ids.length) return 0
  if (!APPLY) return ids.length
  const { data, error } = await supa
    .from('pagamentos_prosoluto')
    .update({ status: 'pendente', data_pagamento: null, updated_at: new Date().toISOString() })
    .in('id', ids)
    .eq('status', 'pago')
    .select('id')
  if (error) {
    report.errors.push({ etapa, step: 'reverter_pagos', ids, msg: error.message })
    return 0
  }
  return data?.length || 0
}

async function cancelarAtivos(ids, report, etapa) {
  if (!ids.length) return 0
  if (!APPLY) return ids.length
  const { data, error } = await supa
    .from('pagamentos_prosoluto')
    .update({ status: 'cancelado', updated_at: new Date().toISOString() })
    .in('id', ids)
    .neq('status', 'cancelado')
    .select('id')
  if (error) {
    report.errors.push({ etapa, step: 'cancelar_ativos', ids, msg: error.message })
    return 0
  }
  return data?.length || 0
}

async function limparAnchorsCancelados(vendaId, report, etapa) {
  if (!APPLY) return 0
  const { data, error } = await supa
    .from('pagamentos_prosoluto')
    .update({ sienge_bill_id: null, sienge_installment_id: null, updated_at: new Date().toISOString() })
    .eq('venda_id', vendaId)
    .eq('status', 'cancelado')
    .not('sienge_installment_id', 'is', null)
    .select('id')
  if (error) {
    report.errors.push({ etapa, step: 'limpar_anchors_cancelados', venda_id: vendaId, msg: error.message })
    return 0
  }
  return data?.length || 0
}

function montarGradeCanonica({ venda, billRows, tipoCorretor, corretorId }) {
  const relevantes = billRows
    .map((row) => ({ ...row, _tipoInterno: tipoInterno(row) }))
    .filter((row) => row._tipoInterno)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || n(a.installmentId) - n(b.installmentId))

  const valorProSoluto = round2(relevantes.reduce((sum, row) => sum + n(row.originalAmount), 0))
  const percentualTotal = tipoCorretor === 'interno' ? 6.5 : 7
  const fator = round6((n(venda.valor_venda) * (percentualTotal / 100)) / valorProSoluto)
  let numeroParcela = 0

  const pagamentos = relevantes.map((row) => {
    const tipo = row._tipoInterno
    const status = isPagoSienge(row) ? 'pago' : 'pendente'
    const valor = round2(row.originalAmount)
    if (tipo === 'parcela_entrada') numeroParcela += 1
    return {
      venda_id: venda.id,
      numero_parcela: tipo === 'parcela_entrada' ? numeroParcela : null,
      tipo,
      valor,
      data_prevista: row.dueDate,
      status,
      data_pagamento: status === 'pago' ? dataPagamento(row) : null,
      comissao_gerada: round2(valor * fator),
      fator_comissao_aplicado: fator,
      percentual_comissao_total: percentualTotal,
      sienge_bill_id: Number(row.billId),
      sienge_installment_id: String(row.installmentId ?? row.installmentNumber ?? ''),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  })

  const comissaoTotal = round2(pagamentos.reduce((sum, p) => sum + n(p.comissao_gerada), 0))
  const vendaPatch = {
    tipo_corretor: tipoCorretor,
    valor_pro_soluto: valorProSoluto,
    fator_comissao: fator,
    comissao_total: comissaoTotal,
    updated_at: new Date().toISOString(),
  }
  if (n(venda.valor_venda_total) === 0) vendaPatch.valor_venda_total = n(venda.valor_venda)
  if (corretorId) vendaPatch.corretor_id = corretorId
  return { relevantes, pagamentos, vendaPatch, fator, percentualTotal, valorProSoluto, comissaoTotal }
}

function gradeJaCanonica(ativos, canonical) {
  if (ativos.length !== canonical.length) return false
  const a = ativos.map(canonicalKey).sort()
  const b = canonical.map(canonicalKey).sort()
  return a.every((x, i) => x === b[i])
}

async function rebuildVenda(caso, rowsPorBill, report) {
  const venda = await buscarVenda(caso.vendaId)
  if (String(venda.sienge_contract_id) !== caso.contractId || Number(venda.sienge_receivable_bill_id) !== caso.billId) {
    throw new Error(`${caso.label}: venda inesperada contract=${venda.sienge_contract_id} bill=${venda.sienge_receivable_bill_id}`)
  }

  let corretorId = null
  if (caso.corretorOrigemVendaId) {
    const origem = await buscarVenda(caso.corretorOrigemVendaId)
    corretorId = origem.corretor_id
  }

  const billRows = rowsPorBill.get(caso.billId) || []
  if (!billRows.length) throw new Error(`${caso.label}: bill ${caso.billId} nao encontrado no income Sienge`)

  const grade = montarGradeCanonica({ venda, billRows, tipoCorretor: caso.tipoCorretor, corretorId })
  const pagamentosAntes = await buscarPagamentos(venda.id)
  const ativosAntes = pagamentosAntes.filter((p) => p.status !== 'cancelado')
  const pagosAntes = ativosAntes.filter((p) => p.status === 'pago')
  const jaCanonica = gradeJaCanonica(ativosAntes, grade.pagamentos)
  const vendaJaOk =
    venda.tipo_corretor === grade.vendaPatch.tipo_corretor &&
    Math.abs(n(venda.valor_pro_soluto) - grade.vendaPatch.valor_pro_soluto) <= 0.01 &&
    Math.abs(n(venda.fator_comissao) - grade.vendaPatch.fator_comissao) <= 0.000001 &&
    (!corretorId || venda.corretor_id === corretorId) &&
    (!caso.protegerOrigemManual || venda.corretor_id_origem === 'manual')

  const acao = {
    caso: caso.label,
    venda_id: venda.id,
    contrato: caso.contractId,
    bill: caso.billId,
    motivo: caso.motivo,
    antes: {
      corretor_id: venda.corretor_id,
      tipo_corretor: venda.tipo_corretor,
      valor_pro_soluto: n(venda.valor_pro_soluto),
      fator_comissao: n(venda.fator_comissao),
      comissao_total: n(venda.comissao_total),
      pagamentos_ativos: ativosAntes.length,
      pagamentos_pagos: pagosAntes.length,
    },
    depois: {
      corretor_id: corretorId || venda.corretor_id,
      tipo_corretor: grade.vendaPatch.tipo_corretor,
      valor_pro_soluto: grade.valorProSoluto,
      fator_comissao: grade.fator,
      comissao_total: grade.comissaoTotal,
      pagamentos_canonicos: grade.pagamentos.length,
      pagos_canonicos: grade.pagamentos.filter((p) => p.status === 'pago').length,
    },
    dryRun: !APPLY,
    skipped_idempotent: jaCanonica && vendaJaOk,
    pagos_revertidos: 0,
    antigos_cancelados: 0,
    pagamentos_inseridos: 0,
    venda_atualizada: 0,
  }

  if (acao.skipped_idempotent) {
    report.rebuilds.push(acao)
    return
  }

  console.log(`- ${caso.label}`)
  console.log(`  ativos antigos: ${ativosAntes.length}; pagos antigos: ${pagosAntes.length}`)
  console.log(`  grade Sienge: ${grade.pagamentos.length}; pagos Sienge: ${acao.depois.pagos_canonicos}`)
  console.log(`  pro-soluto: R$ ${money(acao.antes.valor_pro_soluto)} -> R$ ${money(grade.valorProSoluto)}`)
  console.log(`  fator: ${(acao.antes.fator_comissao * 100).toFixed(4)}% -> ${(grade.fator * 100).toFixed(4)}%`)

  if (APPLY) {
    const vendaPatch = { ...grade.vendaPatch }
    if (caso.protegerOrigemManual) vendaPatch.corretor_id_origem = 'manual'
    const { data: updVenda, error: vendaErr } = await supa
      .from('vendas')
      .update(vendaPatch)
      .eq('id', venda.id)
      .select('id')
    if (vendaErr) {
      report.errors.push({ caso: caso.label, step: 'update_venda', msg: vendaErr.message, patch: vendaPatch })
    } else {
      acao.venda_atualizada = updVenda?.length || 0
    }

    acao.pagos_revertidos = await reverterPagos(pagosAntes.map((p) => p.id), report, caso.label)
    acao.antigos_cancelados = await cancelarAtivos(ativosAntes.map((p) => p.id), report, caso.label)
    acao.anchors_cancelados_limpos = await limparAnchorsCancelados(venda.id, report, caso.label)

    const { data: inserted, error: insErr } = await supa
      .from('pagamentos_prosoluto')
      .insert(grade.pagamentos)
      .select('id')
    if (insErr) {
      report.errors.push({ caso: caso.label, step: 'insert_pagamentos', msg: insErr.message })
    } else {
      acao.pagamentos_inseridos = inserted?.length || 0
    }
  }

  report.rebuilds.push(acao)
}

async function excluirVendaDuplicada(item, report) {
  const venda = await buscarVenda(item.vendaId)
  const pagamentos = await buscarPagamentos(item.vendaId)
  const ativos = pagamentos.filter((p) => p.status !== 'cancelado')
  const pagos = ativos.filter((p) => p.status === 'pago')
  const acao = {
    venda_id: item.vendaId,
    preservada_id: item.preservadaId,
    motivo: item.motivo,
    ja_excluida: venda.excluido === true,
    ativos_antes: ativos.length,
    pagos_antes: pagos.length,
    pagos_revertidos: 0,
    pagamentos_cancelados: 0,
    venda_excluida: 0,
  }

  if (acao.ja_excluida) {
    report.exclusoes.push(acao)
    return
  }

  console.log(`- Excluir duplicata local ${item.vendaId}: ativos=${ativos.length}, pagos=${pagos.length}`)
  if (APPLY) {
    acao.pagos_revertidos = await reverterPagos(pagos.map((p) => p.id), report, `excluir ${item.vendaId}`)
    acao.pagamentos_cancelados = await cancelarAtivos(ativos.map((p) => p.id), report, `excluir ${item.vendaId}`)
    const motivo =
      `${item.motivo}. Removida da visao ativa em ${DATA}; venda preservada: ${item.preservadaId}.`
    const { data, error } = await supa
      .from('vendas')
      .update({
        excluido: true,
        motivo_exclusao: motivo,
        excluido_por: EXCLUIDO_POR,
        excluido_em: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.vendaId)
      .select('id')
    if (error) {
      report.errors.push({ step: 'excluir_venda', venda_id: item.vendaId, msg: error.message })
    } else {
      acao.venda_excluida = data?.length || 0
    }
  }

  report.exclusoes.push(acao)
}

console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`)

const bills = new Set(CASOS_REBUILD.map((c) => c.billId))
const income = extractRows(
  (await siengeGet({
    path: '/bulk-data/v1/income',
    query: { startDate: '2023-01-01', endDate: '2031-12-31', selectionType: 'D', companyId: 5 },
  })).data,
)
const rowsPorBill = new Map()
for (const row of income) {
  const bill = Number(row.billId)
  if (!bills.has(bill)) continue
  if (!rowsPorBill.has(bill)) rowsPorBill.set(bill, [])
  rowsPorBill.get(bill).push(row)
}

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    modo: APPLY ? 'apply' : 'dry-run',
    script: SCRIPT,
    empreendimento_id: FIGUEIRA_ID,
  },
  rebuilds: [],
  exclusoes: [],
  errors: [],
}

for (const caso of CASOS_REBUILD) {
  await rebuildVenda(caso, rowsPorBill, report)
}

for (const item of VENDAS_DUPLICADAS_PARA_EXCLUIR) {
  await excluirVendaDuplicada(item, report)
}

const out = `docs/correcao-casos-admin-${DATA}${APPLY ? '-aplicado' : '-dryrun'}.json`
writeFileSync(out, JSON.stringify(report, null, 2))

console.log('\nResumo:')
console.log(`  rebuilds: ${report.rebuilds.length}`)
console.log(`  exclusoes: ${report.exclusoes.length}`)
console.log(`  erros: ${report.errors.length}`)
console.log(`  report: ${out}`)

if (!APPLY) console.log('\nDry-run apenas. Use --apply para aplicar.')
if (report.errors.length) process.exitCode = 1
