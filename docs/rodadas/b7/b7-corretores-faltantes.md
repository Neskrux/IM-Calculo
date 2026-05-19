# Corretores faltantes — vendas sem `corretor_id` (Etapa C)

## Conclusão da investigação automática

O Sienge **não expõe** endpoint de comissões/corretores para essas vendas:
- `/accounts-receivable/receivable-bills/{billId}/commissions` → 404
- `/accounts-receivable/receivable-bills/{billId}` → 403 (Permission denied)
- `/sales-contracts/{id}/commissions` → 404
- `/sales-contracts/{id}/brokers` / `/salesmen` / `/salespeople` → 404
- `/commissions?receivableBillId=` → 403
- `/commissions/{id}` → 404
- `/sales-contracts/{id}/sales-team` → 404

**Único endpoint útil**: `/sales-contracts/{id}` (GET 200), mas `linkedCommissions` está **`null` em TODAS as 13 vendas testadas** (12 retornaram 200 + 1 retornou 404 — o contrato 144/sienge 236 do b6 grupo 3).

Conclusão: **não há fonte automatizada disponível**. Gestora precisa preencher manualmente.

## 13 vendas pra gestora vincular corretor

Todas do empreendimento **FIGUEIRA GARCIA**.

| # | Contrato | Sienge | Unidade | Cliente | Data Contrato | Valor |
|---|----------|--------|---------|---------|---------------|-------|
| 1 | 35 | 75 | 902 A | RICARDO JOSÉ GIRARD | 2025-05-22 | R$ 390.993,15 |
| 2 | 37 | 79 | 904 A | BRYAN LUCAS MACCALLI | 2025-06-04 | R$ 418.341,97 |
| 3 | 71 | 161 | 1506 A | LUCAS PORTO MARTINS | 2025-06-16 | R$ 310.250,00 |
| 4 | 84 | 174 | 1806 A | ALEX WILLIAN BERNARDES | 2025-05-09 | R$ 388.744,70 |
| 5 | 86 | 176 | 403 B | MILENA PAULA NASCIMENTO SANTOS | 2025-06-02 | R$ 310.442,00 |
| 6 | 121 | 213 | 503 C | ANTONIO DOS SANTOS ESTEVÃO | 2025-05-22 | R$ 313.546,14 |
| 7 | 144 | 236 | 1007 C | CLAUDIO MARTIRE | 2025-05-16 | R$ 384.110,14 |
| 8 | 202 | 294 | 1201 D | ANNE MAYARA BRANCO VIEIRA | 2025-05-06 | R$ 356.209,78 |
| 9 | 273 | 390 | 1008 C | CLAUDIO MARTIRE | 2025-05-16 | R$ 384.110,14 |
| 10 | 287 | 411 | 603 B | CAYO KAMENAC RAMOS DA SILVA | 2026-02-09 | R$ 426.900,16 |
| 11 | 300 | 433 | 1008 D | FERRETTI CONSULTORIA E INVESTIMENTOS LTDA | 2026-03-24 | R$ 499.437,96 |
| 12 | 301 | 434 | 908 D | FERRETTI CONSULTORIA E INVESTIMENTOS LTDA | 2026-03-23 | R$ 494.493,06 |
| 13 | 302 | 435 | 1208 A | FERRETTI CONSULTORIA E INVESTIMENTOS LTDA | 2026-03-24 | R$ 509.476,67 |

⚠️ **Contrato 144 (sienge 236)** — já mapeado no b6 grupo 3 ("contrato 144 sem par no Sienge"). Aguarda decisão sobre o contrato inteiro antes de pensar em corretor.

⚠️ **Contratos 300/301/302** — vendas via permuta (b7 já mapeado em `b7-vendas-sem-prosoluto.md` Grupo B). Pode ser que não tenham corretor mesmo (permuta interna).

## Ação esperada

Preencher uma tabela como abaixo e voltar pra mim:

```
sienge_contract_id, broker_email_ou_nome
75,                 [nome ou email do corretor que fechou]
79,                 ...
...
```

Se algum contrato realmente não tem corretor (caso permuta interna): escrever `SEM_CORRETOR` na linha. Vai pro humano_pendente permanente.

Após resposta, rodo script de aplicação (formato regra `.claude/rules/rodadas-b.md`) que faz UPDATE com `corretor_id_origem='manual'` (protegido contra sobrescrita por sync futuro, conforme migration 021).

Referência: [docs/C-execucao.json](docs/C-execucao.json), [docs/C1-probe-commissions-75.json](docs/C1-probe-commissions-75.json), [docs/C1b-probe-multi-contracts.json](docs/C1b-probe-multi-contracts.json)
