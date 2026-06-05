# Context Engineering — Estado do Banco (snapshot 2026-05-29)

> **O que é este documento.** Retrato vivo do que existe **hoje** no banco do IM-Calculo,
> medido por query direta (não por inferência de código nem por histórico). Serve como
> contexto inicial para qualquer agente/dev que for trabalhar nesta base: começa por aqui,
> depois desce para `.claude/rules/` (a spec) e `docs/` (o histórico de como chegamos aqui).
>
> **Como ler junto com o resto do repo:**
> - `.claude/rules/*.md` → **a spec** (regras de negócio invioláveis). É a fonte normativa.
> - `docs/auditorias/`, `docs/rodadas/` → **o histórico** (o que já foi corrigido e por quê).
> - **este arquivo** → **o estado atual** (o que está medido no banco neste momento).
>
> Snapshot é congelado no tempo. Para estado *atual* re-rode as queries da seção 9.

---

## 0. Identidade e escopo

| Item | Valor |
|------|-------|
| Projeto Supabase | **Calculo IM** — `jdkkusrxullttyeakwib` (região us-east-1, Postgres 17) |
| URL | `https://jdkkusrxullttyeakwib.supabase.co` (confirmado em `.env`) |
| Empreendimento ativo | **FIGUEIRA GARCIA** — `enterpriseId = 2104` (único em sync, ver [sincronizacao-sienge.md](../../.claude/rules/sincronizacao-sienge.md)) |
| Fonte da verdade financeira | **Sienge** (banco local é espelho) |
| Data do snapshot | 2026-05-29 |

⚠️ **Nota:** existem 12 projetos Supabase na organização. O ref correto deste repo é
`jdkkusrxullttyeakwib`. Não confundir com "IMCapital" (`wckbhvszhoeqlxqljvxt`).

---

## 1. Inventário de tabelas (públicas, com linhas)

### Tabelas operacionais
| Tabela | Linhas | Papel |
|--------|-------:|-------|
| `pagamentos_prosoluto` | **19.002** | Parcelas + snapshot de fator. **Fonte viva de comissão.** |
| `unidades` | 561 | Unidades sincronizadas do Sienge |
| `vendas` | 332 | Contratos (302 ativas + 30 `excluido=TRUE`) |
| `clientes` | 327 | |
| `comissoes_venda` | 196 | Snapshot por venda — **subutilizada** (só 33 vendas distintas cobertas) |
| `usuarios` | 79 | |
| `complementadores_renda` | 12 | |
| `cargos_empreendimento` | 11 | Percentuais atuais (ver seção 6) |
| `conquistas` | 10 | |
| `empreendimentos` | 9 | Só Figueira tem dado transacional |
| `solicitacoes` | 7 | Aprovações pendentes de corretor |
| `sienge_sync_jobs` | 6 | Controle de sync incremental por entidade |
| `renegociacoes` | 1 | |

### Tabelas de backup (não são dados vivos — não usar em UI/relatório)
| Tabela | Linhas | Origem |
|--------|-------:|--------|
| `backup_pagamentos_prosoluto_prego_20260424` | 18.558 | Snapshot pré-"prego" 2026-04-24 |
| `backup_b5_falsos_cancelados_20260424` | 361 | Rodada B5 |
| `backup_vendas_prego_20260424` | 330 | Snapshot pré-"prego" 2026-04-24 |

### Vazias / sem uso atual
`atividades`, `leads`, `metas`, `notificacoes`, `usuario_conquistas`,
`cargos_empreendimento_historico` (0 — log de alteração de % nunca disparou),
`mentoria_*` (0).

---

## 2. `pagamentos_prosoluto` — estado vs meta

| Status | Linhas | % atual | Meta da spec |
|--------|-------:|--------:|-------------:|
| `pago` | 4.381 | **23,06%** | ~95% |
| `pendente` | 12.843 | **67,59%** | ~5% |
| `cancelado` | 1.778 | 9,36% | pontual |

**Leitura:** o gap entre 23% pago e a meta de ~95% continua sendo o problema central do
projeto. A spec ([sincronizacao-sienge.md](../../.claude/rules/sincronizacao-sienge.md))
atribui esse gap a **"falsos pendentes"** — parcelas que o cliente pagou no Sienge mas o
`income` local ainda não refletiu. O baseline de 2026-04-22 era 2,8% pago; hoje 23%, então
houve avanço grande, mas ainda longe da meta.

**Tipos de pagamento:** `parcela_entrada` 18.576 · `balao` 321 · `sinal` 102 · `bens` 2 ·
`comissao_integral` 1.

### Financeiro vivo (`SUM(comissao_gerada)`)
| Recorte | Valor |
|---------|------:|
| Comissão total viva | R$ 8.683.593,26 |
| Comissão paga (`status=pago`) | R$ 2.015.498,29 |
| Comissão pendente (`status=pendente`) | R$ 5.726.444,91 |

Janela temporal: `data_prevista` de 2025-04-18 a 2033-02-01; `data_pagamento` de
2025-04-20 a 2026-12-19; último `updated_at` 2026-05-29 (sync do dia).

---

## 3. Health-check das invariantes da spec

As invariantes vêm de [sincronizacao-sienge.md](../../.claude/rules/sincronizacao-sienge.md).
Medição direta hoje:

| Invariante | Esperado | Medido | Status |
|------------|---------|-------:|:------:|
| `pago` ⇒ `data_pagamento IS NOT NULL` | 0 violações | 0 | ✅ |
| `pendente` ⇒ `data_pagamento IS NULL` | 0 violações | 0 | ✅ |
| `data_prevista` sempre preenchida | 0 nulos | **10** nulos | ⚠️ |
| Escopo single-enterprise (só 2104) | só Figueira | 332/332 Figueira | ✅ |
| Sem `pago` com data futura | 0 | **3** | ⚠️ |

As duas invariantes financeiras de status (pago↔data) estão **íntegras**. Pendências leves:
10 parcelas sem `data_prevista` e 3 pagos com data no futuro (ver
`docs/auditoria-pagos-futuros-sienge-2026-05-22.json` para contexto desse tipo de caso).

---

## 4. ⚠️ Problema de qualidade aberto: duplicatas `(venda_id, numero_parcela)`

A spec ([CLAUDE.md](../../CLAUDE.md), fix 2026-05-13) diz que a causa-raiz que gerava pares
`cancelado+pendente` foi eliminada em `propagarCronogramaCirurgico`. Isso vale para **novos**
pares — mas o passivo histórico **ainda existe** no banco:

| Recorte de duplicata | Grupos |
|----------------------|-------:|
| Todas (incluindo canceladas) | 570 |
| **Apenas não-canceladas** | **324** |
| ↳ `pago + pendente` | 201 |
| ↳ `pago + pago` (duplo!) | 86 |
| ↳ `pendente + pendente` | 37 |

- **`pago+pendente` (201)** infla o total pendente — a parcela já foi paga numa linha, mas
  a duplicata pendente continua contando como a receber.
- **`pago+pago` (86 grupos / 97 linhas em excesso)** é o mais sério: **comissão paga contada
  em dobro**. Risco de relatório de repasse pagar duas vezes a mesma parcela.

Esse é o candidato natural a uma próxima **rodada `b`** (ver
[rodadas-b.md](../../.claude/rules/rodadas-b.md)) — ancoragem 1:1 por `sienge_installment_id`
(seção 5) é o caminho para desfazer com segurança, já que decidir qual linha mantém **não é
mecânico** quando ambas estão `pago`.

Sinais correlatos:
- **346 parcelas pendentes já vencidas** (`data_prevista < hoje`), somando R$ 189.165,56 de
  comissão. Mistura de inadimplência real (~5% esperado) com falsos pendentes.

---

## 5. Ancoragem com o Sienge

| Campo | Preenchido | Total | Cobertura |
|-------|-----------:|------:|----------:|
| `sienge_bill_id` | 15.223 | 19.002 | 80,1% |
| `sienge_installment_id` | 15.223 | 19.002 | 80,1% |
| `fator_comissao_aplicado` (snapshot) | 18.709 | 19.002 | 98,5% |
| `comissao_gerada > 0` | 19.002 | 19.002 | 100% |

📌 **Divergência com CLAUDE.md:** o doc lista a
[migration 023](../../migrations/023_pagamentos_sienge_installment_id.sql) como
**"Não aplicada — pendente de revisão"**. Mas as colunas `sienge_bill_id` /
`sienge_installment_id` **existem e estão populadas em 80% das linhas** → a migration
**foi aplicada**. A nota em CLAUDE.md está desatualizada e deveria ser corrigida.

Os ~20% sem ancoragem (3.779 linhas) são o que ainda depende de match heurístico
`(venda_id, numero_parcela)` — exatamente as linhas mais propensas às duplicatas da seção 4.

---

## 6. Percentuais de comissão atuais (`cargos_empreendimento`)

Todos vigentes desde 2026-01-16, todos `ativo=true`, `vigente_ate=NULL`.

| Cargo | Externo | Interno |
|-------|--------:|--------:|
| Corretor | 4,00% | 2,50% |
| Ferretti Consultoria | 1,00% | 1,00% |
| Beton Arme | 0,50% | 1,25% |
| Diretor | 0,50% | 0,50% |
| Nohros | 0,50% | 1,25% |
| Coordenadora | 0,50% | — |
| **Total** | **7,00%** | **6,50%** |

O total externo de 7% bate com o exemplo canônico da
[fator-comissao.md](../../.claude/rules/fator-comissao.md). `cargos_empreendimento_historico`
está vazio (0 linhas) — nenhuma alteração de percentual foi registrada desde a carga inicial.

---

## 7. `vendas` — composição (302 ativas)

| Recorte | Valor |
|---------|-------|
| Tipo corretor | externo 245 · interno 57 |
| `situacao_contrato` | `2` (ativo) 273 · `3` 25 · null 4 |
| Origem `corretor_id` | `sync` 285 · `manual` 17 (protegidos contra sobrescrita — migration 021) |
| `excluido=TRUE` | 30 (fora das 302) |

`comissoes_venda` cobre apenas **33** das 302 vendas ativas — a tabela é um snapshot
legado/parcial. Para totais em UI **não** usar `comissoes_venda` nem `vendas.comissao_*`;
derivar de `pagamentos_prosoluto` (ver [visualizacao-totais.md](../../.claude/rules/visualizacao-totais.md)).

---

## 8. Sincronização — último estado dos jobs

| Entidade | Status | Último run |
|----------|:------:|-----------|
| `receivable-bills` | OK | 2026-05-29 04:54 |
| `sales-contracts` | OK | 2026-05-29 04:54 |
| `creditors` | OK | 2026-04-21 |
| `enterprises` | OK | 2026-04-21 |
| `customers` | OK | 2026-04-21 |
| `units` | OK | 2026-04-21 |

O cron diário (08h BRT, [recurring-reconciliation.yml](../../.github/workflows/recurring-reconciliation.yml))
está rodando: `receivable-bills` e `sales-contracts` foram sincronizados hoje de madrugada.
As entidades de cadastro (creditors/enterprises/customers/units) não mudam com frequência —
última sync em 2026-04-21.

---

## 9. 🔒 Segurança — pendência crítica

O advisor do Supabase reporta **RLS desabilitado em 22 tabelas**, incluindo
`pagamentos_prosoluto`, `vendas`, `clientes`, `usuarios`. Com a `anon key` exposta no
client, **qualquer um pode ler/escrever todas as linhas**. Isto **não** foi corrigido neste
trabalho (é decisão de negócio + exige desenhar policies, senão trava tudo). Remediação em
`https://supabase.com/docs/guides/database/postgres/row-level-security`.

---

## 10. Queries para re-medir este snapshot

```sql
-- Distribuição de status + invariantes
SELECT status, COUNT(*), ROUND(100.0*COUNT(*)/SUM(COUNT(*)) OVER (),2) AS pct
FROM pagamentos_prosoluto GROUP BY status;

SELECT COUNT(*) FROM pagamentos_prosoluto WHERE status='pago' AND data_pagamento IS NULL;      -- =0
SELECT COUNT(*) FROM pagamentos_prosoluto WHERE status='pendente' AND data_pagamento IS NOT NULL; -- =0

-- Duplicatas não-canceladas por combinação de status
SELECT string_agg(DISTINCT status,'+' ORDER BY status) AS combo, COUNT(*) AS grupos FROM (
  SELECT venda_id, numero_parcela FROM pagamentos_prosoluto WHERE status<>'cancelado'
  GROUP BY venda_id, numero_parcela HAVING COUNT(*)>1
) t JOIN LATERAL (SELECT 1) x ON true GROUP BY 1;  -- (ajustar conforme necessidade)

-- Cobertura de ancoragem Sienge
SELECT SUM((sienge_installment_id IS NOT NULL)::int) AS ancorados, COUNT(*) AS total
FROM pagamentos_prosoluto;
```

---

## 11. Resumo executivo (o que importa para a próxima sessão)

1. **Banco saudável nas invariantes financeiras** (pago↔data 100% íntegro).
2. **Meta de 95% pago ainda distante** (23% hoje) — gap = falsos pendentes do `income`.
3. **Passivo de duplicatas é o maior risco aberto:** 71 vendas com colisão de `numero_parcela`.
   **NÃO é comissão dobrada por padrão** — ver §12. São números trocados (renumerar) +
   pendentes fantasma (conferir no Sienge). Roteado para rodada **b8**.
4. **CLAUDE.md desatualizado:** migration 023 está aplicada (não "pendente"). Atualizar.
5. **RLS desabilitado em 22 tabelas** — pendência de segurança a decidir com a gestora.

---

## 12. Por que está longe da meta de 95% pago — e o denominador errado

### 12.1 O "23% pago" é artefato de denominador, não de inadimplência

A meta de 95% em [sincronizacao-sienge.md](../../.claude/rules/sincronizacao-sienge.md) usa **todas as
parcelas** como denominador. Mas a carteira FIGUEIRA tem **muita parcela futura** (vendas com
54–60 parcelas, vencendo ao longo de 4–5 anos). Comparar "pago" contra o total inclui parcelas
**que ainda nem venceram** — elas estão `pendente` porque é cedo, não porque o cliente está inadimplente.

**Denominador correto = parcelas já vencidas** (`data_prevista <= hoje`):

| Métrica | Valor |
|---------|-------|
| % pago sobre **todas** as parcelas | ~23% |
| % pago sobre **parcelas vencidas** (matured) | **~88,7%** |
| Inadimplência real estimada (vencido e não pago) | **~8–11%** |

> A leitura honesta: a operação **não está em colapso de cobrança**. Está cobrando ~89% do que
> venceu. O "23%" assusta mas mistura futuro com passado.

### 12.2 A meta de 5% de inadimplência ainda faz sentido?

Parcialmente. **5% é otimista** para esta carteira (pro-soluto de incorporadora costuma rodar
8–12% de atraso). Recomendação: **trocar o KPI do dashboard** de "% pago total" para
**"% pago sobre vencidas"** + **"inadimplência = vencido não pago"**. Aí 5% vira meta de
inadimplência real (alcançável com régua de cobrança), e o número que a gestora vê para de mentir.

> ⚠️ Isto é mudança de **código de UI** (cards/KPIs) — **não foi feito** nesta sessão (é
> alteração em `main` fora do escopo de docs). Fica como recomendação.

### 12.3 O que ainda impede chegar perto de 89%→95%

1. **Falsos pendentes residuais:** parcelas que o cliente pagou mas o `income` do Sienge ainda
   não preencheu `data_pagamento` localmente. O cron diário fecha isso aos poucos, mas depende de quota.
2. **Quota Sienge** (ver §13) — o gargalo real para reconciliar o resto.

---

## 13. Gargalo de quota Sienge — o que sabemos e a contradição em aberto

| Fonte | Afirma |
|-------|--------|
| `sincronizacao-sienge.md` (spec) | `/bulk-data/v1/*` **sem quota diária**; REST v1 = 100/dia |
| Usuária (sessão 2026-05-29) | **10 bulk/dia + 100 REST/dia** |
| `recurring-reconciliation.yml` | step 3 "consome ~10 chamadas bulk-data e a quota diária do Sienge é pequena" |

**Contradição não resolvida:** a spec diz bulk ilimitado; usuária e workflow dizem ~10/dia.
**Antes de planejar qualquer backfill é preciso confirmar o limite real de bulk no painel Sienge.**
Se for mesmo 10/dia, reconciliar 71 contratos da b8 (1 income por contrato) leva **vários dias**
ou exige 1 chamada ampla que traga todos de uma vez (preferível).

### 13.1 Custo/funcionamento do cron hoje

- O cron **está rodando** (sync de `receivable-bills`/`sales-contracts` com timestamp de hoje 04:54).
- **Não foi possível medir o gasto exato de Actions** nesta sessão: `gh` não está instalado/autenticado
  no ambiente. Para ver: aba **Actions → Reconciliacao Pagamentos** no GitHub + baixar o artifact
  `reconciliation-report-*` de cada run.
- O cron usa `actions/cache` para `.sienge-cache/` com TTL 1h e *stale-on-error*, então em dias
  normais ele relê o cache (0 chamadas) e só busca income fresco 1×/dia.

### 13.2 Ideia da usuária: exportar relatório direto no Sienge

Viável e **economiza quota** — em vez de bater na API, exportar o relatório de **Contas a Receber
(income)** pela UI do Sienge e importar via script. Para montar o importador preciso de **uma
amostra do export** (CSV/XLSX) para mapear colunas → `pagamentos_prosoluto`. **Bloqueio: depende
de você gerar esse export uma vez** (nunca usou o Sienge — ver §14).

---

## 14. O que ficou pendente do lado da usuária (bloqueios)

Tudo que **eu não consigo destravar sozinho** e depende de decisão/ação da gestora:

1. **Confirmar o limite real de bulk no Sienge** (10/dia? ilimitado?). Sem isso não dá pra planejar
   backfill. → resolve a contradição da §13.
2. **Gerar 1 export de Contas a Receber (income) pela UI do Sienge** (CSV/XLSX) e me mandar.
   Com a amostra eu monto um importador que economiza quota. → §13.2.
3. **Decidir a política da rodada b8** (ver [b8-texto-para-usuaria.md](../rodadas/b8/b8-texto-para-usuaria.md)):
   - Grupo 1 (12 vendas): "ok renumerar" — sem risco, sem perda de comissão.
   - Grupo 2 (42 vendas): "ok conferir no Sienge e cancelar fantasmas".
   - Grupo 3b (3 órfãs — unidades **1603**, **002**, **603**): confirmar se são vendas **reais**.
4. **Decidir se o dashboard troca o KPI** "% pago total" → "% pago sobre vencidas" + inadimplência real (§12.2).
5. **RLS** (§9) — adiado por sua instrução ("depois pensamos em rls"), mas continua sendo o maior risco de segurança.


