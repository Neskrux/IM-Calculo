# Plano: Estancar a Sangria (implementação durável)

> **2026-06-05.** Depois do curativo de maio (band-aid pontual), este é o plano para a **correção durável**:
> o banco vira espelho fiel do Sienge, atualizado sozinho — o [North Star #1](2026-06-01-north-star-reconciliacao.md).
> Fecha o ciclo dos 3 termos do [North Star #2](2026-06-05-north-star-2-tres-termos-DEFINITIVO.md) **+ o gerador furado**
> (que o curativo de maio expôs). Dados nominais: [mapa-3-termos.json](2026-06-05-mapa-3-termos.json).

---

> ⚠️ **PIVÔ 2026-06-05 (durante a execução) — leia antes:** a implementação **pivotou**. A fundação é a
> **âncora + gerador idempotente** (Seção 1), **não** as tabelas de evento. `cessoes_direitos`/`distratos`
> (Seção 4 itens 1 e 4; Fase 1 da Seção 5) **NÃO foram construídas** — viraram **auditoria, fase posterior**
> (o sync nem alimenta a cessão; o evento de distrato já está em `vendas`). O schema real aplicado foi **3 campos**:
> `renegociacao_id`, `cliente_id_origem += 'cessao'`, `motivo_cancelamento_parcela`. As **Seções 1–4 (espinha,
> 4 problemas, fontes) seguem válidas** como mapa geral; a **ordem das fases (Seção 5) mudou** (âncora+gerador
> primeiro; termos depois). Plano de implementação vivo: [`2026-06-05-fundacao-ancora-gerador.md`](2026-06-05-fundacao-ancora-gerador.md).

---

## 1. A espinha dorsal: ancorar tudo no `(billId, installmentId)` do Sienge

A causa-raiz de TODOS os problemas de hoje (duplicatas, cronograma errado, match frágil por valor, baixa de distrato) é a mesma:
**nossas parcelas não estão ancoradas 1:1 nas parcelas do Sienge.** O match é feito por `(tipo, numero_parcela)` ou por valor — e isso quebra.

> **Princípio único do plano:** cada linha de `pagamentos_prosoluto` deve ter `sienge_installment_id` único, ligando-a à
> parcela real do Sienge (`/bulk-data/v1/income` traz `billId` + `installmentId`). Com isso:
> - duplicata vira impossível (1 linha por installment);
> - reconciliação vira trivial (match por id, não por valor);
> - distrato/aditivo/pagamento ficam determinísticos.

**Hoje: 84% ancorado** (3911/4679 parcelas Figueira). Levar a **100%** é o passo que destrava o resto.

---

## 2. Os 4 problemas — contagem, fonte do dado, mecânica

| Problema | Casos | Fonte do dado | Mecânica | Estado no banco hoje |
|---|---|---|---|---|
| **Distrato** | **36** (≈28 marcados, ≈7 a marcar, 1 sem venda) | `/sales-contracts.situation='3'` + relatório oficial | Sienge dá **baixa em TODAS** as parcelas; só **pré-distrato** (`paymentDate < data_distrato`) é real | `data_distrato` existe; **baixa infla comissão** nos marcados |
| **Aditivo** | **15** (14 contratos) | `/remade-installments` (1 request traz todos) | Grade **nova roda em paralelo** à antiga; pode ter juros | `renegociacoes` existe (manual); **sem `renegociacao_id`** nos pagamentos |
| **Cessão** | **3** | **relatório de cessão** (sem endpoint de consulta) | Troca `cliente_id`; **autocura via sync** (2/3 já corretas) | `cessoes_direitos` **NÃO existe** |
| **Gerador furado** | duplicatas (c129) + cronograma errado (c275) | `income` por `installmentId` | Geração **não-idempotente** por `(tipo, numero_parcela)` | 84% ancorado, 16% solto |

---

## 3. Catálogo das fontes de dado (como o dado vem)

| Fonte | Quota | Traz | Usada para |
|---|---|---|---|
| `/sales-contracts` (REST v1) | 100/dia | criação, `situation`(distrato), `salesContractCustomers`(cessão), `containsRemadeInstallments` | venda nova, distrato, titular |
| `/bulk-data/v1/income` | **sem quota** | parcela a parcela: `billId`, `installmentId`, `clientId`, `paymentDate`, `originalAmount` | **a âncora** — pagamento, status, datas |
| `/remade-installments` (REST v1) | 1 request | todos os aditivos: renegociadas→geradas, `remadeDate`, juros | aditivo completo |
| Relatório de cessão (export) | manual | antes/depois + data + cônjuge | **único evento de cessão** |
| Relatório de distrato (export) | manual | lista oficial + motivo/valor | conferência da lista de distrato |

---

## 4. Schema — o que existe vs o que falta

**Já existe:** `vendas.situacao_contrato`/`data_distrato` (015) · `renegociacoes` (016) · `sienge_receivable_bill_id` (019) ·
`sienge_installment_id` (023) · `cliente_id_origem` (021) · triggers de imutabilidade 017/018/020/026.

**Falta (migrations novas):**
1. **`cessoes_direitos`** — tabela de evento: `venda_id, data_cessao, titular_antigo[], titular_novo[], conjuge, receivable_bill_id, origem`. Prever **múltiplos titulares + cônjuge** (caso 1208 C).
2. **`pagamentos_prosoluto.renegociacao_id`** (FK → `renegociacoes`) — liga parcela gerada ao aditivo.
3. **`cliente_id_origem` += `'cessao'`** — rastro do titular trocado por cessão (hoje CHECK só aceita `sync/manual`).
4. **(opcional) `distratos`** — persistir dado do evento (`motivo, valor_distrato, valor_recebido, percentual`) p/ auditoria; o real-vs-baixa fica nas próprias parcelas (real=`pago`, baixa=`cancelado`).

---

## 5. Plano por fases (ordem de ataque)

### Fase 1 — Schema (fundação) · *migration, não toca dado*
- Criar `cessoes_direitos`, `pagamentos.renegociacao_id`, afrouxar `cliente_id_origem` p/ `'cessao'`.
- (opcional) `distratos`. **Risco baixo** — só DDL.

### Fase 2 — Gerador idempotente · *mata a causa de c129/c275*
- Reescrever a geração de parcelas para **chavear por `sienge_installment_id`** (não por `numero_parcela`).
- Regra: só insere installment inexistente; nunca duplica; nunca toca pago. Rodar 2× = no-op.
- (Parte B do gerador "skip-only" já começou — ver CLAUDE.md; completar p/ ancoragem por installment.)

### Fase 3 — Ancoragem 100% · *o passo-chave*
- Varredura: para cada parcela sem `sienge_installment_id`, casar com o `income` por `(billId, valor, dueDate)` e gravar o id.
- Os 16% soltos hoje são onde mora o risco (duplicata/cronograma). Depois disso, reconciliação por id (não por valor).

### Fase 4 — Distrato (os 36) · *escreve em pago — gated*
- Para cada distrato: manter `pago` só as parcelas **pré-distrato** (`income.paymentDate < data_distrato`); o resto → `cancelado`; `situacao='3'` + `data_distrato`.
- **Corrige os ≈28 já marcados** (que ainda têm baixa inflada) + marca os ≈7 + decide o 1 sem venda (412).
- Já validado em 3 casos no curativo de maio (molde: AMANDA c195).

### Fase 5 — Aditivo (os 15) · *escreve — gated + decisão de negócio*
- Wiring `/remade-installments`: parcelas renegociadas não-pagas → `cancelado`/`renegociado`; geradas → linhas novas com `renegociacao_id` + ancoradas; pagas intactas.
- **Resolver o débito de maio** ([debito-aditivo](2026-06-05-debito-aditivo-para-schema.json)): os 2 inserts viram parcelas ancoradas, sem inflar o total.
- ⚠️ **Decisão de negócio: juros comissionam?** (padrão: não).

### Fase 6 — Cessão (os 3) · *quase autocura*
- Popular `cessoes_direitos` com os 3 do relatório; o sync de `sales-contracts` já traz o titular novo (provado 2/3).
- Detector opcional via `income.clientId` ≠ local p/ pegar os não-sincronizados.

### Fase 7 — Reconciliação contínua · *o espelho vivo*
- Sync mensal: income fresco → ancora por id → marca pago/distrato/aditivo → emite métrica de drift.
- Invariantes (zero pago sem data, zero distrato com baixa contada, zero duplicata por installment).
- Aí "filtro do mês = verdade" vira automático, sem curativo.

---

## 6. Decisões de negócio abertas (travam fases)

1. **Juros de aditivo comissionam?** (Fase 5) — padrão: não.
2. **Distrato: comissão paga = só o real pré-distrato?** (Fase 4) — confirmado hoje; reconfirmar com a gestora (a regra antiga "preserva R$684k" precisa ser lida como "só o real").
3. **c275 (803 D):** regenerar cronograma 2-fases (enviado à controladoria).
4. **Vendas sem contrato Sienge** (412 Gabriel, 606 Gustavo): criar ou descartar?

---

## 7. Ligação com o controle (cards)

- Card **"renegociações"** = Fases 1, 4, 5, 6 (os 3 termos + tabelas).
- Card **"banco 100% igual ao Sienge"** = Fases 2, 3, 7 (gerador, ancoragem, reconciliação) — a parte que o card ainda não tinha.
- O **relatório é mensal**: cada fase entregue torna o relatório do mês mais fiel; a Fase 7 fecha o ciclo.

---

## 8. Próximo passo sugerido

**Fase 1 (schema)** — risco zero, destrava tudo. Escrever as migrations (`cessoes_direitos`, `renegociacao_id`,
`cliente_id_origem += cessao`) e revisar antes de aplicar. Depois Fase 2/3 (gerador + ancoragem), que são a fundação
técnica do "100% igual ao Sienge".
