import { siengePaginate } from "../transport/client.ts"
import { closeRun, getJobEntity, openRun, updateJobEntity, upsertRaw } from "../raw/writer.ts"
import { normalizeCustomers } from "../normalize/customers.ts"
import { normalizeSalesContracts } from "../normalize/sales-contracts.ts"
import { normalizeReceivableBills } from "../normalize/receivable-bills.ts"
import { log } from "../lib/log.ts"

export type Entity = "customers" | "creditors" | "enterprises" | "units" | "sales-contracts" | "receivable-bills"

/**
 * Escopo atual do sync (ver .claude/rules/sincronizacao-sienge.md).
 * Até decisão explícita de negócio, todo ingest que tenha enterpriseId filtra pra Figueira Garcia.
 * Os outros empreendimentos da IM permanecem cadastrados mas não entram no sync.
 */
const FIGUEIRA_GARCIA_ENTERPRISE_ID = 2104

type NormalizeResult = { inserted: number; updated: number; errors: number; extra?: Record<string, unknown> }

export interface NormalizeOpts {
  offset?: number
  limit?: number
  apiBudget?: number
}

interface EntityConfig {
  path?: string
  idField?: string
  enterpriseIdField?: string
  supportsModifiedAfter: boolean
  /** Se true, pula a fase de ingest (API→RAW) — só roda normalize. */
  skipIngest?: boolean
  normalize?: (runId: string, opts?: NormalizeOpts) => Promise<NormalizeResult>
}

const ENTITY_CONFIG: Record<Entity, EntityConfig> = {
  customers: {
    path: "/customers",
    idField: "id",
    supportsModifiedAfter: true,
    normalize: normalizeCustomers,
  },
  creditors: {
    path: "/creditors",
    idField: "id",
    supportsModifiedAfter: false,
  },
  enterprises: {
    path: "/enterprises",
    idField: "id",
    supportsModifiedAfter: false,
  },
  units: {
    path: "/units",
    idField: "id",
    enterpriseIdField: "enterpriseId",
    supportsModifiedAfter: false,
  },
  "sales-contracts": {
    path: "/sales-contracts",
    idField: "id",
    enterpriseIdField: "enterpriseId",
    supportsModifiedAfter: true,
    normalize: normalizeSalesContracts,
  },
  "receivable-bills": {
    // Sem list endpoint — normalize busca por venda via receivableBillId.
    supportsModifiedAfter: false,
    skipIngest: true,
    normalize: normalizeReceivableBills,
  },
}

export interface RunOptions {
  entities: Entity[]
  fullSync?: boolean
  runIncremental?: boolean
  /** Pula ingest API→RAW pra todas as entidades. Usado quando RAW já está fresco e só precisa normalizar. */
  skipIngest?: boolean
  /** Chunking: offset de onde começar dentro do conjunto normalizável. */
  offset?: number
  /** Chunking: qtd de itens a processar nesta invocação. */
  limit?: number
  /** Budget máximo de calls na API Sienge nesta invocação (receivable-bills usa isso pra respeitar o limite diário). */
  apiBudget?: number
  /** Run já aberto externamente — handler abre, dispara em background e devolve runId sem esperar. */
  preOpenedRunId?: string
}

export interface RunResult {
  runId: string
  status: "OK" | "PARTIAL" | "ERROR"
  metrics: Record<string, unknown>
}

export async function runSync(opts: RunOptions): Promise<RunResult> {
  const runId = opts.preOpenedRunId ?? await openRun({ entities: opts.entities, fullSync: !!opts.fullSync })
  log("info", "run_started", { runId, entities: opts.entities, fullSync: !!opts.fullSync })

  const startedAt = new Date().toISOString()
  const perEntity: Record<string, unknown> = {}
  let totalInserted = 0
  let totalUpdated = 0
  let totalUnchanged = 0
  let totalErrors = 0
  const errors: string[] = []

  for (const entity of opts.entities) {
    const cfg = ENTITY_CONFIG[entity]
    if (!cfg) {
      errors.push(`unknown entity: ${entity}`)
      totalErrors++
      continue
    }

    try {
      const job = await getJobEntity(entity)
      const modifiedAfter = !opts.fullSync && cfg.supportsModifiedAfter ? job?.last_modified_after ?? undefined : undefined

      let inserted = 0, updated = 0, unchanged = 0, errCount = 0, total = 0

      if (!opts.skipIngest && !cfg.skipIngest && cfg.path && cfg.idField) {
        const query: Record<string, string | number | undefined> = {}
        if (modifiedAfter) query.modifiedAfter = modifiedAfter
        if (cfg.enterpriseIdField) query.enterpriseId = FIGUEIRA_GARCIA_ENTERPRISE_ID

        for await (const page of siengePaginate<Record<string, unknown>>({ path: cfg.path, query })) {
          for (const item of page) {
            total++
            const siengeId = item[cfg.idField] as string | number | undefined
            if (siengeId == null) { errCount++; continue }
            const enterpriseId = cfg.enterpriseIdField ? (item[cfg.enterpriseIdField] as string | number | null | undefined) ?? null : null
            try {
              const action = await upsertRaw({ entity, siengeId, payload: item, enterpriseId, runId })
              if (action === "inserted") inserted++
              else if (action === "updated") updated++
              else unchanged++
            } catch (e) {
              errCount++
              log("error", "upsert_item_error", { entity, siengeId, err: String(e) })
            }
          }
        }
      }

      let normalizeMetrics: NormalizeResult | null = null
      const shouldNormalize = cfg.normalize && (cfg.skipIngest || opts.skipIngest || inserted > 0 || updated > 0 || opts.fullSync)
      if (cfg.normalize && shouldNormalize) {
        try {
          normalizeMetrics = await cfg.normalize(runId, { offset: opts.offset, limit: opts.limit, apiBudget: opts.apiBudget })
        } catch (e) {
          errors.push(`normalize(${entity}): ${String(e)}`)
          log("error", "normalize_error", { entity, err: String(e) })
        }
      }

      perEntity[entity] = { total, inserted, updated, unchanged, errors: errCount, normalize: normalizeMetrics }
      totalInserted += inserted
      totalUpdated += updated
      totalUnchanged += unchanged
      totalErrors += errCount

      await updateJobEntity(
        entity,
        runId,
        errCount === 0 ? "OK" : "PARTIAL",
        startedAt,
        perEntity[entity] as Record<string, unknown>,
      )
    } catch (e) {
      totalErrors++
      errors.push(`${entity}: ${String(e)}`)
      perEntity[entity] = { error: String(e) }
      log("error", "entity_sync_error", { entity, err: String(e) })
    }
  }

  const metrics = {
    inserted: totalInserted,
    updated: totalUpdated,
    unchanged: totalUnchanged,
    errors: totalErrors,
    per_entity: perEntity,
    errors_detail: errors,
  }

  const status: "OK" | "PARTIAL" | "ERROR" =
    totalErrors === 0 ? "OK" : totalInserted + totalUpdated > 0 ? "PARTIAL" : "ERROR"

  await closeRun(runId, status, metrics)
  log("info", "run_finished", { runId, status, metrics })

  return { runId, status, metrics }
}
