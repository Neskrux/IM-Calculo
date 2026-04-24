# Regra: Comissão Integral (entrada ≥ 20% NO ATO)

## Regra correta – NUNCA alterar sem alinhamento de negócio

A **comissão integral** (um único registro em `pagamentos_prosoluto` com `tipo: 'comissao_integral'`) só se aplica quando:

1. **O percentual da entrada é ≥ 20%** do valor da venda:
   `(sinal + entrada) / valor_venda * 100 >= 20`
2. **E** esse valor foi pago **NO ATO** (à vista), **não parcelado**.

Se a entrada for **parcelada** (ex.: 52x de R$ 2.076,57), mesmo que o total supere 20%, **não** se aplica a comissão integral. Nesse caso o sistema deve gerar uma linha por parcela (`parcela_entrada`) normalmente.

---

## Resumo

| Situação | Gera comissão integral? |
|----------|-------------------------|
| Entrada ≥ 20% e **paga à vista** (não parcelou) | ✅ Sim – 1 registro `comissao_integral` |
| Entrada ≥ 20% mas **parcelada** (ex.: 52x) | ❌ Não – gera cada `parcela_entrada` |
| Entrada < 20% | ❌ Não – gera sinal/entrada/parcelas/balões normalmente |

---

## Implementação no código

```javascript
// CORRETO ✅ – Só comissão integral quando 20% no ato
const percentualEntrada = valorVenda > 0 ? (valorEntradaParaCalculo / valorVenda) * 100 : 0
const entradaNoAto = !parcelou_entrada  // true = entrada à vista ou só sinal
const aplicarComissaoIntegral = percentualEntrada >= 20 && entradaNoAto

if (aplicarComissaoIntegral) {
  // Gerar 1 registro tipo 'comissao_integral'
} else {
  // Gerar parcelas normalmente (sinal, entrada, parcela_entrada, balão)
}
```

```javascript
// ERRADO ❌ – Não usar só percentual
const entradaMaiorOuIgual20 = percentualEntrada >= 20  // ignora se foi parcelado
```

---

## Onde a regra é usada

- **AdminDashboard.jsx**: ao salvar/editar venda (recriar pagamentos) e ao "Gerar pagamentos" para venda existente. Sempre usar `parcelou_entrada` da venda/form para decidir "no ato".
