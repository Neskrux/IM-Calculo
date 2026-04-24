# IM-Calculo — Regras do Projeto

Regras de negócio críticas que **SEMPRE** devem ser respeitadas ao alterar código, gerar queries ou calcular comissões neste repositório.

---

## Regras de comissão (carregadas automaticamente)

@.claude/rules/fator-comissao.md
@.claude/rules/comissao-corretor.md
@.claude/rules/comissao-integral-20.md

## Regras de sincronização (carregadas automaticamente)

@.claude/rules/sincronizacao-sienge.md

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
