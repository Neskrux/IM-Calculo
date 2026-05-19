# Registry de Contratos Cancelados — Sienge × IM-Calculo

**Gerado em:** 2026-04-24
**Origem:** `GET /bulk-data/v1/sales?enterpriseId=2104&companyId=5&situation=CANCELED`
**RAW bruto:** [docs/fase5-sales-cancelados-RAW.json](fase5-sales-cancelados-RAW.json)
**Detalhamento linha-a-linha:** [docs/cancelados-resumo-final.json](cancelados-resumo-final.json)
**Regra de referência:** [.claude/rules/sincronizacao-sienge.md](../.claude/rules/sincronizacao-sienge.md)

---

## Para que serve este documento

Registro permanente dos **31 contratos da Figueira Garcia que foram cancelados/distratados no Sienge** e como o IM-Calculo trata cada um.

Leia este arquivo se precisa responder:

- *"Quanto entrou de caixa em contratos que acabaram distratados?"* → coluna **Valor Pago (preservado)**
- *"Quanto ficou pendente e foi cancelado junto com o distrato?"* → coluna **Pendente a Cancelar**
- *"Por que a parcela X aparece como `status='cancelado'`?"* → cruze pelo `sienge_contract_id` abaixo
- *"O corretor recebeu comissão dessas vendas?"* → sim, das parcelas pagas (1518 linhas) — trigger 017 protege essas comissões históricas

---

## Sumário

| Métrica | Valor |
|---------|-------|
| Contratos cancelados no Sienge | **31** |
| Match com `vendas` local (via `sienge_contract_id`) | **31 / 31 (100%)** |
| Total de parcelas em vendas canceladas | 1.815 |
| Parcelas **pagas** (preservadas — histórico de caixa) | **1.518** |
| Parcelas **pendentes** (a marcar como `cancelado`) | **297** |
| Vendas com pendentes | 13 |
| Vendas 100% pagas antes do cancelamento | 18 |
| Valor pago total (preservado) | **R$ 2.044.013,08** |
| Valor pendente (cancelado junto com o distrato) | **R$ 507.796,34** |
| Valor total das vendas canceladas | **R$ 12.095.582,95** |

### Motivos de cancelamento (campo `cancellationReason` do Sienge)

| Motivo | Qtd |
|--------|-----|
| CLIENTE DESISTIU DA COMPRA (variações) | 16 |
| Cliente distratou / destratou / distrato | 7 |
| SOLICITOU / OPTOU PELO DISTRATO | 4 |
| CANCELAMENTO POR PARTE DO CLIENTE | 1 |
| CLIENTE NÃO QUIS DAR ANDAMENTO A COMPRA | 1 |
| CLIENTE DESISTIU DA UNIDADE | 1 |
| CLIENTE RESOLVEU NÃO SEGUIR COM A UNIDADE | 1 |

---

## Regra de negócio aplicada

> **O que mexemos:** parcelas com `status='pendente'` de vendas canceladas → vão pra `status='cancelado'`.
>
> **O que NÃO mexemos:** parcelas `status='pago'`. Elas representam dinheiro que entrou **antes do distrato**, e a comissão correspondente já foi apurada/repassada ao corretor. Protegidas pela trigger 017 (imutáveis: `tipo`, `valor`, `comissao_gerada`; DELETE bloqueado).
>
> **O que NÃO fazemos na venda:** `vendas.excluido` continua `false`. A venda permanece no banco como registro histórico; dashboards podem filtrar por `pagamentos_prosoluto.status` se quiserem esconder parcelas canceladas.

---

## Tabela de contratos cancelados (ordenada por data)

| sienge_contract_id | nº contrato | data cancel. | parc. pagas | valor pago | pendentes | valor pendente | motivo |
|---:|---:|---|---:|---:|---:|---:|---|
| 25 | 18 | 2025-09-23 | 60 | R$ 45.482,40 | 1 | R$ 1.000,00 | CLIENTE DESISTIU DA COMPRA |
| 168 | 78 | 2025-11-17 | 57 | R$ 88.913,16 | 0 | R$ 0,00 | CLIENTE DESISTIU DA COMPRA |
| 290 | 198 | 2025-11-17 | 61 | R$ 69.571,60 | 4 | R$ 40.000,00 | Cliente distratou |
| 311 | 219 | 2025-11-24 | 58 | R$ 82.088,56 | 0 | R$ 0,00 | CLIENTE DESISTIU DA COMPRA |
| 355 | 253 | 2025-12-04 | 56 | R$ 87.161,76 | 0 | R$ 0,00 | Cliente distratou |
| 307 | 215 | 2025-12-05 | 60 | R$ 87.162,00 | 0 | R$ 0,00 | Cliente desistiu da compra |
| 284 | 192 | 2025-12-09 | 58 | R$ 87.932,06 | 1 | R$ 800,00 | cliente distratou |
| 278 | 186 | 2025-12-15 | 60 | R$ 69.146,40 | 0 | R$ 0,00 | Cliente destratou |
| 255 | 163 | 2025-12-29 | 54 | R$ 61.009,04 | 11 | R$ 8.466,15 | CLIENTE DESISTIU DA COMPRA |
| 145 | 55 | 2026-01-06 | 58 | R$ 54.593,99 | 4 | R$ 20.000,00 | CLIENTE DESISTIU DA COMPRA |
| 268 | 176 | 2026-01-06 | 59 | R$ 76.639,23 | 0 | R$ 0,00 | CLIENTE DESISTIU DA COMPRA |
| 209 | 117 | 2026-01-13 | 60 | R$ 78.141,60 | 0 | R$ 0,00 | CLIENTE NÃO QUIS DAR ANDAMENTO A COMPRA |
| 186 | 96 | 2026-01-14 | 57 | R$ 82.088,55 | 0 | R$ 0,00 | CLIENTE DESISTIU DA COMPRA |
| 354 | 252 | 2026-01-15 | 60 | R$ 75.880,20 | 0 | R$ 0,00 | CLIENTE DESISTIU DA COMPRA |
| 362 | 259 | 2026-01-15 | 58 | R$ 125.999,86 | 1 | R$ 50.000,00 | CLIENTE DESISTIU DA COMPRA |
| 361 | 258 | 2026-01-29 | 56 | R$ 83.913,20 | 1 | R$ 5.000,00 | CLIENTE DESISTIU DA COMPRA |
| 141 | 51 | 2026-02-02 | 60 | R$ 85.350,00 | 0 | R$ 0,00 | CLIENTE DESISTIU DA COMPRA |
| 181 | 91 | 2026-02-02 | 57 | R$ 80.470,89 | 0 | R$ 0,00 | CLIENTE DESISTIU DA COMPRA |
| 149 | 59 | 2026-02-04 | 60 | R$ 87.065,40 | 0 | R$ 0,00 | CLIENTE DESISTIU DA COMPRA |
| 42 | 21 | 2026-02-06 | 57 | R$ 80.471,46 | 0 | R$ 0,00 | CLIENTE DESISTIU DA COMPRA |
| 380 | 266 | 2026-02-08 | 52 | R$ 57.370,04 | 0 | R$ 0,00 | CLIENTE DESISTIU DA UNIDADE |
| 79 | 37 | 2026-02-24 | 60 | R$ 83.668,20 | 0 | R$ 0,00 | CLIENTE RESOLVEU NÃO SEGUIR COM A UNIDADE |
| 384 | 270 | 2026-03-17 | 51 | R$ 85.379,61 | 0 | R$ 0,00 | Cliente solicitou o distrato por não conseguir pagamento |
| 341 | 244 | 2026-03-25 | 55 | R$ 58.622,00 | 5 | R$ 21.000,00 | CANCELAMENTO POR PARTE DO CLIENTE |
| 315 | 223 | 2026-04-09 | 57 | R$ 63.308,76 | 0 | R$ 0,00 | Cliente optou pelo distrato da unidade |
| 195 | 103 | 2026-04-23 | 9 | R$ 13.632,48 | 49 | R$ 74.221,28 | CLIENTE DESISTIU DA COMPRA |
| 196 | 104 | 2026-04-23 | 60 | R$ 83.668,20 | 0 | R$ 0,00 | SOLICITOU DISTRATO |
| 246 | 154 | 2026-04-23 | 3 | R$ 3.607,06 | 53 | R$ 81.837,09 | SOLICITOU DISTRATO |
| 259 | 167 | 2026-04-23 | 2 | R$ 2.000,00 | 51 | R$ 71.000,00 | OPTOU PELO DISTRATO |
| 266 | 174 | 2026-04-23 | 2 | R$ 2.700,82 | 57 | R$ 76.973,37 | OPTOU PELO DISTRATO |
| 357 | 254 | 2026-04-23 | 1 | R$ 974,55 | 59 | R$ 57.498,45 | CLIENTE SOLICITOU DISTRATO |

---

## Queries prontas para auditoria

### Panorama rápido (distribuição de status)

```sql
SELECT
  v.numero_contrato,
  v.sienge_contract_id,
  COUNT(*) FILTER (WHERE p.status = 'pago')      AS pagas,
  COUNT(*) FILTER (WHERE p.status = 'cancelado') AS canceladas,
  SUM(p.valor) FILTER (WHERE p.status = 'pago')      AS valor_pago,
  SUM(p.valor) FILTER (WHERE p.status = 'cancelado') AS valor_cancelado
FROM vendas v
JOIN pagamentos_prosoluto p ON p.venda_id = v.id
WHERE v.sienge_contract_id IN (
  25, 42, 79, 141, 145, 149, 168, 181, 186, 195, 196,
  209, 246, 255, 259, 266, 268, 278, 284, 290, 307,
  311, 315, 341, 354, 355, 357, 361, 362, 380, 384
)
GROUP BY v.id, v.numero_contrato, v.sienge_contract_id
ORDER BY v.numero_contrato;
```

### Relatório financeiro — dinheiro efetivo de vendas canceladas

```sql
-- Quanto entrou de caixa em contratos que acabaram distratados
SELECT
  SUM(p.valor) AS caixa_preservado_em_cancelados,
  COUNT(*)     AS parcelas_pagas_antes_do_distrato
FROM vendas v
JOIN pagamentos_prosoluto p ON p.venda_id = v.id
WHERE p.status = 'pago'
  AND v.sienge_contract_id IN (
    25, 42, 79, 141, 145, 149, 168, 181, 186, 195, 196,
    209, 246, 255, 259, 266, 268, 278, 284, 290, 307,
    311, 315, 341, 354, 355, 357, 361, 362, 380, 384
  );
-- Esperado: R$ 2.044.013,08 em 1.518 parcelas (valor hoje, pode crescer se novos cancelamentos)
```

### Comissões repassadas em vendas canceladas (por corretor)

```sql
SELECT
  u.nome AS corretor,
  COUNT(*)              AS parcelas_pagas,
  SUM(p.comissao_gerada) AS comissao_total_repassada,
  SUM(p.valor)           AS valor_caixa
FROM vendas v
JOIN pagamentos_prosoluto p ON p.venda_id = v.id
JOIN usuarios u ON u.id = v.corretor_id
WHERE p.status = 'pago'
  AND v.sienge_contract_id IN (
    25, 42, 79, 141, 145, 149, 168, 181, 186, 195, 196,
    209, 246, 255, 259, 266, 268, 278, 284, 290, 307,
    311, 315, 341, 354, 355, 357, 361, 362, 380, 384
  )
GROUP BY u.id, u.nome
ORDER BY comissao_total_repassada DESC;
```

---

## Alertas para futuras implementações

1. **Dashboards (Admin/Corretor):** se decidir esconder parcelas canceladas, filtrar por `status != 'cancelado'` — mas considerar expor toggle "incluir canceladas" para o Admin/Diretor Financeiro ver o panorama completo.

2. **Relatório PDF:** hoje Admin/Corretor filtra por período. Avaliar se relatório do diretor financeiro precisa agrupar por `status` (pago / pendente / cancelado) pra comparar caixa realizado × caixa perdido.

3. **Próximo distrato:** quando aparecer um novo cancelamento no Sienge, o sync incremental (Etapa 6 / edge function com `changeStartDate`) precisa chamar **também** `/bulk-data/v1/sales?situation=CANCELED` — senão vamos contar falsamente como "pendente" parcelas de uma venda que o Sienge já distratou.

4. **Reversão de cancelamento (raro):** se uma venda voltar a valer (re-ativação), as parcelas locais seguirão `status='cancelado'`. Isso é decisão de negócio — por padrão não revertemos. Se precisar, exige fluxo explícito similar ao "Excluir Baixa" pro caso `pago → pendente`.

5. **Comissão pós-distrato:** se o time comercial decidir reaver comissão paga em vendas que distrataram, isso NÃO acontece automaticamente. Trigger 017 impede mexer em `comissao_gerada` de linha `pago`. Seria um fluxo manual / administrativo à parte.

---

## Próximo passo (Etapa 5B-cancelados)

Executar UPDATE das 297 parcelas `pendente` → `cancelado`. Script: `scripts/executar-cancelados.mjs`. Plano dry-run em [docs/fase5-plano-cancelados-v2.json](fase5-plano-cancelados-v2.json).
