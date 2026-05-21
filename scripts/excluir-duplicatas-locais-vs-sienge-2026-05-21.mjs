// Remove da visao ativa duplicatas locais de vendas FIGUEIRA que ja existem
// como contratos Sienge.
//
// Criterio:
// - mesma pessoa compradora (nome em clientes/nome_cliente normalizado);
// - mesmo corretor_id;
// - mesma unidade/bloco normalizados;
// - existe pelo menos uma venda com sienge_contract_id;
// - existe uma venda local sem sienge_contract_id.
//
// Politica aplicada:
// - preserva todas as vendas Sienge;
// - para cada venda local duplicada, reverte baixas falsas pelo fluxo explicito
//   permitido (pago -> pendente + data_pagamento = null);
// - cancela todas as parcelas ativas da duplicata local;
// - marca a venda duplicada como excluido=true com motivo rastreavel.
//
// Uso:
//   node scripts/excluir-duplicatas-locais-vs-sienge-2026-05-21.mjs
//   node scripts/excluir-duplicatas-locais-vs-sienge-2026-05-21.mjs --apply

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const DRY = !process.argv.includes('--apply')
const DATA = new Date().toISOString().slice(0, 10)
const FIGUEIRA_ID = '0d7d01f4-c398-4d9a-a280-13f44c957279'
const EXCLUIDO_POR = 'c8cff026-b79f-41e1-a9c1-93547d484758'
const SCRIPT = 'scripts/excluir-duplicatas-locais-vs-sienge-2026-05-21.mjs'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '')
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')

if (!URL || !KEY) {
  console.error('faltando VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY (.env ou env vars)')
  process.exit(1)
}

const supa = createClient(URL, KEY)
const PAGE = 1000

const normalizarNome = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const normalizarUnidade = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')

const unidadeKey = (venda) => normalizarUnidade(`${venda.unidade || ''}${venda.bloco || ''}`)

function money(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function buscarTodos(queryFactory) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await queryFactory().range(from, from + PAGE - 1)
    if (error) throw error
    if (!data?.length) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

async function buscarMapeados(table, select, ids, label) {
  const map = new Map()
  const unique = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await supa.from(table).select(select).in('id', unique.slice(i, i + 100))
    if (error) throw new Error(`${label}: ${error.message}`)
    for (const row of data || []) map.set(row.id, row)
  }
  return map
}

function nomeCliente(venda, clientesPorId) {
  return venda.nome_cliente || clientesPorId.get(venda.cliente_id)?.nome_completo || venda.cliente_id || ''
}

function nomeCorretor(venda, corretoresPorId) {
  return corretoresPorId.get(venda.corretor_id)?.nome || venda.corretor_id || '-'
}

console.log(`Modo: ${DRY ? 'DRY-RUN' : 'APPLY'}\n`)

const vendas = await buscarTodos(() =>
  supa
    .from('vendas')
    .select(
      [
        'id',
        'nome_cliente',
        'cliente_id',
        'corretor_id',
        'unidade',
        'bloco',
        'sienge_contract_id',
        'sienge_receivable_bill_id',
        'excluido',
        'status',
        'valor_pro_soluto',
        'comissao_total',
        'created_at',
      ].join(','),
    )
    .eq('empreendimento_id', FIGUEIRA_ID)
    .or('excluido.is.null,excluido.eq.false'),
)

const clientesPorId = await buscarMapeados('clientes', 'id,nome_completo,cpf', vendas.map((v) => v.cliente_id), 'clientes')
const corretoresPorId = await buscarMapeados('usuarios', 'id,nome,sienge_broker_id', vendas.map((v) => v.corretor_id), 'usuarios')

const grupos = new Map()
for (const venda of vendas) {
  const key = [
    normalizarNome(nomeCliente(venda, clientesPorId)),
    venda.corretor_id || '',
    unidadeKey(venda),
  ].join('|')
  if (!grupos.has(key)) grupos.set(key, [])
  grupos.get(key).push(venda)
}

const candidatosBase = []
for (const [key, rows] of grupos) {
  const sienge = rows.filter((v) => v.sienge_contract_id)
  const locais = rows.filter((v) => !v.sienge_contract_id)
  if (!sienge.length || !locais.length) continue

  for (const duplicata of locais) {
    candidatosBase.push({ key, duplicata, sienge })
  }
}

const pagamentosPorVenda = new Map()
const duplicataIds = candidatosBase.map((c) => c.duplicata.id)
for (let i = 0; i < duplicataIds.length; i += 50) {
  const chunk = duplicataIds.slice(i, i + 50)
  if (!chunk.length) continue
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa
      .from('pagamentos_prosoluto')
      .select('id,venda_id,status,tipo,numero_parcela,valor,comissao_gerada,data_prevista,data_pagamento')
      .in('venda_id', chunk)
      .order('venda_id', { ascending: true })
      .order('numero_parcela', { ascending: true, nullsFirst: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data?.length) break
    for (const pagamento of data) {
      if (!pagamentosPorVenda.has(pagamento.venda_id)) pagamentosPorVenda.set(pagamento.venda_id, [])
      pagamentosPorVenda.get(pagamento.venda_id).push(pagamento)
    }
    if (data.length < PAGE) break
  }
}

const candidatos = candidatosBase
  .map(({ key, duplicata, sienge }) => {
    const pagamentos = pagamentosPorVenda.get(duplicata.id) || []
    const ativos = pagamentos.filter((p) => p.status !== 'cancelado')
    const pagos = ativos.filter((p) => p.status === 'pago')

    return {
      key,
      cliente: nomeCliente(duplicata, clientesPorId),
      corretor: nomeCorretor(duplicata, corretoresPorId),
      unidade: `${duplicata.unidade || ''}${duplicata.bloco ? ` ${duplicata.bloco}` : ''}`.trim(),
      duplicata,
      sienge,
      pagamentos,
      ativos,
      pagos,
      comissaoAtiva: ativos.reduce((sum, p) => sum + Number(p.comissao_gerada || 0), 0),
    }
  })
  .sort((a, b) => b.pagos.length - a.pagos.length || a.cliente.localeCompare(b.cliente))

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    script: SCRIPT,
    modo: DRY ? 'dry-run' : 'apply',
    empreendimento_id: FIGUEIRA_ID,
    autorizacao: 'usuario autorizou remover duplicatas locais erradas em 2026-05-21',
    criterio:
      'mesmo cliente normalizado + corretor_id + unidade/bloco normalizados, com venda Sienge ativa e venda local sem sienge_contract_id',
  },
  resumo: {
    candidatos: candidatos.length,
    duplicatas_sem_baixa: candidatos.filter((c) => c.pagos.length === 0).length,
    duplicatas_com_baixa: candidatos.filter((c) => c.pagos.length > 0).length,
    grupos_com_multiplos_contratos_sienge: candidatos.filter((c) => c.sienge.length > 1).length,
    parcelas_ativas: candidatos.reduce((sum, c) => sum + c.ativos.length, 0),
    parcelas_pagas: candidatos.reduce((sum, c) => sum + c.pagos.length, 0),
    comissao_ativa: Number(candidatos.reduce((sum, c) => sum + c.comissaoAtiva, 0).toFixed(2)),
  },
  acoes: [],
  errors: [],
}

console.log('Resumo:')
console.log(`  candidatos: ${report.resumo.candidatos}`)
console.log(`  sem baixa: ${report.resumo.duplicatas_sem_baixa}`)
console.log(`  com baixa: ${report.resumo.duplicatas_com_baixa}`)
console.log(`  parcelas ativas nas duplicatas: ${report.resumo.parcelas_ativas}`)
console.log(`  baixas nas duplicatas: ${report.resumo.parcelas_pagas}`)
console.log(`  comissao ativa nas duplicatas: R$ ${money(report.resumo.comissao_ativa)}\n`)

for (const candidato of candidatos) {
  const contratos = candidato.sienge.map((v) => v.sienge_contract_id).sort()
  const motivo =
    `Venda local duplicada removida em ${DATA}. ` +
    `Ja existe venda sincronizada pelo Sienge para o mesmo cliente/corretor/unidade ` +
    `(contrato(s) Sienge: ${contratos.join(', ')}).`

  const acao = {
    venda_duplicada_id: candidato.duplicata.id,
    cliente: candidato.cliente,
    corretor: candidato.corretor,
    unidade: candidato.unidade,
    contratos_sienge_preservados: contratos,
    venda_sienge_ids_preservadas: candidato.sienge.map((v) => v.id),
    multiplos_contratos_sienge: candidato.sienge.length > 1,
    parcelas_ativas_antes: candidato.ativos.length,
    parcelas_pagas_antes: candidato.pagos.length,
    comissao_ativa_antes: Number(candidato.comissaoAtiva.toFixed(2)),
    pagos_revertidos: 0,
    pagamentos_cancelados: 0,
    venda_excluida: 0,
    skipped_idempotent: 0,
    errors: [],
  }

  console.log(
    `- ${acao.cliente} | ${acao.unidade} | local=${acao.venda_duplicada_id} | ` +
      `Sienge=${contratos.join(', ')} | ativos=${acao.parcelas_ativas_antes} | ` +
      `pagos=${acao.parcelas_pagas_antes} | comissao=R$ ${money(acao.comissao_ativa_antes)}`,
  )

  if (!DRY) {
    const now = new Date().toISOString()

    for (const pagamento of candidato.pagos) {
      const { data, error } = await supa
        .from('pagamentos_prosoluto')
        .update({ status: 'pendente', data_pagamento: null, updated_at: now })
        .eq('id', pagamento.id)
        .eq('status', 'pago')
        .select('id')

      if (error) {
        const err = { step: 'reverter_baixa', pagamento_id: pagamento.id, msg: error.message }
        acao.errors.push(err)
        report.errors.push({ venda_id: candidato.duplicata.id, ...err })
      } else {
        acao.pagos_revertidos += data?.length || 0
      }
    }

    const ativosIds = candidato.ativos.map((p) => p.id)
    if (ativosIds.length) {
      const { data, error } = await supa
        .from('pagamentos_prosoluto')
        .update({ status: 'cancelado', updated_at: new Date().toISOString() })
        .in('id', ativosIds)
        .neq('status', 'cancelado')
        .select('id')

      if (error) {
        const err = { step: 'cancelar_pagamentos', msg: error.message }
        acao.errors.push(err)
        report.errors.push({ venda_id: candidato.duplicata.id, ...err })
      } else {
        acao.pagamentos_cancelados = data?.length || 0
      }
    }

    const { data, error } = await supa
      .from('vendas')
      .update({
        excluido: true,
        motivo_exclusao: motivo,
        excluido_por: EXCLUIDO_POR,
        excluido_em: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', candidato.duplicata.id)
      .select('id')

    if (error) {
      const err = { step: 'excluir_venda', msg: error.message }
      acao.errors.push(err)
      report.errors.push({ venda_id: candidato.duplicata.id, ...err })
    } else {
      acao.venda_excluida = data?.length || 0
      if (!acao.venda_excluida && !acao.pagamentos_cancelados) acao.skipped_idempotent = 1
    }
  }

  report.acoes.push(acao)
}

const out = `docs/exclusao-duplicatas-locais-vs-sienge-${DATA}.json`
writeFileSync(out, JSON.stringify(report, null, 2))

if (DRY) {
  console.log('\nDry-run apenas. Use --apply para aplicar.')
} else {
  const total = report.acoes.reduce(
    (acc, a) => {
      acc.pagos_revertidos += a.pagos_revertidos
      acc.pagamentos_cancelados += a.pagamentos_cancelados
      acc.vendas_excluidas += a.venda_excluida
      acc.errors += a.errors.length
      return acc
    },
    { pagos_revertidos: 0, pagamentos_cancelados: 0, vendas_excluidas: 0, errors: 0 },
  )
  console.log('\nAplicado:')
  console.log(`  baixas revertidas: ${total.pagos_revertidos}`)
  console.log(`  pagamentos cancelados: ${total.pagamentos_cancelados}`)
  console.log(`  vendas excluidas: ${total.vendas_excluidas}`)
  console.log(`  erros: ${total.errors}`)
}

console.log(`\nReport: ${out}`)

if (report.errors.length) process.exitCode = 1
