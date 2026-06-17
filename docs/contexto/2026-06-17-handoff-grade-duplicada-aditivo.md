# Handoff → reconciliação: grade pendente duplicada (aditivo)

> **Gerado em:** 2026-06-17 · **Origem:** sessão de mobile do corretor (diagnóstico read-only).
> **Natureza:** DADO (reconciliação / rodada-b), **não** UI. O pill "Aditivo" no admin
> está correto (reflete `renegociacao_id`). Fix de dado roda no **worktree de reconciliação**,
> com a verdade do Sienge — **não** decidir/cancelar "no olho" (ver `.claude/rules/rodadas-b.md`).

## Como apareceu
No admin (detalhe de pagamentos), uma venda mostrava **2 parcelas na mesma data, ambas com
ADITIVO** (ex.: 903 C — Parcela 11 = R$ 1.426,07 + Parcela 61 = R$ 285,21, 20/06/2026).

## Diagnóstico (corrigido)
Detector ingênuo (`count(*)>1` por `data_prevista` em pendentes) flagou **47 vendas** — mas a
maioria é **falso-positivo**: é **PM + balão caindo no mesmo dia** (normal). Critério correto =
`pago + Σ pendentes` vs `valor_pro_soluto`:

| Classe | Qtd | Significado |
|---|---:|---|
| **Bate o pro-soluto (OK)** | **37** | PM+balão na mesma data; dado correto. Inclui **903 C (c228)** — já parqueada/conhecida. |
| **Excede (DUPLICATA real)** | **7** | `pago+pendente > pro_soluto` por ~1 parcela → há 1 parcela sobrando. |
| **Abaixo** | **3** | `pago+pendente < pro_soluto` → falta parcela / buraco. |

## Casos reais (10) — semente da rodada-b

**DUPLICATA (excede — excesso ≈ valor de 1 parcela a cancelar):**

| Unidade | Contrato | Pro-soluto | Pago | Pendente | Excesso |
|---|---|---:|---:|---:|---:|
| 1206 B | 332 | 58.695,43 | 11.295,93 | 56.399,50 | **+9.000,00** |
| 1507 A | 162 | 86.160,00 | 2.000,00 | 89.592,00 | **+5.432,00** |
| 1207 C | 244 | 84.598,22 | 15.800,00 | 73.798,22 | **+5.000,00** |
| 1506 A | 161 | 310.250,00 | 130.554,01 | 183.200,16 | **+3.504,17** |
| 1805 A | 173 | 76.860,00 | 10.080,00 | 68.040,00 | **+1.260,00** |
| 710 A | 63 | 70.366,00 | 8.209,19 | 63.329,58 | **+1.172,77** |
| 1707 D | 306 | 69.981,04 | 14.746,08 | 55.984,64 | **+749,68** |

**ABAIXO (falta):**

| Unidade | Contrato | Pro-soluto | Pago | Pendente | Diferença |
|---|---|---:|---:|---:|---:|
| 906 C | 230 | 78.199,66 | 8.089,62 | 69.954,85 | -155,19 (ninharia) |
| 1606 A | 165 | 83.839,80 | 11.178,64 | 71.263,83 | -1.397,33 (1 PM; Mariane c165, renegociação conhecida) |
| 609 D | 269 | 124.200,00 | 20.800,00 | 54.600,00 | **-48.800,00 (buraco grande — investigar)** |

## Recipe pra reconciliação (worktree de reconciliação)
1. Pra cada DUPLICATA: cruzar com Sienge (`/bulk-data/v1/income` + grade vigente) pra achar a
   parcela **sobrando** (a que não tem âncora `sienge_installment_id` real / fora da grade vigente).
2. Cancelar a sobrando via fluxo permitido (status→`cancelado`, `motivo_cancelamento_parcela`),
   **nunca** DELETE; respeitar imutabilidade de pago. Gerar rodada-b com decisão da gestora.
3. ABAIXO: 906 C ignorar (centavos); 1606 A conferir a PM faltante; **609 D investigar** (gap de R$48,8k).
4. **903 C (c228)** e demais 37: não tocar — dado bate; se incomodar no admin é só **visual**
   (2 parcelas/data ambas ADITIVO), decisão de UI separada.

### Query de detecção (reusável)
```sql
WITH dupvendas AS (
  SELECT DISTINCT venda_id FROM pagamentos_prosoluto WHERE status='pendente'
  GROUP BY venda_id, data_prevista HAVING COUNT(*)>1)
SELECT v.unidade, v.sienge_contract_id,
  ROUND(v.valor_pro_soluto::numeric,2) ps,
  ROUND(SUM(p.valor) FILTER (WHERE p.status='pago')::numeric,2) pago,
  ROUND(SUM(p.valor) FILTER (WHERE p.status='pendente')::numeric,2) pend,
  ROUND((SUM(p.valor) FILTER (WHERE p.status='pago')+SUM(p.valor) FILTER (WHERE p.status='pendente')-v.valor_pro_soluto)::numeric,2) excesso
FROM vendas v JOIN pagamentos_prosoluto p ON p.venda_id=v.id
WHERE v.id IN (SELECT venda_id FROM dupvendas)
GROUP BY v.id, v.unidade, v.sienge_contract_id, v.valor_pro_soluto
HAVING ABS(SUM(p.valor) FILTER (WHERE p.status='pago')+SUM(p.valor) FILTER (WHERE p.status='pendente')-v.valor_pro_soluto) > 1
ORDER BY excesso DESC;
```
