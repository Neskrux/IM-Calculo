// Plano puro do merge de pagamentos do sync (sales-contracts). Sem I/O — testado em
// tests/merge-pagamentos.test.js. Spec: docs/specs/2026-11-10-spec-sync-merge-pagamentos.md
// ver .claude/rules/sincronizacao-sienge.md e .claude/rules/numeracao-parcelas-sienge.md
//
// O desejado vem das condições do contrato e casa por (tipo, numero_parcela) — chave fraca:
// cada série numera 1..n, então duas séries do mesmo tipo repetem a chave. Por isso o sync:
//   - nunca escreve em linha `cancelado` (nem cria substituta);
//   - nunca escreve em linha com `sienge_installment_id` (dona = income, pela âncora);
//   - nunca escreve em `pago`;
//   - não escreve nada na venda se a chave vier repetida no desejado;
//   - não escreve numa chave que já está repetida entre existentes ativas.

export interface PagamentoDesejado {
  tipo: string
  numero_parcela: number | null
  valor: number
  data_prevista: string | null
  comissao_gerada: number
  fator_comissao_aplicado: number
  percentual_comissao_total: number
  [k: string]: unknown
}

export interface PagamentoExistente {
  id: string
  tipo: string
  numero_parcela: number | null
  status: string | null
  valor: number | null
  data_prevista: string | null
  comissao_gerada: number | null
  fator_comissao_aplicado: number | null
  percentual_comissao_total: number | null
  sienge_installment_id?: string | null
}

export interface PlanoMerge {
  inserts: PagamentoDesejado[]
  updates: Array<{ id: string; body: Record<string, unknown> }>
  skip: number
  motivoSkip: "chave_repetida" | null
}

const moneyChanged = (a: unknown, b: unknown) => Math.abs((Number(a) || 0) - (Number(b) || 0)) > 0.005
const numberChanged = (a: unknown, b: unknown) => Math.abs((Number(a) || 0) - (Number(b) || 0)) > 0.000001
const chave = (tipo: string, np: number | null) => `${tipo}|${np ?? "null"}`

export function planejarMergePagamentos(desejados: PagamentoDesejado[], existentes: PagamentoExistente[]): PlanoMerge {
  const vistos = new Set<string>()
  for (const d of desejados) {
    const k = chave(d.tipo, d.numero_parcela)
    if (vistos.has(k)) return { inserts: [], updates: [], skip: desejados.length, motivoSkip: "chave_repetida" }
    vistos.add(k)
  }

  const porChave = new Map<string, PagamentoExistente[]>()
  for (const r of existentes) {
    const k = chave(r.tipo, r.numero_parcela)
    porChave.set(k, [...(porChave.get(k) ?? []), r])
  }

  const plano: PlanoMerge = { inserts: [], updates: [], skip: 0, motivoSkip: null }
  for (const d of desejados) {
    const linhas = porChave.get(chave(d.tipo, d.numero_parcela)) ?? []
    if (linhas.length === 0) { plano.inserts.push(d); continue }
    const ativas = linhas.filter((r) => r.status !== "cancelado")
    if (ativas.length !== 1) { plano.skip++; continue } // só cancelada, ou ambígua
    const ex = ativas[0]
    if (ex.status === "pago" || ex.sienge_installment_id) { plano.skip++; continue }

    const body: Record<string, unknown> = {}
    if (moneyChanged(ex.valor, d.valor)) body.valor = d.valor
    if (!ex.data_prevista && d.data_prevista) body.data_prevista = d.data_prevista
    if (moneyChanged(ex.comissao_gerada, d.comissao_gerada)) body.comissao_gerada = d.comissao_gerada
    if (numberChanged(ex.fator_comissao_aplicado, d.fator_comissao_aplicado)) body.fator_comissao_aplicado = d.fator_comissao_aplicado
    if (numberChanged(ex.percentual_comissao_total, d.percentual_comissao_total)) body.percentual_comissao_total = d.percentual_comissao_total
    if (Object.keys(body).length > 0) plano.updates.push({ id: ex.id, body })
    else plano.skip++
  }
  return plano
}
