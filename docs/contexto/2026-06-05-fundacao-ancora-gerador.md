# Fundação do espelho: Âncora + Gerador Idempotente (doc vivo)

> **2026-06-05.** Plano de implementação **atual** da fundação do espelho Sienge. Substitui, na ordem de execução,
> as Fases 1–3 do [`plano-estancar-sangria.md`](2026-06-05-plano-estancar-sangria.md) (que pivotou — ver nota lá).
> Este doc rastreia **o que está feito vs o que falta**.

## A virada de chave (por que este é o caminho)

O curativo de maio expôs que **duplicata** (c129) e **cronograma errado** (c275/803 D) quebram o "banco = Sienge"
**independente** dos 3 termos. Causa-raiz única: as parcelas **não estão ancoradas 1:1 no Sienge** (`sienge_installment_id`,
hoje ~84%) e o gerador cria do **params da venda**, não espelha a grade real do Sienge.

> **Decisão (validada contra o sync):** a fundação é a **âncora** (`installmentId` em toda parcela) + **materializar
> do income** (não gerar dos params). Com isso duplicata e cronograma-errado ficam **estruturalmente impossíveis**
> (1 linha por `installmentId`, índice UNIQUE rejeita o resto), e os 3 termos viram **deriváveis**.
> As tabelas de evento (`cessoes_direitos`/`distratos`) são **auditoria** — fase posterior, não a fundação.

---

## Parte A — Schema (3 campos) · ✅ FEITO

Migrations aplicadas (027–029) + verificadas:
- ✅ `pagamentos_prosoluto.renegociacao_id` (FK → `renegociacoes`, p/ aditivo)
- ✅ `vendas.cliente_id_origem += 'cessao'`
- ✅ `pagamentos_prosoluto.motivo_cancelamento_parcela` (CHECK: duplicata/cronograma_refeito/distrato/aditivo_renegociado/sienge_removeu/outro)
- ✅ Migration 023 (âncora + índice **UNIQUE** `(bill, installment)`) já estava aplicada — espinha dorsal pronta; 0 pares duplicados no pré-check.

**NÃO construído (virou auditoria, fase posterior):** `cessoes_direitos`, `distratos`. O evento de distrato já vive em
`vendas` (`data_distrato`, `motivo_cancelamento`); a cessão o sync não alimenta (sem antes/depois na API).

---

## Parte B — Gerador idempotente (materializar do income)

**B1 — Reconciliador = materializador canônico** · ✅ FEITO (endurecido)
[`scripts/reconciliar-todas-vendas.mjs`] já cria 1 parcela por `installmentId` do income (`selectionType='D'`, lista
completa), ancorada, comissão canônica. Hoje endurecido com **2 proteções críticas**:
- **Distrato-aware:** baixa de liquidação (`income.paymentDate >= data_distrato`) **não conta como pago** → o cron não
  re-paga a baixa.
- **Motivo-aware:** **nunca reativa** parcela cancelada de propósito (`motivo_cancelamento_parcela` setado).
- Marcadas 161 parcelas do curativo (160 `distrato` + 1 `duplicata`).
- ✅ **Verificado: rerun = no-op** (0 popular/marcar/reativar/criar nas 249 vendas limpas) → idempotência da spec +
  prova que **o cron não desfaz o curativo de maio**.

**B2 — Guards no gerador da UI** · ⏳ FALTA
[`src/pages/AdminDashboard.jsx`]: `gerarPagamentosVenda` (~:3486) e `propagarCronogramaCirurgico` (~:645) — não rodar
param-gen em venda ancorada; nunca DELETE em pendente ancorado. Pequeno; precisa build verde.

---

## Parte C — Ancoragem 84%→100% + resíduo · ⏳ FALTA (gated)

**Achado-chave (do dry-run):** o `popular = 0` mostrou que a ancoragem **não sobe rodando o reconciliador** — os ~16%
não-ancorados estão **todos** nas **49 vendas de revisão humana** (S2 soma≠pro_soluto = aditivos; S4 dup = c129; etc).
→ **Chegar a 100% = resolver essas 49**, não um backfill simples.

- **C-3b — duplicatas (c129):** manter a que casa o Sienge, cancelar a gêmea (`motivo='duplicata'`). Gated (rodada-b se ambas pagas reais).
- **C-3c — cronograma errado (c275/803 D):** preservar pago real, cancelar pendente errado (`motivo='cronograma_refeito'`), materializar a grade real do income. Gated (controladoria — 803 D já enviada).
- **C-3d — resíduo legítimo (fica unanchored):** vendas sem bill (412/606), distrato-baixa, aditivo-grade-antiga (fases dos termos).

---

## Verificação

- ✅ **V1 — idempotência:** dry-run = no-op (provado).
- ⏳ **V2 — cobertura:** ancoragem ≈100% após resolver as 49 (query Figueira `excluido=false status<>cancelado`).
- ⏳ **V3 — invariantes:** 0 par dup, 0 pago sem data, 0 pendente com data, todo cancelado novo com motivo.
- ⏳ **V4 — spot-check:** c129 (1 ativa) · c275 (grade = income, 19×2650+37×1500 ancoradas).

---

## Decisões de negócio que travam o *apply* (não o schema/código)

1. **Juros de aditivo:** **NÃO comissionam** (decidido) → `renegociacoes.diferenca_* = 0`.
2. **c275 (803 D):** confirmar regeneração 2-fases com a controladoria (enviada).
3. **412 Gabriel / 606 Gustavo** (sem contrato Sienge): criar ou descartar?

---

## Próximo passo

**B2** (guards da UI, fecha a Parte B) **ou** **C** (resolver as 49 vendas-resíduo p/ ancorar 100% — gated, rodada-b).
Os 3 termos (distrato backfill, aditivo wiring, cessão) são **derivados** que vêm **depois** da fundação ancorada.
