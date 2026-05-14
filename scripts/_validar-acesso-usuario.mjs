// Valida o acesso de um usuario via Supabase Auth REAL — autentica com
// email/senha e roda as queries que o dashboard correspondente faz, com o
// RLS do usuario aplicado. Confirma que os dados chegam certos.
//
// Credenciais via env (NUNCA hard-coded / commitado):
//   TEST_EMAIL=... TEST_PASSWORD=... node scripts/_validar-acesso-usuario.mjs
//
// READ-ONLY. Spec: .claude/rules/visualizacao-totais.md, comissao-corretor.md

import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const ANON = process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
const EMAIL = process.env.TEST_EMAIL
const PASSWORD = process.env.TEST_PASSWORD
if (!EMAIL || !PASSWORD) {
  console.error('Faltando TEST_EMAIL / TEST_PASSWORD nas env vars.')
  process.exit(1)
}

const supa = createClient(URL, ANON)

// 1. LOGIN
console.log(`=== 1. Login: ${EMAIL} ===`)
const { data: auth, error: authErr } = await supa.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
if (authErr) {
  console.error(`  ✗ Falha no login: ${authErr.message}`)
  process.exit(1)
}
console.log(`  ✓ Login OK — user.id=${auth.user.id}`)

// 2. PROFILE (igual fetchProfileDirect do AuthContext)
const { data: perfis, error: perfErr } = await supa.from('usuarios').select('*').eq('id', auth.user.id)
if (perfErr) {
  console.error(`  ✗ Erro ao buscar perfil: ${perfErr.message}`)
  process.exit(1)
}
const perfil = perfis?.[0]
if (!perfil) {
  console.error('  ✗ Usuario sem perfil na tabela usuarios')
  process.exit(1)
}
console.log(`  ✓ Perfil: nome=${perfil.nome || '-'} tipo=${perfil.tipo} corretor_id=${perfil.corretor_id || '-'}`)

// helper de soma de comissao (igual comissaoCalculator.calcularComissaoPagamentoCompleto, simplificado)
const comissaoDe = (p) => {
  if (p.comissao_gerada && Number(p.comissao_gerada) > 0) return Number(p.comissao_gerada)
  if (p.fator_comissao_aplicado && Number(p.fator_comissao_aplicado) > 0) return Number(p.valor) * Number(p.fator_comissao_aplicado)
  return 0
}

// 3. queries conforme tipo
if (perfil.tipo === 'admin') {
  console.log(`\n=== 2. Visao ADMIN — carregando vendas + pagamentos ===`)
  const { data: vendas, error: vErr } = await supa.from('vendas').select('id, excluido').limit(2000)
  if (vErr) { console.error(`  ✗ erro vendas: ${vErr.message}`); process.exit(1) }
  console.log(`  ✓ vendas acessiveis: ${vendas.length}`)

  const pagamentos = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supa
      .from('pagamentos_prosoluto')
      .select('id, venda_id, valor, status, comissao_gerada, fator_comissao_aplicado, data_pagamento, data_prevista')
      .range(from, from + 999)
    if (error) { console.error(`  ✗ erro pagamentos: ${error.message}`); process.exit(1) }
    if (!data?.length) break
    pagamentos.push(...data)
    if (data.length < 1000) break
  }
  console.log(`  ✓ pagamentos acessiveis: ${pagamentos.length}`)

  // totais como o AdminDashboard calcula (ignora cancelado)
  const ativos = pagamentos.filter((p) => p.status !== 'cancelado')
  const totalComissao = ativos.reduce((s, p) => s + comissaoDe(p), 0)
  const totalPago = ativos.filter((p) => p.status === 'pago').reduce((s, p) => s + comissaoDe(p), 0)
  const totalPendente = ativos.filter((p) => p.status === 'pendente').reduce((s, p) => s + comissaoDe(p), 0)
  const canceladas = pagamentos.filter((p) => p.status === 'cancelado').length
  console.log(`\n  === Totais (visao admin, cancelados excluidos) ===`)
  console.log(`    Comissao Total:    R$ ${totalComissao.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
  console.log(`    Comissao Paga:     R$ ${totalPago.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
  console.log(`    Comissao Pendente: R$ ${totalPendente.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
  console.log(`    Parcelas canceladas (fora dos totais): ${canceladas}`)
  // sanidade
  const difCheck = Math.abs(totalComissao - (totalPago + totalPendente))
  console.log(`    Sanidade (Total == Paga + Pendente): ${difCheck < 0.01 ? '✓' : `✗ diff R$ ${difCheck.toFixed(2)}`}`)
} else if (perfil.tipo === 'corretor') {
  // CorretorDashboard usa user.id (id de autenticacao), nao perfil.corretor_id —
  // vendas.corretor_id aponta direto pro auth user.id.
  console.log(`\n=== 2. Visao CORRETOR — vendas do corretor_id=user.id=${auth.user.id} ===`)
  const { data: vendas, error: vErr } = await supa.from('vendas').select('id, unidade, status').eq('corretor_id', auth.user.id)
  if (vErr) { console.error(`  ✗ erro vendas: ${vErr.message}`); process.exit(1) }
  console.log(`  ✓ minhas vendas: ${vendas.length}`)
  const vendaIds = vendas.map((v) => v.id)
  const pagamentos = []
  for (let i = 0; i < vendaIds.length; i += 50) {
    const { data } = await supa
      .from('pagamentos_prosoluto')
      .select('id, venda_id, valor, status, comissao_gerada, fator_comissao_aplicado')
      .in('venda_id', vendaIds.slice(i, i + 50))
    pagamentos.push(...(data || []))
  }
  console.log(`  ✓ meus pagamentos: ${pagamentos.length}`)
  const ativos = pagamentos.filter((p) => p.status !== 'cancelado')
  const total = ativos.reduce((s, p) => s + comissaoDe(p), 0)
  const paga = ativos.filter((p) => p.status === 'pago').reduce((s, p) => s + comissaoDe(p), 0)
  const pendente = ativos.filter((p) => p.status === 'pendente').reduce((s, p) => s + comissaoDe(p), 0)
  console.log(`\n  === Minha comissao (cancelados excluidos) ===`)
  console.log(`    Total:    R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
  console.log(`    Paga:     R$ ${paga.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
  console.log(`    Pendente: R$ ${pendente.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
  console.log(`    Canceladas (fora): ${pagamentos.filter((p) => p.status === 'cancelado').length}`)
} else {
  console.log(`\n  tipo de usuario "${perfil.tipo}" — sem validacao especifica`)
}

await supa.auth.signOut()
console.log('\n✓ Logout. Validacao concluida.')
