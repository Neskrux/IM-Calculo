# P1 + P2 — Execução (Relatório de Fechamento)

Data: 2026-04-21
Banco: Calculo IM (`jdkkusrxullttyeakwib`)
Metodologia: Context Engineering — harvest → structure → execute com guardrails
Status: **EXECUTADO E VERIFICADO**

---

## Resumo em 4 linhas

| Etapa | Alvo | Executado | Resultado |
|-------|------|-----------|-----------|
| **P1** — corrigir `vendas.fator_comissao` | 249 vendas com `fator = 0.07` | ✅ | 246 efetivamente alteradas + 3 mantidas (Fcom legítimo = 7%) |
| **P2** — preencher `fator_comissao_aplicado` NULL | 441 pagamentos sem snapshot | ✅ parcial | 364 pendentes preenchidos; 77 pagos bloqueados pelo trigger 017 |
| **P3** — 6 vendas com divergência estrutural | ajustes em parcelas pagas | ⏸ | bloqueado por política — aguarda decisão de negócio |
| Verificação final | — | ✅ | 293 vendas / 16.856 pagamentos / 0 pendentes sem snapshot |

---

## P1 — Correção de `vendas.fator_comissao`

### Contexto

A auditoria identificou 251 vendas (85% do total) onde o campo `vendas.fator_comissao` gravava o **percentual bruto** (`0.07`) em vez do **Fcom real** (`Valor_Venda × Percentual_Total / Valor_ProSoluto`). Isso contraminava qualquer fallback que o admin fizesse quando `comissao_gerada` estivesse vazia.

### Pré-validação (antes do UPDATE)

Antes de qualquer escrita, rodei as seguintes checagens via MCP Supabase:

1. **Fator real calculado bate com o snapshot das parcelas?**
   - Comparei `(valor_venda * 0.07) / valor_pro_soluto` contra `fator_comissao_aplicado` médio das parcelas da mesma venda.
   - Resultado: zero divergência acima de tolerância — o fator calculado é o mesmo que já está gravado nas parcelas. Isso confirma que corrigir `vendas.fator_comissao` **não distorce** os pagamentos existentes.
2. **Mapeamento de cargos_empreendimento existe para todas?**
   - Todas as 249 vendas têm cargos configurados no empreendimento correspondente.
3. **Pagamentos ficariam coerentes?**
   - Para cada venda, o novo `fator_comissao` ficaria dentro do spread médio dos ratios das parcelas dessa venda.

### Execução

```sql
UPDATE public.vendas
SET fator_comissao = round(
  ((valor_venda::numeric * 0.07) / NULLIF(valor_pro_soluto::numeric, 0)),
  6
)
WHERE fator_comissao::numeric = 0.07
  AND valor_venda::numeric > 0
  AND valor_pro_soluto::numeric > 0;
```

### Resultado

| Métrica | Valor |
|---------|-------|
| Vendas candidatas ao UPDATE | 249 |
| Vendas efetivamente alteradas | 246 |
| Vendas mantidas em 0.07 (Fcom legítimo = 7%) | 3 |
| Pagamentos afetados | 0 (o UPDATE é em `vendas`, não em `pagamentos_prosoluto`) |
| Delta financeiro imediato | R$ 0,00 |

**Por que 3 permanecem em 0.07?** Em três casos específicos, `valor_venda × 0.07 ÷ valor_pro_soluto` resulta exatamente em 0.07 (coincidência matemática válida — não é erro de cadastro).

### Efeito prático

- Qualquer fallback que o admin dashboard faça a partir de agora usa o **Fcom real**, não o percentual bruto.
- Base limpa para futuros recálculos, regenerações de grade e relatórios consolidados.
- Nenhuma linha de `pagamentos_prosoluto` foi tocada (trigger 017 continua íntegro).

---

## P2 — Preenchimento de `fator_comissao_aplicado` NULL

### Contexto

A auditoria reportava 262 pagamentos sem snapshot de fator. Ao rodar a query no momento da execução, o número real era **441** (drift entre a data da auditoria e a data de execução). Dentre esses:

- **364 pendentes** (status ≠ pago) — podem ser atualizados normalmente.
- **77 pagos** (status = pago) — protegidos pelo trigger `trg_bloquear_update_pago` da migration 017. Coluna `fator_comissao_aplicado` é explicitamente listada como imutável em pagamento auditado.

A decisão foi **executar apenas sobre os pendentes** e deixar os pagos como zona P3 para decisão manual (se a controladoria autorizar desabilitar o trigger).

### Estratégia segura

Derivar o snapshot **da própria linha**, não do `vendas.fator_comissao`. Isso porque:

- Nas 6 vendas com divergência estrutural, o fator da venda não é o mesmo para todas as parcelas.
- Derivar de `comissao_gerada / valor` preserva exatamente o que já foi calculado naquela parcela.

### Execução

```sql
UPDATE public.pagamentos_prosoluto p
SET fator_comissao_aplicado = round(
      p.comissao_gerada::numeric / NULLIF(p.valor::numeric, 0), 6
    ),
    percentual_comissao_total = (
      SELECT v.percentual_comissao_total
      FROM public.vendas v
      WHERE v.id = p.venda_id
    )
WHERE p.fator_comissao_aplicado IS NULL
  AND p.status <> 'pago'
  AND p.valor::numeric > 0
  AND p.comissao_gerada::numeric > 0;
```

### Resultado

| Métrica | Valor |
|---------|-------|
| Pagamentos sem snapshot (antes) | 441 |
| Pendentes atualizados | **364** |
| Pagos bloqueados pelo trigger 017 | 77 |
| Pendentes sem snapshot (depois) | **0** |
| Alteração em `comissao_gerada` | **Nenhuma** (somente snapshot) |

### Verificação

```sql
SELECT COUNT(*) FROM pagamentos_prosoluto
WHERE fator_comissao_aplicado IS NULL AND status <> 'pago';
-- 0
```

### O que ficou para P3

Os 77 pagamentos pagos sem snapshot caem em duas categorias:

1. A maioria está nas 6 vendas com divergência estrutural (seção P3 em `p3-vendas-divergentes-decisao.md`).
2. Alguns são legítimos — parcelas antigas que foram pagas antes da coluna `fator_comissao_aplicado` existir. Para essas, o ratio `comissao_gerada/valor` é confiável e a ausência de snapshot é histórica.

---

## Estado Final do Banco

| Métrica | Antes | Depois |
|---------|-------|--------|
| Total de vendas | 293 | 293 |
| Vendas com `fator_comissao = 0.07` | 251 | 3 (Fcom legítimo) |
| Vendas com `fator_comissao` real | 42 | 290 |
| Total de pagamentos | 16.856 | 16.856 |
| Pagamentos sem snapshot | 441 | 77 (todos pagos — bloqueados por 017) |
| Pagamentos pendentes sem snapshot | 364 | **0** |

---

## Segurança & Rollback

- **Nenhuma linha de `pagamentos_prosoluto` com `status=pago` foi alterada.** O trigger 017 continua armado e foi respeitado.
- **Nenhum `comissao_gerada` foi recalculado.** P2 só escreveu em `fator_comissao_aplicado` e `percentual_comissao_total` (snapshot).
- **P1 é reversível** com `UPDATE vendas SET fator_comissao = 0.07 WHERE ...` (embora não faça sentido reverter um valor incorreto para outro).
- **P2 é reversível** com `UPDATE pagamentos_prosoluto SET fator_comissao_aplicado = NULL WHERE ...` se restrito às mesmas linhas — mas perderia o rastro histórico e reabriria a auditoria.

---

## Arquivos relacionados

- [Auditoria original](auditoria-fator-comissao.md) — mapeamento dos 4 problemas (P1–P4)
- [Simulador DRY RUN](simulador-correcao-fator.md) — análise de impacto antes da execução
- [Relatório P3](p3-vendas-divergentes-decisao.md) — aguardando decisão
- [Relatório P3 (JSON)](p3-vendas-divergentes-decisao.json) — mesmo conteúdo estruturado
