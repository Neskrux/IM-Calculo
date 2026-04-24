# Regras de Cálculo do Fator de Comissão

## REGRA FUNDAMENTAL - NUNCA VIOLAR

O cálculo de comissão **NÃO** é aplicado diretamente sobre a parcela.
É necessário calcular o **FATOR** usando o pro-soluto como divisor.

---

## 📊 FÓRMULAS OBRIGATÓRIAS

### 1. FATOR DE COMISSÃO TOTAL

```javascript
// CORRETO ✅
const fatorComissaoTotal = (valorTotalVenda * percentualTotalComissao) / valorProSolutoTotal

// Exemplo:
// fatorComissaoTotal = (292.366,06 × 0,07) / 69.804,18 = 0,2932 = 29,32%
```

### 2. FATOR POR CARGO

```javascript
// CORRETO ✅
const fatorCargo = (valorTotalVenda * percentualCargo) / valorProSolutoTotal

// Exemplo (Corretor 4%):
// fatorCorretor = (292.366,06 × 0,04) / 69.804,18 = 0,1675 = 16,75%
```

### 3. COMISSÃO POR PARCELA

```javascript
// CORRETO ✅
const comissaoParcela = valorParcela * fatorCargo

// Exemplo:
// comissaoCorretor = 1.292,67 × 0,1675 = R$ 216,52
```

---

## ❌ O QUE NUNCA FAZER

```javascript
// ERRADO ❌ - Não aplique percentual diretamente na parcela!
const comissaoErrada = valorParcela * (percentualCargo / 100)
// 1.292,67 × 0,04 = R$ 51,71 ← ERRADO!
```

---

## 📋 LÓGICA EXPLICADA

| Variável | Fórmula |
|----------|---------|
| `fatorTotal` | `(valorVenda × percentualTotal) / proSoluto` |
| `fatorCargo` | `(valorVenda × percentualCargo) / proSoluto` |
| `comissaoParcela` | `valorParcela × fatorCargo` |

---

## 🎯 POR QUE ISSO FUNCIONA

A comissão é calculada sobre o **VALOR TOTAL DA VENDA**, mas o pagamento é feito sobre o **PRO-SOLUTO**.

O **FATOR** faz a conversão entre esses dois mundos:
- Para cada R$ 1,00 de pro-soluto pago, qual é a comissão correspondente?

---

## 📍 EXEMPLO COMPLETO (FIGUEIRA GARCIA)

**Dados da Venda:**
- Valor Total: R$ 292.366,06
- Pro-Soluto: R$ 69.804,18 (54 parcelas de R$ 1.292,67)
- Comissão Total: 7% (soma dos cargos)

**Cargos e seus fatores:**
| Cargo | % | Fator | Comissão/Parcela | Total 54 Parcelas |
|-------|---|-------|------------------|-------------------|
| Corretor | 4,00% | 0,1675 | R$ 216,52 | R$ 11.692,08 |
| Diretor | 0,50% | 0,0209 | R$ 27,02 | R$ 1.459,08 |
| Nohros | 0,50% | 0,0209 | R$ 27,02 | R$ 1.459,08 |
| Ferretti | 1,00% | 0,0419 | R$ 54,16 | R$ 2.924,64 |
| Beton | 0,50% | 0,0209 | R$ 27,02 | R$ 1.459,08 |
| Coordenadora | 0,50% | 0,0209 | R$ 27,02 | R$ 1.459,08 |
| **TOTAL** | **7,00%** | **0,2932** | **R$ 379,03** | **R$ 20.467,62** |

---

## 🔧 ONDE APLICAR NO CÓDIGO

1. **`syncVendasV2.js`** - Ao criar pagamentos pro-soluto
2. **`AdminDashboard.jsx`** - Ao calcular comissões dinâmicas
3. **`ImportarVendas.jsx`** - Ao importar vendas manualmente
4. **`CorretorDashboard.jsx`** - Ao exibir comissões do corretor

---

## ⚠️ VALIDAÇÃO

Sempre validar que:
```javascript
// A soma das comissões por cargo deve ser igual à comissão total
const somaComissoesCargos = cargos.reduce((acc, c) => acc + comissaoPorCargo[c], 0)
const comissaoTotal = valorParcela * fatorTotal
// somaComissoesCargos === comissaoTotal (com tolerância de centavos)
```

---

## 📝 RESUMO

```
FATOR = (VALOR_VENDA × PERCENTUAL) / PRO_SOLUTO
COMISSÃO = PARCELA × FATOR
```

**Esta é a única fórmula correta. Qualquer outra está ERRADA.**

---

## 🔄 VERSIONAMENTO DE PERCENTUAIS

### Alteração de Percentuais

Quando um percentual é alterado:

1. **Vendas antigas** → Usam o percentual **do momento da criação** (snapshot em `comissoes_venda`)
2. **Vendas novas** → Usam o percentual **atual** de `cargos_empreendimento`
3. **Histórico** → Registrado automaticamente em `cargos_empreendimento_historico`

### Tabelas Envolvidas

| Tabela | Propósito |
|--------|-----------|
| `cargos_empreendimento` | Percentuais ATUAIS |
| `cargos_empreendimento_historico` | Log de alterações |
| `comissoes_venda` | Snapshot por venda (imutável) |
| `pagamentos_prosoluto.fator_comissao_aplicado` | Fator usado no pagamento |

### Regra de Ouro

> **NUNCA recalcule comissões de vendas antigas ao alterar percentuais.**
>
> Use sempre o `fator_comissao_aplicado` salvo em `pagamentos_prosoluto`.
