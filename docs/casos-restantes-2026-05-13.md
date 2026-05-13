# Casos restantes — diagnóstico (2026-05-13)

Análise dos 38 casos que não foram corrigidos pelo cron automático.

---

## Grupo A — Drifts > 365 dias (19 parcelas)

Vendas afetadas: 5. Cruzando com a rodada b7 (11 vendas com duplicata):

### ✅ Contrato 177 — Sienge 269 — Unidade 609 D (já está na rodada b7)
- **Cliente:** DIEGO RAMOS
- **Parcelas afetadas:** 11
  - parc 1 (pago): local=`2030-07-10` Sienge=`2028-01-10` drift=-912d valor=R$ 1600
  - parc 4 (pendente): local=`2030-10-10` Sienge=`2028-04-10` drift=-913d valor=R$ 1600
  - parc 6 (pago): local=`2030-12-10` Sienge=`2029-06-10` drift=-548d valor=R$ 2200
  - parc 3 (pendente): local=`2030-09-10` Sienge=`2029-03-10` drift=-549d valor=R$ 2200
  - parc 6 (pendente): local=`2030-12-10` Sienge=`2028-06-10` drift=-913d valor=R$ 1600
  - parc 4 (pendente): local=`2030-10-10` Sienge=`2028-10-10` drift=-730d valor=R$ 1900
  - parc 3 (pendente): local=`2030-09-10` Sienge=`2028-03-10` drift=-914d valor=R$ 1600
  - parc 4 (pendente): local=`2030-10-10` Sienge=`2029-04-10` drift=-548d valor=R$ 2200
  - parc 3 (pendente): local=`2030-09-10` Sienge=`2028-09-10` drift=-730d valor=R$ 1900
  - parc 6 (pendente): local=`2030-12-10` Sienge=`2029-06-10` drift=-548d valor=R$ 2200
  - parc 6 (pendente): local=`2030-12-10` Sienge=`2028-12-10` drift=-730d valor=R$ 1900

### ⚠️ Contrato 195 — Sienge 287 — Unidade 1004 D (NÃO está na b7 — investigar separado)
- **Cliente:** FERNANDA DOS SANTOS DE ALMEIDA
- **Parcelas afetadas:** 2
  - parc 1 (pago): local=`2026-09-20` Sienge=`2025-07-20` drift=-427d valor=R$ 800
  - parc 2 (pago): local=`2026-10-20` Sienge=`2025-08-20` drift=-426d valor=R$ 800

### ✅ Contrato 183 — Sienge 275 — Unidade 803 D (já está na rodada b7)
- **Cliente:** SAMUEL MUELLER LEMOS
- **Parcelas afetadas:** 4
  - parc 19 (pendente): local=`2028-11-10` Sienge=`2027-04-10` drift=-580d valor=R$ 2650
  - parc 11 (pendente): local=`2028-03-10` Sienge=`2026-08-10` drift=-578d valor=R$ 2650
  - parc 18 (pendente): local=`2028-10-10` Sienge=`2027-03-10` drift=-580d valor=R$ 2650
  - parc 14 (pendente): local=`2028-06-10` Sienge=`2026-11-10` drift=-578d valor=R$ 2650

### ⚠️ Contrato 75 — Sienge 165 — Unidade 1606 A (NÃO está na b7 — investigar separado)
- **Cliente:** MARIANE GOES DA SILVA GOMES
- **Parcelas afetadas:** 1
  - parc 1 (pago): local=`2025-07-20` Sienge=`2030-06-20` drift=1796d valor=R$ 1397.33

### ⚠️ Contrato 7 — Sienge 8 — Unidade 404 A (NÃO está na b7 — investigar separado)
- **Cliente:** ANDRESSA THAYS MELO
- **Parcelas afetadas:** 1
  - parc 1 (pago): local=`2025-05-20` Sienge=`2030-05-20` drift=1826d valor=R$ 1016.67

**Sobreposição com rodada b7:** 2/5 vendas. Há casos NOVOS fora da b7.

---

## Grupo B — Sem-match no Sienge (19 parcelas)

Vendas afetadas: 2. Parcelas locais que **não têm correspondente** no `/bulk-data/v1/income`.

Hipóteses possíveis:
- Parcela criada pelo gerador antigo a mais do que o Sienge tem.
- Parcela cujo `numero_parcela` local não bate com o `installmentNumber` Sienge (re-numeração).
- Parcela cancelada no Sienge mas ainda viva localmente.

### ⚠️ Contrato 195 — Sienge 287 — Unidade 1004 D (NOVO caso)
- **Cliente:** FERNANDA DOS SANTOS DE ALMEIDA
- **Parcelas sem match:** 14
  - parc 50 (status=?): data_prevista_local=`2029-08-20` bill_id=268 | zero matches no Sienge
  - parc 54 (status=?): data_prevista_local=`2029-12-20` bill_id=268 | zero matches no Sienge
  - parc 52 (status=?): data_prevista_local=`2029-10-20` bill_id=268 | zero matches no Sienge
  - parc 47 (status=?): data_prevista_local=`2029-05-20` bill_id=268 | zero matches no Sienge
  - parc 53 (status=?): data_prevista_local=`2029-11-20` bill_id=268 | zero matches no Sienge
  - parc 48 (status=?): data_prevista_local=`2029-06-20` bill_id=268 | zero matches no Sienge
  - parc 51 (status=?): data_prevista_local=`2029-09-20` bill_id=268 | zero matches no Sienge
  - parc 49 (status=?): data_prevista_local=`2029-07-20` bill_id=268 | zero matches no Sienge
  - parc 56 (status=?): data_prevista_local=`2030-02-20` bill_id=268 | zero matches no Sienge
  - parc 58 (status=?): data_prevista_local=`2030-04-20` bill_id=268 | zero matches no Sienge
  - parc 59 (status=?): data_prevista_local=`2030-05-20` bill_id=268 | zero matches no Sienge
  - parc 57 (status=?): data_prevista_local=`2030-03-20` bill_id=268 | zero matches no Sienge
  - parc 55 (status=?): data_prevista_local=`2030-01-20` bill_id=268 | zero matches no Sienge
  - parc 60 (status=?): data_prevista_local=`2030-06-20` bill_id=268 | zero matches no Sienge

### ⚠️ Contrato 243 — Sienge 340 — Unidade 905 B (NOVO caso)
- **Cliente:** CAROLINE SARAIVA DA SILVEIRA RODRIGUES 
- **Parcelas sem match:** 5
  - parc 60 (status=?): data_prevista_local=`2030-05-26` bill_id=410 | zero matches no Sienge
  - parc 56 (status=?): data_prevista_local=`2030-01-26` bill_id=410 | zero matches no Sienge
  - parc 58 (status=?): data_prevista_local=`2030-03-26` bill_id=410 | zero matches no Sienge
  - parc 59 (status=?): data_prevista_local=`2030-04-26` bill_id=410 | zero matches no Sienge
  - parc 57 (status=?): data_prevista_local=`2030-02-26` bill_id=410 | zero matches no Sienge

**Sobreposição com rodada b7:** 0/2.

---

## Conclusão

- 2 dos 38 casos já estão cobertos pela rodada b7 (vão ser resolvidos quando a quota Sienge voltar + migration 023 aplicada).
- 5 casos NOVOS, fora da b7 — precisam ser adicionados à fila de revisão.

### Recomendação

Casos novos detectados (5). Sugiro:
1. Estender rodada b7 com esses casos novos.
2. Investigar caso a caso o motivo do drift gigante (re-numeração? regeneração antiga?).