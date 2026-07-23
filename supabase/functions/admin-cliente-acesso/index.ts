// Edge function — Gestão de acesso do CLIENTE pelo admin (service role).
//
// Por que existe: o front (anon key) não consegue (1) criar usuário sem trocar a
// sessão do admin pela do cliente recém-criado (signUp loga o novo user) nem
// (2) trocar a senha de OUTRO usuário. Aqui o chamador é validado como admin
// (JWT + usuarios.tipo='admin') e as operações usam auth.admin.* com service role.
//
// verify_jwt da plataforma fica DESLIGADO (o preflight OPTIONS do browser não leva
// Authorization e seria bloqueado); a autenticação é feita AQUI, no corpo da função.
//
// Rotas (POST, JSON):
//   { acao: 'criar',        cliente_id, email, senha } → cria user no Auth (sem tocar
//     na sessão do admin), vincula clientes.user_id e upserta usuarios tipo 'cliente'.
//     Se o email já existir no Auth, redefine a senha informada e vincula mesmo assim.
//   { acao: 'trocar_senha', cliente_id, senha }        → redefine a senha do user
//     vinculado ao cliente (auth.admin.updateUserById).
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
  const { acao, cliente_id, email, senha } = (body ?? {}) as {
    acao?: string; cliente_id?: string; email?: string; senha?: string
  }
  if (!acao || !cliente_id) return json({ error: "payload inválido: acao e cliente_id são obrigatórios" }, 400)
  if (!senha || senha.length < 6) return json({ error: "senha deve ter no mínimo 6 caracteres" }, 400)

  const { data: cliente, error: cliErr } = await admin
    .from("clientes")
    .select("id, user_id, email, nome_completo")
    .eq("id", cliente_id)
    .maybeSingle()
  if (cliErr) return json({ error: cliErr.message }, 500)
  if (!cliente) return json({ error: "cliente não encontrado" }, 404)

  // Vincula o user do Auth ao cliente (clientes.user_id) e garante usuarios tipo 'cliente'
  const vincular = async (userId: string, emailLogin: string) => {
    const { error: upCliErr } = await admin
      .from("clientes")
      .update({ user_id: userId, email: emailLogin })
      .eq("id", cliente_id)
    if (upCliErr) throw new Error(upCliErr.message)
    const { error: upUsrErr } = await admin
      .from("usuarios")
      .upsert(
        { id: userId, nome: cliente.nome_completo, email: emailLogin, tipo: "cliente", ativo: true },
        { onConflict: "id" },
      )
    if (upUsrErr) throw new Error(upUsrErr.message)
  }

  try {
    if (acao === "trocar_senha") {
      if (!cliente.user_id) return json({ error: "cliente ainda não possui acesso — use a ação 'criar'" }, 400)
      const { error } = await admin.auth.admin.updateUserById(cliente.user_id, { password: senha })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, user_id: cliente.user_id })
    }

    if (acao === "criar") {
      if (cliente.user_id) return json({ error: "cliente já possui acesso — use a ação 'trocar_senha'" }, 400)
      const emailLogin = (email || cliente.email || "").trim().toLowerCase()
      if (!emailLogin) return json({ error: "email é obrigatório para criar acesso" }, 400)

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: emailLogin,
        password: senha,
        email_confirm: true,
        user_metadata: { nome: cliente.nome_completo, role: "cliente" },
      })

      let userId = created?.user?.id ?? null

      if (createErr) {
        const jaExiste = /already|registered|exists/i.test(createErr.message ?? "")
        if (!jaExiste) return json({ error: createErr.message }, 400)
        // Email já existe no Auth: localizar o user via generateLink (não envia email)
        // e redefinir a senha informada — comportamento herdado do fluxo antigo do front.
        const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
          type: "recovery",
          email: emailLogin,
        })
        if (linkErr || !linkData?.user?.id) {
          return json({ error: "email já cadastrado no Auth, mas não foi possível localizar o usuário" }, 400)
        }
        userId = linkData.user.id
        const { error: pwErr } = await admin.auth.admin.updateUserById(userId, { password: senha })
        if (pwErr) return json({ error: pwErr.message }, 400)
      }

      if (!userId) return json({ error: "não foi possível criar o usuário de acesso" }, 500)
      await vincular(userId, emailLogin)
      return json({ ok: true, user_id: userId })
    }

    return json({ error: `ação desconhecida: ${acao}` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
