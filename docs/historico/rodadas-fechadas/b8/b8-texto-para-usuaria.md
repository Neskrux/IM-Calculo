# Rodada B.8 — Parcelas com número repetido (colisão de `numero_parcela`)

**Gerado em:** 2026-05-29
**Total:** 71 vendas FIGUEIRA afetadas

---

## O que aconteceu (em português, sem jargão)

Cada parcela de pro-soluto tem um **número** (parcela 1, 2, 3...). Em 71 vendas, **duas ou mais parcelas estão com o mesmo número** ao mesmo tempo. Isso **não significa, por padrão, que cobramos comissão em dobro** — na maioria dos casos são parcelas reais e diferentes que ficaram com o número trocado.

A causa foi um **gerador de grade antigo**: toda vez que a venda era recalculada, ele renumerava as parcelas e às vezes criava uma cópia "fantasma". Esse gerador **já foi corrigido em 2026-05-13**, então o problema não está crescendo — estamos limpando o que ficou para trás.

Existem **três tipos** de colisão, com riscos diferentes:

| Tipo | O que é | O que fazer | Tem dinheiro real? |
|------|---------|-------------|--------------------|
| **A — pago + pago** | Duas parcelas **já pagas** com o mesmo número. São pagamentos reais distintos. | **Renumerar** (corrigir o número). **Nunca apagar.** | ✅ Sim — apagar perderia comissão real |
| **B — pago + pendente** | Uma parcela paga e uma pendente com o mesmo número. A pendente costuma ser a fantasma. | **Conferir no Sienge** → se não existir lá, cancelar a pendente. | ⚠️ A pendente provavelmente é fantasma |
| **C — pendente + pendente / venda órfã** | Parcelas pendentes duplicadas, ou venda que **nem está ligada ao Sienge**. | **Conferir no Sienge** — forte candidata a fantasma inteira. | ❌ Provável ruído |

> **Importante:** nada aqui é apagado automaticamente. Linha `pago` nunca é deletada (o banco bloqueia). Para as fantasmas, o caminho é marcar como `cancelado` **depois** de confirmar no Sienge.

---

## Grupo 1 — BAIXO risco: só renumerar (12 vendas)

Todas as linhas são **pagas, reais e ancoradas ao Sienge**. Só o número está trocado. **Não há decisão de negócio aqui** — é correção mecânica. Listadas para sua ciência:

| Contrato | Unidade | Parcelas pagas envolvidas | Extras a renumerar |
|----------|---------|---------------------------|--------------------|
| 268 | 1305 A | 19 | 10 |
| 163 | 1405 C | 12 | 7 |
| 198 | 1008 D | 10 | 5 |
| 187 | 903 D | 8 | 4 |
| 259 | 906 A | 8 | 4 |
| 76 | 1607 A | 8 | 4 |
| 167 | 403 D | 8 | 4 |
| 154 | 1302 C | 7 | 4 |
| 55 | 1103 A | 6 | 3 |
| 244 | 503 B | 6 | 3 |
| 246 | 508 A | 2 | 1 |
| 147 | 1106 C | 2 | 1 |

**Decisão pedida:** só um "ok, pode renumerar o Grupo 1". Sem perda de comissão.

---

## Grupo 2 — MÉDIO risco: conferir no Sienge antes (42 vendas)

São colisões **pago + pendente** (e algumas pago+pago sem ancoragem). A parcela pendente que colide com uma paga é **candidata a fantasma** — mas precisa ser confirmada no Sienge antes de cancelar, porque pode ser uma parcela futura legítima que só ficou com o número errado.

Vendas com mais candidatas a fantasma (topo da fila):

| Contrato | Unidade | Pagas | Pendentes fantasma? | Observação |
|----------|---------|-------|--------------------|------------|
| 164 | 1406 C | 8 | 6 | tem 3 pagas a renumerar também |
| 112 | 1204 B | 8 | 5 | tem 3 pagas a renumerar também |
| 232 | 1205 A | 5 | 5 | |
| 116 | 1603 B | 5 | 5 | |
| 224 | 902 D | 5 | 5 | |
| 231 | 1805 D | 5 | 5 | |
| 141 / 207 / 236 / 196 | (vários) | 5 | 5 | parcelas sem ancoragem |
| ...mais 32 contratos | | | 1 a 4 cada | |

**Decisão pedida:** autorizar a **conferência no Sienge** (baixar o income do contrato) e, para as pendentes que não existirem lá, **cancelar**. Lista completa no JSON.

---

## Grupo 3 — ALTO risco / URGENTE (17 vendas)

Duas situações graves:

**3a) Vendas com MUITAS parcelas pendentes fantasma e nenhuma/pouca ancoragem** (precisam de conferência cuidadosa):

| Contrato | Unidade | Pagas | Pendentes | Sem ancoragem |
|----------|---------|-------|-----------|----------------|
| 177 | 609 D | 4 | 14 | 18 de 21 |
| 175 | 603 D | 9 | 9 | 18 de 18 |
| 114 | 1303 B | 7 | 9 | 16 de 16 |
| 133 | 810 C | 7 | 5 | 12 |

**3b) Vendas ÓRFÃS — nem estão ligadas ao Sienge** (`sienge_contract_id` vazio). São as mais suspeitas de serem vendas fantasma inteiras:

| "Unidade" | Pagas | Pendentes | Observação |
|-----------|-------|-----------|------------|
| **1603** (venda `9b6d5bf3…`) | 3 | 25 | 28 linhas, zero ancoragem — investigar identidade |
| **002** (venda `2026ca9d…`) | 1 | 9 | unidade "002" estranha |
| **603** (venda `ad2d2d32…`) | 0 | 8 | sem pagos, tudo pendente sem ancoragem — forte candidata a fantasma inteira |

**Decisão pedida:** essas 3 órfãs precisam de você confirmar **se a venda existe de verdade** (cliente real, unidade real no Sienge). Se for fantasma, a venda inteira sai. As 3a precisam de conferência parcela a parcela contra o income do Sienge.

---

## O que fazer agora

Responda por grupo (não precisa caso a caso, exceto Grupo 3):

1. **Grupo 1 (renumerar):** "ok renumerar" — libera os 12 contratos de baixo risco.
2. **Grupo 2 (conferir+cancelar):** "ok conferir no Sienge e cancelar fantasmas" — libera a fila de 42.
3. **Grupo 3a (4 contratos):** mesma autorização, mas avisamos que precisa baixar income do Sienge contrato a contrato.
4. **Grupo 3b (3 órfãs):** preciso que você confirme se **1603**, **002** e **603** são vendas reais. Se não souber de cabeça, dá pra cruzar com a planilha/Sienge.

> **Bloqueio técnico atual:** a conferência no Sienge (Grupos 2, 3a, 3b) depende de baixar o `/bulk-data/v1/income` — e hoje estamos com **limite de requisições** (ver seção no doc de contexto). Por isso esta rodada **separa o que dá pra fazer já** (Grupo 1, sem Sienge) **do que depende de quota** (Grupos 2 e 3).
