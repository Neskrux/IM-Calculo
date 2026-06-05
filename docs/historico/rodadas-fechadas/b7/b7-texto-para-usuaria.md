# Rodada B.7 — Parcelas duplicadas no banco (numero_parcela repetido)

Encontrei **11 vendas** com pares de parcelas duplicadas no nosso banco — duas linhas com o mesmo `numero_parcela` e mesmo tipo, sendo uma cancelada e outra ativa. Isso veio do backfill antigo de pagamentos, que não amarrava as parcelas pelo id real do Sienge.

**Importante:** o Sienge está correto. A bagunça é só no nosso banco. Vou corrigir respeitando o Sienge como fonte da verdade.

---

## Grupo 1 — Casos com par PAGO (risco alto) — aguardar re-baixa Sienge

11 vendas tem pelo menos um par onde uma das linhas duplicadas está **paga**. Nesses casos, não vou cancelar nada antes de confirmar com o Sienge qual linha realmente recebeu pagamento.

### Contrato 183 — Sienge 275 — Unidade 803 D
- **Cliente:** SAMUEL MUELLER LEMOS — CPF 11319608906 — Tel (47) 99660-0856
- **Corretor:** -
- **Valor venda:** R$ 410.443,77
- **Pagamentos:** 8 pagos, 33 pendentes, 16 cancelados — 16 pares duplicados, 4 com linha paga
- **Pares duplicados:**
  - parc 2 / parcela_entrada: cancelado(R$ 2650, prev 2025-11-10, pago -) + pago(R$ 1500, prev 2027-06-10, pago 2025-11-10)
  - parc 3 / parcela_entrada: pago(R$ 1500, prev 2027-07-10, pago 2025-12-10) + cancelado(R$ 1500, prev 2027-07-10, pago -)
  - parc 6 / parcela_entrada: pago(R$ 1500, prev 2027-10-10, pago 2026-03-10) + cancelado(R$ 1500, prev 2027-10-10, pago -)
  - parc 7 / parcela_entrada: pago(R$ 1500, prev 2027-11-10, pago 2026-04-10) + cancelado(R$ 1500, prev 2027-11-10, pago -)
  - parc 8 / parcela_entrada: pendente(R$ 1500, prev 2027-12-10, pago -) + cancelado(R$ 1500, prev 2027-12-10, pago -)
  - parc 9 / parcela_entrada: pendente(R$ 1500, prev 2028-01-10, pago -) + cancelado(R$ 1500, prev 2028-01-10, pago -)
  - parc 10 / parcela_entrada: pendente(R$ 1500, prev 2028-02-10, pago -) + cancelado(R$ 1500, prev 2028-02-10, pago -)
  - parc 11 / parcela_entrada: cancelado(R$ 1500, prev 2028-03-10, pago -) + pendente(R$ 2650, prev 2028-03-10, pago -)
  - parc 12 / parcela_entrada: cancelado(R$ 2650, prev 2028-04-10, pago -) + pendente(R$ 1500, prev 2028-04-10, pago -)
  - parc 13 / parcela_entrada: pendente(R$ 1500, prev 2028-05-10, pago -) + cancelado(R$ 2650, prev 2028-05-10, pago -)
  - parc 14 / parcela_entrada: cancelado(R$ 1500, prev 2028-06-10, pago -) + pendente(R$ 2650, prev 2028-06-10, pago -)
  - parc 15 / parcela_entrada: pendente(R$ 1500, prev 2028-07-10, pago -) + cancelado(R$ 2650, prev 2028-07-10, pago -)
  - parc 16 / parcela_entrada: pendente(R$ 1500, prev 2028-08-10, pago -) + cancelado(R$ 1500, prev 2028-08-10, pago -)
  - parc 17 / parcela_entrada: pendente(R$ 1500, prev 2028-09-10, pago -) + cancelado(R$ 2650, prev 2028-09-10, pago -)
  - parc 18 / parcela_entrada: cancelado(R$ 1500, prev 2028-10-10, pago -) + pendente(R$ 2650, prev 2028-10-10, pago -)
  - parc 19 / parcela_entrada: cancelado(R$ 1500, prev 2028-11-10, pago -) + pendente(R$ 2650, prev 2028-11-10, pago -)
- **Ação proposta:** aguardar re-baixa de `/bulk-data/v1/income` (quota Sienge esgotou hoje 2026-05-13) → popular `sienge_installment_id` (migration 023) → re-amarrar parcelas pelo id real → cancelar a duplicata redundante.

### Contrato 268 — Sienge 382 — Unidade 1305 A
- **Cliente:** ALISSON RODRIGUES DO CARMO
- **Corretor:** -
- **Valor venda:** R$ 457.103,88
- **Pagamentos:** 3 pagos, 41 pendentes, 10 cancelados — 10 pares duplicados, 1 com linha paga
- **Pares duplicados:**
  - parc 2 / parcela_entrada: cancelado(R$ 875, prev 2026-03-10, pago -) + pago(R$ 1723.01, prev 2027-02-10, pago 2026-03-06)
  - parc 3 / parcela_entrada: pendente(R$ 875, prev 2027-03-10, pago -) + cancelado(R$ 875, prev 2027-03-10, pago -)
  - parc 4 / parcela_entrada: cancelado(R$ 1723.01, prev 2027-04-10, pago -) + pendente(R$ 875, prev 2027-04-10, pago -)
  - parc 5 / parcela_entrada: cancelado(R$ 875, prev 2027-05-10, pago -) + pendente(R$ 1723.01, prev 2027-05-10, pago -)
  - parc 6 / parcela_entrada: pendente(R$ 875, prev 2027-06-10, pago -) + cancelado(R$ 1723.01, prev 2027-06-10, pago -)
  - parc 7 / parcela_entrada: pendente(R$ 875, prev 2027-07-10, pago -) + cancelado(R$ 1723.01, prev 2027-07-10, pago -)
  - parc 8 / parcela_entrada: cancelado(R$ 1723.01, prev 2027-08-10, pago -) + pendente(R$ 875, prev 2027-08-10, pago -)
  - parc 9 / parcela_entrada: cancelado(R$ 1723.01, prev 2027-09-10, pago -) + pendente(R$ 875, prev 2027-09-10, pago -)
  - parc 10 / parcela_entrada: pendente(R$ 875, prev 2027-10-10, pago -) + cancelado(R$ 1723.01, prev 2027-10-10, pago -)
  - parc 11 / parcela_entrada: pendente(R$ 875, prev 2027-11-10, pago -) + cancelado(R$ 1723.01, prev 2027-11-10, pago -)
- **Ação proposta:** aguardar re-baixa de `/bulk-data/v1/income` (quota Sienge esgotou hoje 2026-05-13) → popular `sienge_installment_id` (migration 023) → re-amarrar parcelas pelo id real → cancelar a duplicata redundante.

### Contrato 163 — Sienge 255 — Unidade 1405 C
- **Cliente:** ANDREY LUIZ MESSIAS SANTOS  — CPF 05319809522 — Tel (47)99282-8064
- **Corretor:** -
- **Valor venda:** R$ 363.369,59
- **Pagamentos:** 58 pagos, 0 pendentes, 7 cancelados — 7 pares duplicados, 7 com linha paga
- **Pares duplicados:**
  - parc 1 / parcela_entrada: pago(R$ 400, prev 2025-06-20, pago 2025-12-29) + cancelado(R$ 1221.23, prev 2026-01-20, pago -)
  - parc 2 / parcela_entrada: cancelado(R$ 400, prev 2025-07-20, pago -) + pago(R$ 400, prev 2025-07-20, pago 2025-12-29)
  - parc 3 / parcela_entrada: pago(R$ 400, prev 2025-08-20, pago 2025-12-29) + cancelado(R$ 400, prev 2025-08-20, pago -)
  - parc 4 / parcela_entrada: pago(R$ 400, prev 2025-09-20, pago 2025-12-29) + cancelado(R$ 400, prev 2025-09-20, pago -)
  - parc 5 / parcela_entrada: cancelado(R$ 400, prev 2025-10-20, pago -) + pago(R$ 1221.23, prev 2026-05-20, pago 2025-12-29)
  - parc 6 / parcela_entrada: pago(R$ 400, prev 2025-11-20, pago 2025-12-29) + cancelado(R$ 400, prev 2025-11-20, pago -)
  - parc 7 / parcela_entrada: cancelado(R$ 400, prev 2025-12-20, pago -) + pago(R$ 400, prev 2025-12-20, pago 2025-12-29)
- **Ação proposta:** aguardar re-baixa de `/bulk-data/v1/income` (quota Sienge esgotou hoje 2026-05-13) → popular `sienge_installment_id` (migration 023) → re-amarrar parcelas pelo id real → cancelar a duplicata redundante.

### Contrato 73 — Sienge 163 — Unidade 1603 A
- **Cliente:** DIOGO DA LUZ DOS SANTOS — CPF 09233207927 — Tel (47)99724-4138
- **Corretor:** -
- **Valor venda:** R$ 346.440,81
- **Pagamentos:** 10 pagos, 42 pendentes, 9 cancelados — 6 pares duplicados, 3 com linha paga
- **Pares duplicados:**
  - parc 1 / parcela_entrada: pago(R$ 1275.07, prev 2026-08-20, pago 2025-06-21) + cancelado(R$ 1275.07, prev 2026-08-20, pago -) + cancelado(R$ 1275.07, prev 2026-08-20, pago -)
  - parc 2 / parcela_entrada: cancelado(R$ 500, prev 2025-11-20, pago -) + cancelado(R$ 1136.66, prev 2026-09-20, pago -) + pago(R$ 1275.07, prev 2026-09-20, pago 2025-06-21)
  - parc 4 / parcela_entrada: cancelado(R$ 1275.07, prev 2026-11-20, pago -) + cancelado(R$ 1136.66, prev 2026-11-20, pago -) + pago(R$ 1275.07, prev 2026-11-20, pago 2026-01-19)
  - parc 8 / parcela_entrada: pendente(R$ 1275.07, prev 2027-03-20, pago -) + cancelado(R$ 500, prev 2027-03-20, pago -)
  - parc 9 / parcela_entrada: cancelado(R$ 500, prev 2027-04-20, pago -) + pendente(R$ 500, prev 2027-04-20, pago -)
  - parc 10 / parcela_entrada: cancelado(R$ 500, prev 2027-05-20, pago -) + pendente(R$ 500, prev 2027-05-20, pago -)
- **Ação proposta:** aguardar re-baixa de `/bulk-data/v1/income` (quota Sienge esgotou hoje 2026-05-13) → popular `sienge_installment_id` (migration 023) → re-amarrar parcelas pelo id real → cancelar a duplicata redundante.

### Contrato 40 — Sienge 87 — Unidade 908 A
- **Cliente:** LEANDRO DE OLIVEIRA VICENTIN  — CPF 18757055890 — Tel (47)98420-3075
- **Corretor:** -
- **Valor venda:** R$ 418.341,97
- **Pagamentos:** 8 pagos, 49 pendentes, 4 cancelados — 4 pares duplicados, 3 com linha paga
- **Pares duplicados:**
  - parc 1 / parcela_entrada: pago(R$ 1394.47, prev 2026-02-20, pago 2026-02-03) + cancelado(R$ 1000, prev 2026-02-20, pago -) + pago(R$ 2761.39, prev 2026-02-20, pago 2026-02-02)
  - parc 2 / parcela_entrada: cancelado(R$ 1000, prev 2026-03-20, pago -) + pago(R$ 1000, prev 2026-03-20, pago 2026-03-03)
  - parc 4 / parcela_entrada: cancelado(R$ 1000, prev 2025-09-20, pago -) + pago(R$ 1394.47, prev 2026-05-20, pago 2025-05-08)
  - parc 6 / parcela_entrada: cancelado(R$ 1000, prev 2025-11-20, pago -) + pendente(R$ 1394.47, prev 2026-07-20, pago -)
- **Ação proposta:** aguardar re-baixa de `/bulk-data/v1/income` (quota Sienge esgotou hoje 2026-05-13) → popular `sienge_installment_id` (migration 023) → re-amarrar parcelas pelo id real → cancelar a duplicata redundante.

### Contrato 154 — Sienge 246 — Unidade 1302 C
- **Cliente:** MARIA VITORIA DA SILVA FRANCISCO — CPF 11625933932 — Tel (43)99669-8714
- **Corretor:** -
- **Valor venda:** R$ 427.221,03
- **Pagamentos:** 53 pagos, 0 pendentes, 3 cancelados — 3 pares duplicados, 3 com linha paga
- **Pares duplicados:**
  - parc 1 / parcela_entrada: cancelado(R$ 500, prev 2025-10-20, pago -) + pago(R$ 1553.53, prev 2026-01-20, pago 2026-01-20)
  - parc 2 / parcela_entrada: cancelado(R$ 500, prev 2025-11-20, pago -) + pago(R$ 1553.53, prev 2026-02-20, pago 2026-02-09)
  - parc 3 / parcela_entrada: pago(R$ 500, prev 2025-12-20, pago 2026-03-05) + cancelado(R$ 1553.53, prev 2026-03-20, pago -)
- **Ação proposta:** aguardar re-baixa de `/bulk-data/v1/income` (quota Sienge esgotou hoje 2026-05-13) → popular `sienge_installment_id` (migration 023) → re-amarrar parcelas pelo id real → cancelar a duplicata redundante.

### Contrato 177 — Sienge 269 — Unidade 609 D
- **Cliente:** DIEGO RAMOS — CPF 10099686961 — Tel (47)99629-9164
- **Corretor:** -
- **Valor venda:** R$ 383.188,92
- **Pagamentos:** 12 pagos, 36 pendentes, 18 cancelados — 3 pares duplicados, 3 com linha paga
- **Pares duplicados:**
  - parc 1 / parcela_entrada: cancelado(R$ 1300, prev 2025-07-10, pago -) + cancelado(R$ 1600, prev 2030-07-10, pago -) + cancelado(R$ 2200, prev 2030-07-10, pago -) + pago(R$ 1600, prev 2030-07-10, pago 2025-07-09) + cancelado(R$ 2800, prev 2030-07-10, pago -) + cancelado(R$ 1900, prev 2030-07-10, pago -) + cancelado(R$ 3200, prev 2030-07-10, pago -)
  - parc 2 / parcela_entrada: cancelado(R$ 1300, prev 2025-08-10, pago -) + cancelado(R$ 2500, prev 2030-08-10, pago -) + pago(R$ 2800, prev 2030-08-10, pago 2025-08-08) + cancelado(R$ 2500, prev 2030-08-10, pago -) + cancelado(R$ 2200, prev 2030-08-10, pago -) + cancelado(R$ 1900, prev 2030-08-10, pago -) + cancelado(R$ 1600, prev 2030-08-10, pago -)
  - parc 5 / parcela_entrada: cancelado(R$ 1300, prev 2025-11-10, pago -) + cancelado(R$ 1900, prev 2030-11-10, pago -) + pago(R$ 2500, prev 2030-11-10, pago 2025-11-06) + cancelado(R$ 1600, prev 2030-11-10, pago -) + cancelado(R$ 2500, prev 2030-11-10, pago -) + cancelado(R$ 3200, prev 2030-11-10, pago -) + cancelado(R$ 2800, prev 2030-11-10, pago -)
- **Ação proposta:** aguardar re-baixa de `/bulk-data/v1/income` (quota Sienge esgotou hoje 2026-05-13) → popular `sienge_installment_id` (migration 023) → re-amarrar parcelas pelo id real → cancelar a duplicata redundante.

### Contrato 76 — Sienge 166 — Unidade 1607 A
- **Cliente:** GHIZIERI JENNINFER FREITAS COSTA BOSZCZOWSKI — CPF 08401031907 — Tel (47)988623130
- **Corretor:** -
- **Valor venda:** R$ 440.166,26
- **Pagamentos:** 7 pagos, 48 pendentes, 3 cancelados — 3 pares duplicados, 3 com linha paga
- **Pares duplicados:**
  - parc 2 / parcela_entrada: cancelado(R$ 1604.4, prev 2026-02-20, pago -) + pago(R$ 600, prev 2026-02-20, pago 2026-01-21)
  - parc 3 / parcela_entrada: cancelado(R$ 1604.4, prev 2026-03-20, pago -) + pago(R$ 1604.4, prev 2026-03-20, pago 2026-03-04)
  - parc 4 / parcela_entrada: pago(R$ 600, prev 2026-04-20, pago 2026-04-07) + cancelado(R$ 1604.4, prev 2026-04-20, pago -)
- **Ação proposta:** aguardar re-baixa de `/bulk-data/v1/income` (quota Sienge esgotou hoje 2026-05-13) → popular `sienge_installment_id` (migration 023) → re-amarrar parcelas pelo id real → cancelar a duplicata redundante.

### Contrato 112 — Sienge 204 — Unidade 1204 B
- **Cliente:** SARA JANE DE OLIVEIRA BARBOSA — CPF 04304256009 — Tel (47)99245-8784
- **Corretor:** -
- **Valor venda:** R$ 431.026,76
- **Pagamentos:** 8 pagos, 54 pendentes, 2 cancelados — 2 pares duplicados, 2 com linha paga
- **Pares duplicados:**
  - parc 1 / parcela_entrada: cancelado(R$ 1000, prev 2025-11-20, pago -) + pago(R$ 1461.11, prev 2025-11-20, pago 2025-11-24)
  - parc 3 / parcela_entrada: cancelado(R$ 1461.11, prev 2026-01-20, pago -) + pago(R$ 1000, prev 2026-01-20, pago 2026-01-21)
- **Ação proposta:** aguardar re-baixa de `/bulk-data/v1/income` (quota Sienge esgotou hoje 2026-05-13) → popular `sienge_installment_id` (migration 023) → re-amarrar parcelas pelo id real → cancelar a duplicata redundante.

### Contrato 246 — Sienge 346 — Unidade 508 A
- **Cliente:** MICHEL CHRISTIAN BORBA — CPF 09786118960 — Tel (47)99713-2318
- **Corretor:** -
- **Valor venda:** R$ 295.289,72
- **Pagamentos:** 7 pagos, 46 pendentes, 1 cancelados — 1 pares duplicados, 1 com linha paga
- **Pares duplicados:**
  - parc 4 / parcela_entrada: cancelado(R$ 1200, prev 2026-07-10, pago -) + pago(R$ 1200, prev 2026-07-10, pago 2026-03-05)
- **Ação proposta:** aguardar re-baixa de `/bulk-data/v1/income` (quota Sienge esgotou hoje 2026-05-13) → popular `sienge_installment_id` (migration 023) → re-amarrar parcelas pelo id real → cancelar a duplicata redundante.

### Contrato 164 — Sienge 256 — Unidade 1406 C
- **Cliente:** WANDERLEY ROSA GUIMARÃES JÚNIOR — CPF 05204505903 — Tel (47)99617-9440
- **Corretor:** -
- **Valor venda:** R$ 431.493,25
- **Pagamentos:** 8 pagos, 50 pendentes, 1 cancelados — 1 pares duplicados, 1 com linha paga
- **Pares duplicados:**
  - parc 1 / parcela_entrada: cancelado(R$ 500, prev 2026-03-20, pago -) + pago(R$ 500, prev 2026-03-20, pago 2026-03-20)
- **Ação proposta:** aguardar re-baixa de `/bulk-data/v1/income` (quota Sienge esgotou hoje 2026-05-13) → popular `sienge_installment_id` (migration 023) → re-amarrar parcelas pelo id real → cancelar a duplicata redundante.

---

## Grupo 2 — Casos sem par pago (risco médio) — podem ser cancelados em massa

0 vendas têm duplicatas apenas em `pendente + cancelado`. Posso manter a linha ativa e marcar a redundante como cancelada com segurança — não afeta nenhum dado financeiro confirmado.

---

## O que fazer agora

**Eu não vou alterar nada no banco ainda.** Esse documento e o JSON `docs/b7-duplicatas-numero-parcela.json` são pra você revisar e me dar o sinal verde caso a caso.

**Resposta esperada por linha:**
- Para Grupo 1: "ok, aguarda re-baixa Sienge" ou "investiga o contrato X primeiro"
- Para Grupo 2: "ok, cancela as redundantes" ou "deixa como está"

Quando você responder, transcrevo em `docs/b7-respostas.json` e rodo a aplicação respeitando as regras de [.claude/rules/sincronizacao-sienge.md](../.claude/rules/sincronizacao-sienge.md).