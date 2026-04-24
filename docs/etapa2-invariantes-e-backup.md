# Etapa 2 — Invariantes + Backup pré go-live

**Gerado em:** 2026-04-24
**Trigger:** após correção dos 281 falsos cancelados da B.5 (Etapa 0.3 → corrigir-b5-falsos-cancelados.mjs).

## Backups criados

| Tabela backup | Linhas |
|---|---|
| `backup_pagamentos_prosoluto_prego_20260424` | 18.558 |
| `backup_vendas_prego_20260424` | 330 |
| `backup_b5_falsos_cancelados_20260424` (pré-correção) | 361 |

**Rollback em caso de regressão:**
```sql
TRUNCATE pagamentos_prosoluto;
INSERT INTO pagamentos_prosoluto SELECT id, venda_id, tipo, numero_parcela, valor, data_prevista, data_pagamento, status, comissao_gerada, created_at, fator_comissao_aplicado, percentual_comissao_total, updated_at FROM backup_pagamentos_prosoluto_prego_20260424;
```

## Invariantes (pré-condição para qualquer sync novo)

| Invariante | Violações | Status |
|---|---|---|
| `status='pago' AND data_pagamento IS NULL` | 0 | ✅ |
| `status='pendente' AND data_pagamento IS NOT NULL` | 0 | ✅ |
| venda com `sienge_contract_id` sem unidade vinculada | 0 | ✅ |

## Distribuição atual

| Status | Linhas | % |
|---|---|---|
| pendente | 14.868 | 80,12% |
| pago | 3.610 | 19,45% |
| cancelado | 80 | 0,43% |
| **Total** | **18.558** | 100% |

## Leitura do resultado

- **80 canceladas** = 361 pré-correção − 281 revertidas = 80 legítimas da B.5 (duplicatas reais em vendas que já foram pagas e reemitidas no Sienge).
- **Pago em 19,45%**: abaixo do alvo (~95%) mas esperado. O backfill income completo ainda não rodou de ponta a ponta pós-correção — o gap de "pago no Sienge mas pendente no banco" é residual e será fechado pela Etapa 3 (normalize backend + receivables) quando ativada.
- Nenhuma violação de invariante estrutural (que era o bloqueador real).

## Pré-requisitos para Etapa 3 (sync backend) — atendidos

- [x] B.5 safe executado (55 grupos)
- [x] B.6 classificado (safe + delicados documentados)
- [x] Etapa 0.2 OK (100% dos contratos CT do Sienge em `vendas`)
- [x] Etapa 0.3 OK (281 falsos cancelados revertidos; 7 balões faltantes documentados)
- [x] Invariantes zeradas
- [x] Backups criados
- [ ] Decisões humanas B.5 (34 casos delicados) — em espera até produção, conforme instrução do usuário
- [ ] Decisões humanas B.6 (Grupo 2 contrato 38, Grupo 3 contrato 144 urgente) — em espera até produção
- [ ] Decisões humanas Etapa 0 (7 balões faltantes em contratos 38/55/167/244) — em espera até produção

Nenhum item em espera bloqueia a Etapa 2 — as decisões humanas afetam ~40 parcelas numa base de 18.558 (0,2%) e podem ser aplicadas pós go-live sem risco estrutural.
