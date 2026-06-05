---
status: DESENHO / mapeamento completo (base pro desenvolvimento) — read-only até aqui
data: 2026-06-03
branch: sync/reconciliacao
escopo: 3 termos contratuais novos a modelar no banco — distrato · reparcelamento(aditivo) · cessão de direitos
fontes: api.sienge.com.br/docs/ (88 recursos) · general-hooks-types.html (webhooks) · ajuda.sienge.com.br · banco (read-only)
relacionado: memory/termos-contratuais-sienge.md · docs/contexto/2026-06-01-distratos-mapa-completo.md
---

# Termos contratuais (distrato · aditivo · cessão) — desenho pro banco

> Consolida tudo que mapeamos até 2026-06-03. São **3 situações DIFERENTES** de um contrato. Princípio:
> Sienge é a fonte da verdade, mas **não confiar cegamente** (validar). Hoje o sync é **PULL** (bulk-data + REST v1);
> **não há planos de webhook** no momento → priorizar o que dá pra pegar via **bulk-data**.

## Tabela-resumo (a forma de capturar cada um)

| Termo | O que é | API v1 (consulta) | Bulk-data | Webhook (sem planos) | Estado no banco |
|-------|---------|-------------------|-----------|----------------------|-----------------|
| **Distrato** | contrato cancelado; cliente desiste | ✅ `sales-contracts-v1` (`situation='3'`) | `bulk-data-sales-v1` | `SALES_CONTRACT_CANCELED` | ✅ modelado (ponte A.1) — falta deploy+backfill |
| **Reparcelamento = aditivo** | mesmo contrato, ajusta cronograma | ✅ `remade-installments-v1` (dedicado) | reflexo no `income` (parcelas mudam) | `RECEIVABLE_INSTALLMENT_UPDATED` (não dedicado) | tabela `renegociacoes` (016, só manual) |
| **Cessão de direitos** | mesmo contrato, troca titular | ❌ sem consulta dedicada | ✅ **`income.clientId` por bill** (reflexo) | `ASSIGNMENT_RIGHTS_AGREEMENT_UPDATED` | nada — a desenhar |

---

## 1. Distrato

- **Negócio:** cancelamento do contrato. Cliente desiste. Comissão **já paga é preservada**; parcelas futuras canceladas.
- **Sienge:** `situacao_contrato='3'` + `cancellationDate` + `cancellationReason`.
- **Captura:** já vem no sync de `sales-contracts` (pull). Webhook irmão: `SALES_CONTRACT_CANCELED`.
- **Banco (já modelado):** `vendas.situacao_contrato`, `data_distrato`, `data_cancelamento`, `motivo_cancelamento`;
  ponte A.1 (`normalize/sales-contracts.ts`): `situation='3'` → `status='distrato'` + `data_distrato`. Tolera reversão.
- **Decisões da gestora:** comissão paga **mantida** (R$ 684k); distrato em **vermelho** (não some); **todos** os dashboards.
- **Falta:** deploy do edge (A.1) + backfill dos 25 distratos. `nome_cliente` NULL nos 25.
- **Ex confirmado:** Gabriel Adriano Gomes (unid 412) — não pagou nada, pediu distrato.
- **Não confundir** com **reemissão** (contrato cancelado e reaberto com **novo id**, ex c236→c390).

## 2. Reparcelamento = Termo Aditivo

- **Negócio:** alteração do parcelamento de um contrato que **CONTINUA ativo** (mudar data da 1ª parcela, renegociar
  prazo/valores). Formalizado por **termo aditivo**. NÃO é distrato nem novo contrato. **reparcelamento ⇔ aditivo.**
- **Sienge:** Financeiro → Contas a Receber → Reparcelamento → Inclusão.
- **Captura:**
  - **Endpoint dedicado `remade-installments-v1`** ("Reparcelamentos - Conta a Receber") — REST v1, consultável.
    ⚠️ pode precisar **habilitar o módulo** no plano Sienge; ainda **não fizemos probe** dos campos.
  - **Reflexo no `income`:** as parcelas do bill mudam (datas/valores) → detectável comparando cronograma.
  - Webhook irmão (não dedicado): `RECEIVABLE_INSTALLMENT_UPDATED`.
- **Banco:** tabela **`renegociacoes`** (migration 016) já existe — hoje só pra renegociação **manual** feita no
  nosso sistema (`usuario_id`, `parcelas_originais`/`novas` JSONB, `diferenca_valor/comissao`). **Falta ligar ao sync.**
- **Modelo:** ao detectar aditivo, ajustar `data_prevista` das **pendentes**; **NÃO tocar nas pagas** (imutáveis 017);
  registrar o evento em `renegociacoes`. Separar aditivo de drift comum de data.
- **Ex confirmado:** Gustavo Henrique da Cunha (unid 606, contrato 305 / código 451) — 1ª parcela movida pra junho.
  Implica: vincular ao contrato real + ajustar cronograma, nunca excluir.

## 3. Cessão de Direitos

- **Negócio (confirmado pelo Jonas):** o cliente atual não quer/não pode mais pagar → **passa o contrato a um NOVO
  cliente** (o corretor intermedia). NÃO é distrato — o contrato não morre, troca de dono.
- **Modelo no nosso banco:**
  - **Trocar `cliente_id` da venda** (titular novo), **MANTENDO** o contrato e as parcelas.
  - **Parcelas já pagas continuam pagas** (o dinheiro entrou) — só o "dono" daqui pra frente muda.
  - **`corretor_id` NÃO muda:** hoje a cessão só é feita pelo **mesmo corretor**; comissão (passada e futura) segue
    dele. → deixar o caminho **fácil de mudar no futuro**, mas **não é foco** (não é processo do dia a dia).
  - **Preservar histórico** do titular antigo (não sobrescrever cego — migration 021 já protege `cliente_id='manual'`).
- **Sienge (oficial):** Financeiro → Contas a Receber → **Cessão de Direitos** → Solicitação. "Termos do contrato,
  condições de pagamento e **parcelas já pagas permanecem inalterados, passando aos novos clientes a partir da data
  informada**." Pode incluir **cliente principal + secundário + cônjuge** com **percentual de participação** (cônjuge
  entra com 0% por padrão); reflete em IR/DIMOB. → `customersIdAfter` pode ser **lista** (prever múltiplos titulares).
- **Captura:**
  - ❌ **Sem endpoint de consulta dedicado** na v1 (88 recursos, nenhum de cessão/assignment).
  - ✅ **BULK (preferido, sem webhook):** `bulk-data-income` traz **`clientId` + `clientName` por bill**. Comparar com
    o `cliente_id` local detecta a cessão pelo **reflexo** (titular do título mudou).
    **PROVADO 2026-06-03** (`scripts/detectar-cessao-via-income.mjs`): **c340 / unid 905 B / bill 410** —
    local **Caroline** (sienge 102) → income **Gabriel** (sienge 670). 1 de 294 conferíveis (amostra = só vencidas).
  - Webhook (PUSH, **sem planos**): `ASSIGNMENT_RIGHTS_AGREEMENT_UPDATED`
    `{ receivableBillId, dtRightAssignment, customersIdBefore:[...], customersIdAfter:[...] }` —
    `receivableBillId` = `vendas.sienge_receivable_bill_id`.
  - **2 relatórios exclusivos** no Sienge (1 com data+clientes da cessão; 1 com financeiro antes/depois).
- **Limitações do bulk:** dá o estado **ATUAL** (cliente novo), **não a data nem o "antes"** do evento; e uma
  divergência pode ser **cessão OU correção de cliente** — confirmar caso a caso. `income-D` só cobre vencidas;
  income completo varre tudo.

---

## Decisões de negócio registradas (Jonas, 2026-06-03)

1. Cessão = trocar `cliente_id`, mantendo contrato/parcelas; pagas intactas; **mesmo corretor** (deixar fácil mudar).
2. Distrato: comissão paga mantida · vermelho · todos os dashboards.
3. Não confiar cegamente (THAI errou 48/81; API nova idem) — sempre validar contra o Sienge.

## Arquitetura

- **Hoje:** PULL — `bulk-data/v1/income` (sem quota) + REST v1 (`/sales-contracts`, quota 100/dia). Sync via edge function.
- **Webhook (PUSH):** existe e seria o caminho "puro" pra cessão/distrato, mas **sem planos** agora (precisa configurar
  `hooks-v1` + endpoint receptor + habilitar no plano). Por isso: **priorizar detecção via bulk**.
- **Pré-requisito recorrente:** cada API/módulo do Sienge precisa estar **habilitado no plano** da IM (ex.:
  `remade-installments` pode dar 403 até liberar). Confirmar antes de depender de um endpoint novo.

## Não confundir (resumo)

- **Distrato** = cancela o contrato (situacao=3).
- **Reemissão** = cancela e reabre com **novo id** (ex c236→c390).
- **Reparcelamento/aditivo** = **mesmo** contrato, ajusta cronograma.
- **Cessão** = **mesmo** contrato, **troca o titular** (cliente).

## Estado de desenvolvimento / pendências

| Termo | Pronto | Falta |
|-------|--------|-------|
| Distrato | modelagem + ponte A.1 | deploy edge + backfill 25 |
| Aditivo | tabela `renegociacoes` (016) | ponte sync→renegociacoes; probe `remade-installments-v1` (habilitar?) |
| Cessão | detector via `income.clientId` (provado) | desenhar aplicação (trocar `cliente_id` + histórico); varrer income completo; tratar múltiplos titulares/percentual |

## Achados concretos (casos reais)

- **Cessão:** c340 / 905 B — Caroline → Gabriel (detectado via income).
- **Reparcelamento:** Gustavo 606 (c305/451).
- **Distrato:** Gabriel Adriano 412.

## Scripts / artefatos

- `scripts/detectar-cessao-via-income.mjs` — detector de cessão por divergência de cliente (read-only).
- `migrations/016_renegociacoes.sql` — tabela de renegociações (aditivo, hoje manual).
- `supabase/functions/sienge-sync/normalize/sales-contracts.ts` — ponte distrato A.1 (linha ~415).
