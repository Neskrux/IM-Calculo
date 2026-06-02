// Correcao final das sobras deterministicas da auditoria de 2026-05-25.
//
// Politica:
// - Nao faz DELETE.
// - Linhas extras pendentes viram cancelado.
// - Linhas extras pagas seguem o fluxo permitido pelas migrations:
//   pago -> pendente com data_pagamento=null, depois pendente -> cancelado.
// - Mantem uma linha ativa por identidade local (tipo + numero + valor + vencimento).
//
// Uso:
//   node scripts/corrigir-sobras-auditoria-2026-05-25.mjs
//   node scripts/corrigir-sobras-auditoria-2026-05-25.mjs --apply

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const env = Object.fromEntries(
  envFile
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)

const URL = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY
if (!URL || !KEY) {
  console.error('faltando VITE_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY/VITE_SUPABASE_ANON_KEY')
  process.exit(1)
}

const supa = createClient(URL, KEY, { auth: { persistSession: false } })

const GRUPOS = [
  {
    label: '609 D / Diego Ramos / parcela_entrada 3',
    keepId: '25bf7945-0408-4ec8-9f7a-87f6215dd63a',
    cancelIds: ['9d254307-caf7-43aa-a8a1-daf22ba5ebfd'],
    motivo: 'duplicata pendente exata: mesmo tipo, numero, valor e vencimento',
  },
  {
    label: '508 A / Michel Borba / parcela_entrada 1',
    keepId: '3b1a914c-ac59-43ac-9a2a-b736c44a0382',
    cancelIds: ['045d5d72-ac21-43dc-9914-c31510f14abe'],
    motivo: 'duplicata paga exata; mantida uma baixa e cancelada a linha extra',
  },
  {
    label: '508 A / Michel Borba / parcela_entrada 2',
    keepId: '0595a8cf-968d-40a1-8ec5-dc06c8a9be1d',
    cancelIds: ['3fe24d3d-e074-41b7-93a2-6259c1eb7f51'],
    motivo: 'duplicata paga; mantida a baixa que bate com o paymentDate do Sienge (2026-01-06)',
  },
]

async function buscarPagamentos(ids) {
  const { data, error } = await supa
    .from('pagamentos_prosoluto')
    .select('id,venda_id,tipo,numero_parcela,status,valor,data_prevista,data_pagamento,sienge_bill_id,sienge_installment_id,updated_at')
    .in('id', ids)
    .order('numero_parcela', { ascending: true, nullsFirst: true })
  if (error) throw error
  return data || []
}

async function reverterPagos(ids) {
  if (!ids.length || !APPLY) return { requested: ids.length, updated: APPLY ? 0 : ids.length }
  const { data, error } = await supa
    .from('pagamentos_prosoluto')
    .update({ status: 'pendente', data_pagamento: null, updated_at: new Date().toISOString() })
    .in('id', ids)
    .eq('status', 'pago')
    .select('id')
  if (error) throw error
  return { requested: ids.length, updated: data?.length || 0 }
}

async function cancelar(ids) {
  if (!ids.length || !APPLY) return { requested: ids.length, updated: APPLY ? 0 : ids.length }
  const { data, error } = await supa
    .from('pagamentos_prosoluto')
    .update({ status: 'cancelado', updated_at: new Date().toISOString() })
    .in('id', ids)
    .neq('status', 'cancelado')
    .select('id')
  if (error) throw error
  return { requested: ids.length, updated: data?.length || 0 }
}

const report = {
  meta: {
    geradoEm: new Date().toISOString(),
    modo: APPLY ? 'apply' : 'dry-run',
    script: 'scripts/corrigir-sobras-auditoria-2026-05-25.mjs',
  },
  grupos: [],
  errors: [],
}

for (const grupo of GRUPOS) {
  try {
    const ids = [grupo.keepId, ...grupo.cancelIds]
    const antes = await buscarPagamentos(ids)
    const cancelRows = antes.filter((row) => grupo.cancelIds.includes(row.id) && row.status !== 'cancelado')
    const pagosParaReverter = cancelRows.filter((row) => row.status === 'pago').map((row) => row.id)
    const revertidos = await reverterPagos(pagosParaReverter)
    const cancelados = await cancelar(cancelRows.map((row) => row.id))
    const depois = await buscarPagamentos(ids)

    report.grupos.push({
      ...grupo,
      dryRun: !APPLY,
      antes,
      pagos_revertidos: revertidos,
      pagamentos_cancelados: cancelados,
      depois,
    })
  } catch (error) {
    report.errors.push({ grupo: grupo.label, message: error.message })
  }
}

const out = `docs/sobras-auditoria-2026-05-25-${APPLY ? 'aplicado' : 'dryrun'}.json`
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)

console.log(JSON.stringify({
  arquivo: out,
  modo: report.meta.modo,
  grupos: report.grupos.length,
  errors: report.errors.length,
}, null, 2))

if (report.errors.length) process.exitCode = 1
