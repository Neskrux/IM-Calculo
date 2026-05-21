// Remove da visao ativa a venda duplicada da LUARA GABRIELA COELHO, unidade 807 A.
//
// Venda correta: contrato Sienge 407 / bill 479 / unidade "807 A".
// Duplicata: venda local antiga sem sienge_contract_id, unidade "807", bloco "A".
//
// Politica aplicada:
// - preserva a venda correta do Sienge;
// - baixa falsa em duplicata e revertida pelo fluxo explicito permitido
//   (pago -> pendente + data_pagamento = null) antes de cancelar;
// - todas as parcelas da duplicata viram cancelado;
// - a venda duplicada recebe excluido=true com motivo rastreavel.
//
// ver .claude/rules/sincronizacao-sienge.md
//
// Uso:
//   node scripts/excluir-duplicata-luara-807a-2026-05-21.mjs
//   node scripts/excluir-duplicata-luara-807a-2026-05-21.mjs --apply

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const DRY = !process.argv.includes('--apply')
const DATA = new Date().toISOString().slice(0, 10)

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '')
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const supa = createClient(URL, KEY)

const VENDA_CORRETA_CONTRACT = '407'
const VENDA_DUPLICADA_ID = '008553b3-8c88-420f-9c79-c665051a497a'
const EXCLUIDO_POR = 'c8cff026-b79f-41e1-a9c1-93547d484758'
const MOTIVO =
  'Venda duplicada local da LUARA GABRIELA COELHO unidade 807 A. ' +
  'A venda correta e o contrato Sienge 407 / bill 479, ja ativo no banco. ' +
  'Duplicata sem sienge_contract_id removida da visao ativa a pedido da administracao em 2026-05-21.'

function money(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    script: 'scripts/excluir-duplicata-luara-807a-2026-05-21.mjs',
    modo: DRY ? 'dry-run' : 'apply',
    spec_ref: '.claude/rules/sincronizacao-sienge.md',
    autorizacao: 'administracao: "consta 2 e e so a primeira" em 2026-05-21',
  },
  correta: null,
  duplicata: null,
  pagamentos_antes: [],
  counts: {
    pagos_revertidos: 0,
    pagamentos_cancelados: 0,
    venda_excluida: 0,
    skipped_idempotent: 0,
    errors: 0,
  },
  errors: [],
}

console.log(`Modo: ${DRY ? 'DRY-RUN' : 'APPLY'}\n`)

const { data: correta, error: corretaErr } = await supa
  .from('vendas')
  .select('id, sienge_contract_id, sienge_receivable_bill_id, unidade, bloco, cliente_id, corretor_id, valor_pro_soluto, excluido')
  .eq('sienge_contract_id', VENDA_CORRETA_CONTRACT)
  .maybeSingle()

if (corretaErr || !correta || correta.excluido === true) {
  const msg = corretaErr?.message || 'venda correta 407 nao encontrada ou excluida'
  console.error(`ERRO: ${msg}`)
  report.errors.push({ msg })
  report.counts.errors++
  process.exit(1)
}
report.correta = correta

const { data: duplicata, error: dupErr } = await supa
  .from('vendas')
  .select('id, sienge_contract_id, sienge_receivable_bill_id, unidade, bloco, cliente_id, corretor_id, valor_pro_soluto, comissao_total, status, excluido')
  .eq('id', VENDA_DUPLICADA_ID)
  .maybeSingle()

if (dupErr || !duplicata) {
  const msg = dupErr?.message || 'venda duplicada nao encontrada'
  console.error(`ERRO: ${msg}`)
  report.errors.push({ msg })
  report.counts.errors++
  process.exit(1)
}
report.duplicata = duplicata

const { data: pagamentos, error: pagsErr } = await supa
  .from('pagamentos_prosoluto')
  .select('id, status, tipo, numero_parcela, valor, comissao_gerada, data_prevista, data_pagamento')
  .eq('venda_id', VENDA_DUPLICADA_ID)
  .order('numero_parcela', { ascending: true })

if (pagsErr) {
  console.error(`ERRO pagamentos: ${pagsErr.message}`)
  report.errors.push({ msg: pagsErr.message })
  report.counts.errors++
  process.exit(1)
}

report.pagamentos_antes = pagamentos || []

const pagos = (pagamentos || []).filter((p) => p.status === 'pago')
const ativos = (pagamentos || []).filter((p) => p.status !== 'cancelado')
const somaComissaoAtiva = ativos.reduce((s, p) => s + Number(p.comissao_gerada || 0), 0)

console.log('Venda correta:')
console.log(`  contrato=${correta.sienge_contract_id} bill=${correta.sienge_receivable_bill_id} unidade=${correta.unidade}`)
console.log('Duplicata:')
console.log(`  id=${duplicata.id} contrato=${duplicata.sienge_contract_id || '-'} unidade=${duplicata.unidade}${duplicata.bloco ? ' ' + duplicata.bloco : ''}`)
console.log(`  pagamentos ativos=${ativos.length}, pagos=${pagos.length}, comissao ativa=R$ ${money(somaComissaoAtiva)}`)

if (duplicata.excluido === true && ativos.length === 0) {
  console.log('\nJa esta corrigido: venda excluida e sem pagamentos ativos.')
  report.counts.skipped_idempotent++
} else if (DRY) {
  console.log('\nAcoes que seriam aplicadas:')
  console.log(`  1. Reverter ${pagos.length} baixa(s) falsa(s): status pago -> pendente, data_pagamento=null`)
  console.log(`  2. Cancelar ${ativos.length} pagamento(s) da duplicata`)
  console.log('  3. Marcar venda duplicada como excluido=true com motivo')
  console.log('\nDry-run apenas. Use --apply para aplicar.')
} else {
  const now = new Date().toISOString()

  for (const p of pagos) {
    const { error } = await supa
      .from('pagamentos_prosoluto')
      .update({ status: 'pendente', data_pagamento: null, updated_at: now })
      .eq('id', p.id)
      .eq('status', 'pago')
    if (error) {
      report.errors.push({ id: p.id, step: 'reverter_baixa', msg: error.message })
      report.counts.errors++
    } else {
      report.counts.pagos_revertidos++
    }
  }

  const idsAtivos = ativos.map((p) => p.id)
  if (idsAtivos.length > 0) {
    const { error } = await supa
      .from('pagamentos_prosoluto')
      .update({ status: 'cancelado', updated_at: new Date().toISOString() })
      .in('id', idsAtivos)
      .neq('status', 'cancelado')
    if (error) {
      report.errors.push({ step: 'cancelar_pagamentos', msg: error.message })
      report.counts.errors++
    } else {
      report.counts.pagamentos_cancelados = idsAtivos.length
    }
  }

  const updateVenda = {
    excluido: true,
    motivo_exclusao: MOTIVO,
    excluido_por: EXCLUIDO_POR,
    excluido_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const { data: vendaUpd, error: vendaErr } = await supa
    .from('vendas')
    .update(updateVenda)
    .eq('id', VENDA_DUPLICADA_ID)
    .select('id, excluido, status')

  if (vendaErr) {
    report.errors.push({ step: 'excluir_venda', msg: vendaErr.message })
    report.counts.errors++
  } else {
    report.counts.venda_excluida = vendaUpd?.length || 0
  }

  console.log('\nAplicado:')
  console.log(`  baixas revertidas: ${report.counts.pagos_revertidos}`)
  console.log(`  pagamentos cancelados: ${report.counts.pagamentos_cancelados}`)
  console.log(`  venda excluida: ${report.counts.venda_excluida}`)
  console.log(`  erros: ${report.counts.errors}`)
}

if (!DRY) {
  const out = `docs/exclusao-duplicata-luara-807a-${DATA}.json`
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(`\nReport: ${out}`)
}
