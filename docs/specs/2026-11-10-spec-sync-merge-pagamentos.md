# Spec: sync não reescreve parcela cancelada nem ancorada (merge de pagamentos)

**Data:** 2026-11-10 · **Toca:** edge `sienge-sync` (cron de produção) · **Regras:** `.claude/rules/sincronizacao-sienge.md`, `.claude/rules/numeracao-parcelas-sienge.md`

## Problema (medido no histórico, migration 043)
Na rodada de 10/11 (04:37–04:38 BRT, origem `sync`), `normalize/sales-contracts.ts → mergePagamentos` fez 95 UPDATEs:
90 em 55 parcelas **canceladas** e 5 em **pendentes**. Destas, 4 ficaram com valor diferente do Sienge
(1805 A, 803 D ×2, 1004 D — R$ 1.546,89 de comissão a receber distorcida). Nenhuma paga.

## Causa
- O merge casa por `(tipo, numero_parcela)`. O desejado é montado das condições do contrato e cada série
  numera 1..n → duas séries do mesmo tipo (ou sinal/entrada com número nulo) **repetem a chave**.
- O índice de existentes inclui canceladas e guarda a última linha lida (sem ordem) → a cada rodada o valor
  de uma série vai parar na linha da outra (pingue-pongue).
- Ignora `sienge_installment_id`: reescreve linha já ancorada, cuja dona é o income/reconciliador.

## Regra nova
1. Linha `cancelado` → o sync **não escreve** (nem update, nem insert de substituta).
2. Linha com `sienge_installment_id` → o sync **não escreve** (valor/data vêm do income pela âncora).
3. Chave `(tipo, numero_parcela)` repetida **no desejado** → a venda inteira fica sem escrita de pagamentos;
   log `pagamentos_merge_skip_chave_repetida`.
4. Chave repetida **entre existentes** (não canceladas) → aquela chave não é escrita.
5. Sem mudança no resto: `pago` continua intocado; venda nova (sem existentes) e série única seguem iguais.

## Verificação
- `tests/merge-pagamentos.test.js`: duas séries PM + canceladas + ancoradas → 0 escritas; rodar 2× = no-op;
  série única pendente não ancorada → update como hoje; venda nova → insert.
- Pós-deploy: histórico (`pagamentos_prosoluto_historico`, origem `sync`) do cron seguinte sem mudança em cancelada.

## Fora do escopo (lote separado, com ok)
Restaurar as 4 pendentes erradas e varrer pendentes ancoradas com valor ≠ Sienge.
