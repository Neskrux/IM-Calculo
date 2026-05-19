# P0 — Auditoria do RAW (sienge_raw.objects) vs. pagamentos_prosoluto

**Data:** 2026-04-22
**Fonte:** `sienge_raw.objects` (434 sales-contracts) + `pagamentos_prosoluto` (21.660 linhas) + `vendas`
**Método:** read-only, offline, sem chamar API Sienge (quota exausta)
**Escopo:** validar se **data_prevista** está correta ANTES do backfill de data_pagamento
**ver:** [.claude/rules/sincronizacao-sienge.md](../.claude/rules/sincronizacao-sienge.md)

---

## TL;DR

| Pergunta | Resposta |
|----------|----------|
| Dá pra validar data_prevista com o que temos hoje, sem API? | **Sim.** Todo `firstPayment` do Sienge já está no payload RAW |
| data_prevista está batendo com o Sienge? | **Sim**, para o grosso (parcelas_entrada/PM). 0,21% de edge cases NULL isolados |
| Backfill de API precisa mexer em data_prevista? | **Não.** Só mexe em `data_pagamento` + `status` |
| Tem gap de cobertura no normalize? | **Sim, grande.** 8 conditionTypes não mapeados — soma R$ 21M+ de valores invisíveis |
| Tem contratos "fantasma"? | **Sim, 35.** Contratos Emitidos no Sienge sem uma linha em `pagamentos_prosoluto` |

---

## 1. Cobertura geral

| Métrica | Valor |
|---------|-------|
| Contratos em `sienge_raw.objects` (sales-contracts) | **434** |
| Contratos ligados a venda (match `sienge_contract_id`) | 434 (**100%**) ✅ |
| Contratos órfãos (RAW sem venda no DB) | **0** ✅ |
| Contratos com `paymentConditions=[]` | 0 |
| Vendas ligadas ao RAW **sem nenhum pagamento_prosoluto** | **35** ⚠️ |
| Total linhas em `pagamentos_prosoluto` | 21.660 |
| Linhas `status='pago'` | 647 (~2,98%) |
| Linhas com `data_prevista = NULL` | **45** ⚠️ |

---

## 2. Mapa completo de `conditionTypeId` no RAW

25 tipos distintos. Marcação vs. [normalize/sales-contracts.ts](../supabase/functions/sienge-sync/normalize/sales-contracts.ts):

| ID | Nome | Ocorrências | Valor Total (R$) | Tratado hoje? | Vira tipo interno |
|----|------|------------:|-----------------:|:-------------:|-------------------|
| `PM` | Parcelas Mensais | 416 | 34.679.948 | ✅ | `parcela_entrada` |
| `CA` | Crédito Associativo | 361 | 119.991.583 | ✅ ignora | (não pro-soluto) |
| `AT` | Ato | 138 | 3.441.976 | ✅ | `sinal` |
| `B1` | Balão 1 | 101 | 1.986.131 | ✅ | `balao` |
| `B2` | Balão 2 | 90 | 1.644.755 | ✅ | `balao` |
| `B3` | Balão 3 | 87 | 1.344.225 | ✅ | `balao` |
| `B4` | Balão 4 | 76 | 937.284 | ✅ | `balao` |
| `B5` | Balão 5 | 48 | 935.744 | ✅ | `balao` |
| `BN` | Bens | 36 | 9.831.877 | ✅ | `bens` |
| `SN` | Sinal | 27 | 536.634 | ✅ | `sinal` |
| **`CH`** | **Entrega das chaves** | **22** | **4.571.701** | ❌ **ignorado silencioso** | ? |
| **`PU`** | **Parcela Única** | **15** | **11.460.118** | ❌ **ignorado silencioso** | ? |
| **`PE`** | **Permuta** | **14** | **5.551.477** | ❌ **ignorado silencioso** | ? |
| `BA` | Balão Anual | 14 | 897.436 | ✅ | `balao` |
| `B6` | Balão 6 | 10 | 130.083 | ✅ | `balao` |
| `B8` | Balão 8 | 6 | 315.586 | ✅ | `balao` |
| `B7` | Balão 7 | 5 | 39.000 | ✅ | `balao` |
| `FI` | Financiamento | 5 | 2.106.490 | ✅ ignora | (não pro-soluto) |
| **`PA`** | **Parcelas Anuais** | **2** | **1.000.000** | ❌ **ignorado silencioso** | ? |
| **`PD`** | **Parcelamento Direto IM** | **1** | **587.550** | ❌ **ignorado silencioso** | ? (36 parcelas) |
| **`PS`** | **Balões Semestrais** | **1** | **510.000** | ❌ **ignorado silencioso** | ? (17 parcelas) |
| **`BQ`** | **Balões Quadrimestrais** | **1** | **135.000** | ❌ **ignorado silencioso** | ? (9 parcelas) |
| **`"10"`** | **BALÃO10** | **1** | **2.000** | ❌ **não bate com regex** `^B[1-9]$` | `balao`? |
| `B9` | Balão 9 | 1 | 2.000 | ✅ | `balao` |
| `CV` | Comissão de Venda | 1 | 16.919 | ✅ ignora | (não pro-soluto) |

### ⚠️ Gaps críticos do normalize

**Total de valor "invisível" no normalize atual:** R$ 23.819.846 (CH + PU + PE + PA + PD + PS + BQ + "10")

Hoje o [mapearPaymentConditions](../supabase/functions/sienge-sync/normalize/sales-contracts.ts) só reconhece: AT, SN, PM, EN, BA, B1-B9, BN. Tudo que não bater cai em `log('debug', 'unknown_payment_type')` e **nunca vira linha em `pagamentos_prosoluto`**.

**Decisões de negócio pendentes** (precisam validação do stakeholder):
- `CH` (Entrega das chaves): é pro-soluto? vira tipo `balao_final` / `chaves`? ou ignora como CA/FI?
- `PU` (Parcela Única): vira `sinal` ou `entrada`? Ou cria tipo novo `parcela_unica`?
- `PE` (Permuta): pro-soluto ou ignorar como financiamento?
- `PA` (Parcelas Anuais), `PS` (Balões Semestrais), `BQ` (Balões Quadrimestrais), `PD` (Parcelamento Direto IM): subtipos de `balao` ou tipos próprios?
- `"10"`: casuística rara (1 ocorrência, R$ 2.000) — fix do regex `^B([1-9]|10)$` resolve

---

## 3. Linhas com `data_prevista = NULL` (45 total)

### 3a. De contratos RAW (7 linhas — fix automático via backfill RAW)
| sienge_contract_id | numero_contrato | tipo | parcelas afetadas |
|---|---|---|---|
| 299 | 207 | balao | 2, 3, 4, 5 (4 linhas) |
| 340 | 243 | balao | 2, 3, 4 (3 linhas) |

**Causa provável (hipótese a validar):** o Sienge envia `B1, B2, B3...` como `conditionType` **separados**, cada um com `installmentsNumber=1`. O [normalize atual](../supabase/functions/sienge-sync/normalize/sales-contracts.ts#L218) trata cada um como cond separada → gera linha única com `numero_parcela=1` pra cada. Na chave `(venda_id, tipo, numero_parcela)`, todas colidem em `(v, balao, 1)` e só a última sobrevive. As outras ficaram como linhas antigas geradas pelo `syncVendasV2.js` (frontend) com `numero_parcela=2..5` e `data_prevista=NULL`.

**Ação:** quando normalize rodar em cima do RAW dessas vendas, vai gerar as linhas certas, **mas a 017+018 podem bloquear update** se alguma já estiver `pago`. Investigar case-a-case.

### 3b. De vendas manuais sem RAW (38 linhas)
Vendas com `sienge_contract_id IS NULL` — criadas pela interface [ImportarVendas.jsx](../src/components/ImportarVendas.jsx) ou Admin sem passar pelo sync. 6 vendas distintas:

| venda_id | tipo | parcelas NULL |
|---|---|---:|
| 9b6d5bf3-… | balao | 14 |
| 22833c5c-… | balao | 5 |
| ad2d2d32-… | balao | 4 |
| bd0483d9-… | balao | 4 |
| 624897e1-… | balao | 4 |
| 2026ca9d-… | balao | 5 |
| e1220449-… | balao | 1 |

**Backend saudável:** adicionar `NOT NULL` em `pagamentos_prosoluto.data_prevista` **depois** de limpar essas 45 linhas (via fluxo manual / fix específico). Sem isso, a invariante da spec ("data_prevista é sempre preenchida") é violada no schema.

---

## 4. Os 35 contratos sem pagamentos

**Todos** estão com `situation='Emitido'` no Sienge e **todos** têm `paymentConditions` não-vazio. Portanto **não é** caso de contrato cancelado — é bug/gap do sync que não gerou as linhas.

**Hipóteses:**
1. Contratos cuja `paymentConditions` é composta **só** por tipos ignorados (CA + FI + CV) → `valor_pro_soluto = 0` → montarPagamentos retorna array vazio
2. Se a hipótese (1) for verdade, **CH/PU/PE/PA/PD/PS/BQ não entram em nada** e também dão valor_pro_soluto = 0

**Investigação rápida proposta** (próxima query): identificar quais dos 35 contratos caem em (1) vs outra causa.

---

## 5. Validação de `data_prevista` — amostra

Amostra de 3 contratos Emitidos (PM / parcela_entrada):

| contract_id | firstPayment (RAW) | db_min_data | db_max_data | db_qtd | raw_qtd |
|---|---|---|---|---:|---:|
| 418 | 2026-03-20 | 2026-03-20 | 2030-09-20 | 55 | 55 |
| 115 | 2024-10-12 | 2024-10-12 | 2029-12-12 | 63 | 63 |
| 388 | 2026-01-20 | 2026-01-20 | 2030-08-20 | 56 | 56 |

**✅ Match perfeito** nos 3 casos: primeira data = firstPayment, quantidade bate, última data = firstPayment + (qtd-1) meses.

Conclusão: a lógica de geração de `data_prevista` para `parcela_entrada` (PM → mês a mês) está correta. Rodar o normalize de `sales-contracts` **de novo** nos 434 contratos RAW não vai gerar drift significativo em PM — só vai arrumar os edge cases de balões múltiplos (item 3a).

---

## 6. Baseline de status (baseline do backfill)

| status | qtd | pct |
|---|---:|---:|
| pendente | 21.013 | 97,02% |
| pago | 647 | 2,98% |

**Invariantes spec:**
- `status='pago'` + `data_pagamento IS NULL`: checar → (rodar SQL)
- `status='pendente'` + `data_pagamento IS NOT NULL`: checar → (rodar SQL)

**Meta pós-backfill de income:** ~95% pago, ~5% pendente (refletindo inadimplência real da carteira Sienge).

---

## 7. Próximos passos

1. **Decidir conditionTypes** (CH, PU, PE, PA, PD, PS, BQ, "10") com stakeholder — atualizar `mapearPaymentConditions` + spec ANTES de rodar backfill
2. **Investigar 35 contratos "fantasma"** (query detalhada nas paymentConditions deles) — confirmar hipótese
3. **Validar invariantes de status** (2 queries SQL rápidas)
4. **Esperar quota Sienge liberar** (~5h41min) + rodar `discover-sienge-income.mjs` e `discover-sienge-outcome.mjs` pra responder os GAPS de `data_pagamento` e definir `outcome`
5. **Atualizar spec** com desenho final (conditionTypes validados, colunas novas se outcome exigir, política de drift/cancelamento refinada)
6. **Escrever backfill final** — UPDATE-only, preserva IDs, respeita 017+018
