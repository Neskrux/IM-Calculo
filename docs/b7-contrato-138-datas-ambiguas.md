# Contrato 138 — datas duplicadas, decisão ambígua (Etapa B.3)

## O caso

Venda `c6100456-03b1-44a9-8f1b-c47dd16997ad` — contrato 138, sienge `230`, unidade 906 C — tem 58 parcelas de R$ 1.348,27 (`tipo='parcela_entrada'`). Mas há **8 parcelas duplicando datas**:

| numero_parcela | data_prevista (atual) | colide com |
|----------------|------------------------|------------|
| 21 | 2027-04-10 | parcela 13 |
| 22 | 2027-05-10 | parcela 14 |
| 23 | 2027-06-10 | parcela 15 |
| 24 | 2027-07-10 | parcela 16 |
| 25 | 2027-08-10 | parcela 17 |
| 26 | 2027-09-10 | parcela 18 |
| 27 | 2027-10-10 | parcela 19 |
| 28 | 2027-11-10 | parcela 20 |

Sequência geral:
- 1-8 → abr/26 a nov/26 (todas pagas)
- 9-20 → dez/26 a nov/27 ✓
- **21-28 → abr/27 a nov/27 ⚠️ duplicadas com 13-20**
- 29-58 → dez/27 a mai/30 ✓

`valor_pro_soluto` no banco = R$ 78.199,66 = exatamente 58 × R$ 1.348,27.

## ⚠️ Hipóteses possíveis (precisa Sienge pra confirmar)

### Hipótese A — São 50 parcelas reais (21-28 são lixo)
Bug do gerador antigo criou 8 duplicadas. O cronograma real do Sienge é 50 parcelas (1-20 + renumera 29-58 → 21-50). Pro-soluto correto = 50 × R$ 1.348,27 = R$ 67.413,50 (não R$ 78.199,66 atual).
**Ação:** marcar 21-28 como `cancelado` + atualizar `valor_pro_soluto` da venda.

### Hipótese B — São 58 parcelas, mas datas das 21-28 estão erradas
Cronograma real do Sienge tem 58 parcelas; as datas 21-28 deveriam continuar a sequência depois de 58. **Ação:** UPDATE 21-28 → jun/30 a jan/31 (depois de mai/30 atual da parcela 58). Pro-soluto fica R$ 78.199,66.

### Hipótese C — Outra coisa
Renegociação no Sienge mudou estrutura; precisa olhar histórico.

## ⚠️ Bloqueio spec

Spec `.claude/rules/sincronizacao-sienge.md` (FASE 0.1c) diz: "mudança de `data_prevista` em pago > 30 dias requer revisão humana". Aqui são todas pendentes (liberado), mas a magnitude (3 anos de deslocamento ou cancelamento) é grande demais pra decisão mecânica sem confirmar via Sienge.

## Opção sugerida

Quando o sync de **Etapa C.1** (probe `/accounts-receivable/receivable-bills/{billId}/commissions`) for testado, **aproveitar pra GET o cronograma real desse contrato** via `/accounts-receivable/receivable-bills/{billId}/installments`. Isso confirma se são 50 ou 58 parcelas reais. Aí decide A vs B com dado.

Enquanto isso: contrato 138 fica como está. Não bloqueia financeiro do cliente — todas as 8 duplicadas estão pendentes, e como `valor_pro_soluto` casa com 58 parcelas, a comissão total do cliente está coerente. O bug é só visual (datas repetidas no cronograma).

## Cliente

- **João Pedro Marasca** (sienge customer 92)
- Tel: (47) 99670-3160
- CPF: 09762700916

Referência: [docs/B3-execucao.json](docs/B3-execucao.json)
