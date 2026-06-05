# North Star #2 — Os 3 Eventos de Vida do Contrato (DEFINITIVO, dado real)

> **2026-06-05.** Supera `docs/contexto/2026-06-03-north-star-2-distrato-aditivo-cessao.md` (que era desenho/hipótese).
> Agora tudo está **conferido contra os relatórios oficiais do Sienge** que a controladoria gerou.
> Mapa nominal máquina-legível: [`docs/contexto/2026-06-05-mapa-3-termos.json`](2026-06-05-mapa-3-termos.json).
> Spec de escrita: [`.claude/rules/sincronizacao-sienge.md`](../../.claude/rules/sincronizacao-sienge.md).

---

## 1. O problema, em uma frase

Nosso sync captura **duas** coisas: a **criação do contrato** (`/sales-contracts`) e os **pagamentos** (`/bulk-data/v1/income`).
Ele **não captura nenhuma das mutações que acontecem DEPOIS** que o contrato nasce. As três mutações do dia a dia da IM são:

| | O que é | Muda no contrato |
|---|---|---|
| **Distrato** | Cliente desiste, contrato cancela | `situacao_contrato='3'` + parcelas futuras canceladas |
| **Aditivo (reparcelamento)** | Renegocia parcelas em aberto, contrato **continua** | parcelas novas em paralelo às originais |
| **Cessão de direitos** | Troca de titular, contrato **continua** | `cliente_id` (novo dono daqui pra frente) |

Por isso o Sienge anda e o espelho fica parado no estado inicial — **a sangria do North Star**.

---

## 2. Placar real (conferido contra Sienge oficial em 2026-06-05)

| Termo | Sienge (oficial) | Banco reflete | Pendente | Fonte de verdade |
|---|---|---|---|---|
| **Distrato** | 36 | 25 marcados | **10 marcar + 1 sem venda** | relatório distrato (xlsx) + `/sales-contracts.situation` |
| **Aditivo** | 15 (14 contratos) | ~0 automático | **wiring do sync (todos)** | relatório reparcelamento (csv) + `/remade-installments` |
| **Cessão** | 3 | 2 ok (autocura) | **1 (905 B)** | relatório cessão (pdf); titular vem do `/sales-contracts` |

**Achado transversal:** a causa-raiz dos três é a **mesma** — o sync de `sales-contracts` (com a ponte de distrato A.1)
não está deployado/rodando. Quando rodar:
- **Distrato** flipa sozinho (via ponte A.1, escrita mas não deployada).
- **Cessão** se autocura (o `/sales-contracts` já traz o titular atual — provado em 2 de 3).
- **Aditivo** é o único que **não** resolve só com isso (sales-contracts não traz parcelas) → precisa wiring extra de `/remade-installments`.

---

## 3. Distrato — detalhe

**Definição:** cancelamento do contrato (`situacao_contrato='3'`). Comissão já paga **preservada**; parcelas futuras canceladas.

**Censo:** 36 no relatório oficial · 25 já marcados no banco · **11 pendentes** (10 com venda + 1 sem venda).

**⚠️ Armadilha de numeração (resolvida):** a coluna **"Contrato" do relatório ≠ nosso `sienge_contract_id`** — são
identificadores diferentes do mesmo contrato. A chave confiável de cruzamento é a **unidade** (física, estável).

**Os 11 pendentes** (todos recentes — 22/abr a 02/jun/2026, confirmando que é o sync que parou):

| Unidade | Cliente | Data distrato | Recebido | Banco |
|---|---|---|---|---|
| 904 C | LUCAS ANTONIO LAMIM | 28/04 | 0 | c229 (sit2) |
| 1305 A | ALISSON RODRIGUES | 04/05 | 3.250,00 | c382 (sit2) |
| 908 B | LAELSON QUEIROZ | 22/04 | 5.634,16 | c196 (sit2) |
| 1302 C | MARIA VITORIA | 22/04 | 6.160,59 | c246 (sit2) |
| 403 D | ADRIELE FERNANDA | 22/04 | 2.000,00 | c259 (sit2) |
| 510 D | JESSE VELOSO | 22/04 | 2.700,82 | c266 (sit2) |
| 904 B | AMANDA ERZINGER | 22/04 | 12.117,76 | c195 (sit2) ⚠️ tem aditivo (tít 194) |
| 405 B | TIAGO DE BORBA | 22/04 | 974,55 | c357 (sit2) |
| 903 D | LEONARDO ESPINDOLA | 21/05 | 6.757,84 | c279 (sit2) |
| 1403 D | NICOLLE NASCIMENTO | 28/05 | 9.056,40 | c302 (sit2) |
| 412 B | GABRIEL ADRIANO GOMES | 02/06 | 0 | **SEM VENDA** (já na controladoria) |

**Fix:** (a) deployar ponte A.1 (`sales-contracts.ts:411` → `situacao='3'` ⇒ `status='distrato'` + `data_distrato`);
(b) backfill dos 10 (UPDATE `situacao_contrato='3'` + `data_distrato`), **preservando parcelas pagas** (8 dos 10 têm recebido > 0).
O 412 B é venda sem contrato no banco → decisão da controladoria.

---

## 4. Aditivo (reparcelamento) — detalhe

**Definição:** renegocia parcelas **em aberto** em N parcelas novas que correm **em paralelo** às originais restantes.
Contrato **continua ativo**. Formalizado por termo aditivo. **reparcelamento ⇔ aditivo.**

**Censo:** 15 reparcelamentos / 14 contratos (Mariane tít 225 tem 2). **Relatório oficial e API `/remade-installments`
batem 100%** — sem gap com a controladoria. (O "14" anterior era subcontagem por cruzar via venda.)

**Mecânica confirmada (3 exemplos reais do relatório):**
- **tít 483 CAYO** — R$5.934,78, **2 parcelas → 25** (o "caso 1" do Jonas: abril+maio viraram 25×).
- **tít 176 CAROLINE HONORATO** — **12 parcelas → 50** (maior caso).
- **tít 418 LILIAM** — **cessão E aditivo no mesmo contrato** (os termos se combinam).

**Banco hoje:** ~0 refletido automaticamente. A tabela `renegociacoes` (migration 016) existe mas é só manual,
não ligada ao sync. As parcelas geradas pelo aditivo não entram → é a causa da metade "grande" do bucket b10
(pro_soluto "divergente" = aditivo, não erro).

**Fix (o trabalho de verdade):** wiring `/remade-installments` → para cada aditivo:
1. parcelas **originais renegociadas (não pagas)** → sair do ativo (`cancelado`/`renegociado`);
2. parcelas **geradas** → linhas novas em `pagamentos_prosoluto` com `renegociacao_id`;
3. parcelas **pagas** → intactas (imutabilidade);
4. `income` preenche `data_pagamento`/`status` das geradas conforme forem pagas.

**⚠️ Juros:** 74/79 sem juros; os com juros (`generatedValue > remadeValue`) → **decisão de negócio**: juros comissionam?

**⚠️ GAP "negociado ≠ lançado":** só aparece quando **lançado** no Sienge. Acordos futuros (ex Ricardo c74/c75
"a partir de julho") não aparecem até a controladoria lançar. Não é falha de detecção — é timing.

---

## 5. Cessão de direitos — detalhe

**Definição:** titular atual passa o contrato a um **novo cliente** (mesmo corretor intermedia). Contrato e parcelas
mantidos; parcelas pagas continuam pagas; só o "dono daqui pra frente" muda.

**Censo (relatório "Extrato de cessão de direitos"):** **3 cessões**, não 1.

| Tít | Unidade | Data | Antigo → Novo | Banco hoje |
|---|---|---|---|---|
| 160 | 1208 C (c245) | 03/12/2025 | 144 EDUARDO → 575 KAINÃ **+ cônjuge TAYNARA** | ✅ já KAINÃ |
| 410 | 905 B (c340) | 29/05/2026 | 102 CAROLINE → 670 GABRIEL | ⏳ ainda CAROLINE |
| 418 | 506 A (c351) | 11/09/2025 | 16 BEATRIZ → 582 LILIAM | ✅ já LILIAM |

**ACHADO-CHAVE: cessão se autocura pelo sync normal.** 2 das 3 já estão com o titular novo no banco (`origem='sync'`)
— o `/sales-contracts` **já traz o titular atual sozinho**. Só falta a 905 B (cessão de 7 dias atrás, não sincronizada).
→ **Não precisa detector dedicado nem webhook** pra trocar `cliente_id`. O relatório de cessão é **fonte de auditoria**
(verificar), não de captura.

**Impacto em comissão ≈ zero:** corretor não muda; parcelas pagas continuam pagas.

**Limitação do income-diff (confirmada):** pega só 1 de 3 (as 2 já sincronizadas são invisíveis — os dois lados mostram
o cliente novo). Não estava quebrado; é cego por design. Por isso o **relatório** é necessário pra o censo completo.

**⚠️ Múltiplos titulares:** a 1208 C tem **cônjuge** (KAINÃ + TAYNARA, cônjuge com 0% por padrão). O modelo precisa
**prever múltiplos titulares**, não só 1→1.

**Fix:** 905 B se corrige sozinha quando o sync rodar; ou UPDATE manual `cliente_id` → GABRIEL (670), `origem` mantendo rastro.

---

## 6. Desenho do banco (incremental via API/relatório)

Princípio: dados que **incrementam** ao longo do tempo (eventos) merecem tabela própria de evento, não sobrescrita cega.

- **Distrato** — já cabe em `vendas`: `situacao_contrato='3'` + `data_distrato`. Sem tabela nova. (`isVendaAtiva` já exclui distrato da contagem; comissão paga preservada.)
- **Aditivo** — `renegociacoes` (migration 016) como **tabela de evento** + `pagamentos_prosoluto.renegociacao_id` ligando
  as parcelas geradas ao evento. Originais renegociadas marcadas `renegociado`. Idempotente por `(receivableBillId, remadeDate)`.
- **Cessão** — `cliente_id` na venda (titular vigente) + **tabela de evento** `cessoes_direitos`
  (`venda_id, data_cessao, titular_antigo, titular_novo[]`) pra preservar histórico e suportar cônjuge/múltiplos.
  `cliente_id_origem` ganha valor `'cessao'` pra rastro. (Migration 021 já protege `cliente_id` manual.)

---

## 7. Wiring do sync (por termo)

| Termo | Fonte | Operação | Já existe? |
|---|---|---|---|
| Distrato | `/sales-contracts.situation=3` | `situacao_contrato='3'` + `data_distrato` | ponte A.1 escrita, **não deployada** |
| Cessão | `/sales-contracts` (titular atual) | trocar `cliente_id` (já acontece) + registrar evento | titular ✅; evento ❌ |
| Aditivo | `/remade-installments` + `income` | cancelar originais, inserir geradas, ligar `renegociacao_id` | ❌ (renegociacoes só manual) |

---

## 8. Comportamentos de front-end que o banco precisa suportar

1. **Distrato:** badge "distrato" só aparece quando há rótulo de distrato (não inferir de status).
2. **Aditivo:** tipo/origem de aditivo nos `pagamentos_prosoluto` (distinguir parcela gerada de original).
3. **Cessão:** ler a troca de titular no sync (aviso/observação) + autorização; observar os primeiros casos.

---

## 9. Plano de execução (gated — escreve em produção, precisa do OK do Jonas)

1. **Distrato** (mais maduro): deploy ponte A.1 + backfill 10 → dry-run primeiro.
2. **Cessão** (autocura): rodar sync resolve a 905 B; opcional registrar tabela de evento das 3.
3. **Aditivo** (trabalho de verdade): implementar wiring `/remade-installments`; decidir juros (negócio).

**Decisões abertas de negócio:**
- Juros de aditivo comissionam?
- 412 B GABRIEL (venda sem contrato): criar ou descartar?
- Cessão com cônjuge: percentual de participação afeta algo no nosso lado? (provavelmente não — comissão é por parcela paga).
