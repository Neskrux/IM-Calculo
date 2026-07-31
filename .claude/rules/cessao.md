# Regra/Spec: Cessão de contrato (3º termo) — "Ceder contrato"

> **Status:** spec para o **worktree principal (IM-Calculo)** implementar a UI. A reconciliação só
> diagnostica/protege; a ação de UI mora no app. Handoff escrito do worktree de reconciliação.
> **Origem:** caso real 905 B (Gabriel Antonio Marques → Caroline Saraiva), 2026-06-26.

## 1. O que é cessão (e por que é diferente de distrato/aditivo)

**Cessão de direitos = troca do CLIENTE num contrato que continua vivo.** O cedente sai, o cessionário
assume o mesmo contrato, mesma unidade, mesmo corretor, mesma grade. As parcelas já pagas pelo cedente
**ficam como histórico**; as **em aberto passam a ser do cessionário**.

| Termo | Tem API Sienge? | Como o sistema sabe |
|---|---|---|
| Distrato | ✅ `situacao=3` | sync |
| Aditivo | ✅ `/remade-installments` | sync |
| **Cessão** | ❌ **NÃO há API v1** | **só a pasta/Drive (termo assinado)** |

**Consequência-chave:** cessão é o **único termo onde banco ≠ Sienge é LEGÍTIMO** — o Sienge mantém o
cedente (não há endpoint pra trocar), o banco tem o cessionário (a verdade do contrato assinado). A
pasta/Drive é a **fonte da verdade** desse termo, não o Sienge.

## 2. Invariantes (o que muda, o que NÃO muda)

Ao ceder um contrato:
- **MUDA:** `vendas.cliente_id` → novo cliente · `vendas.cliente_id_origem = 'cessao'` (migration 028).
- **NÃO MUDA:** `sienge_receivable_bill_id`, `sienge_contract_id`, as parcelas e suas âncoras
  (`sienge_installment_id`), o histórico de pagas (do cedente), o corretor, o `valor_pro_soluto`.
- **Por que o sync não se confunde:** o pagamento ancora por `(bill, installmentId)`, **independente do
  nome do cliente**. Pagamento novo do cessionário entra no mesmo bill → ancora certo. O nome é só rótulo,
  e `cliente_id_origem='cessao'` **protege** contra sobrescrita do sync (igual `manual`).

## 3. UI "Ceder contrato" (a ação a construir no principal)

Ação no admin/controladoria, sobre uma venda existente:
1. **Selecionar a venda** (unidade/contrato do cedente).
2. **Escolher/cadastrar o cessionário** (novo cliente).
3. **Anexar/confirmar o termo de cessão** (o PDF assinado da pasta/Drive — é a prova).
4. **Decidir a liquidação das parcelas em aberto** (ver §4) — **campo de escolha humana**.
5. **Aplicar:** `cliente_id = novo`, `cliente_id_origem='cessao'`; mantém grade/âncora/pagas; loga em
   métrica canônica (schema de [sincronizacao-sienge.md](sincronizacao-sienge.md)).
6. **Reversível** (snapshot do `cliente_id` anterior).

## 4. Liquidação das pendentes — DECISÃO DE NEGÓCIO (não automatizar)

As parcelas em aberto que passam ao cessionário **podem ser liquidadas de formas diferentes** e **o negócio
decide caso a caso** (ex.: balões extras no mensal × manter a grade padrão). Por isso a UI **oferece a
opção**, mas **não decide sozinha**:
- **Manter grade** (cessionário assume as pendentes como estão), ou
- **Gerar balões/ajuste** (quando o negócio definir o reparcelamento).

> ⚠️ **Não automatizar a liquidação.** O que falta nesses casos **não é dado, é decisão de negócio.**
> Enquanto indefinido, manter a grade e **parquear** a liquidação.

## 5. Caminho de adoção (estágios — não construir além do necessário)

| Quando | Como |
|---|---|
| **Agora (≤3 casos)** | **UI manual** + pasta/Drive valida (termo assinado). Humano inicia. |
| **Se o volume crescer** | Drive-watcher **sugere** cessões numa fila (rodada-b), humano confirma na UI. |
| **Provavelmente nunca** | Auto-aplicar sem humano — a liquidação (§4) exige decisão. |

Racional: cessão é rara e o processo de liquidação é indefinido. Automatizar a detecção pelo Drive é
esforço alto pra evento raro + processo não-fechado. **Espelho fiel sem depender de API** = a pasta valida,
o humano decide, o sync mantém (âncora + proteção `cessao`).

## 6. Validação (dois lados, sem API)

- **Pasta/Drive:** o termo de cessão assinado **prova** quem cedeu pra quem (fonte da verdade).
- **Banco:** `cliente_id_origem='cessao'` + grade ancorada intacta.
- **Validador de identidade** ([scripts/validar-identidade-unidade-torre.mjs](../../scripts/validar-identidade-unidade-torre.mjs)):
  é **cessão-aware** — venda `origem='cessao'` pode divergir do `clientName` do Sienge **de propósito**
  (não conta como erro). Sem isso, toda cessão apareceria como "cliente diverge" falso.

## 7. Estado atual (2026-06-26)

- **905 B** — Gabriel Antonio Marques (Sienge/cedente) → **Caroline Saraiva** (banco/cessionária).
  Marcado `cliente_id_origem='cessao'`. Bill 410 ancorado, 8 pagas mantidas. **Liquidação das pendentes:
  parqueada** (negócio ainda não definiu balões × mensal).
- **+2 cessões antigas** já autocuraram pelo sync (nome passou a bater com o Sienge) — sem divergência hoje.
- **1208 C** — **Eduardo Vidal de Souza (cedente) → Kainã Luis de Souza & Taynara Peixoto (cessionário)**.
  Autocurou pelo sync: banco hoje = Kainã (`cliente_id_origem='sync'`, ativa, Sienge 245). Termo assinado na pasta
  (`Torre C/Apto. 1208 KAINÃ ... - CESSÃO`). **Unidade da coordenadora Jessica** (cod 326). Identificado 2026-07-08 ao
  reconciliar a lista da controladoria (13 nomes) com o extrato SIMOB (12 unidades): o 13º nome = o **cedente** Eduardo
  Vidal, que não está no banco (só o cessionário) nem no SIMOB — por isso "sumia".

### Atualização 2026-07-08 — 4 cessões documentadas na pasta (não 3)
Varredura da pasta DISTRATOS/torres achou **4 termos de cessão assinados**: **506 A** (Liliam Thaiane), **610 A**
(Nahelem Nayara), **905 B** (Caroline→Gabriel), **1208 C** (Eduardo Vidal→Kainã). O North Star #2 registrava 3 — a
contagem sobe para **≥4**. Fonte-verdade da cessão continua a pasta/Drive (não há API v1). Rever o total ao mapear
506 A e 610 A no banco.

---

**Handoff p/ o principal:** implementar §3 (ação UI "Ceder contrato") + §4 (escolha de liquidação). O
schema (`cliente_id` + `cliente_id_origem='cessao'`) e a proteção do sync **já existem** (migration 028 +
`*_id_origem`). O validador já é cessão-aware. Falta só a **superfície de UI**.
