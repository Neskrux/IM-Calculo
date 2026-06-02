# Contexto: migration 017 × fluxos do projeto

**Objetivo deste documento:** engenharia de contexto — mapear o que a `017_proteger_pagamentos_auditados.sql` faz no banco e **onde o código hoje pode colidir**, para não surpreender em produção.

## O que a 017 faz (resumo)

Triggers `BEFORE DELETE` e `BEFORE UPDATE` em `public.pagamentos_prosoluto` via `proteger_pagamento_auditado()`:

| Situação | Comportamento |
|----------|----------------|
| `DELETE` com `OLD.status = 'pago'` | **Bloqueado** |
| `UPDATE` que tira `pago` de outro status (exceto reversão explícita) | **Bloqueado** |
| Reversão de baixa: `pago` → `pendente` com `NEW.data_pagamento IS NULL` e `OLD.data_pagamento` preenchido | **Permitido** |
| `UPDATE` em linha `pago` alterando `tipo`, `comissao_gerada`, `fator_comissao_aplicado`, `percentual_comissao_total`, `valor`, `data_pagamento` | **Bloqueado** (exceto no ramo de reversão acima) |
| `UPDATE` em linha `pago` só em `data_prevista` (e colunas não listadas) | **Permitido** |

Outro trigger no projeto: `011_pagamentos_prosoluto_updated_at.sql` mantém `updated_at` em `UPDATE`. Não entra em conflito com a 017 para linhas `pago` desde que não se alterem colunas bloqueadas.

## Matriz: fluxo × compatível com 017

| Área | Arquivo / fluxo | Compatível? | Nota |
|------|-----------------|---------------|------|
| Painel admin — salvar venda com baixas | `AdminDashboard.jsx` (propagação cirúrgica) | **Sim** | Só `UPDATE data_prevista` em `pago`; `DELETE` só em não-pagos. |
| Painel admin — renegociação | `AdminDashboard.jsx` | **Sim** | Atua em parcelas não `pago`. |
| Painel admin — confirmar pagamento | `AdminDashboard.jsx` | **Sim** | `pendente` → `pago` + `data_pagamento`. |
| Painel admin — excluir / reverter baixa | `AdminDashboard.jsx` (`processarExcluirBaixa`) | **Sim** | `pago` → `pendente` + `data_pagamento: null` — exatamente o escape previsto na 017. |
| Importação de vendas | `ImportarVendas.jsx` | **Sim** | Só `INSERT` de parcelas novas. |
| Corretor / cliente | `CorretorDashboard.jsx`, `ClienteDashboard.jsx` | **Sim** | Leitura (`SELECT`). |
| **Sienge — recriar grade da venda** | `syncVendasV2.js` → `criarPagamentosProsoluto` | **Não** | Faz `DELETE` em **todas** as parcelas da venda (`eq('venda_id')`). Se existir **qualquer** linha `pago`, o banco **rejeita** o delete. |
| **Sienge — recalcular comissões** | `syncVendasV2.js` → `recalcularComissoesPagamentosVenda` | **Não** | Faz `UPDATE` de `comissao_gerada`, `fator_comissao_aplicado`, `percentual_comissao_total` em **todas** as parcelas da venda, **incluindo** `pago` — bloqueado pela 017. |
| **Sienge — reprocessar pagamentos** | `syncVendasV2.js` → `reprocessarPagamentosVenda` | **Não** (típico) | Depende do fluxo que chama `criarPagamentosProsoluto` (delete total). |
| Sienge — sync status experimental | `syncPagamentosStatus.js` | **Sim** (trecho atual) | Só promove `pendente` → `pago`. |
| Auto-marcar vencidos como pagos | `syncPagamentosStatus.js` → `marcarPagamentosVencidosComoPagos` | **Sim** | Só atualiza `status = 'pendente'`. |

## Conclusão para produto

- A 017 **alinha** com a spec de preservação e com o **fluxo novo** do `AdminDashboard` (edição com baixas).
- A 017 **entra em conflito direto** com o desenho atual do **sync Sienge** que **apaga** ou **recalcula comissão** em parcelas já **`pago`**.

Enquanto o sync não for ajustado (ex.: nunca `DELETE` em `pago`; recalcular comissão só em `pendente`; ou não rodar recriação de grade para vendas com baixa), **rodar a 017 e manter o sync atual** pode gerar erros em jobs ou logs de warning no `criarPagamentosProsoluto`.

## Referências rápidas no código

- Delete em massa por venda: `src/services/sienge/syncVendasV2.js` (`criarPagamentosProsoluto`, ~linhas 273–277).
- Update de comissão em todas as parcelas: `recalcularComissoesPagamentosVenda`, ~linhas 814–821.
- Reversão de baixa: `src/pages/AdminDashboard.jsx` (`processarExcluirBaixa`, ~2553).

---

*Atualizar este arquivo quando o sync Sienge ou a 017 forem alterados.*
