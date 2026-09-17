// Cria a conta de LOGIN (auth.users) de todo corretor que tem cadastro em `usuarios`
// e venda ativa, mas ainda nao tem acesso. Idempotente: rodar de novo so cria o que faltar.
//
// POR QUE ESTE SCRIPT EXISTE
//   `usuarios` e populado sozinho pelo sync do Sienge — todo corretor que vende aparece la.
//   `auth.users` NAO: so existe quando alguem cria o acesso na tela. Resultado em 2026-07-31:
//   51 corretores com venda, 24 com login, 27 sem. Este script fecha essa lacuna sem trabalho manual.
//
// O QUE ELE NAO FAZ (de proposito)
//   - NAO dispara email. Criar acesso e enviar convite sao passos separados: o disparo em lote
//     queima reputacao de dominio, e o link de recuperacao do Supabase expira em ~1h.
//     Depois de criar, use a tela de "esqueci minha senha" ou o painel pra convidar.
//   - NAO cria pra email placeholder `@sync.local` (o sync inventa quando o Sienge nao traz email).
//     Sem email real nao ha pra onde mandar o acesso — pular e o comportamento correto.
//   - NAO cria pra email repetido entre dois cadastros (duplicata tipo DIEGO BENITES): dois logins
//     pra mesma pessoa fragmentam a carteira. Consolidar o cadastro primeiro.
//
// USO
//   SUPABASE_SERVICE_ROLE_KEY='...'  (painel > Project Settings > API > service_role)
//   node scripts/acessos/criar-acessos-faltantes.mjs            # dry-run: so lista
//   node scripts/acessos/criar-acessos-faltantes.mjs --apply    # cria
//
// ver .claude/rules/sincronizacao-sienge.md (schema canonico de metrica)

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const APLICAR = process.argv.includes('--apply')

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=')
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
  })
)
const URL = env.VITE_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY. Criar conta de login exige service_role — a anon nao pode.')
  process.exit(1)
}

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })

// 1. quem tem cadastro + venda ativa
const { data: corretores, error: e1 } = await admin
  .from('usuarios')
  .select('id, nome, email, tipo_corretor, tem_acesso_sistema, vendas:vendas!vendas_corretor_id_fkey(id, excluido)')
  .eq('tipo', 'corretor')
if (e1) { console.error('erro lendo usuarios:', e1.message); process.exit(1) }

const comVenda = corretores.filter((u) => (u.vendas || []).some((v) => v.excluido !== true))

// 2. quem ja tem login (lista paginada de auth.users)
const jaTemLogin = new Set()
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
  if (error) { console.error('erro listando auth.users:', error.message); process.exit(1) }
  data.users.forEach((u) => { jaTemLogin.add(u.id); if (u.email) jaTemLogin.add(u.email.toLowerCase()) })
  if (data.users.length < 1000) break
}

// 3. emails repetidos entre cadastros — nunca criar login pra eles
const contagem = {}
for (const u of corretores) {
  const e = (u.email || '').toLowerCase()
  if (e) contagem[e] = (contagem[e] || 0) + 1
}

const emailValido = (e) => !!e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !e.endsWith('@sync.local')

const criar = [], pular = []
for (const u of comVenda) {
  const email = (u.email || '').toLowerCase()
  if (jaTemLogin.has(u.id) || jaTemLogin.has(email)) continue          // ja tem login: idempotente
  if (!emailValido(email)) { pular.push({ ...u, motivo: email.endsWith('@sync.local') ? 'email placeholder do sync — precisa de email real' : 'email invalido ou vazio' }); continue }
  if (contagem[email] > 1) { pular.push({ ...u, motivo: 'email repetido em outro cadastro — consolidar antes' }); continue }
  criar.push({ id: u.id, nome: u.nome, email })
}

console.log(`\ncorretores com venda ativa: ${comVenda.length}`)
console.log(`ja tem login:               ${comVenda.length - criar.length - pular.length}`)
console.log(`A CRIAR:                    ${criar.length}`)
console.log(`pulados:                    ${pular.length}`)
for (const p of pular) console.log(`   - ${p.nome} <${p.email || 'sem email'}> :: ${p.motivo}`)

const resultado = {
  meta: { geradoEm: new Date().toISOString(), spec_ref: '.claude/rules/sincronizacao-sienge.md', script: 'scripts/acessos/criar-acessos-faltantes.mjs', modo: APLICAR ? 'apply' : 'dry-run' },
  counts: { com_venda: comVenda.length, a_criar: criar.length, criados: 0, ja_tinham: comVenda.length - criar.length - pular.length, pulados: pular.length, errors: 0 },
  criados: [], humano_pendente: pular.map((p) => ({ id: p.id, nome: p.nome, email: p.email, motivo: p.motivo })), errors: [],
}

if (!APLICAR) {
  console.log('\nDry-run. Pra criar de verdade: --apply')
  for (const c of criar) console.log(`   criaria: ${c.nome} <${c.email}>`)
  process.exit(0)
}

// 4. criar. Senha aleatoria descartada: o corretor entra pelo fluxo de redefinicao.
//    email_confirm=true evita prender o corretor num passo de confirmacao antes de redefinir.
// CRITICO: a conta do auth nasce COM o id que o cadastro ja tem em `usuarios`.
// O AuthContext casa o perfil por `authUser.id` (fetchProfileDirect(authUser.id)), entao os dois
// ids TEM que ser o mesmo. O caminho inverso — criar com id novo e depois mudar `usuarios.id` —
// quebraria a FK `vendas.corretor_id` e desligaria o corretor da propria carteira. Nunca fazer isso.
for (const c of criar) {
  const { data, error } = await admin.auth.admin.createUser({
    id: c.id,
    email: c.email,
    password: randomBytes(24).toString('base64url'),
    email_confirm: true,
    user_metadata: { nome: c.nome, criado_por: 'criar-acessos-faltantes' },
  })
  if (error) {
    resultado.counts.errors++
    resultado.errors.push({ id: c.id, email: c.email, msg: error.message })
    console.log(`   ERRO ${c.email}: ${error.message}`)
    continue
  }
  if (data.user.id !== c.id) {
    // a versao do GoTrue ignorou o id enviado: NAO da pra seguir — o perfil nao casaria.
    resultado.counts.errors++
    resultado.errors.push({ id: c.id, email: c.email, msg: `id divergente: auth=${data.user.id} usuarios=${c.id}. Conta criada mas NAO casa com o perfil — apagar no painel e criar pela tela.` })
    console.log(`   ATENCAO ${c.email}: auth id ${data.user.id} != cadastro ${c.id}. Apague essa conta no painel — o perfil nao vai casar.`)
    continue
  }
  resultado.counts.criados++
  resultado.criados.push({ id: c.id, nome: c.nome, email: c.email })
  console.log(`   ok ${c.nome} <${c.email}>`)
}

mkdirSync('docs/acessos', { recursive: true })
const out = `docs/acessos/criar-acessos-${new Date().toISOString().slice(0, 10)}-${APLICAR ? 'aplicado' : 'dryrun'}.json`
writeFileSync(out, JSON.stringify(resultado, null, 2))
console.log(`\ncriados: ${resultado.counts.criados} | erros: ${resultado.counts.errors} | relatorio: ${out}`)
console.log('Proximo passo: disparar a redefinicao de senha (em lotes) — este script NAO envia email.')
