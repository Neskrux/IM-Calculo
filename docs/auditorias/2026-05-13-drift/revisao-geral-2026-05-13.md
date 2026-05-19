# Revisão Geral do Sistema — 2026-05-13

Auditoria completa do IM-Calculo: arquitetura, regras de negócio vs código, integridade de dados, pendências.

Fonte: investigação multi-frente disparada após queixa de "relatório de vendas da Carolina incompleto". O que começou como 1 venda faltante revelou 10 vendas com corretor errado/ausente, vários bugs de aderência às regras de negócio e um **bug crítico no normalize do sync** que invalida proteções manuais.

---

## TL;DR — Top 5 problemas, em ordem de gravidade

1. 🔴 **Sync ignora `corretor_id_origem='manual'`** ([sales-contracts.ts:401-405](../supabase/functions/sienge-sync/normalize/sales-contracts.ts#L401-L405)). As 10 correções manuais aplicadas hoje serão **sobrescritas no próximo sync**. Proteção da migration 021 existe no schema mas não no código.
2. 🔴 **Snapshot `vendas.comissao_total` divergente em 89.7% das vendas** (R$ 6,86 mi de erro absoluto). UI usa esse snapshot stale em pelo menos 3 lugares — viola `visualizacao-totais.md`.
3. 🟠 **2 cálculos de comissão em PDF aplicam percentual direto na parcela** ([AdminDashboard.jsx:4271, 4403](../src/pages/AdminDashboard.jsx#L4271)) — viola `fator-comissao.md`.
4. 🟠 **Distribuição pago/pendente em 21.3% / 78.2%** — meta da spec é ~95% pago. Backfill de income está incompleto.
5. 🟡 **3 vendas sem `corretor_id`** + **brokers Sienge com cadastro local mas sem `sienge_broker_id` preenchido** (Maicon Iaroch, Erica Faerber, Matheus Pires) → sync vai continuar atribuindo errado.

---

## 1. Estado dos dados (foto em 2026-05-13)

```
vendas: 331 (todas ativas, 0 excluídas)
pagamentos_prosoluto: 18.631
usuarios (corretor): 75
empreendimentos: 9 (7 com sienge_enterprise_id)
clientes: 326
```

**Invariantes da spec `sincronizacao-sienge.md`:**

| Invariante | Esperado | Atual | Status |
|---|---|---|---|
| `pago` SEM data_pagamento | 0 | 0 | ✓ |
| `pendente` COM data_pagamento | 0 | 0 | ✓ |
| pagamentos SEM data_prevista | 0 | **26** | ⚠️ |
| vendas `excluido=true` | (livre) | 0 | ✓ |
| origem dos `corretor_id` (manual) | varia | 10 | (após correções de hoje) |
| vendas SEM `corretor_id` | 0 | **3** | ⚠️ |

**Distribuição de pagamentos:**

| status | qtd | % | meta spec |
|---|---|---|---|
| pago | 3.975 | 21.3% | ~95% |
| pendente | 14.576 | 78.2% | ~5% |
| cancelado | 80 | 0.4% | pontual |

Subiu de 2.8% (baseline 2026-04-22 da spec) pra 21.3%, mas ainda muito longe. Indica que o **backfill via `/bulk-data/v1/income` não rodou completo** ou parou no meio.

**Snapshot stale em vendas:**
- 297 de 331 vendas (**89.7%**) têm `vendas.comissao_total` ≠ soma viva de `pagamentos_prosoluto.comissao_gerada`.
- Soma absoluta do erro: **R$ 6.858.172,39**.
- Mesma ordem de grandeza da auditoria de 2026-04-27 (R$ 7,2 mi) — não progrediu.

---

## 2. Bugs no código (priorizados)

### 🔴 Crítico — Sync sobrescreve `corretor_id_origem='manual'`

[supabase/functions/sienge-sync/normalize/sales-contracts.ts:340-407](../supabase/functions/sienge-sync/normalize/sales-contracts.ts#L340-L407)

`upsertVenda()` monta `row` com `corretor_id: corretor?.id ?? null` e faz `upsert({...row, ...})` direto, sem ler a `corretor_id_origem` da venda existente. Resultado: toda venda sincronizada tem `corretor_id` sobrescrito pelo broker que o Sienge informa naquele momento, mesmo que origem='manual'.

**Impacto imediato:** as 10 vendas que corrigi hoje (138 Carolina, 350 Felipe Madona, 75/433/434/435 Watson, 224/238/264 Gabriel Luz, 232 Paulo Chaves) **serão sobrescritas no próximo sync** quando o broker do Sienge for diferente do que está no banco.

**Fix sugerido**: antes do upsert, fazer um SELECT da venda existente. Se `corretor_id_origem='manual'` (ou `api_commissions`), preservar o `corretor_id` atual no row. Mesmo tratamento pra `cliente_id_origem`.

```ts
const { data: existente } = await supa.from('vendas')
  .select('corretor_id, corretor_id_origem, cliente_id, cliente_id_origem')
  .eq('sienge_contract_id', String(contract.id))
  .maybeSingle()

if (existente?.corretor_id_origem === 'manual' || existente?.corretor_id_origem === 'api_commissions') {
  row.corretor_id = existente.corretor_id
  row.corretor_id_origem = existente.corretor_id_origem
}
if (existente?.cliente_id_origem === 'manual') {
  row.cliente_id = existente.cliente_id
  row.cliente_id_origem = existente.cliente_id_origem
}
```

### 🔴 Alto — Snapshot stale em UI/PDF

[src/pages/AdminDashboard.jsx:4406](../src/pages/AdminDashboard.jsx#L4406)

```js
comissaoVenda = parseFloat(venda?.comissao_total) || grupo.totalComissao || ...
```

Fallback para snapshot stale viola `visualizacao-totais.md`. Deve sempre derivar de `grupo.pagamentos`.

[src/pages/AdminDashboard.jsx:4271, 4403](../src/pages/AdminDashboard.jsx#L4271)

```js
const comissao = valorParcela * percentualCorretorTotais
```

Aplica percentual direto na parcela — viola `fator-comissao.md`. Deveria usar `calcularComissaoPagamento(pag)`.

### 🟠 Médio — `vendas.comissao_corretor` como fonte

[src/pages/AdminDashboard.jsx:2873](../src/pages/AdminDashboard.jsx#L2873)

```js
if (!venda.comissao_corretor || venda.comissao_corretor === 0)
```

Trata snapshot como verdade. Viola `comissao-corretor.md` ("comissão por pagamento, não por venda").

### 🟠 Médio — DELETE sem filtro de status

[src/pages/AdminDashboard.jsx:235](../src/pages/AdminDashboard.jsx#L235)

```js
from('pagamentos_prosoluto').delete().in('id', idsParaRemover)
```

Sem `.eq('status', 'pendente')`. Trigger 017 deve barrar deletes de `pago`, mas a query deveria também explicitar pra não depender só da defesa do banco.

### 🟡 Baixo — Broker não mapeado vira NULL silenciosamente

[sales-contracts.ts:347-352](../supabase/functions/sienge-sync/normalize/sales-contracts.ts#L347-L352)

```ts
const corP = contract.brokers?.find(b => b.main) ?? contract.brokers?.[0]
const corretor = corP?.id != null ? maps.corBySienge.get(String(corP.id)) ?? null : null
```

Se o broker do Sienge não tem cadastro em `usuarios.sienge_broker_id`, `corretor` vira null e a venda é gravada sem `corretor_id`. **Isso já causou 3+ vendas sem corretor no banco.** Deveria pelo menos logar (em `runs.metrics`).

---

## 3. Pendências de dados

### Caso A — Matheus de S. Pires (duplicata confirmada)

Cadastro local `9b1f5c90-...`: nome **MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS**, CNPJ **60.509.941/0001-87**, cadastrado manualmente em 28/jan/2026, `tipo_corretor=interno`.

Sienge broker 118: nome idêntico, **CNPJ idêntico 60.509.941/0001-87**, cidade Itajaí.

**Conclusão: é a mesma empresa.** Decisão: vincular `sienge_broker_id=118` no cadastro local. Cuidado: revisar se `tipo_corretor=interno` está certo (no Sienge ele é um broker normal — pode ter sido marcado manualmente como interno por engano). Há 2 vendas atribuídas a esse UUID — a 176 (contract Sienge) e uma sem `sienge_contract_id` (manual).

### Maicon/Maicom Iaroch e Erica Faerber

Ambos têm cadastro local com `origem='manual'`, sem CPF preenchido, sem `sienge_broker_id`. No Sienge:
- Broker 461 — Maicom Iaroch (CPF 031.620.719-50, Itajaí)
- Broker 352 — ERICA FAERBER (CPF 630.525.479-68, Itajaí)

Mesmo nome, mesma cidade. Quase certo que são a mesma pessoa. Pra vincular com segurança, **pedir CPF deles pra controladoria** e confirmar.

Há 1 venda no banco atribuída a cada um deles (Maicon → contract 213; Erica → contract 390), com `origem='sync'`. Quando vincular `sienge_broker_id`, marcar `origem='manual'` nessas vendas pra proteger (depois que o bug crítico 1 for corrigido).

### Felicita Imobiliária (broker 358)

Sem cadastro local. Tem 1 venda no banco (contract 411) com `corretor_id=NULL`. Precisa cadastrar antes de reatribuir.

### 3 vendas remanescentes sem corretor_id

| Contract | Valor | Data | Causa |
|---|---|---|---|
| 411 | R$ 426.900,16 | 2026-02-09 | Felicita (broker 358) sem cadastro local |
| 236 | R$ 384.110,14 | 2025-05-16 | Investigar — não estava no batch da audit anterior |
| 79 | R$ 418.341,97 | 2025-06-04 | Sienge não tem broker main neste contrato |

### 26 pagamentos sem `data_prevista`

Todos `tipo=balao`, `status=pendente`. Concentrados em poucas vendas. Spec diz que `data_prevista` é sempre preenchida. Provavelmente são balões "futuros" sem data definida — o gerador antigo deixou null em vez de calcular pelo calendário.

**Ação**: preencher via cálculo a partir de `data_entrada + periodicidade_balao * numero_parcela`, ou marcar essas vendas pra revisão.

---

## 4. Padrões arquiteturais (notas pra futuro)

### Frontend

- `src/pages/AdminDashboard.jsx` tem **11.5k linhas** — está cobrando preço em manutenção. Vários bugs (R1, R2, R5) acumulados nele.
- Padrão de fetch é cliente Supabase direto, sem camada de serviço. Mistura SQL com renderização. Refatorar pra `services/` ajudaria isolamento.
- Validações de input (formulários, modais) variam — alguns usam HTML5 `required`, outros lógica JS no submit.

### Backend (Edge Functions)

- Orchestrator centraliza `enterpriseId=2104` em [run.ts:15](../supabase/functions/sienge-sync/orchestrator/run.ts#L15) — bom.
- Mas normalize de sales-contracts viola a separação: faz lógica de proteção fraca (só ler `brokers[0].main`) e ignora `origem`.
- `runs.metrics` é JSONB livre — sem schema validation. Spec define schema canônico mas código não enforce.

### Banco

- Triggers 017/018/020 protegem pagamentos pagos no DB — defesa em profundidade boa.
- Falta CHECK pra `origem` consistente (ex.: quando `corretor_id IS NULL`, `corretor_id_origem` poderia exigir 'sync' ou ser ignorado).
- Migration 022 (motivo_exclusao) ainda não foi aplicada — está no repo, precisa rodar no Supabase SQL Editor.

---

## 5. Recomendações priorizadas

### Esta semana

1. **[bug crítico]** Aplicar fix em [sales-contracts.ts:340-407](../supabase/functions/sienge-sync/normalize/sales-contracts.ts#L340-L407) pra respeitar `corretor_id_origem='manual'`. Deploy da edge function. Sem isso, qualquer correção manual no `corretor_id` é fictícia.
2. **[migration]** Aplicar migration 022 (motivo_exclusao) no Supabase SQL Editor.
3. **[dados]** Vincular `sienge_broker_id` nos 3 cadastros: Matheus Pires (118), Maicom Iaroch (461) — *após confirmar CPF*, Erica Faerber (352) — *após confirmar CPF*. Marcar `origem='manual'` nas vendas relacionadas.
4. **[dados]** Cadastrar Felicita Imobiliária + reatribuir contract 411.
5. **[financeiro]** Levar pra controladoria a lista de comissões a estornar/realocar das 10 vendas corrigidas hoje.

### Próximas 2 semanas

6. **[código]** Eliminar fallbacks pra `venda.comissao_total/comissao_corretor/fator_comissao` em UI/PDF. Substituir por `somarComissao(grupo.pagamentos)` do `comissaoCalculator`. Pelo menos linhas 2873, 4271, 4403, 4406 do AdminDashboard.
7. **[código]** Adicionar `.eq('status','pendente')` em deletes de pagamentos.
8. **[dados]** Investigar os 26 balões sem `data_prevista` — gerar datas ou marcar pra revisão humana.
9. **[backfill]** Retomar backfill de income pra elevar % pago de 21% pra ~95%. Identificar onde parou.
10. **[UI]** Tela de "vendas excluídas" mostrando motivo + autor + data (depende da migration 022).

### Manutenção contínua

11. **[código]** Refatorar AdminDashboard.jsx em módulos menores (vendas, comissões, sync, relatórios). Hoje toda mudança lá tem risco.
12. **[código]** Snapshot `vendas.comissao_total` deveria ser **eliminado** (já que viola a regra de visualização) ou recomputado consistentemente. Decidir entre os dois e seguir.
13. **[observabilidade]** Schema validation em `runs.metrics` (a spec já define o formato — bastaria validar no orchestrator antes de gravar).
14. **[observabilidade]** Logar em `runs.metrics.warnings` quando broker do Sienge não tem cadastro local — ajuda a pegar casos como Felicita antes de virarem queixa.

---

## 6. Apêndice — histórico das correções de hoje

| # | Contract | De (banco) | Pra (Sienge) | Status |
|---|---|---|---|---|
| 1 | 138 | Bruno Diogo | Carolina | ✓ manual |
| 2 | 350 | Luiz Corazza | Felipe Madona | ✓ manual |
| 3 | 75 | NULL | Felipe Madona | ✓ manual |
| 4 | 433 | NULL | Watson Slonski | ✓ manual |
| 5 | 434 | NULL | Watson Slonski | ✓ manual |
| 6 | 435 | NULL | Watson Slonski | ✓ manual |
| 7 | 224 | Maicon Iaroch | Gabriel Luz | ✓ manual |
| 8 | 238 | Maicon Iaroch | Gabriel Luz | ✓ manual |
| 9 | 264 | Maicon Iaroch | Gabriel Luz | ✓ manual |
| 10 | 232 | Paulo Rigoni | Paulo Chaves Jr | ✓ manual |

Reversão da venda 9760cf8a-... (1603 C Carolina) de `excluido=true` pra `excluido=false`.

Migration 022 (motivo_exclusao) escrita mas **não aplicada** ainda.

Scripts criados: ver `scripts/auditar-*`, `scripts/investigar-*`, `scripts/corrigir-*`, `scripts/cadastrar-*`. Todos respeitam o padrão `.env` + cliente Supabase anon.

---

## 7. Referências

- Regras vigentes: [`.claude/rules/`](../.claude/rules/) (fator-comissao, comissao-corretor, comissao-integral-20, sincronizacao-sienge, visualizacao-totais, rodadas-b)
- Spec geral: [CLAUDE.md](../CLAUDE.md)
- Migrations recentes: [017](../migrations/017_proteger_pagamentos_auditados.sql), [018](../migrations/018_afrouxar_snapshot_em_pago.sql), [020](../migrations/020_liberar_data_pagamento_sienge.sql), [021](../migrations/021_corretor_cliente_id_origem.sql), [022](../migrations/022_motivo_exclusao_venda.sql) (pendente)
- Auditorias anteriores: [docs/p1-p2-execucao.md](p1-p2-execucao.md), [docs/p3-vendas-divergentes-decisao.md](p3-vendas-divergentes-decisao.md)
