# Regras de Cálculo de Comissão do Corretor

## REGRA FUNDAMENTAL

A comissão do corretor é calculada **SEMPRE** baseada nos **PAGAMENTOS** (tabela `pagamentos_prosoluto`), **NUNCA** baseado no status da venda.

---

## ❌ O QUE NUNCA FAZER

```javascript
// ERRADO ❌ - Não use o status da venda!
const comissaoPaga = vendas
  .filter(v => v.status === 'pago')
  .reduce((acc, v) => acc + v.comissao_corretor, 0)

// ERRADO ❌ - Não some comissao_corretor direto da venda!
const totalComissao = vendas.reduce((acc, v) => acc + v.comissao_corretor, 0)
```

---

## ✅ O QUE SEMPRE FAZER

```javascript
// CORRETO ✅ - Use os pagamentos individuais!
const comissaoPaga = meusPagamentos
  .filter(pag => pag.status === 'pago')
  .reduce((acc, pag) => acc + calcularComissaoPagamento(pag), 0)

const comissaoPendente = meusPagamentos
  .filter(pag => pag.status === 'pendente')
  .reduce((acc, pag) => acc + calcularComissaoPagamento(pag), 0)

const totalComissao = meusPagamentos
  .reduce((acc, pag) => acc + calcularComissaoPagamento(pag), 0)
```

---

## 📊 FÓRMULA DE COMISSÃO POR PAGAMENTO

```javascript
const calcularComissaoPagamento = (pagamento) => {
  // 1. Usar comissao_gerada se existir
  if (pagamento.comissao_gerada > 0) {
    return pagamento.comissao_gerada
  }

  // 2. Usar fator_comissao_corretor se existir
  if (pagamento.fator_comissao_corretor > 0) {
    return pagamento.valor * pagamento.fator_comissao_corretor
  }

  // 3. Calcular baseado na venda
  const venda = vendas.find(v => v.id === pagamento.venda_id)
  if (venda?.fator_comissao_corretor > 0) {
    return pagamento.valor * venda.fator_comissao_corretor
  }

  // 4. Fallback: proporção simples
  if (venda?.comissao_corretor && venda?.valor_pro_soluto > 0) {
    const fator = venda.comissao_corretor / venda.valor_pro_soluto
    return pagamento.valor * fator
  }

  // 5. Último fallback: percentual padrão
  return pagamento.valor * (percentualCorretor / 100)
}
```

---

## 📍 ONDE APLICAR

| Local | Descrição |
|-------|-----------|
| Dashboard | Cards de resumo (Total, Pago, Pendente) |
| Minhas Vendas | Resumo de comissões filtradas |
| Meus Pagamentos | Resumo de pagamentos |
| Relatórios | Resumo geral e por empreendimento |
| PDF | Geração de relatório PDF |

---

## 🎯 POR QUE ISSO É IMPORTANTE

1. Uma venda pode ter **múltiplos pagamentos** com status diferentes
2. O corretor recebe **por parcela paga**, não por venda fechada
3. O `venda.status` não reflete a realidade dos pagamentos individuais
4. A comissão real é a soma das **parcelas pagas**

---

## 📋 EXEMPLO PRÁTICO

**Venda:** R$ 300.000,00 com 10 parcelas de R$ 6.000,00 cada (pro-soluto R$ 60.000,00)

**Comissão total do corretor:** R$ 12.000,00 (4%)

**Situação atual:**
- 3 parcelas pagas (status: 'pago')
- 7 parcelas pendentes (status: 'pendente')

**Cálculo CORRETO:**
- Comissão Paga: 3 × (R$ 6.000 × fator) = R$ 3.600,00
- Comissão Pendente: 7 × (R$ 6.000 × fator) = R$ 8.400,00

**Cálculo ERRADO (baseado na venda):**
- Se venda.status = 'pendente': Comissão Paga = R$ 0,00 ← ERRADO!
- Deveria mostrar os R$ 3.600,00 já pagos
