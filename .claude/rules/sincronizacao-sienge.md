# Regra: Sincronização Sienge — Fonte da Verdade

## Princípio fundamental

**O Sienge é a fonte da verdade financeira.** Lá os dados passam pela controladoria e financeiro da IM, e é o que corretor/admin valida na hora de fechar repasse. O banco local (`pagamentos_prosoluto`) deve ser um **espelho fiel** do que está no Sienge — nunca uma aproximação, nunca um cálculo derivado.

Quando corretor/admin abre o dashboard ou gera relatório de repasse:
- **`data_prevista`** → deve bater com a data prevista de vencimento no Sienge
- **`data_pagamento`** → deve bater com a data real em que o cliente pagou (extrato bancário)
- **`status`** → deve refletir o estado atual no Sienge (`pago` só quando Sienge confirma baixa)

Se divergir, corretor perde confiança no sistema — e aí ele vai conferir tudo manualmente no Sienge de qualquer forma, tornando o IM-Calculo inútil.

---

## Escopo atual do sync (2026-04-23 em diante)

**Único `enterpriseId` ativo:** `2104` (FIGUEIRA GARCIA).

Até decisão explícita de negócio, todos os syncs com Sienge filtram por esse `enterpriseId`. Os outros empreendimentos da IM (Laguna 2105, Sintropia 2107, River 2103, Girassol 2102, Áurea 2108, Lotus) permanecem cadastrados em `empreendimentos` mas:
- **Não entram em sync** (orchestrator injeta `enterpriseId=2104` em toda entidade com `enterpriseIdField`).
- **Não têm vendas/pagamentos** no banco local — cleanup de 2026-04-22 removeu 140 vendas, 4815 pagamentos, 276 unidades, 135 RAW sales-contracts não-Figueira.
- **Continuam visíveis nos dropdowns/admin** (empreendimentos como entidade permanecem) — só não carregam dado transacional.

**Motivação:** sistema hoje é exclusivamente operado pra Figueira. Qualquer venda/pagamento de outro empreendimento no banco é ruído — confunde corretor/admin e gasta requisição REST na quota de 100/dia.

**Constante canônica:** `FIGUEIRA_GARCIA_ENTERPRISE_ID = 2104` em [supabase/functions/sienge-sync/orchestrator/run.ts](supabase/functions/sienge-sync/orchestrator/run.ts). Quando negócio liberar outro empreendimento, trocar de constante única para lista/config e atualizar esta regra **antes** do código.

---

## Os dois endpoints massivos do Sienge (bulk-data)

O Sienge expõe dois conjuntos massivos via `/bulk-data/v1/` sem quota diária (diferente da REST v1, que é 100/dia). **Ambos são necessários** pra fechar o ciclo:

### 1. `/bulk-data/v1/income` — Contas a Receber (pro-soluto recebido da IM → cliente)
- Retorna parcelas que **o cliente pagou para a IM** (pro-soluto, sinal, entrada, balões)
- Campos-chave: `contractId`, `installmentNumber`, `dueDate`, `paymentDate`, `paidAmount`, `receipts[]`
- Use pra popular: `data_pagamento` + `status='pago'` em `pagamentos_prosoluto`
- Filtro recomendado: `selectionType="P"` (só quem já pagou) + `companyId=5`

### 2. `/bulk-data/v1/outcome` (ou `/expense`) — Contas a Pagar (comissões/repasse IM → corretor)
- Retorna parcelas que **a IM paga para terceiros** (corretores, parceiros, etc.)
- Use pra validar datas reais de repasse de comissão, quando for relevante pra relatório

Os dois endpoints complementam: `income` fecha o lado cliente→IM (status das parcelas pro-soluto); `outcome` fecha o lado IM→corretor (quando a comissão foi de fato repassada).

**Hoje o sistema só usa `income`** — suficiente pra resolver o problema imediato dos 96% "pendentes" falsos. `outcome` entra numa segunda fase, depois que o income estiver 100%.

---

## As 3 colunas críticas de `pagamentos_prosoluto`

```
data_prevista  date null,          -- do Sienge: installment.dueDate
data_pagamento date null,          -- do Sienge: installment.paymentDate (ou receipts[0].paymentDate)
status         text default 'pendente'  -- 'pago' SSE Sienge confirmou baixa; senão 'pendente'
```

**Invariantes:**
1. `status='pago'` → `data_pagamento IS NOT NULL` (sempre). Nunca marcar pago sem data.
2. `status='pendente'` → `data_pagamento IS NULL` (sempre). Se o Sienge "despagou" (raro), reverter os dois juntos.
3. `data_prevista` é sempre preenchida (vem do `dueDate` do Sienge na criação da venda).

Drift detectado (data_pagamento do banco ≠ data do Sienge): **logar em `runs.metrics.drift[]`** E corrigir no mesmo run (post-migration 020). Sienge é a verdade — silenciar correção cria débito; não corrigir cria desconfiança. A métrica existe pra auditoria humana depois, não pra travar o sync.

---

## Regra de escrita (protegida por migrations 017 + 018 + 020)

Trigger impede UPDATE em linhas `status='pago'` das colunas **financeiras imutáveis**: `tipo`, `valor`, `comissao_gerada`.

**Liberado em pago** (editável via sync):
- `data_pagamento` → **migration 020 (2026-04-23)**. Sienge é fonte da verdade financeira; se data local divergir do extrato, sync corrige pra espelhar. Motivação: 278+ drifts detectados na Etapa 3 onde data local vinha de lançamento manual com +20/+40 dias vs extrato real.
- `data_prevista` (não bloqueada por trigger) → Sienge é fonte da verdade também pra data prevista. Se o dueDate do Sienge mudou (renegociação), atualizar no local mesmo em `status='pago'`. O histórico financeiro fica preservado em `data_pagamento`; `data_prevista` descreve sempre a previsão vigente.
- `numero_parcela` (não bloqueada) → editável pra corrigir re-numeração (bug do gerador antigo que criava múltiplos balões com seq=1).
- `fator_comissao_aplicado`, `percentual_comissao_total` → migration 018 (snapshots/metadados, não financeiros).

**Princípio único aplicado a qualquer campo temporal/descritivo:**
> Se Sienge divergir do local em `data_prevista`, `data_pagamento`, `numero_parcela` ou qualquer metadado de parcela, Sienge vence. Status pendente/pago não blinda esses campos — só os financeiros imutáveis (tipo, valor, comissao_gerada, fator_comissao_aplicado, percentual_comissao_total) ficam protegidos. Não silenciar drift: corrigir no mesmo run e registrar em `runs.metrics.drift[]`.

Sync NUNCA:
- `DELETE` de linha pago. Parcela some do Sienge → marcar como `cancelado` ou logar drift.
- Reverter `pago → pendente` fora do fluxo explícito "Excluir Baixa" (único caminho permitido: `status='pendente'` + `data_pagamento=NULL` no mesmo UPDATE — trigger 020 valida).
- Alterar `tipo`, `valor` ou `comissao_gerada` em linha pago. Qualquer divergência aí é bug de match ou problema estrutural — logar e investigar.

Sync PODE:
- Corrigir `data_pagamento` em linha já pago pra refletir Sienge. Deve emitir métrica de drift (`drift_data_pagamento`) pra auditoria.
- Atualizar snapshots (`fator_comissao_aplicado`, `percentual_comissao_total`) em linha pago quando regra de cargo mudar.

Sync SEMPRE:
- Pendente vira pago em **uma única operação** (`status` + `data_pagamento` no mesmo UPDATE).
- Novo pagamento detectado → `INSERT` com `status='pendente'` + `data_prevista`, nunca já pago.

---

## Arquitetura de sincronização

### Backfill one-shot (~22k linhas)
- **Usar script Node local** (`scripts/backfill-*.mjs`) — sem timeout, log em tempo real, interrompível.
- NÃO usar edge function pra backfill massivo: limite de ~150s de execução + deploy flaky.
- Fonte: `/bulk-data/v1/income` paginado (`PAGE_SIZE=200`), sem quota.
- Match: primário `(venda_id via sienge_contract_id, numero_parcela)`; fallback `(valor ±0.01, |data_prevista - dueDate| ≤ 30d)`.

### Sync incremental recorrente (delta do dia)
- **Usar edge function `sienge-sync`** — chamada pelo botão no front ou cron.
- Apenas o delta: `modifiedAfter` filtrando últimos N dias.
- Volume pequeno cabe no timeout de 150s.

### Sync de vendas novas (sales-contracts)
- Edge function já faz via `/sales-contracts` REST → RAW → normalize.
- Gera as linhas `pagamentos_prosoluto` com `status='pendente'` + `data_prevista`.
- Depois o `income` (backfill ou incremental) preenche `data_pagamento`.

---

## Meta operacional

**Objetivo final:** `pagamentos_prosoluto` com distribuição próxima a:
- `pago`: ~95% (reflete inadimplência real ~5% da carteira)
- `pendente`: ~5% (parcelas não vencidas + inadimplentes reais)
- `cancelado`: pontual (contratos cancelados)

**Hoje (baseline 2026-04-22):** 2.8% pago (655 de 23.373). O gap entre 2.8% e 95% é todo composto por "falsos pendentes" — parcelas que o cliente pagou mas o banco local não sabe.

**Verificação pós-backfill:**
```sql
SELECT status, COUNT(*), ROUND(100.0*COUNT(*)/SUM(COUNT(*)) OVER (), 2) AS pct
FROM pagamentos_prosoluto GROUP BY status;

-- Invariante: zero pagos sem data
SELECT COUNT(*) FROM pagamentos_prosoluto
WHERE status='pago' AND data_pagamento IS NULL;  -- deve ser 0

-- Invariante: zero pendentes com data
SELECT COUNT(*) FROM pagamentos_prosoluto
WHERE status='pendente' AND data_pagamento IS NOT NULL;  -- deve ser 0
```

---

## Context engineering + spec-driven development

Esta regra **é a spec**. Qualquer script, edge function, ou migration que toque `pagamentos_prosoluto.status`/`data_pagamento` deve:

1. **Referenciar esta regra explicitamente** no cabeçalho/comentário (`// ver .claude/rules/sincronizacao-sienge.md`)
2. **Respeitar as invariantes** listadas (nunca pago sem data, nunca delete de pago, nunca mexer em `tipo`/`valor`/`comissao_gerada` em pago, nunca reverter pago→pendente fora do fluxo "Excluir Baixa")
3. **Emitir métricas estruturadas** (`matched`, `updated`, `drift`, `noMatch`, `noPaymentDate`) — pra auditoria e detecção de regressão
4. **Ser idempotente** — rodar 2x seguidas não deve mudar nada no 2º run (exceto métricas)

Quem quiser entender o porquê de uma decisão de código nessa área, lê este arquivo primeiro. Quem for alterar, atualiza este arquivo **antes** de mexer no código.
