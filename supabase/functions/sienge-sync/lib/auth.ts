import { createClient } from "jsr:@supabase/supabase-js@2"
import { loadSupabaseEnv } from "./env.ts"
import { log } from "./log.ts"

export interface AuthedUser {
  id: string
  email?: string
  tipo: string
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function requireAdmin(req: Request): Promise<AuthedUser> {
  const auth = req.headers.get("Authorization")
  if (!auth?.startsWith("Bearer ")) throw new HttpError(401, "missing bearer token")
  const jwt = auth.slice("Bearer ".length).trim()

  const { url, anonKey, serviceRoleKey } = loadSupabaseEnv()

  // Bypass: chamada server-to-server com service_role (cron, automacoes).
  // service_role ja tem acesso total ao DB — aceitar como auth da edge function
  // e coerente. Comparacao em tempo constante pra evitar timing attack.
  if (serviceRoleKey && jwt.length === serviceRoleKey.length) {
    let diff = 0
    for (let i = 0; i < jwt.length; i++) diff |= jwt.charCodeAt(i) ^ serviceRoleKey.charCodeAt(i)
    if (diff === 0) {
      log("info", "auth_service_role", {})
      return { id: "00000000-0000-0000-0000-000000000000", email: "service-role@system", tipo: "admin" }
    }
  }

  const anon = createClient(url, anonKey)
  const { data: userData, error: userErr } = await anon.auth.getUser(jwt)
  if (userErr || !userData.user) {
    log("warn", "auth_failed", { err: userErr?.message })
    throw new HttpError(401, "invalid token")
  }
  const user = userData.user

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const { data: perfil, error: perfilErr } = await admin
    .from("usuarios")
    .select("id,email,tipo")
    .eq("id", user.id)
    .maybeSingle()

  if (perfilErr) {
    log("error", "profile_lookup_error", { err: perfilErr.message })
    throw new HttpError(500, "profile lookup failed")
  }
  if (!perfil) throw new HttpError(403, "no profile")
  const tipo = String((perfil as { tipo: string }).tipo ?? "").toLowerCase()
  if (tipo !== "admin") throw new HttpError(403, "admin required")

  return { id: user.id, email: user.email, tipo }
}
