import { publicClient } from "../raw/writer.ts"
import { log } from "../lib/log.ts"

/* ------------------------------------------------------------------
 * Tipos do payload Sienge (sales-contracts)
 * ---------------------------------------------------------------- */

interface PaymentCondition {
  conditionTypeId?: string
  conditionTypeName?: string
  installmentsNumber?: number | string
  totalValue?: number | string
  firstPayment?: string
}

interface SalesContractCustomer { id?: number | string; main?: boolean; name?: string }
interface SalesContractUnit { id?: number | string; main?: boolean; name?: string }
interface SalesContractBroker { id?: number | string; main?: boolean; name?: string }

interface SalesContractPayload {
  id: number | string
  number?: string | number
  situation?: string | number
  value?: number | string
  totalSellingValue?: number | string
  contractDate?: string
  issueDate?: string
  expectedDeliveryDate?: string
  cancellationDate?: string | null
  cancellationReason?: string | null
  receivableBillId?: number | string | null
  enterpriseId?: number | string
  enterpriseName?: string
  paymentConditions?: PaymentCondition[]
  salesContractCustomers?: SalesContractCustomer[]
  salesContractUnits?: SalesContractUnit[]
  brokers?: SalesContractBroker[]
  lastUpdateDate?: string
}

/* ------------------------------------------------------------------
 * Regras de cálculo (espelho de src/utils/comissaoCalculator.js)
 * ---------------------------------------------------------------- */

function calcularFator(valorVenda: number, valorProSoluto: number, percentualTotal: number): number {
  if (valorProSoluto <= 0) return 0
  return (valorVenda * (percentualTotal / 100)) / valorProSoluto
}

function calcularComissaoPagamento(valorParcela: number, fator: number): number {
  return valorParcela * fator
}

/* ------------------------------------------------------------------
 * Mapeamento paymentConditions -> tipos internos
 *
 * PRO-SOLUTO (entram na comissão): AT, SN, PM, EN, BA, B1..B9, BN
 * NÃO PRO-SOLUTO (ignorar): CA, FI, CV
 * ---------------------------------------------------------------- */

interface CondicaoInterna {
  tipo: "sinal" | "entrada" | "parcela_entrada" | "balao" | "bens"
  qtd: number
  valorParcela: number
  valorTotal: number
  primeiroVencimento: string | null
}

interface PaymentData {
  teve_sinal: boolean
  valor_sinal: number | null
  teve_entrada: boolean
  valor_entrada: number | null
  parcelou_entrada: boolean
  qtd_parcelas_entrada: number | null
  valor_parcela_entrada: number | null
  teve_balao: "sim" | "nao"
  qtd_balao: number | null
  valor_balao: number | null
  teve_bens: boolean
  valor_bens: number | null
  valor_pro_soluto: number
  condicoes: CondicaoInterna[]
}

const TIPOS_IGNORAR = new Set(["CA", "FI", "CV"])

function mapearPaymentConditions(conds: PaymentCondition[] | undefined): PaymentData {
  const out: PaymentData = {
    teve_sinal: false, valor_sinal: null,
    teve_entrada: false, valor_entrada: null, parcelou_entrada: false,
    qtd_parcelas_entrada: null, valor_parcela_entrada: null,
    teve_balao: "nao", qtd_balao: null, valor_balao: null,
    teve_bens: false, valor_bens: null,
    valor_pro_soluto: 0,
    condicoes: [],
  }
  if (!Array.isArray(conds)) return out

  for (const c of conds) {
    const tipoId = String(c.conditionTypeId || "").toUpperCase()
    if (TIPOS_IGNORAR.has(tipoId)) continue

    const totalValue = Number(c.totalValue) || 0
    const qtd = Math.max(1, Number(c.installmentsNumber) || 1)
    const valorParcela = totalValue / qtd
    const primeiro = c.firstPayment || null

    if (tipoId === "AT" || tipoId === "SN") {
      out.teve_sinal = true
      out.valor_sinal = (out.valor_sinal || 0) + totalValue
      out.valor_pro_soluto += totalValue
      out.condicoes.push({ tipo: "sinal", qtd: 1, valorParcela: totalValue, valorTotal: totalValue, primeiroVencimento: primeiro })
      continue
    }
    if (tipoId === "PM") {
      out.teve_entrada = true
      out.parcelou_entrada = true
      out.qtd_parcelas_entrada = (out.qtd_parcelas_entrada || 0) + qtd
      out.valor_parcela_entrada = valorParcela
      out.valor_entrada = (out.valor_entrada || 0) + totalValue
      out.valor_pro_soluto += totalValue
      out.condicoes.push({ tipo: "parcela_entrada", qtd, valorParcela, valorTotal: totalValue, primeiroVencimento: primeiro })
      continue
    }
    if (tipoId === "EN") {
      out.teve_entrada = true
      out.valor_entrada = (out.valor_entrada || 0) + totalValue
      out.valor_pro_soluto += totalValue
      out.condicoes.push({ tipo: "entrada", qtd: 1, valorParcela: totalValue, valorTotal: totalValue, primeiroVencimento: primeiro })
      continue
    }
    if (tipoId === "BA" || /^B[1-9]$/.test(tipoId)) {
      out.teve_balao = "sim"
      out.qtd_balao = (out.qtd_balao || 0) + qtd
      out.valor_balao = valorParcela
      out.valor_pro_soluto += totalValue
      out.condicoes.push({ tipo: "balao", qtd, valorParcela, valorTotal: totalValue, primeiroVencimento: primeiro })
      continue
    }
    if (tipoId === "BN") {
      out.teve_bens = true
      out.valor_bens = (out.valor_bens || 0) + totalValue
      out.valor_pro_soluto += totalValue
      out.condicoes.push({ tipo: "bens", qtd: 1, valorParcela: totalValue, valorTotal: totalValue, primeiroVencimento: primeiro })
      continue
    }
    log("debug", "sales_contracts_unknown_payment_type", { tipoId, name: c.conditionTypeName, totalValue })
  }
  return out
}

/* ------------------------------------------------------------------
 * Lookups (FKs) — cache por run
 * ---------------------------------------------------------------- */

interface Maps {
  empByEnt: Map<string, { id: string; com_ext: number; com_int: number }>
  unitBySienge: Map<string, string>
  cliBySienge: Map<string, string>
  corBySienge: Map<string, { id: string; tipo: string }>
}

async function loadMaps(): Promise<Maps> {
  const supa = publicClient()
  const [empR, uniR, cliR, corR] = await Promise.all([
    supa.from("empreendimentos").select("id,sienge_enterprise_id,comissao_total_externo,comissao_total_interno").not("sienge_enterprise_id", "is", null),
    supa.from("unidades").select("id,sienge_unit_id").not("sienge_unit_id", "is", null),
    supa.from("clientes").select("id,sienge_customer_id").not("sienge_customer_id", "is", null),
    supa.from("usuarios").select("id,sienge_broker_id,tipo_corretor").not("sienge_broker_id", "is", null),
  ])

  const empByEnt = new Map<string, { id: string; com_ext: number; com_int: number }>()
  for (const r of empR.data ?? []) {
    empByEnt.set(String(r.sienge_enterprise_id), {
      id: r.id,
      com_ext: Number(r.comissao_total_externo) || 7,
      com_int: Number(r.comissao_total_interno) || 6,
    })
  }
  const unitBySienge = new Map<string, string>()
  for (const r of uniR.data ?? []) unitBySienge.set(String(r.sienge_unit_id), r.id)
  const cliBySienge = new Map<string, string>()
  for (const r of cliR.data ?? []) cliBySienge.set(String(r.sienge_customer_id), r.id)
  const corBySienge = new Map<string, { id: string; tipo: string }>()
  for (const r of corR.data ?? []) corBySienge.set(String(r.sienge_broker_id), { id: r.id, tipo: r.tipo_corretor ?? "externo" })

  return { empByEnt, unitBySienge, cliBySienge, corBySienge }
}

/* ------------------------------------------------------------------
 * Situação / status
 * ---------------------------------------------------------------- */

function normalizarSituacao(s: unknown): string {
  if (typeof s === "string") {
    const map: Record<string, string> = { Solicitado: "0", Autorizado: "1", Emitido: "2", Cancelado: "3" }
    return map[s] ?? s
  }
  return String(s)
}

/* ------------------------------------------------------------------
 * Construção das linhas de pagamentos_prosoluto para uma venda
 * ---------------------------------------------------------------- */

interface PagamentoRow {
  venda_id: string
  tipo: string
  numero_parcela: number | null
  valor: number
  data_prevista: string | null
  comissao_gerada: number
  fator_comissao_aplicado: number
  percentual_comissao_total: number
}

function montarPagamentos(vendaId: string, p: PaymentData, valorVenda: number, percentualTotal: number, dataVenda: string | null): PagamentoRow[] {
  const fator = calcularFator(valorVenda, p.valor_pro_soluto, percentualTotal)
  const rows: PagamentoRow[] = []

  for (const cond of p.condicoes) {
    for (let i = 0; i < cond.qtd; i++) {
      let dataPrev: string | null = cond.primeiroVencimento
      if (cond.primeiroVencimento) {
        const d = new Date(cond.primeiroVencimento)
        if (cond.tipo === "parcela_entrada") d.setMonth(d.getMonth() + i)
        else if (cond.tipo === "balao") d.setFullYear(d.getFullYear() + i)
        dataPrev = d.toISOString().slice(0, 10)
      } else {
        dataPrev = dataVenda
      }
      rows.push({
        venda_id: vendaId,
        tipo: cond.tipo,
        numero_parcela: (cond.tipo === "parcela_entrada" || cond.tipo === "balao") ? i + 1 : null,
        valor: Number(cond.valorParcela.toFixed(2)),
        data_prevista: dataPrev,
        comissao_gerada: Number(calcularComissaoPagamento(cond.valorParcela, fator).toFixed(2)),
        fator_comissao_aplicado: fator,
        percentual_comissao_total: percentualTotal,
      })
    }
  }
  return rows
}

/* ------------------------------------------------------------------
 * Merge de pagamentos respeitando linhas pagas (migration 017)
 *
 * Chave de match: (venda_id, tipo, numero_parcela)
 * - pago  → NÃO altera valor/tipo/data_pagamento/comissao_gerada
 * - pendente existente → update valor, data_prevista, snapshots, comissao_gerada
 * - novo → insert
 * ---------------------------------------------------------------- */

async function mergePagamentos(vendaId: string, desejados: PagamentoRow[]): Promise<{ ins: number; upd: number; skip: number }> {
  const supa = publicClient()
  const { data: existentes, error } = await supa
    .from("pagamentos_prosoluto")
    .select("id, tipo, numero_parcela, status")
    .eq("venda_id", vendaId)
  if (error) throw new Error(`pagamentos.select: ${error.message}`)

  const key = (tipo: string, np: number | null) => `${tipo}|${np ?? "null"}`
  const mapEx = new Map<string, { id: string; status: string | null }>()
  for (const r of existentes ?? []) mapEx.set(key(r.tipo, r.numero_parcela), { id: r.id, status: r.status })

  const now = new Date().toISOString()
  const toInsert: Record<string, unknown>[] = []
  const updatesPendente: Array<{ id: string; body: Record<string, unknown> }> = []
  const updatesPago: Array<{ id: string; body: Record<string, unknown> }> = []

  for (const d of desejados) {
    const k = key(d.tipo, d.numero_parcela)
    const ex = mapEx.get(k)
    if (!ex) {
      toInsert.push({ ...d, status: "pendente", created_at: now, updated_at: now })
    } else if (ex.status === "pago") {
      // Migration 017: não tocar em valor/tipo/data_pagamento/comissao_gerada.
      // Snapshots de fator/percentual são editáveis (migration 018).
      updatesPago.push({
        id: ex.id,
        body: {
          fator_comissao_aplicado: d.fator_comissao_aplicado,
          percentual_comissao_total: d.percentual_comissao_total,
          updated_at: now,
        },
      })
    } else {
      updatesPendente.push({
        id: ex.id,
        body: {
          valor: d.valor,
          data_prevista: d.data_prevista,
          comissao_gerada: d.comissao_gerada,
          fator_comissao_aplicado: d.fator_comissao_aplicado,
          percentual_comissao_total: d.percentual_comissao_total,
          updated_at: now,
        },
      })
    }
  }

  let ins = 0, upd = 0, skip = 0

  if (toInsert.length > 0) {
    const { error: e } = await supa.from("pagamentos_prosoluto").insert(toInsert)
    if (e) log("error", "pagamentos_batch_insert_error", { vendaId, count: toInsert.length, err: e.message })
    else ins = toInsert.length
  }

  if (updatesPendente.length > 0) {
    const results = await Promise.all(
      updatesPendente.map((u) => supa.from("pagamentos_prosoluto").update(u.body).eq("id", u.id)),
    )
    for (const r of results) {
      if (r.error) log("error", "pagamentos_update_pendente_error", { err: r.error.message })
      else upd++
    }
  }

  if (updatesPago.length > 0) {
    const results = await Promise.all(
      updatesPago.map((u) => supa.from("pagamentos_prosoluto").update(u.body).eq("id", u.id)),
    )
    for (const r of results) {
      if (r.error) log("warn", "pagamentos_update_pago_error", { err: r.error.message })
      else skip++
    }
  }

  return { ins, upd, skip }
}

/* ------------------------------------------------------------------
 * Upsert venda
 * ---------------------------------------------------------------- */

async function upsertVenda(
  contract: SalesContractPayload,
  maps: Maps,
): Promise<{ vendaId: string | null; p: PaymentData; percentualTotal: number }> {
  const supa = publicClient()
  const cliP = contract.salesContractCustomers?.find((c) => c.main) ?? contract.salesContractCustomers?.[0]
  const uniP = contract.salesContractUnits?.find((u) => u.main) ?? contract.salesContractUnits?.[0]
  const corP = contract.brokers?.find((b) => b.main) ?? contract.brokers?.[0]

  const empInfo = contract.enterpriseId != null ? maps.empByEnt.get(String(contract.enterpriseId)) ?? null : null
  const unidadeId = uniP?.id != null ? maps.unitBySienge.get(String(uniP.id)) ?? null : null
  const clienteId = cliP?.id != null ? maps.cliBySienge.get(String(cliP.id)) ?? null : null
  const corretor = corP?.id != null ? maps.corBySienge.get(String(corP.id)) ?? null : null

  // Observabilidade: broker do Sienge sem cadastro local vira corretor_id=null silenciosamente,
  // o que ja causou vendas orfas (ver docs/revisao-geral-2026-05-13.md). Logar pra runs.metrics.warnings
  // ajuda a pegar antes de virar queixa do corretor.
  if (corP?.id != null && !corretor) {
    console.warn(JSON.stringify({
      warning: 'broker_sienge_sem_cadastro_local',
      sienge_contract_id: String(contract.id),
      broker_sienge_id: String(corP.id),
      broker_name: corP.name ?? null,
    }))
  }

  const tipoCorretor = corretor?.tipo ?? "externo"
  const percentualTotal = empInfo ? (tipoCorretor === "interno" ? empInfo.com_int : empInfo.com_ext) : 7
  const paymentData = mapearPaymentConditions(contract.paymentConditions)
  const valorVenda = Number(contract.value) || 0
  const fatorComissao = calcularFator(valorVenda, paymentData.valor_pro_soluto, percentualTotal)
  const situacao = normalizarSituacao(contract.situation)

  const row = {
    sienge_contract_id: String(contract.id),
    numero_contrato: contract.number != null ? String(contract.number) : null,
    corretor_id: corretor?.id ?? null,
    cliente_id: clienteId,
    empreendimento_id: empInfo?.id ?? null,
    unidade_id: unidadeId,
    tipo_corretor: tipoCorretor,
    valor_venda: valorVenda,
    valor_venda_total: Number(contract.totalSellingValue ?? contract.value ?? 0) || 0,
    data_venda: contract.contractDate || null,
    data_emissao: contract.issueDate || null,
    data_entrega_prevista: contract.expectedDeliveryDate || null,
    descricao: `Contrato ${contract.number ?? contract.id}`,
    status: situacao === "2" ? "pago" : "pendente",
    situacao_contrato: situacao,
    sienge_broker_id: corP?.id != null ? String(corP.id) : null,
    sienge_unit_id: uniP?.id != null ? String(uniP.id) : null,
    sienge_customer_id: cliP?.id != null ? String(cliP.id) : null,
    unidade: uniP?.name ?? null,
    teve_sinal: paymentData.teve_sinal,
    valor_sinal: paymentData.valor_sinal,
    teve_entrada: paymentData.teve_entrada,
    valor_entrada: paymentData.valor_entrada,
    parcelou_entrada: paymentData.parcelou_entrada,
    qtd_parcelas_entrada: paymentData.qtd_parcelas_entrada,
    valor_parcela_entrada: paymentData.valor_parcela_entrada,
    teve_balao: paymentData.teve_balao,
    qtd_balao: paymentData.qtd_balao,
    valor_balao: paymentData.valor_balao,
    valor_pro_soluto: paymentData.valor_pro_soluto,
    fator_comissao: fatorComissao,
    data_cancelamento: contract.cancellationDate ?? null,
    motivo_cancelamento: contract.cancellationReason ?? null,
    sienge_updated_at: contract.lastUpdateDate ? new Date(contract.lastUpdateDate).toISOString() : new Date().toISOString(),
  }

  // Preserva correcoes manuais (migration 021 + .claude/rules/sincronizacao-sienge.md):
  // se a venda existente foi corrigida por humano (corretor_id_origem='manual' ou
  // 'api_commissions') ou cliente_id_origem='manual', mantem os ids atuais e a flag
  // de origem. Sem isso, todo sync sobrescreve a correcao — a flag virava decorativa.
  const { data: existente } = await supa
    .from("vendas")
    .select("corretor_id, corretor_id_origem, cliente_id, cliente_id_origem, tipo_corretor")
    .eq("sienge_contract_id", String(contract.id))
    .maybeSingle()

  const rowProtegido = { ...row } as Record<string, unknown>
  if (existente?.corretor_id_origem === "manual" || existente?.corretor_id_origem === "api_commissions") {
    rowProtegido.corretor_id = existente.corretor_id
    // tipo_corretor anda junto: se corretor manual aponta pra interno, manter interno;
    // senao o sync recalcularia percentualTotal com base no tipo errado.
    if (existente.tipo_corretor) rowProtegido.tipo_corretor = existente.tipo_corretor
    rowProtegido.corretor_id_origem = existente.corretor_id_origem
  }
  if (existente?.cliente_id_origem === "manual") {
    rowProtegido.cliente_id = existente.cliente_id
    rowProtegido.cliente_id_origem = existente.cliente_id_origem
  }

  const now = new Date().toISOString()
  // Idempotente: upsert por sienge_contract_id evita race em múltiplos runs simultâneos
  // (dois workers chegando no mesmo contrato não explodem com UNIQUE violation — o 2º vira UPDATE)
  const { data, error } = await supa
    .from("vendas")
    .upsert({ ...rowProtegido, created_at: now, updated_at: now }, { onConflict: "sienge_contract_id" })
    .select("id")
    .single()
  if (error) throw new Error(`vendas.upsert: ${error.message}`)
  return { vendaId: (data as { id: string }).id, p: paymentData, percentualTotal }
}

/* ------------------------------------------------------------------
 * Entry point — chamado pelo orchestrator
 * ---------------------------------------------------------------- */


export async function normalizeSalesContracts(
  _runId: string,
  opts: { offset?: number; limit?: number } = {},
): Promise<{ inserted: number; updated: number; errors: number; extra?: Record<string, unknown> }> {
  const supa = publicClient()
  // Ordenação estável por sienge_id pra paginação confiável entre invocações.
  // Piloto: já filtra Figueira no SQL (evita trazer raws de outros empreendimentos).
  const query = supa
    .schema("sienge_raw")
    .from("objects")
    .select("sienge_id,payload,enterprise_id", { count: "exact" })
    .eq("entity", "sales-contracts")
    .order("sienge_id", { ascending: true })

  const offset = Math.max(0, Number(opts.offset) || 0)
  const limit = Math.max(1, Number(opts.limit) || 40)
  const { data: raws, error: rawErr, count: totalCount } = await query.range(offset, offset + limit - 1)
  if (rawErr) throw new Error(`raw.objects(sales-contracts): ${rawErr.message}`)

  const total = totalCount ?? 0
  const hasMore = offset + (raws?.length ?? 0) < total
  log("info", "normalize_sales_contracts_scope", {
    total, offset, limit, fetched: raws?.length ?? 0, hasMore,
  })
  if (!raws?.length) return { inserted: 0, updated: 0, errors: 0, extra: { total, offset, limit, hasMore: false } }

  const ordered = raws

  const maps = await loadMaps()

  // Pré-carrega IDs de vendas já existentes em 1 única query (evita N SELECTs no loop)
  const { data: existingVendasRows } = await supa
    .from("vendas")
    .select("sienge_contract_id")
    .not("sienge_contract_id", "is", null)
  const existingVendas = new Set<string>(
    (existingVendasRows ?? []).map((r) => String((r as { sienge_contract_id: string }).sienge_contract_id)),
  )

  let inserted = 0, updated = 0, errors = 0
  let pagIns = 0, pagUpd = 0, pagSkip = 0

  // Paraleliza em chunks: ganho ~5-8x vs serial. CHUNK moderado evita saturar pool PostgREST.
  const CHUNK = 6
  const rows = ordered as Array<{ sienge_id: string; payload: SalesContractPayload }>
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK)
    const results = await Promise.all(batch.map(async (r) => {
      try {
        const existedBefore = existingVendas.has(String(r.payload.id))
        const { vendaId, p, percentualTotal } = await upsertVenda(r.payload, maps)
        if (!vendaId) return { ok: false as const }
        const valorVenda = Number(r.payload.value) || 0
        const desejados = montarPagamentos(vendaId, p, valorVenda, percentualTotal, r.payload.contractDate ?? null)
        const merge = await mergePagamentos(vendaId, desejados)
        return { ok: true as const, existedBefore, merge }
      } catch (e) {
        log("error", "normalize_sales_contract_error", { siengeId: r.sienge_id, err: String(e) })
        return { ok: false as const }
      }
    }))
    for (const r of results) {
      if (!r.ok) { errors++; continue }
      if (r.existedBefore) updated++; else inserted++
      pagIns += r.merge.ins; pagUpd += r.merge.upd; pagSkip += r.merge.skip
    }
  }

  return {
    inserted, updated, errors,
    extra: {
      total, offset, limit, fetched: raws.length, hasMore,
      pagamentos: { inseridos: pagIns, atualizados: pagUpd, pagos_preservados: pagSkip },
    },
  }
}
