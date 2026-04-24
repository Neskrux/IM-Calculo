import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2"
import { loadSupabaseEnv } from "../lib/env.ts"
import { log } from "../lib/log.ts"

let cachedPublic: SupabaseClient | null = null
export function publicClient(): SupabaseClient {
  if (!cachedPublic) {
    const { url, serviceRoleKey } = loadSupabaseEnv()
    cachedPublic = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return cachedPublic
}

export interface UpsertResult {
  action: "inserted" | "updated" | "unchanged"
}

export async function upsertRaw(params: {
  entity: string
  siengeId: string | number
  payload: unknown
  enterpriseId?: string | number | null
  sourceUrl?: string | null
  runId: string
}): Promise<UpsertResult["action"]> {
  const supa = publicClient()
  const { data, error } = await supa.schema("sienge_raw").rpc("upsert_object", {
    p_entity: params.entity,
    p_sienge_id: String(params.siengeId),
    p_payload: params.payload,
    p_enterprise_id: params.enterpriseId != null ? String(params.enterpriseId) : null,
    p_source_url: params.sourceUrl ?? null,
    p_run_id: params.runId,
  })

  if (error) {
    log("error", "upsert_raw_error", { entity: params.entity, siengeId: params.siengeId, error: error.message })
    throw new Error(`upsert_object failed: ${error.message}`)
  }
  return data as UpsertResult["action"]
}

export async function openRun(params: Record<string, unknown>): Promise<string> {
  const supa = publicClient()
  const { data, error } = await supa
    .schema("sienge_raw")
    .from("runs")
    .insert({ params, status: "RUNNING" })
    .select("id")
    .single()
  if (error) throw new Error(`openRun: ${error.message}`)
  return (data as { id: string }).id
}

export async function closeRun(
  runId: string,
  status: "OK" | "PARTIAL" | "ERROR",
  metrics: Record<string, unknown>,
  err?: unknown,
) {
  const supa = publicClient()
  const errJson = err ? { message: String(err), stack: (err as Error)?.stack } : null
  const { error } = await supa
    .schema("sienge_raw")
    .from("runs")
    .update({ finished_at: new Date().toISOString(), status, metrics, error: errJson })
    .eq("id", runId)
  if (error) log("error", "closeRun_error", { runId, error: error.message })
}

export async function getJobEntity(entity: string) {
  const supa = publicClient()
  const { data, error } = await supa
    .from("sienge_sync_jobs")
    .select("entity,last_modified_after,last_run_id,last_status")
    .eq("entity", entity)
    .maybeSingle()
  if (error) throw new Error(`getJobEntity: ${error.message}`)
  return data as {
    entity: string
    last_modified_after: string | null
    last_run_id: string | null
    last_status: string | null
  } | null
}

export async function updateJobEntity(
  entity: string,
  runId: string,
  status: string,
  modifiedAfter: string,
  metrics: Record<string, unknown>,
) {
  const supa = publicClient()
  const { error } = await supa
    .from("sienge_sync_jobs")
    .upsert(
      {
        entity,
        last_run_id: runId,
        last_status: status,
        last_modified_after: modifiedAfter,
        last_metrics: metrics,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "entity" },
    )
  if (error) log("error", "updateJobEntity_error", { entity, error: error.message })
}
