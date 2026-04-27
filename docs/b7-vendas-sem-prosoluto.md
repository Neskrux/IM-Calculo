# Vendas com pro-soluto = 0 — confirmação Sienge (Etapa B.1)

Auditoria de 2026-04-27 encontrou **11 vendas** com `valor_pro_soluto = 0` no banco. Inicialmente parecia bug. Validação contra payload Sienge **confirma**: essas vendas legitimamente não têm pro-soluto.

Detalhe: `paymentConditions[]` do `sales-contracts` Sienge não tem `conditionTypeId='PM'` (Parcelas Mensais) em **nenhuma** das 11 — só `PU` (Parcela Única), `PA` (Parcelas Anuais) ou `PE` (Permuta). Pro-soluto é o saldo que entra em parcelas mensais; sem `PM`, não há pro-soluto.

Por isso essas 11 vendas:
- não geram linhas em `pagamentos_prosoluto`
- não aparecem em relatórios de comissão por parcela
- não têm comissão a pagar via cronograma mensal

---

## Grupo A — Parcela única / anual (8 vendas, contratos 275-282, **R$ 4M**)

| Contrato | Sienge ID | Valor | Tipo | Corretor | Cliente |
|----------|-----------|-------|------|----------|---------|
| 275 | 393 | R$ 500.000 | PARCELA UNICA | corretor `770f4e93` | **sem cliente** |
| 276 | 394 | R$ 500.000 | PARCELAS ANUAIS | corretor `770f4e93` | **sem cliente** |
| 277 | 395 | R$ 500.000 | PARCELA UNICA | corretor `770f4e93` | **sem cliente** |
| 278 | 396 | R$ 500.000 | PARCELAS ANUAIS | corretor `770f4e93` | **sem cliente** |
| 279 | 397 | R$ 500.000 | PARCELA UNICA | corretor `770f4e93` | **sem cliente** |
| 280 | 398 | R$ 500.000 | PARCELA UNICA | corretor `770f4e93` | **sem cliente** |
| 281 | 399 | R$ 500.000 | PARCELA UNICA | corretor `770f4e93` | **sem cliente** |
| 282 | 400 | R$ 500.000 | PARCELA UNICA | corretor `770f4e93` | **sem cliente** |

Todos do mesmo corretor (770f4e93). Falta apenas vincular cliente. Será resolvido em **Etapa D** (mapeamento de cliente via raw `customers`).

## Grupo B — Permutas (3 vendas, contratos 300-302, **R$ 1,5M**)

| Contrato | Sienge ID | Valor | Tipo | Corretor | Cliente |
|----------|-----------|-------|------|----------|---------|
| 300 | 433 | R$ 499.437,96 | PERMUTA | **sem corretor** | **sem cliente** |
| 301 | 434 | R$ 494.493,06 | PERMUTA | **sem corretor** | **sem cliente** |
| 302 | 435 | R$ 509.476,67 | PERMUTA | **sem corretor** | **sem cliente** |

Permutas legítimas no Sienge (paid via troca de bens). Sem corretor nem cliente vinculados no banco local — pode ser intencional (permuta interna) ou cadastro incompleto. Decisão da gestora:

1. **"Permuta interna, mantém sem corretor/cliente"** — fica como está, fora do fluxo de comissão.
2. **"Falta cadastro, vou complementar"** — gestora preenche em planilha (formato a definir) e roda script de aplicação.

---

## Resumo

| Grupo | Casos | Ação |
|-------|-------|------|
| A — PU/PA com cliente faltante | 8 | Resolve em Etapa D (mapear cliente via raw) |
| B — Permutas sem cadastro | 3 | **Decisão da gestora** |
| **Total** | **11** | |

⚠️ **Status:** B.1 concluído (validação read-only). Nenhuma mutação no banco. Casos rastreados em `humano_pendente` no relatório.

Referência: [docs/B1-execucao.json](docs/B1-execucao.json)
