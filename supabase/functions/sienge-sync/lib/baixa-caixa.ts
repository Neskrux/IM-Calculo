// Tipo da baixa no income do Sienge — o que conta como PAGAMENTO do cliente.
// ver .claude/rules/sincronizacao-sienge.md, secao "Tipo da baixa".
//
// Gemeo de scripts/_baixa-caixa.mjs (o reconciliador roda em Node 20, que nao importa TS).
// Mudou um, mude o outro — tests/baixa-caixa.test.js roda os mesmos casos nos dois.
//
// Regra: pago = ao menos um recibo em dinheiro (Recebimento / Adiantamento / Por Bens) com
// valor > 0 E nenhum recibo nao-dinheiro. Reparcelamento (aditivo) e Distrato sao baixas
// contabeis, nao dinheiro. Tipo desconhecido = nao-dinheiro (na duvida nao marca pago).

export interface Recibo {
  operationTypeName?: string | null
  paymentDate?: string | null
  netAmount?: number | string | null
}

export type MotivoBaixa = "caixa" | "nao_caixa" | "misto" | "sem_baixa"

export const TIPOS_CAIXA = new Set(["Recebimento", "Adiantamento", "Por Bens"])

export function classificarBaixa(inc: { receipts?: Recibo[] | null } | null | undefined): {
  pago: boolean
  motivo: MotivoBaixa
  recibosCaixa: Recibo[]
  tiposNaoCaixa: string[]
} {
  const recibos = Array.isArray(inc?.receipts) ? inc!.receipts! : []
  const recibosCaixa = recibos.filter((r) =>
    TIPOS_CAIXA.has(String(r?.operationTypeName)) && Number(r?.netAmount || 0) > 0 && !!r?.paymentDate
  )
  const tiposNaoCaixa = [...new Set(
    recibos.filter((r) => !TIPOS_CAIXA.has(String(r?.operationTypeName))).map((r) => r?.operationTypeName ?? "(sem tipo)"),
  )]
  let motivo: MotivoBaixa
  if (tiposNaoCaixa.length && recibosCaixa.length) motivo = "misto"
  else if (tiposNaoCaixa.length) motivo = "nao_caixa"
  else if (recibosCaixa.length) motivo = "caixa"
  else motivo = "sem_baixa"
  return { pago: motivo === "caixa", motivo, recibosCaixa, tiposNaoCaixa }
}
