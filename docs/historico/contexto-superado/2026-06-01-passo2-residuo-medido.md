---
status: MEDIÇÃO (Passo 2 do north star) — resíduo classificado contra Sienge fresco
data: 2026-06-01
branch: sync/reconciliacao (worktree IM-reconciliacao)
fonte_fresca: node scripts/reconciliar-todas-vendas.mjs (dry-run) → docs/reconciliacao-geral-2026-06-01-dryrun.json
              + /bulk-data/v1/income selectionType=D (17.567 linhas, puxado hoje, 0 quota)
              + DB Supabase live
---

# Passo 2 — o resíduo medido e classificado (2026-06-01)

> Objetivo (north star): banco local = espelho fiel do Sienge. Este doc é a **foto do resíduo**
> que ainda diverge, medido contra dado **fresco** do Sienge, classificado em determinístico vs negócio.

## Como foi medido

- `node scripts/reconciliar-todas-vendas.mjs` (modo dry-run, **read-only**) — o reconciliador **testado**
  (não código novo divergente). Puxou income fresco via bulk-data (sem quota).
- Resultado bruto: **298 vendas** com bill_id, **17.191 pagamentos** locais, **17.567 linhas** income Sienge.
- **249 vendas com match limpo** + **49 pra revisão humana**. Ações automáticas nas 249: **todas 0**
  (anchoring/marcar-pago/reativar/criar) → o cron já está em steady-state.

## Confiabilidade da fonte (verificado)

- Sienge: **3.719 parcelas pagas / 294 bills**, par `(billId, installmentId)` **100% único** (0 dup, 0 nulo).
  `installmentId` **reinicia por bill** (69 valores distintos sozinho) → chave de match é o **par**, nunca o id sozinho.
- Âncora local: **15.223 linhas (80%) ancoradas e LIMPAS** — 0 duplicata pelo par `(bill_id, installment_id)`.
  O "20% sem âncora" é justamente o resíduo abaixo.

## O resíduo classificado

| Categoria | Qtd | Comissão / valor | Natureza | Ação |
|---|---|---|---|---|
| **`parcela_entrada` PAGAS órfãs** | **52** | **R$ 21.194,06 comissão em dobro** (valor R$ 73.142,56) | 🟢 espúrio determinístico (Sienge não tem) | pago → fluxo "Excluir Baixa" (trigger 017/020) |
| `sinal` PAGO órfão | 2 | R$ 675,96 | 🟡 talvez legítimo (sinal não entra no income) | checar antes de tocar |
| PENDENTES órfãs | 5 | 3 balão (R$ 11.692) + 1 sinal (R$ 1.158,56) + 1 parc_entrada (R$ 1.267,68) | 🟢 falso pendente determinístico | `cancelar` (pendente é livre) |
| Revisão — `soma income ≠ pro_soluto` | 28 | — | 🔴 negócio (pago → pro_soluto imutável) | rodada b (b10) |
| Revisão — `bill sem parcelas no income` | 11 | — | 🟡 provável distrato / sem-movimento | conectar c/ Parte A |
| Revisão — ambíguo (banco/Sienge mesmo tipo,valor,data) | ~10 | — | 🔴 humano genuíno | rodada b (b9) |

### Números-âncora (precisos, não estimados)
- **Dinheiro contado em dobro = R$ 21.194,06** em 52 `parcela_entrada` pagas órfãs.
  (O plano estimava ~R$ 27.552 via detector heurístico — aquele **inflava**; este é ancorado no Sienge.)
- Distribuição de status no banco (2026-06-01): **pago 4.433 · pendente 12.791 · cancelado 1.778** (total 19.002).
- Distratos: **25** vendas `situacao_contrato='3'`. Vendas com bill: **298** (4 sem bill).

## Leitura estratégica

1. **A "fila humana" não é milhares — é ~10 ambíguos + 28 de pro_soluto-negócio.** O resto é determinístico.
   Confirma a tese: **Sienge decide; humano só no que é genuinamente negócio.**
2. **Termômetro de inadimplência (14% inflado vs 4,89% real):** vem dos **falsos pendentes**, e só 5 estão no
   conjunto limpo → o grosso da distorção está nas **49 parqueadas**. Resolver as 49 é o que move esse termômetro.
3. **Comissão dobrada (R$ 21k)** está nos 52 pagos-órfãos → distorce o número que o corretor vê, não a inadimplência.
4. **As 11 "bill sem income"** quase certamente são distratos / contratos sem movimento → fecha o loop com a Parte A.

## Passo 3 (próximo) — o que limpa, em ordem de risco

1. **Cancelar as 5 pendentes órfãs** — pendente é livre (sem trigger), reversível. Quick-win.
2. **"Excluir Baixa" das 52 pagas** (R$ 21k) — dry-run primeiro. Pago → trigger exige status→pendente +
   data_pagamento=NULL no mesmo UPDATE, depois cancelar. **Controlado, não decisão de negócio** (Sienge já provou fantasma).
3. **Atacar as 49 parqueadas** — o que move a inadimplência. Maioria determinística (re-ancorar); ~10 humano + 28 negócio.

> Tudo do Passo 3 **escreve em produção** → gated por ok explícito.
