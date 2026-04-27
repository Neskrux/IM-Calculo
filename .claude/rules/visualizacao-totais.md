# Regra: Visualização de Totais Financeiros

## Princípio fundamental

**Componentes de UI derivam totais financeiros SEMPRE de `pagamentos_prosoluto`, nunca de snapshots em `vendas`.**

Snapshots em `vendas` (`comissao_total`, `comissao_corretor`, `fator_comissao`) são **histórico do cálculo no momento da criação** — podem estar stale (auditoria 2026-04-27 encontrou `comissao_total` divergente em 284/319 vendas, soma absoluta de erro **R$ 7,2 milhões**).

A verdade viva é `SUM(pagamentos_prosoluto.comissao_gerada)` filtrada por `venda_id`.

---

## Permitido vs proibido

| Local | Pode ler `vendas.comissao_total`/`comissao_corretor`? |
|-------|-------------------------------------------------------|
| Gerador de pagamentos (cálculo inicial) | ✅ Sim, é entrada do cálculo |
| Migration / script de correção retroativa | ✅ Sim, como ponto de partida |
| Componente de UI / dashboard / cards / gráficos | ❌ **NÃO** — derivar de pagamentos |
| Geração de PDF / relatório financeiro | ❌ **NÃO** — derivar de pagamentos |
| Filtro / agregação / soma exibida ao usuário | ❌ **NÃO** — derivar de pagamentos |

---

## Helpers canônicos

Sempre importar de [src/utils/comissaoCalculator.js](src/utils/comissaoCalculator.js):

- **`calcularComissaoPagamento(pag)`** — comissão de uma única parcela (lê `comissao_gerada` ou recalcula via `valor × fator_comissao_aplicado`).
- **`somarComissao(pagamentos)`** — soma viva de uma lista de pagamentos.
- **`dataEfetiva(pag)`** — `pag.data_pagamento ?? pag.data_prevista` (filtros de período).
- **`isPago(pag)`** / **`isPendente(pag)`** — predicados de status.

**Padrão correto:**
```javascript
import { somarComissao, isPago } from '../utils/comissaoCalculator'

const pagamentosVenda = pagamentos.filter(p => p.venda_id === venda.id)
const comissaoTotal = somarComissao(pagamentosVenda)
const comissaoPaga = somarComissao(pagamentosVenda.filter(isPago))
```

**Padrão errado (NUNCA fazer em UI):**
```javascript
// ❌ valor stale, divergente em 89% das vendas
const comissaoTotal = vendas.reduce((acc, v) => acc + (v.comissao_total || 0), 0)
```

---

## Contexto

Esta regra foi formalizada em 2026-04-27 após auditoria que encontrou:
- **HomeDashboard** "Distribuição de Comissões" usando `vendas.comissao_total` stale em gráfico de pizza Externo×Interno (mostrava ~zero).
- **AdminDashboard** modal "Visualizar Venda" exibindo `selectedItem.comissao_total` stale.
- **AdminDashboard** PDF de relatório com fallback para `venda.comissao_total` quando `listaVendasComPagamentos` vazio.
- **CorretorDashboard** fallback `venda.comissao_corretor` em listagens de "Minhas Vendas".

Todos foram corrigidos pra ler de `pagamentos_prosoluto`. Esta regra existe pra impedir regressão.

Quem for criar componente novo de visualização: lê este arquivo antes.
