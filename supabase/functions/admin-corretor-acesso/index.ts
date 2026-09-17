// Edge function — Gestão de acesso do CORRETOR pelo admin (service role).
//
// Irmã de admin-cliente-acesso, mesma arquitetura: o front usa anon key, e a operação
// privilegiada mora aqui, onde a service role fica na env do servidor e nunca no bundle.
//
// Por que existe: o front (anon) não consegue (1) criar usuário sem trocar a sessão do
// admin pela do corretor recém-criado (signUp loga o novo user), nem (2) trocar senha de
// OUTRO usuário, nem (3) — e é o ponto que difere do cliente — criar o user do Auth COM
// um id escolhido.
//
// A DIFERENÇA CRÍTICA PARA O CLIENTE:
//   Cliente tem coluna de vínculo própria (`clientes.user_id`), então o id do Auth pode ser
//   qualquer um. Corretor NÃO tem: `usuarios.id` É a identidade, e `vendas.corretor_id`
//   referencia ela. O AuthContext casa o perfil por `authUser.id`.
//   Logo, a conta do Auth precisa NASCER com o id que o corretor já tem em `usuarios`.
//   O caminho inverso (criar id novo e mudar `usuarios.id`) quebraria a FK e desligaria o
//   corretor da própria carteira — nunca fazer.
//   Por isso `criar` passa `id` no createUser e ABORTA se o Auth devolver outro,
//   removendo a conta órfã antes de sair.
//
// Contexto de negócio: `usuarios` é populado sozinho pelo sync do Sienge (todo corretor que
// vende aparece), mas `auth.users` não — só existe se alguém criar. Em 2026-07-31: 51
// corretores com venda, 24 com login, 27 sem. Esta função fecha essa lacuna sem trabalho
// manual e sem service role na mão de ninguém.
//
// verify_jwt da plataforma fica DESLIGADO (o preflight OPTIONS do browser não leva
// Authorization e seria bloqueado); a autenticação é feita AQUI, no corpo da função.
//
// Rotas (POST, JSON):
//   { acao: 'criar',        corretor_id, email?, senha } → cria o user no Auth com o MESMO id
//     do cadastro. Usa o email do cadastro se `email` não vier. Não envia email nenhum.
//   { acao: 'trocar_senha', corretor_id, senha }         → redefine a senha do corretor.
//   { acao: 'gerar_link',   corretor_id }                → gera link de redefinição e DEVOLVE
//     a URL, sem disparar email. Serve pro admin mandar por WhatsApp quando o email do
//     corretor quica (caso mayimoveis.com.br) ou o provedor de envio está suspenso.
import "@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-my-custom-header",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } })

// Placeholder que o sync inventa quando o Sienge não traz email do corretor.
// Não é endereço real: criar acesso com ele geraria conta que ninguém alcança.
const ehPlaceholder = (e: string) => e.endsWith("@sync.local")
const emailValido = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !ehPlaceholder(e)

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "edge mal configurada" }, 500)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  // 1) Autenticação — JWT do chamador
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
  if (!jwt) return json({ error: "não autenticado" }, 401)
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  if (userErr || !userData?.user) return json({ error: "não autenticado" }, 401)

  // 2) Autorização — apenas admin
  const { data: perfil } = await admin
    .from("usuarios")
    .select("tipo")
    .eq("id", userData.user.id)
    .maybeSingle()
  if (perfil?.tipo !== "admin") return json({ error: "apenas administradores podem gerenciar acessos" }, 403)

  // 3) Payload
  const body = await req.json().catch(() => null)
  const { acao, corretor_id, email, senha } = (body ?? {}) as {
    acao?: string; corretor_id?: string; email?: string; senha?: string
  }
  if (!acao || !corretor_id) return json({ error: "payload inválido: acao e corretor_id são obrigatórios" }, 400)
  if ((acao === "criar" || acao === "trocar_senha") && (!senha || senha.length < 6)) {
    return json({ error: "senha deve ter no mínimo 6 caracteres" }, 400)
  }

  const { data: corretor, error: corErr } = await admin
    .from("usuarios")
    .select("id, nome, email, tipo, tipo_corretor, ativo")
    .eq("id", corretor_id)
    .maybeSingle()
  if (corErr) return json({ error: corErr.message }, 500)
  if (!corretor) return json({ error: "corretor não encontrado" }, 404)
  // Beneficiário (Nohros/Beton/Ferretti — migration 041) usa o MESMO fluxo de acesso:
  // usuarios.id é a identidade e a conta do Auth precisa nascer com esse id igual ao corretor.
  if (corretor.tipo !== "corretor" && corretor.tipo !== "beneficiario") {
    return json({ error: `usuário é do tipo '${corretor.tipo}', não corretor/beneficiário` }, 400)
  }

  // Já existe conta de Auth com este id?
  const { data: jaExiste } = await admin.auth.admin.getUserById(corretor_id)
  const temLogin = !!jaExiste?.user

  try {
    if (acao === "trocar_senha") {
      if (!temLogin) return json({ error: "corretor ainda não possui acesso — use a ação 'criar'" }, 400)
      const { error } = await admin.auth.admin.updateUserById(corretor_id, { password: senha })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, user_id: corretor_id })
    }

    if (acao === "gerar_link") {
      if (!temLogin) return json({ error: "corretor ainda não possui acesso — use a ação 'criar'" }, 400)
      const emailLogin = (jaExiste!.user!.email ?? "").toLowerCase()
      // generateLink NÃO dispara email — devolve a URL pro admin repassar como quiser.
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: emailLogin,
      })
      if (linkErr) return json({ error: linkErr.message }, 400)
      return json({ ok: true, user_id: corretor_id, email: emailLogin, link: linkData?.properties?.action_link ?? null })
    }

    if (acao === "criar") {
      if (temLogin) return json({ error: "corretor já possui acesso — use 'trocar_senha' ou 'gerar_link'" }, 400)

      const emailLogin = (email || corretor.email || "").trim().toLowerCase()
      if (!emailLogin) return json({ error: "email é obrigatório para criar acesso" }, 400)
      if (ehPlaceholder(emailLogin)) {
        return json({ error: "email é placeholder do sync (@sync.local) — obtenha o email real do corretor antes" }, 400)
      }
      if (!emailValido(emailLogin)) return json({ error: `email inválido: ${emailLogin}` }, 400)

      // Email repetido em outro cadastro = duplicata de corretor (ex.: DIEGO BENITES em dois
      // cadastros). Dois logins fragmentariam a carteira — consolidar antes.
      const { data: mesmoEmail } = await admin
        .from("usuarios")
        .select("id, nome")
        .ilike("email", emailLogin)
        .neq("id", corretor_id)
      if (mesmoEmail && mesmoEmail.length > 0) {
        return json({
          error: `email já usado por outro cadastro (${mesmoEmail.map((u) => u.nome).join(", ")}) — consolidar antes de criar acesso`,
        }, 409)
      }

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        id: corretor_id, // ver cabeçalho: o id TEM que ser o mesmo do cadastro
        email: emailLogin,
        password: senha,
        email_confirm: true,
        user_metadata: { nome: corretor.nome, role: "corretor" },
      })

      if (createErr) {
        const emailEmUso = /already|registered|exists/i.test(createErr.message ?? "")
        if (emailEmUso) {
          // Existe conta no Auth com esse email, mas com OUTRO id — não dá pra casar com o
          // cadastro sem quebrar a FK. Decisão é humana: consolidar ou usar outro email.
          return json({
            error: "já existe conta no Auth com este email, vinculada a outro id. Não é possível casar com o cadastro automaticamente — resolver manualmente.",
          }, 409)
        }
        return json({ error: createErr.message }, 400)
      }

      const novoId = created?.user?.id
      if (!novoId) return json({ error: "não foi possível criar o usuário de acesso" }, 500)
      if (novoId !== corretor_id) {
        // O GoTrue ignorou o id enviado. Conta criada não serve (o perfil não casaria):
        // remove antes de sair para não deixar órfã.
        await admin.auth.admin.deleteUser(novoId).catch(() => {})
        return json({
          error: `Auth gerou id ${novoId} em vez de ${corretor_id}; conta removida. Esta versão do GoTrue não aceita id na criação.`,
        }, 500)
      }

      // Cadastro já existe (veio do sync) — só garante o email usado no login e o acesso.
      const { error: upErr } = await admin
        .from("usuarios")
        .update({ email: emailLogin, tem_acesso_sistema: true, updated_at: new Date().toISOString() })
        .eq("id", corretor_id)
      if (upErr) return json({ error: `acesso criado, mas falhou ao atualizar o cadastro: ${upErr.message}` }, 500)

      return json({ ok: true, user_id: corretor_id, email: emailLogin })
    }

    return json({ error: `ação desconhecida: ${acao}` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
