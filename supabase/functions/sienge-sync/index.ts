import "@supabase/functions-js/edge-runtime.d.ts"
import { HttpError, requireAdmin } from "./lib/auth.ts"
import { log } from "./lib/log.ts"
import { openRun, publicClient } from "./raw/writer.ts"
import { type Entity, runSync } from "./orchestrator/run.ts"
import { siengeGet } from "./transport/client.ts"

// EdgeRuntime é injetado pelo Supabase. Tipamos só o que usamos.
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined

// Roda sync em background — handler devolve runId em <1s, worker continua processando.
function queueInBackground(task: () => Promise<unknown>) {
  const p = task().catch((e) => log("error", "background_task_failed", { err: String(e) }))
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(p)
}

const VALID_ENTITIES: Entity[] = ["customers", "creditors", "enterprises", "units", "sales-contracts", "receivable-bills"]

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/sienge-sync/, "") || "/"

  try {
    if (req.method === "GET" && path === "/stats") {
      await requireAdmin(req)
      const supa = publicClient()
      const { data, error } = await supa.schema("sienge_raw").from("summary").select("*")
      if (error) throw error
      return json({ stats: data })
    }

    const runIdMatch = path.match(/^\/runs\/([0-9a-f-]{36})$/i)
    if (req.method === "GET" && runIdMatch) {
      await requireAdmin(req)
      const supa = publicClient()
      const { data, error } = await supa
        .schema("sienge_raw")
        .from("runs")
        .select("*")
        .eq("id", runIdMatch[1])
        .maybeSingle()
      if (error) throw error
      if (!data) return json({ error: "run not found" }, 404)
      return json({ run: data })
    }

    if (req.method === "GET" && path === "/runs") {
      await requireAdmin(req)
      const supa = publicClient()
      const { data, error } = await supa
        .schema("sienge_raw")
        .from("runs")
        .select("id,started_at,finished_at,status,params,metrics")
        .order("started_at", { ascending: false })
        .limit(20)
      if (error) throw error
      return json({ runs: data })
    }

    if (req.method === "POST" && (path === "/sync/incremental" || path === "/sync/full")) {
      await requireAdmin(req)
      const fullSync = path === "/sync/full"
      let body: { entities?: string[] } = {}
      try { body = await req.json() } catch { /* empty body ok */ }
      const requested = (body.entities ?? VALID_ENTITIES).filter((e): e is Entity =>
        (VALID_ENTITIES as string[]).includes(e)
      )
      if (requested.length === 0) return json({ error: "no valid entities" }, 400)

      // Abre o run sincrono (rápido), devolve runId e roda sync em background.
      // Cliente polla /runs/:runId pra acompanhar status.
      const runId = await openRun({ entities: requested, fullSync, mode: fullSync ? "full" : "incremental" })
      queueInBackground(() => runSync({ entities: requested, fullSync, preOpenedRunId: runId }))
      return json({ runId, status: "QUEUED", mode: fullSync ? "full" : "incremental" }, 202)
    }

    if (req.method === "POST" && path === "/sync/normalize-only") {
      await requireAdmin(req)
      let body: { entities?: string[]; offset?: number; limit?: number; apiBudget?: number } = {}
      try { body = await req.json() } catch { /* empty body ok */ }
      const requested = (body.entities ?? VALID_ENTITIES).filter((e): e is Entity =>
        (VALID_ENTITIES as string[]).includes(e)
      )
      if (requested.length === 0) return json({ error: "no valid entities" }, 400)

      const runId = await openRun({ entities: requested, fullSync: true, mode: "normalize-only", offset: body.offset, limit: body.limit, apiBudget: body.apiBudget })
      queueInBackground(() => runSync({
        entities: requested,
        fullSync: true,
        skipIngest: true,
        offset: body.offset,
        limit: body.limit,
        apiBudget: body.apiBudget,
        preOpenedRunId: runId,
      }))
      return json({ runId, status: "QUEUED", mode: "normalize-only" }, 202)
    }

    if (req.method === "POST" && path === "/probe") {
      // Sonda qualquer endpoint da API Sienge (admin-only). 1 call por POST.
      // Usado pra descobrir formato de endpoints antes de codificar normalize.
      await requireAdmin(req)
      let body: { path?: string; query?: Record<string, string | number> } = {}
      try { body = await req.json() } catch { /* empty body ok */ }
      if (!body.path || typeof body.path !== "string") return json({ error: "path required" }, 400)
      const r = await siengeGet({ path: body.path, query: body.query })
      return json({ status: r.status, url: r.url, data: r.data })
    }

    return json({ error: "not found", path }, 404)
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    log("error", "handler_crash", { err: String(err), stack: (err as Error)?.stack })
    return json({ error: String(err) }, 500)
  }
})
