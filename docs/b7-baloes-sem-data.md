# Balões pendentes sem `data_prevista` (Etapa B.5)

Auditoria: 40 balões `tipo='balao'` `status='pendente'` no banco com `data_prevista=NULL`. Divididos em dois grupos com tratamentos diferentes.

---

## Grupo A — 7 balões com `sienge_contract_id`, mas o Sienge **não confirma** (3 vendas afetadas)

Banco tem balões pendentes nesses contratos, mas o payload Sienge `sales-contracts` **não tem nenhum `paymentConditions[]` com `conditionTypeId='BL'`** (nem `BB`, balão complementar). Hipótese: balões fantasma criados pelo gerador antigo.

### Contrato 207 — Sienge 299
4 balões pendentes (#2, #3, #4, #5) de R$ 4.364,15 cada — total R$ 17.456,60.

### Contrato 243 — Sienge 340
3 balões pendentes (#2, #3, #4) de R$ 3.624,00 cada — total R$ 10.872,00.

**Decisão necessária:**

1. **"Cancelar como balões fantasmas"** — UPDATE `status='cancelado'` (libera de relatório, preserva histórico). Recomendado se gestora confirmar que esses contratos não têm balão.
2. **"Esperar próxima sincronização Sienge"** — talvez o payload local está desatualizado; rodar sync de sales-contracts e re-auditar.
3. **"Investigar manualmente no Sienge"** — confirmar via UI Sienge se há balão real e qual o cronograma.

---

## Grupo B — 33 balões em vendas locais (sem `sienge_contract_id`)

Vendas cadastradas manualmente (não vieram do Sienge). 6 vendas afetadas:

| Bloco | Unidade | Cliente | Corretor | Qtd balões | Soma |
|-------|---------|---------|----------|-----------|------|
| A | 1305 | ALISSON RODRIGUES DO CARMO | MATEUS GABRIEL DE OLIVEIRA | 1 | R$ 11.375,00 |
| B | 401 | RAYLTON GOMES DA COSTA | DENIS ALEXANDRE MOREIRA MAGNI PINTO | 5 | R$ 20.000,00 |
| B | 603 | CAYO KAMENAC RAMOS DA SILVA | Alessandro Pereira | 4 | R$ 40.000,00 |
| C | 1603 | HELOIZA MARCHINI SANCHES | Luiz Corazza | 14 | R$ 42.000,00 |
| D | 1307 | Felix Roman Munieweg | Rodrigo Fernando Viapiana Parada | 4 | R$ 20.000,00 |
| K | 002 | jonas cliente | jonas beton | 5 | R$ 1.500,00 |

**Bloco K — `jonas cliente` / `jonas beton`** = vendas de teste, podem ser ignoradas (cancelar todos os 5 balões dessa venda como `cancelado`).

**Demais 5 vendas:** gestora precisa preencher cronograma original (data prevista por balão) — não há fonte de verdade local pra inferir. Recomendamos planilha:

```
venda_id, numero_parcela, data_prevista
e1220449-..., 1, 2027-XX-XX
22833c5c-..., 1, 2027-XX-XX
... (33 linhas)
```

---

## Resumo

| Grupo | Qtd | Ação proposta |
|-------|-----|----------------|
| A — fantasmas Sienge (contratos 207, 243) | 7 | Cancelar (recomendado) |
| B — bloco K teste (jonas) | 5 | Cancelar |
| B — vendas reais sem cronograma | 28 | Gestora preenche planilha |
| **Total** | **40** | |

Status: aguardando decisão da gestora. Nenhuma mutação aplicada nesta etapa.

Referência: [docs/B5-execucao.json](docs/B5-execucao.json)
