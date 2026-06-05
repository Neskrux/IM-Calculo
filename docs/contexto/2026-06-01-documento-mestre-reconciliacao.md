---
status: DOCUMENTO MESTRE — leitura única de ponta a ponta da reconciliação Sienge ↔ banco
data: 2026-06-01
branch: sync/reconciliacao (worktree IM-reconciliacao)
proposito: a fonte única pra entender o QUÊ, o PORQUÊ e o COMO da reconciliação, lida pelas
           lentes North Star (objetivo do produto) e Context Engineering (método de trabalho).
componentes:
  - 2026-06-01-north-star-reconciliacao.md        (o norte + 3 baldes + through-line)
  - 2026-06-01-passo2-residuo-medido.md           (a medição do resíduo)
  - 2026-06-01-mapa-decisoes-northstar-context.md (tabela enxuta de decisões)
  - 2026-06-01-distratos-mapa-completo.md          (mergulho em distrato)
  - 2026-06-01-plano-alinhamento-banco-sienge.md   (plano A–E + progresso)
---

# Documento mestre — Reconciliação Sienge ↔ banco local

> Este documento é auto-contido. Os outros são mergulhos; este é o mapa do território inteiro.
> Lê-se de cima a baixo. Cada seção responde uma das três perguntas: **o quê · por quê · por que assim.**

---

## 0. Sumário executivo

O IM-Calculo é uma **calculadora de comissão imobiliária**. Seu valor inteiro depende de um número:
quanto de comissão cada corretor tem a receber. Esse número só vale se **bater com o Sienge** — o ERP
onde a controladoria da IM fecha o repasse. Hoje o banco local **diverge** do Sienge em pontos que inflam
a inadimplência exibida (~14% contra ~4,89% real), contam distratos como vendas ativas, e duplicam
parcelas pagas (R$ 21.194,06 de comissão contada em dobro, medido). O trabalho de reconciliação existe
pra fechar essa divergência e mantê-la fechada sozinha — pra que o corretor confie no número sem
precisar conferir no Sienge na mão.

Em 2026-06-01: **estancamos a criação de novas divergências** (código), **medimos o resíduo** contra
o Sienge fresco, e **preparamos as filas** de limpeza — tudo numa branch isolada, sem tocar produção.

---

## 1. As duas lentes (o critério de tudo)

Toda decisão neste projeto passa por dois filtros. Quando os dois concordam, a decisão é fácil. Quando
brigam, o documento registra o trade-off.

### 🌟 North Star — o objetivo do produto
> **O corretor e o admin abrem o IM-Calculo e confiam 100% no número de comissão — porque o banco
> local é um espelho fiel do Sienge, atualizado sozinho todo dia, sem ninguém conferir nada na mão.**

Pergunta-filtro: *"isso aproxima o número da verdade do Sienge e da confiança do usuário?"*

Por que esse é o norte e não outro: o produto **é** o número. Um número em que não se confia não vale
nada — pior, custa tempo (o corretor confere tudo no Sienge de qualquer jeito). Confiança no número é
o produto; reconciliação é como se ganha essa confiança.

### 🧩 Context Engineering — o método de trabalho
> **O trabalho tem que ser legível, seguro, reversível e retomável: uma fonte de verdade, sem
> caminhos-fantasma, idempotente, com as decisões registradas onde serão achadas.**

Pergunta-filtro: *"isso deixa o sistema mais simples de entender e mais difícil de quebrar — hoje e
pra quem vier depois (humano ou IA)?"*

Os princípios concretos que usamos:
1. **Spec é a fonte de verdade** — `.claude/rules/*.md` são a especificação; código referencia a regra.
2. **Medir antes de agir** — read-only/dry-run primeiro; nenhum número vai pra humano sem verificação cruzada.
3. **Reusar antes de reinventar** — código novo divergente é o pecado capital (cria um segundo "jeito de errar").
4. **Ancorar > heurística** — casar por chave única real `(bill_id, installment_id)`, não por `(tipo, valor, data)`.
5. **Idempotência** — rodar 2× = no-op no 2º; tudo é re-executável sem medo.
6. **Reversibilidade + escrita em prod gated** — branch isolada; mutação de produção só com ok explícito.
7. **Human-in-loop só no não-mecânico** — o que depende de informação fora do sistema vira rodada-b.
8. **Registrar a decisão** — o doc/CLAUDE.md guarda o porquê; quem vier depois lê antes de mexer.
9. **Reduzir superfície** — deletar código morto é feature (menos lugar pra errar).

> Princípio que une as duas lentes: **medir antes de agir, reusar antes de reinventar, registrar antes de esquecer.**

---

## 2. O problema, em números (a foto medida)

### 2.1. O lado da verdade — Sienge (verificado limpo)
- **294 contratos (bills)**, **3.719 parcelas pagas** (`/bulk-data/v1/income`, `selectionType=P`).
- Par `(billId, installmentId)` **100% único** — 0 duplicata, 0 nulo. `installmentId` **reinicia por bill**
  (só 69 valores distintos sozinho) → **a chave de match é o par, nunca o id sozinho** (erro fácil de cometer).
- Pull fresco confirmado em 2026-06-01: **17.567 linhas** de income, sem gastar quota (bulk-data é grátis).

### 2.2. O lado do espelho — banco local
- **298 vendas** com `sienge_receivable_bill_id`; **~19.002 pagamentos** (pago 4.433 · pendente 12.791 · cancelado 1.778).
- **Âncora `(bill_id, installment_id)`: 80% preenchida (15.223 linhas) e LIMPA** — 0 duplicata pelo par correto.
- **25 vendas** em distrato (`situacao_contrato='3'`), carregando **R$ 684.724,42** de comissão **paga** legítima.

### 2.3. O termômetro-mestre
- **Inadimplência real do Sienge: ~4,86% valor / ~10,26% parcela** (medido do bulk D, corte 29/05). É a meta.
- **O app exibe ~14%** — inflação **local** (suspeita de erro de fórmula). **Quando o app bater ~4,86%, chegamos.**
- **De onde vem a inflação (decomposto contra o bulk, 2026-06-01):** das **328 pendentes-vencidas locais**,
  **0** são "Sienge já pagou" (NÃO é pagamento-não-registrado), **85 (26%)** sem-âncora (gêmeo/fantasma),
  **243 (74%)** reais ou com `data_prevista` errada. Como só há 328 vencidas, a inadimplência *bem calculada*
  daria ~7-8% → o **"14%" é provável erro de FÓRMULA do app (Truth Out)** + os ~85 fantasmas.
- ⚠️ **A b9 (pagos-órfãos) NÃO move este termômetro** — ela conserta comissão em dobro (outro problema).
  Quem ataca a inadimplência é **`data_prevista` (Card 3) + a fórmula do app + limpar os fantasmas-pendentes**.

### 2.4. O resíduo que diverge (medido, classificado)
| Categoria | Qtd | Impacto | Natureza |
|---|---|---|---|
| `parcela_entrada` **pagas órfãs** | 52 | **R$ 21.194,06 comissão em dobro** | espúrio determinístico (Sienge não tem) |
| `sinal` pago órfão | 2 | R$ 675,96 | talvez legítimo (sinal tem outra representação) |
| **pendentes órfãs** | 5 | 3 balão (R$ 11.692) + 1 sinal + 1 parc | falso pendente determinístico |
| revisão — `soma income ≠ pro_soluto` | 28 | até R$ 125k de divergência | negócio (pro_soluto imutável com pago) |
| revisão — `bill sem income relevante` | 11 | — | provável distrato/sem-movimento |
| revisão — ambíguo (cronograma duplicado) | ~10 | 57–65 linhas/venda | qual grade é a real |

> **A "fila humana" não é milhares — é ~10 ambíguos + 28 de pro_soluto-negócio.** O resto é determinístico.

---

## 3. O modelo mental — 3 baldes

Toda dor cai em **um** destes três baldes. É o que dissolve a sensação de "micro-camadas infinitas".

```
   [ SIENGE ]  ──① TRUTH IN──▶  [ BANCO LOCAL ]  ──③ TRUTH OUT──▶  [ DASHBOARDS ]
                                       │
                                  ② MIRROR CLEAN
                               (local == Sienge?)
```

### ① TRUTH IN — trazer a verdade do Sienge, fresca e barata
- `bulk-data/income`: 1 chamada traz o universo inteiro, **fora da quota**. ✅ funcionando.
- REST v1 (`sales-contracts`): 1 req **por entidade**, quota 100/dia — usar com parcimônia.
- Cron diário (`recurring-reconciliation.yml`, roda do `main` 21:30 BRT) baixa income + reconcilia + sobe artifact.
- 🔴 **Dívida:** cron passo ① (`gerar-plano-correcao-data-prevista`) lê arquivo **congelado de 13/05 (99 vendas)**
  → escopo preso ao passado. Fix: fundir no passo ② (universo completo).

### ② MIRROR CLEAN — fazer o local ser fiel ao Sienge (o coração)
- Âncora 80% limpa; 20% é o resíduo da §2.4.
- Causa-raiz dos gêmeos: **gerador não-idempotente** + **match heurístico** que colidia.
- Distrato lido como ativo (corrigido em código, falta deploy).
- Triggers 017/018/020 protegem o pago (trilho de segurança).

### ③ TRUTH OUT — a UI lê o espelho limpo corretamente
- Regra `visualizacao-totais`: UI deriva de `pagamentos_prosoluto`, nunca de `vendas.*` stale. ✅
- Distrato na UI: Admin tratado (vermelho + fora da contagem ativa); Corretor/Cliente só cosmético pendente.

---

## 4. As decisões, em profundidade (o "por que assim, e não a outra")

> Versão enxuta em tabela: `2026-06-01-mapa-decisoes-northstar-context.md`. Abaixo, as que definiram o rumo.

### 4.1. Distrato — ponte `status='distrato'` no sync, não filtro bruto
- **Contexto:** distrato tem 3 representações que não conversam — a real do Sienge (`situacao=3`), a manual
  morta (`status='distrato'`, 0 linhas mas a UI sabe renderizar), e o soft-delete (`excluido`).
- **Alternativa rejeitada:** `isVendaAtiva` excluindo `situacao=3` de toda soma/contagem.
- **Por que perdeu:** filtraria o distrato **das somas de comissão** → apagaria os **R$ 684k pagos** (viola
  fase5/trigger 017); e não entregava o "vermelho" que a gestora pediu.
- **🌟** A ponte faz o banco **espelhar** o que o Sienge já diz, em vez de a UI inventar um filtro paralelo.
- **🧩** Reusa `calcularComissaoVendaDistrato` + rótulo vermelho que **já existiam e nunca rodavam**;
  `isVendaAtiva` ficou só pra **contagem**, nunca pra soma — invariante escrito no código.

### 4.2. Gerador — Opção B (skip-only), não a função que deleta
- **Alternativa rejeitada:** reusar `propagarCronogramaCirurgico`, que **deleta pendentes** fora da grade.
- **Por que perdeu:** o Sienge pode ter **mais** parcelas que a config local conhece; deletar apagaria
  parcela real. "Gerar pagamentos" deve **preencher buraco**, não reconciliar.
- **🌟** Estanca a criação de gêmeo novo sem risco de apagar verdade do Sienge.
- **🧩** Idempotente (2× = no-op); separa "gerar" de "reconciliar"; a limpeza de espúrio é trabalho
  controlado (rodada-b), não efeito-colateral de um botão.

### 4.3. Sync legado — deletar, não remendar
- **Gatilho:** eu ia editar `syncVendasV2.js`/`syncUtils.js` pra tratar distrato — até descobrir que
  **ninguém os importa** (só `SincronizarSienge.jsx`, também órfão). A Action e o botão do Admin usam
  **só o edge** (`sales-contracts.ts`).
- **Alternativa rejeitada:** editar o legado (manutenção em cadáver) ou deixá-lo (armadilha).
- **🌟** Duas implementações de sync = dois jeitos de o mirror divergir. Uma porta só (edge) = um ponto de verdade.
- **🧩** Implementação-fantasma é a armadilha clássica de contexto — ela **quase me fez aplicar a correção
  no lugar errado**. Deletados 19 arquivos (−6.164 linhas); **build verde foi a prova** de que era morto.

### 4.4. Medir com o reconciliador testado, não com matcher novo
- **Alternativa rejeitada:** escrever um detector de resíduo próprio.
- **🌟** Um detector próprio poderia reportar um número **diferente** do que o cron aplica — e a
  desconfiança nasce de "dois números". Mesma fonte de verdade pra medir e pra aplicar.
- **🧩** Reuso > reinvenção. (Foi o que **expôs** o detector heurístico antigo inflando ~R$27k → o número
  ancorado real é **R$ 21.194,06**.)

### 4.5. Resíduo → fila (rodada-b), que pode ser decidida "aqui"
- **Camada spec:** apagar linha **paga** é delicado → rodada-b registra pra humano, não tenta sozinho.
- **Refino de hoje:** como o **repasse ainda não sai do nosso sistema**, os fantasmas **nunca moveram
  dinheiro real** → a decisão pode ser tomada **aqui**, sem controladoria. A rodada-b vira o **formato de
  registro** da decisão, não um gate burocrático.
- **🌟** Limpar **agora**, antes de o repasse depender do banco, é o momento ideal.
- **🧩** O `aplicar-rodada-b.mjs` executa só o autorizado, idempotente, respeitando triggers (Excluir Baixa
  pra pago); a decisão fica versionada em `respostas.json` + `execucao.json`.

### 4.6. Branch isolada, sem push/deploy, DB intocado
- **🌟** Não desestabiliza o mirror vivo antes da hora.
- **🧩** Isolamento + reversibilidade; a Action de amanhã (que roda do `main`) fica **intocada** porque
  nada foi pushado nem escrito no banco.

---

## 5. O que foi feito (execução 2026-06-01)

### Passo 1 — Estancar a sangria (código, branch `sync/reconciliacao`, build verde)
- **Parte B** ([AdminDashboard.jsx:~3408]): `gerarPagamentosVenda` idempotente (skip-only) + grava `sienge_bill_id`.
- **Parte A.1** ([sales-contracts.ts:411]): `situacao_contrato='3'` → `status='distrato'` + `data_distrato`. Tolera reversão.
- **Parte A.3 (Admin)** ([comissaoCalculator.js], [AdminDashboard.jsx]): helper `isVendaAtiva`; auditoria de
  unidade ignora distrato; `matchStatus` mostra distrato em vermelho no "Todos".
- **Limpeza:** cluster de sync legado deletado (17 arq + componente + css).

### Passo 2 — Medir o resíduo (dry-run, read-only)
- `node scripts/reconciliar-todas-vendas.mjs` (dry) + bulk fresco → classificação da §2.4.
- Geradores read-only `gerar-rodada-b9-duplicatas.mjs` (60 casos) e `gerar-rodada-b10-prosoluto.mjs` (28 casos).
- 2 bugs pegos no caminho (paginação sem `order`; tabela de corretor errada) — número triplo-verificado.

### Estado em git
- 4 commits em `sync/reconciliacao` (1 código + 3 docs), **não pushados**, DB **intocado**.
- Identidade: `netojonas` (não impersonando o autor do repo).

---

## 6. O que falta — roadmap (through-line)

1. ✅ Estancar a sangria (código) — feito; falta deploy+backfill A.2 (gated) e cosmético Corretor/Cliente.
2. ✅ Medir o resíduo — feito.
3. ⏭️ **Re-ancorar o determinístico (Passo 3)** — limpar o resíduo. Escreve em prod, **gated**:
   - `aplicar-rodada-b.mjs` (dry-run → `--apply`): cancela 5 pendentes-órfãs + Excluir Baixa das 54 pagas (R$ 21k).
   - Re-ancorar os ~10 cronogramas duplicados (Grupo 3) por `installmentId`.
4. ⏭️ **Curar a Action** — re-ancorar linha paga (matar ponto cego) + fundir passo ① no ② (aposentar o arquivo de 13/05).
5. ⏭️ **A.2** — deploy do edge (A.1) **e depois** backfill dos 25 distratos (ordem obrigatória).
6. ⏭️ **Verificar pelo termômetro** — inadimplência exibida pelo app → ~4,86% valor / ~10,26% parcela (= Sienge). Bateu, chegamos. (Esquecer "% pago → 95%": meta falsa, a maioria das parcelas é futura.)
7. ⏭️ **Ligar o repasse pelo sistema** — o objetivo final, agora seguro porque o número está certo.

---

## 7. Riscos e salvaguardas

| Risco | Salvaguarda |
|---|---|
| Apagar/alterar pago indevidamente | Triggers 017/018/020: `tipo`/`valor`/`comissao_gerada` imutáveis em pago; delete bloqueado |
| Reverter pago→pendente fora de controle | Só via fluxo "Excluir Baixa" (`status='pendente'`+`data_pagamento=NULL` no mesmo UPDATE — trigger 020 valida) |
| Sobrescrever correção manual no sync | `corretor_id_origem`/`cliente_id_origem='manual'` protegidos (migration 021) |
| Decisão delicada virar automática | rodada-b: script registra, humano decide |
| Número errado chegar ao humano | verificação cruzada (3 somas tinham que bater) |
| Desestabilizar produção | branch isolada, sem push/deploy, escrita gated; Action roda do `main` intocado |
| Drift por dado velho | bulk-data fresco (grátis), não snapshot |

---

## 8. Glossário

- **bulk-data vs REST v1:** bulk traz o universo numa chamada, **fora da quota**; REST é 1 req/entidade na quota 100/dia.
- **Âncora `(bill_id, installment_id)`:** chave única 1:1 local↔Sienge. `installmentId` reinicia por bill → usar o **par**.
- **Distrato:** contrato cancelado no Sienge (`situacao_contrato='3'`). Comissão **paga** preservada; futuro zerado.
- **Parcela órfã:** linha ativa no banco **sem match** no Sienge — provável fantasma do gerador antigo.
- **rodada-b:** fila de revisão pra decisão não-mecânica. Formato canônico (`bN-{slug}.json` + `.md` + `respostas` + `execucao`).
- **pro_soluto:** base do cálculo de comissão (fator = comissão/pro_soluto). Imutável quando há parcela paga.
- **Termômetro-mestre:** inadimplência exibida. Inflada (~14%) hoje; meta = real do Sienge (~4,89%).

---

## 9. Como usar este documento

- **Pra entender o todo:** leia §0–§3.
- **Pra entender uma escolha:** §4 (e a tabela enxuta no doc de decisões).
- **Pra continuar o trabalho:** §6 (roadmap) + §7 (não pisar numa salvaguarda).
- **Pra decidir algo novo:** registre no doc de decisões (alternativa rejeitada + as duas lentes). É assim
  que o contexto não se perde — e é por isso que, mesmo trocando de pessoa ou de sessão, o trabalho continua coerente.
