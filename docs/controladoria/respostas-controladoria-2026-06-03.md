---
status: respostas da controladoria (THAI) — recebidas conforme chegam
data_inicio: 2026-06-03
fonte_perguntas: docs/controladoria/conferencia-sienge-2026-06-02.xlsx + textos enviados
---

# Respostas da controladoria — conferência IM × Sienge

> Registra o que a controladoria respondeu. Decisão/ação fica "a mapear" — não executar sem
> alinhamento. Princípio: a resposta dela orienta, mas cruzamos com o Sienge antes de aplicar.

## ✅ Recebidas

### Vendas manuais sem contrato (enviadas por texto)

| Caso | Cliente / CPF | Unid | Resposta dela | Significado | Ação (a mapear) |
|------|---------------|------|---------------|-------------|------------------|
| **412** | GABRIEL ADRIANO GOMES · 126.241.199-81 | 412 | **Distrato** — não pagou nenhuma parcela e pediu distrato | Venda real, distratada. 0 parcelas pagas. | Encerrar a venda manual (marcar distrato / soft-delete — 0 pagas, sem risco). Confirmar se há contrato no Sienge pro distrato. |
| **606** | GUSTAVO HENRIQUE DA CUNHA · 118.163.869-01 | 606 | **Reparcelamento** — existe no Sienge; cliente mudou a 1ª parcela pra **junho**. **Contrato 305 / código 451** | Venda real, existe no Sienge (contrato 305, possível reemissão/código 451), reparcelada. | Vincular a venda manual ao contrato real do Sienge (c305 / 451); ajustar cronograma (1ª parcela junho). **Não excluir.** Investigar relação c305↔451 (reemissão?). |

**Nota:** ambas as respostas batem com o mapeamento prévio (eram "vendas reais sem contrato Sienge").
A 412 vira distrato; a 606 vira vínculo+reparcelamento. Detalhamento técnico fica pra rodada futura.

## ⏳ Aguardando resposta (planilha `conferencia-sienge-2026-06-02.xlsx`)

| Aba | Tema | Qtd |
|-----|------|-----|
| 1 | Parcelas a conferir (existe no Sienge? pago?) — b9 | 59 |
| 2 | Saldo devedor (pró-soluto) divergente — b10 | 28 |
| 3 | Distratos a confirmar | 25 |
| 4 | Em análise interna (duplicidade) — informativo | 6 |
