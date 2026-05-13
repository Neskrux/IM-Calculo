# IM-Calculo — Regras do Projeto

Regras de negócio críticas que **SEMPRE** devem ser respeitadas ao alterar código, gerar queries ou calcular comissões neste repositório.

---

## Regras de comissão (carregadas automaticamente)

@.claude/rules/fator-comissao.md
@.claude/rules/comissao-corretor.md
@.claude/rules/comissao-integral-20.md

## Regras de sincronização (carregadas automaticamente)

@.claude/rules/sincronizacao-sienge.md

## Regras de visualização e processo (carregadas automaticamente)

@.claude/rules/visualizacao-totais.md
@.claude/rules/rodadas-b.md

---

## Princípios gerais

1. **Fórmula canônica do fator:** `Fcom = (Valor_Venda × Percentual_Total) / Valor_ProSoluto`. Nunca aplicar percentual direto na parcela.
2. **Comissão por pagamento, não por venda:** somar sempre das linhas de `pagamentos_prosoluto`, nunca de `vendas.comissao_corretor`.
3. **Comissão integral só quando entrada ≥ 20% paga à vista (não parcelada).**
4. **Nunca recalcular comissões de vendas antigas ao alterar percentuais.** O snapshot em `pagamentos_prosoluto.fator_comissao_aplicado` é a fonte da verdade histórica.
5. **Migrations 017 + 018 + 020** protegem linhas com `status = 'pago'`:
   - **Imutáveis em pago:** `tipo`, `valor`, `comissao_gerada` (financeiras/identidade).
   - **Editáveis em pago:** `data_pagamento` (020 — 2026-04-23, Sienge é fonte da verdade temporal); `fator_comissao_aplicado`, `percentual_comissao_total` (018 — 2026-04-21, snapshots/metadados).
   - **DELETE de pago:** bloqueado.
   - **Reversão pago→pendente:** só via fluxo explícito "Excluir Baixa" (`status='pendente'` + `data_pagamento=NULL` no mesmo UPDATE).

---

## Tabelas-chave

| Tabela | Propósito |
|--------|-----------|
| `vendas` | Dados da venda (valor, pro-soluto, fator canônico) |
| `pagamentos_prosoluto` | Parcelas geradas + snapshot de fator aplicado |
| `cargos_empreendimento` | Percentuais **atuais** por cargo por empreendimento |
| `cargos_empreendimento_historico` | Log de alterações de percentuais |
| `comissoes_venda` | Snapshot por venda (imutável) |

---

## Auditorias recentes

- [docs/p1-p2-execucao.md](docs/p1-p2-execucao.md) — P1 (fator de venda) e P2 (snapshot de pagamentos) executados em 2026-04-21
- [docs/p3-vendas-divergentes-decisao.md](docs/p3-vendas-divergentes-decisao.md) — 6 vendas divergentes aguardando decisão de negócio (causa: mudança de `tipo_corretor` com regeneração de grade)
- [migrations/018_afrouxar_snapshot_em_pago.sql](migrations/018_afrouxar_snapshot_em_pago.sql) — libera snapshots metadados em `status=pago` (trigger 017 afrouxado)
- [migrations/020_liberar_data_pagamento_sienge.sql](migrations/020_liberar_data_pagamento_sienge.sql) — libera `data_pagamento` em `status=pago` pra sync corrigir drift vs Sienge (2026-04-23)
- [migrations/021_corretor_cliente_id_origem.sql](migrations/021_corretor_cliente_id_origem.sql) — adiciona `corretor_id_origem` e `cliente_id_origem` em `vendas` pra proteger correções manuais contra sync (2026-04-27)
- [docs/varredura-pagamentos-bagunca-2026-05-13.json](docs/varredura-pagamentos-bagunca-2026-05-13.json) — varredura 2026-05-13: 99 vendas FIGUEIRA (30% do universo) com drift > 30d entre `data_prevista` e `data_pagamento` em pago e/ou `numero_parcela` duplicado. Causa-raiz: backfill antigo (`scripts/dry-run-backfill-income.mjs`) fez match heurístico apenas por `(venda_id, numero_parcela)` e nunca corrigiu `data_prevista` — só `data_pagamento`.
- [docs/b7-texto-para-usuaria.md](docs/b7-texto-para-usuaria.md) — rodada B.7 (2026-05-13): 11 vendas com `numero_parcela` duplicado (par cancelado+ativo). Aguardando re-baixa `/bulk-data/v1/income` (quota Sienge esgotou) pra reconciliação por `installmentId` real.
- [migrations/023_pagamentos_sienge_installment_id.sql](migrations/023_pagamentos_sienge_installment_id.sql) — adiciona `sienge_bill_id` e `sienge_installment_id` em `pagamentos_prosoluto` pra ancoragem 1:1 com Sienge (substitui match heurístico). **Não aplicada — pendente de revisão.**
- [docs/aplicacao-data-prevista-2026-05-13.json](docs/aplicacao-data-prevista-2026-05-13.json) — **132 parcelas em 16 vendas tiveram `data_prevista` corrigida pelo cache Sienge** (zero quota gasta, 2026-05-13). Drift entre 2 e 365 dias. Idempotente (rerun reporta 0 updated). Drift > 365d (19 parcelas) e sem-match (19) ficaram pra revisão humana.
- **Fix UI 2026-05-13** ([src/pages/AdminDashboard.jsx](src/pages/AdminDashboard.jsx), [CorretorDashboard](src/pages/CorretorDashboard.jsx), [ClienteDashboard](src/pages/ClienteDashboard.jsx), [HomeDashboard](src/pages/HomeDashboard.jsx), [comissaoCalculator](src/utils/comissaoCalculator.js)): parcelas `cancelado` agora renderizam corretamente (antes eram tratadas como `pendente`, inflando totais). `somarComissao` por default ignora canceladas.
- **Fix `propagarCronogramaCirurgico` 2026-05-13** ([AdminDashboard.jsx:181-184](src/pages/AdminDashboard.jsx#L181-L184)): a função antes filtrava `status !== 'pago'` (incluía canceladas como pendentes). Agora separa em 3 grupos (pagos/pendentes/cancelados) e canceladas são **ignoradas** — não entram em UPDATE nem DELETE. Elimina a causa-raiz que estava criando pares `cancelado+pendente` com mesma `numero_parcela` a cada regeneração de grade.
- [.github/workflows/recurring-reconciliation.yml](.github/workflows/recurring-reconciliation.yml) — **cron diário 08h BRT** que baixa income do Sienge (bulk-data, sem quota), gera plano de correção de `data_prevista` e aplica drifts pequenos (2-365d) automaticamente. Idempotente. Drifts >365d e sem-match ficam pra revisão humana. Falha o job se houver erros. **Pré-requisito:** configurar secrets no repo (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SIENGE_USERNAME, SIENGE_PASSWORD, SIENGE_SUBDOMAIN).
- [docs/aplicacao-b6-g1-2026-05-13.json](docs/aplicacao-b6-g1-2026-05-13.json) — **19 parcelas extras canceladas** (b6 Grupo 1, parcial): 14 da venda Fernanda c287 + 5 da Caroline c340.
- [docs/plano-correcao-data-prevista-ampla-2026-05-13.json](docs/plano-correcao-data-prevista-ampla-2026-05-13.json) + [docs/aplicacao-b6-g1-expandido-2026-05-13.json](docs/aplicacao-b6-g1-expandido-2026-05-13.json) — **varredura ampla 2026-05-13** sobre todas as 299 vendas FIGUEIRA com bill_id (não só as 99 da varredura inicial). Resultado: **96.6% das parcelas já corretas**. **+35 parcelas extras canceladas** em 3 contratos novos (c173 Carlos×3, c219 Josapha×1, c228 Letícia×31 — todas extras do gerador antigo, status pendente→cancelado, num > max_parcela_sienge). Algoritmo agora é genérico (não hard-coda contratos). 1 venda flagada pra revisão humana: **c236 (Unidade 1007 C) — 60 parcelas locais sem nenhum match no Sienge income** (caso b6 Grupo 3, investigar se contrato existe no Sienge ou foi reemitido com outro número).
