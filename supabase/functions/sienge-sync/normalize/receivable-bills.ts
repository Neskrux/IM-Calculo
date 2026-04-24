import { publicClient, upsertRaw } from "../raw/writer.ts"
import { siengeGet } from "../transport/client.ts"
import { log } from "../lib/log.ts"

/**
 * Entity receivable-bills (via bulk-data /income)
 *
 * Sweep completa: paginar /bulk-data/v1/income (sem quota de 100/dia),
 * filtrar por companyId=5 e janela de data, e marcar pagamentos_prosoluto
 * como pago + data_pagamento.
 *
 * Match: (venda_id via sienge_contract_id, numero_parcela)
 * Fallback: (venda_id, valor ±0,01, |data_prevista - dueDate| <= 30d)
 */

const COMPANY_ID = 5
// Janela ampla — pega histórico inteiro da empresa. Se endpoint exigir chunking por data,
// cliente pode invocar normalize-only várias vezes com offset diferente no próprio endpoint.
const DEFAULT_START_DATE = "2015-01-01"
const PAGE_SIZE = 200

interface IncomePayload {
  // Campos esperados do /bulk-data/v1/income (descobertos via probe):
  companyId?: number | string
  enterpriseId?: number | string
  receivableBillId?: number | string
  billReceivableId?: number | string
  contractId?: number | string
  salesContractId?: number | string
  installmentNumber?: number | string
  installmentId?: number | string
  dueDate?: string | null
  paymentDate?: string | null
  originalAmount?: number | string
  generatedAmount?: number | string
  netAmount?: number | string
  paidAmount?: number | string
  paidValue?: number | string
  receipts?: Array<{ paymentDate?: string; netAmount?: number; grossAmount?: number }>
}

interface BulkResponse {
  resultSetMetadata?: { count?: number; offset?: number; limit?: number }
  results?: IncomePayload[]
  data?: IncomePayload[] | { results?: IncomePayload[] }
  income?: IncomePayload[]
  bills?: IncomePayload[]
}

function extractRows(pageData: BulkResponse | IncomePayload[] | unknown): IncomePayload[] {
  if (Array.isArray(pageData)) return pageData as IncomePayload[]
  if (!pageData || typeof pageData !== "object") return []
  const p = pageData as BulkResponse
  if (Array.isArray(p.results)) return p.results
  if (Array.isArray(p.income)) return p.income
  if (Array.isArray(p.bills)) return p.bills
  if (Array.isArray(p.data)) return p.data as IncomePayload[]
  if (p.data && typeof p.data === "object" && Array.isArray((p.data as { results?: IncomePayload[] }).results)) {
    return (p.data as { results: IncomePayload[] }).results
  }
  return []
}

interface PagRow {
  id: string
  venda_id: string
  numero_parcela: number | null
  valor: number
  data_prevista: string | null
  status: string | null
  data_pagamento: string | null
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function daysDiff(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000
}

function isValidIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(s)) return false
  const d = new Date(s)
  return !isNaN(d.getTime())
}

function firstPaymentDate(inc: IncomePayload): string | null {
  if (inc.paymentDate && isValidIsoDate(inc.paymentDate)) return inc.paymentDate.slice(0, 10)
  if (Array.isArray(inc.receipts) && inc.receipts.length > 0) {
    const dates = inc.receipts
      .map((r) => r.paymentDate)
      .filter((d): d is string => !!d && isValidIsoDate(d))
      .sort()
    if (dates[0]) return dates[0].slice(0, 10)
  }
  return null
}

function contractIdOf(inc: IncomePayload): string | null {
  const c = inc.contractId ?? inc.salesContractId ?? inc.receivableBillId ?? inc.billReceivableId
  return c != null ? String(c) : null
}

function installmentNumOf(inc: IncomePayload): number | null {
  const n = Number(inc.installmentNumber)
  return Number.isFinite(n) && n > 0 ? n : null
}

function valueOf(inc: IncomePayload): number {
  const v = Number(inc.paidAmount ?? inc.paidValue ?? inc.netAmount ?? inc.generatedAmount ?? inc.originalAmount)
  return Number.isFinite(v) ? v : 0
}

function matchPag(inc: IncomePayload, pags: PagRow[]): PagRow | null {
  const num = installmentNumOf(inc)
  if (num) {
    const exact = pags.find((p) => p.numero_parcela === num)
    if (exact) return exact
  }
  const valor = valueOf(inc)
  const due = parseDate(inc.dueDate ?? null)
  if (!valor || !due) return null
  let best: PagRow | null = null
  let bestScore = Infinity
  for (const p of pags) {
    if (Math.abs(p.valor - valor) > 0.01) continue
    const prev = parseDate(p.data_prevista)
    const diff = prev ? daysDiff(prev, due) : 9999
    if (diff <= 30 && diff < bestScore) { best = p; bestScore = diff }
  }
  return best
}

export async function normalizeReceivableBills(
  runId: string,
  opts: { offset?: number; limit?: number; apiBudget?: number } = {},
): Promise<{ inserted: number; updated: number; errors: number; extra?: Record<string, unknown> }> {
  const supa = publicClient()

  const apiBudget = Math.max(1, Number(opts.apiBudget) || 200)
  const startDate = DEFAULT_START_DATE
  const endDate = new Date().toISOString().slice(0, 10)

  // Carrega índice venda↔pagamentos uma vez (evita query por contrato).
  const { data: vendas, error: vErr } = await supa
    .from("vendas")
    .select("id,sienge_contract_id")
    .not("sienge_contract_id", "is", null)
  if (vErr) throw new Error(`vendas.select: ${vErr.message}`)
  const vendaByContract = new Map<string, string>()
  for (const v of vendas ?? []) if (v.sienge_contract_id) vendaByContract.set(String(v.sienge_contract_id), v.id)

  const vendaIds = Array.from(new Set(Array.from(vendaByContract.values())))
  const pagByVenda = new Map<string, PagRow[]>()

  // Paginar pagamentos_prosoluto em batches de 100 ids (URL fica ~4KB, evita HTTP/2 stream error).
  const BATCH = 100
  for (let i = 0; i < vendaIds.length; i += BATCH) {
    const slice = vendaIds.slice(i, i + BATCH)
    const { data: pgs, error: pErr } = await supa
      .from("pagamentos_prosoluto")
      .select("id,venda_id,numero_parcela,valor,data_prevista,status,data_pagamento")
      .in("venda_id", slice)
    if (pErr) throw new Error(`pagamentos.select: ${pErr.message}`)
    for (const p of pgs ?? []) {
      const row: PagRow = {
        id: p.id,
        venda_id: p.venda_id,
        numero_parcela: p.numero_parcela,
        valor: Number(p.valor) || 0,
        data_prevista: p.data_prevista,
        status: p.status,
        data_pagamento: p.data_pagamento,
      }
      const arr = pagByVenda.get(p.venda_id) ?? []
      arr.push(row)
      pagByVenda.set(p.venda_id, arr)
    }
  }

  log("info", "normalize_rb_bulk_scope", {
    companyId: COMPANY_ID, startDate, endDate, vendas: vendaByContract.size, apiBudget,
  })

  let apiCalls = 0
  let offset = 0
  let totalRowsSeen = 0
  let matched = 0, noMatch = 0, noContractMatch = 0, noPaymentDate = 0
  let updated = 0, drift = 0, invalidDate = 0, errUpdate = 0
  let budgetExhausted = false

  while (true) {
    if (apiCalls >= apiBudget) { budgetExhausted = true; break }
    apiCalls++
    let pageData: BulkResponse | IncomePayload[]
    try {
      const r = await siengeGet<BulkResponse | IncomePayload[]>({
        path: "/bulk-data/v1/income",
        query: {
          startDate,
          endDate,
          selectionType: "P", // P = data de pagamento (vem só quem pagou)
          companyId: COMPANY_ID,
          limit: PAGE_SIZE,
          offset,
        },
      })
      pageData = r.data
    } catch (e) {
      log("error", "bulk_income_page_fail", { offset, err: String(e) })
      break
    }

    const rows = extractRows(pageData)
    if (apiCalls === 1) {
      const sample = Array.isArray(pageData) ? { type: "array", len: pageData.length }
        : { type: "object", keys: Object.keys(pageData as Record<string, unknown>), topLevelLen: rows.length }
      log("info", "rb_bulk_first_page_shape", sample)
    }
    totalRowsSeen += rows.length
    if (rows.length === 0) break

    for (const inc of rows) {
      const contractId = contractIdOf(inc)
      if (!contractId) { noContractMatch++; continue }
      const vendaId = vendaByContract.get(contractId)
      if (!vendaId) { noContractMatch++; continue }
      const pd = firstPaymentDate(inc)
      if (!pd) { noPaymentDate++; continue }

      const pags = pagByVenda.get(vendaId) ?? []
      const hit = matchPag(inc, pags)
      if (!hit) { noMatch++; continue }
      matched++

      if (hit.status === "cancelado") continue
      if (hit.status === "pago" && hit.data_pagamento === pd) continue
      if (hit.status === "pago") {
        drift++
        log("warn", "rb_drift", { id: hit.id, banco: hit.data_pagamento, sienge: pd })
        continue
      }

      const { error } = await supa.from("pagamentos_prosoluto").update({
        status: "pago",
        data_pagamento: pd,
        updated_at: new Date().toISOString(),
      }).eq("id", hit.id)
      if (error) {
        errUpdate++
        log("warn", "rb_update_fail", { id: hit.id, err: error.message })
        continue
      }
      updated++
      // Marca como já-pago no índice local pra não re-matchar na mesma sweep
      hit.status = "pago"
      hit.data_pagamento = pd
    }

    if (rows.length < PAGE_SIZE) break
    offset += rows.length
  }

  try {
    await upsertRaw({
      entity: "receivable-bills",
      siengeId: `sweep-${runId}`,
      payload: { sweep: { runId, companyId: COMPANY_ID, startDate, endDate, apiCalls, totalRowsSeen, updated, drift } },
      runId,
    })
  } catch (e) { log("warn", "rb_raw_sweep_upsert_fail", { err: String(e) }) }

  return {
    inserted: 0, updated, errors: errUpdate,
    extra: {
      companyId: COMPANY_ID, startDate, endDate,
      apiCalls, apiBudget, budgetExhausted,
      totalRowsSeen, matched, noMatch, noContractMatch, noPaymentDate,
      drift, invalidDate,
    },
  }
}
