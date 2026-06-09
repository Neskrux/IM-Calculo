---
status: CONTEXT ENGINEERING (factual, lido do código) — base pra decisão, nada executado
data: 2026-06-03
branch: sync/reconciliacao
escopo: comportamento do sync Sienge→Supabase quando uma ENTIDADE (cliente/corretor/unidade/empreendimento/venda) NÃO existe no nosso banco
fonte: supabase/functions/sienge-sync/* (lido linha a linha)
---

# Context Engineering — Sync Sienge → Supabase: comportamento com ENTIDADE AUSENTE

## Por que este doc (o problemão)

Os 2 bancos vão ficar 100% **no que existe hoje**. Mas o Sienge **continua gerando dados novos** (vendas,
clientes, corretores, unidades). Pergunta central: **quando o sync puxa uma venda nova cujo cliente/corretor/
unidade não tem cadastro no nosso banco — ele cria? não cria? foi pensado pra criar?** Disso depende se o espelho
continua fiel quando entra coisa nova. Abaixo, o comportamento **real do código** (não o que se imagina).

## Arquitetura do sync (edge function `sienge-sync`)

Duas fases por entidade:
1. **INGEST (API → RAW):** puxa o endpoint do Sienge e grava o JSON cru em `sienge_raw.objects`. Filtra Figueira
   (`enterpriseId=2104`) em quem tem `enterpriseIdField`.
2. **NORMALIZE (RAW → tabela final):** lê o RAW e popula a tabela de negócio.

Disparo: botão Admin / cron → `POST /sync/incremental` (ou `/full`). **Default = todas as 6 entidades**
(`index.ts:17,80`), na ordem: `customers → creditors → enterprises → units → sales-contracts → receivable-bills`.

### ⚠️ O ponto-chave: só 3 das 6 entidades têm `normalize`

`orchestrator/run.ts` (ENTITY_CONFIG, l.35-71):

| Entidade | Ingest (→RAW) | Normalize (→tabela) | Tabela final |
|---|---|---|---|
| customers | ✅ | ✅ `normalizeCustomers` | `clientes` |
| **creditors** (corretores) | ✅ | ❌ **undefined** | `usuarios` — **não populada** |
| **enterprises** | ✅ | ❌ **undefined** | `empreendimentos` — **não populada** |
| **units** | ✅ | ❌ **undefined** | `unidades` — **não populada** |
| sales-contracts | ✅ | ✅ `normalizeSalesContracts` | `vendas` + `pagamentos_prosoluto` |
| receivable-bills | (skip) | ✅ `normalizeReceivableBills` | baixa `data_pagamento`/`status` |

→ **corretor, unidade e empreendimento são baixados pro RAW mas NUNCA viram registro final** (o normalize
nunca foi implementado). O dado fica parado em `sienge_raw.objects`.

## Matriz de "entidade ausente" (o coração da resposta)

Quando o sync processa uma venda e a dependência **não existe** no banco:

| Dependência | Onde resolve | Se NÃO existe | Cria? | Efeito |
|---|---|---|---|---|
| **Cliente** | `customers` normaliza ANTES (mesma run) | se customers rodou → resolve; senão `cliente_id=NULL` | ✅ **SIM** (insert + cônjuge) | ok, desde que customers esteja no run |
| **Corretor** | lookup `corBySienge` (`sales-contracts.ts:376`) | `corretor_id = NULL` + log `broker_sienge_sem_cadastro_local` | ❌ **NÃO** | **venda órfã de corretor** — comissão sem dono |
| **Unidade** | lookup `unitBySienge` (l.374) | `unidade_id = NULL` | ❌ **NÃO** | venda sem unidade vinculada |
| **Empreendimento** | lookup `empByEnt` (l.373) | `empreendimento_id=NULL` + **fator usa default 7%** (l.465) | ❌ **NÃO** | só Figueira importa (já existe); risco p/ outro emp. |
| **Venda** | `upsertVenda` → `.upsert(onConflict:sienge_contract_id)` (l.487) | — | ✅ **SIM, sempre** (mesmo com FKs NULL) | venda entra "coxa" |
| **Parcelas** | `montarPagamentos` + `mergePagamentos` | cria pendentes; income preenche pago | ✅ SIM | ok |
| **Parceiro / cargo** | não há entidade no sync | cargos vivem em `cargos_empreendimento` (manual) | — | fora do sync |

## Respondendo direto a pergunta do Jonas

> "Faz um novo? Não faz? Foi pensado que deveria fazer?"

- **Cliente novo:** FAZ (implementado). ✅
- **Venda nova:** FAZ — o `upsert` cria a venda **mesmo sem corretor/unidade**. ✅ (mas entra incompleta)
- **Corretor / unidade / empreendimento novo:** **NÃO FAZ** — mas **foi pensado** (tem config no orchestrator,
  está no `VALID_ENTITIES`, é ingerido pro RAW). O `normalize` simplesmente **nunca foi implementado**
  (`undefined`). É um **"pela metade"**, não uma decisão consciente de "não criar".

## Por que isso não explodiu até hoje

O universo atual (Figueira) **já tem** os corretores/unidades cadastrados (backfill antigo + o sync legado já
deletado + cadastro manual). Então o lookup acha quase tudo. O furo **só aparece com entidade NOVA** — que é
exatamente a fase que o Jonas está prevendo. Já há sinais: o log `broker_sienge_sem_cadastro_local` e as vendas
órfãs registradas em `docs/.../revisao-geral-2026-05-13`.

## O risco concreto (quando ligar o sync de vendas novas)

Uma venda nova de **corretor novo** entra com `corretor_id=NULL`:
- não aparece no dashboard do corretor;
- comissão calculada mas **sem dono**;
- relatório da controladoria não atribui.

E o dado do corretor **está no RAW** (foi ingerido) — só falta normalizar.

## Decisões abertas (o que precisa ser decidido antes de ligar)

1. **Corretor novo** → implementar `normalize` de `creditors` (RAW→`usuarios`)? Define `tipo_corretor`
   (interno/externo) como? (afeta fator 7% vs 6,5%). Placeholder + alerta vs bloquear venda até cadastrar.
2. **Unidade nova** → implementar `normalize` de `units` (RAW→`unidades`)?
3. **Empreendimento novo** → idem (hoje só Figueira; vira relevante se liberar outro emp.).
4. **Venda com FK NULL** → criar mesmo assim + **fila de revisão** (rodada b), ou segurar a venda?
5. **Ordem garantida** → `customers` SEMPRE antes de `sales-contracts` (senão `cliente_id=NULL` também).
6. **Parceiro/cargo** → precisa virar entidade sincronizada, ou continua manual em `cargos_empreendimento`?
7. **`tipo_corretor`** → de onde vem na criação do corretor? Hoje default `externo` — erra o fator se for interno.

## Evidências no código (rastreabilidade)

- `index.ts:17,80` — `VALID_ENTITIES` = 6; default roda todas.
- `orchestrator/run.ts:35-71` — `creditors`/`enterprises`/`units` sem `normalize`.
- `normalize/sales-contracts.ts:364-376` — lookups FK; ausente → `null`.
- `normalize/sales-contracts.ts:378-388` — warning broker sem cadastro.
- `normalize/sales-contracts.ts:487-493` — `upsert` cria venda mesmo com FK null.
- `normalize/customers.ts:122-130` — cliente novo → INSERT.
- `normalize/sales-contracts.ts:465` — fator usa default 7% quando empreendimento ausente.
