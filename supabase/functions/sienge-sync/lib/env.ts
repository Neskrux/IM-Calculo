export interface SiengeConfig {
  username: string
  password: string
  subdomain: string
  baseUrl: string
  authHeader: string
}

export function loadSiengeConfig(): SiengeConfig {
  const username = Deno.env.get("SIENGE_USERNAME")
  const password = Deno.env.get("SIENGE_PASSWORD")
  const subdomain = Deno.env.get("SIENGE_SUBDOMAIN")

  if (!username || !password || !subdomain) {
    throw new Error(
      "Missing Sienge secrets. Set SIENGE_USERNAME, SIENGE_PASSWORD, SIENGE_SUBDOMAIN via `supabase secrets set`.",
    )
  }

  const authHeader = "Basic " + btoa(`${username}:${password}`)
  const baseUrl = `https://api.sienge.com.br/${subdomain}/public/api/v1`

  return { username, password, subdomain, baseUrl, authHeader }
}

export function loadSupabaseEnv() {
  const url = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")

  if (!url || !serviceRoleKey || !anonKey) {
    throw new Error("Missing Supabase env (SUPABASE_URL / SERVICE_ROLE_KEY / ANON_KEY).")
  }

  return { url, serviceRoleKey, anonKey }
}
