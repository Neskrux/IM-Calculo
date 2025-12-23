# Testes: Cálculos de Pro-Soluto

**Data**: 23/12/2025  
**Objetivo**: Documentar todos os cenários de teste para validação dos cálculos de pro-soluto  
**Relacionado a**: Plano de Extração de Cálculos Pro-Soluto

---

## Cenários de Teste para `calcularValorProSoluto`

### Cenário 1: Apenas Sinal

**Dados de entrada**:
```javascript
{
  teve_sinal: true,
  valor_sinal: 10000,
  teve_entrada: false,
  teve_balao: 'nao'
}
gruposParcelasEntrada = []
gruposBalao = []
```

**Cálculo esperado**:
- `valorSinal = 10000`
- `valorEntradaTotal = 0`
- `valorTotalBalao = 0`
- **`valorProSoluto = 10000`**

**Validação**: ✅

---

### Cenário 2: Apenas Entrada à Vista

**Dados de entrada**:
```javascript
{
  teve_sinal: false,
  teve_entrada: true,
  parcelou_entrada: false,
  valor_entrada: 20000,
  teve_balao: 'nao'
}
gruposParcelasEntrada = []
gruposBalao = []
```

**Cálculo esperado**:
- `valorSinal = 0`
- `valorEntradaTotal = 20000`
- `valorTotalBalao = 0`
- **`valorProSoluto = 20000`**

**Validação**: ✅

---

### Cenário 3: Entrada Parcelada (1 grupo)

**Dados de entrada**:
```javascript
{
  teve_sinal: false,
  teve_entrada: true,
  parcelou_entrada: true,
  teve_balao: 'nao'
}
gruposParcelasEntrada = [{qtd: 5, valor: 2000}]
gruposBalao = []
```

**Cálculo esperado**:
- `valorSinal = 0`
- `valorEntradaTotal = 5 * 2000 = 10000`
- `valorTotalBalao = 0`
- **`valorProSoluto = 10000`**

**Validação**: ✅

---

### Cenário 4: Entrada Parcelada (múltiplos grupos)

**Dados de entrada**:
```javascript
{
  teve_sinal: false,
  teve_entrada: true,
  parcelou_entrada: true,
  teve_balao: 'nao'
}
gruposParcelasEntrada = [
  {qtd: 3, valor: 1000},
  {qtd: 2, valor: 2000}
]
gruposBalao = []
```

**Cálculo esperado**:
- `valorSinal = 0`
- `valorEntradaTotal = (3 * 1000) + (2 * 2000) = 3000 + 4000 = 7000`
- `valorTotalBalao = 0`
- **`valorProSoluto = 7000`**

**Validação**: ✅

---

### Cenário 5: Apenas Balões (1 grupo)

**Dados de entrada**:
```javascript
{
  teve_sinal: false,
  teve_entrada: false,
  teve_balao: 'sim'
}
gruposParcelasEntrada = []
gruposBalao = [{qtd: 2, valor: 5000}]
```

**Cálculo esperado**:
- `valorSinal = 0`
- `valorEntradaTotal = 0`
- `valorTotalBalao = 2 * 5000 = 10000`
- **`valorProSoluto = 10000`**

**Validação**: ✅

---

### Cenário 6: Balões (múltiplos grupos)

**Dados de entrada**:
```javascript
{
  teve_sinal: false,
  teve_entrada: false,
  teve_balao: 'sim'
}
gruposParcelasEntrada = []
gruposBalao = [
  {qtd: 1, valor: 10000},
  {qtd: 2, valor: 5000}
]
```

**Cálculo esperado**:
- `valorSinal = 0`
- `valorEntradaTotal = 0`
- `valorTotalBalao = (1 * 10000) + (2 * 5000) = 10000 + 10000 = 20000`
- **`valorProSoluto = 20000`**

**Validação**: ✅

---

### Cenário 7: Sinal + Entrada + Balões (completo)

**Dados de entrada**:
```javascript
{
  teve_sinal: true,
  valor_sinal: 5000,
  teve_entrada: true,
  parcelou_entrada: true,
  teve_balao: 'sim'
}
gruposParcelasEntrada = [{qtd: 4, valor: 2500}]
gruposBalao = [{qtd: 1, valor: 10000}]
```

**Cálculo esperado**:
- `valorSinal = 5000`
- `valorEntradaTotal = 4 * 2500 = 10000`
- `valorTotalBalao = 1 * 10000 = 10000`
- **`valorProSoluto = 5000 + 10000 + 10000 = 25000`**

**Validação**: ✅

---

### Cenário 8: Valores Zero/Nulos

**Dados de entrada**:
```javascript
{
  teve_sinal: false,
  valor_sinal: null,
  teve_entrada: false,
  valor_entrada: 0,
  teve_balao: 'nao'
}
gruposParcelasEntrada = []
gruposBalao = []
```

**Cálculo esperado**:
- `valorSinal = 0`
- `valorEntradaTotal = 0`
- `valorTotalBalao = 0`
- **`valorProSoluto = 0`** (sem erros, sem NaN)

**Validação**: ✅

---

### Cenário 9: Grupos Inválidos (null, undefined, objetos inválidos)

**Dados de entrada**:
```javascript
{
  teve_sinal: false,
  teve_entrada: true,
  parcelou_entrada: true,
  teve_balao: 'sim'
}
gruposParcelasEntrada = [
  {qtd: 3, valor: 1000},
  null,
  undefined,
  {qtd: 'abc', valor: 2000}, // qtd inválido
  {qtd: 2, valor: 'xyz'},     // valor inválido
  {qtd: 1, valor: 500}        // válido
]
gruposBalao = [
  {qtd: 2, valor: 5000},
  null,
  {} // objeto vazio
]
```

**Cálculo esperado**:
- `valorSinal = 0`
- `valorEntradaTotal = (3 * 1000) + (1 * 500) = 3500` (ignora inválidos)
- `valorTotalBalao = (2 * 5000) = 10000` (ignora inválidos)
- **`valorProSoluto = 13500`** (apenas grupos válidos processados)

**Validação**: ✅

---

### Cenário 10: Entrada Parcelada com Campos Simples (compatibilidade)

**Dados de entrada** (formato do banco):
```javascript
{
  teve_sinal: false,
  teve_entrada: true,
  parcelou_entrada: true,
  qtd_parcelas_entrada: 5,
  valor_parcela_entrada: 2000,
  teve_balao: 'nao'
}
gruposParcelasEntrada = [] // vazio (usar campos simples)
gruposBalao = []
```

**Cálculo esperado**:
- `valorSinal = 0`
- `valorEntradaTotal = 5 * 2000 = 10000` (se função suportar campos simples)
- `valorTotalBalao = 0`
- **`valorProSoluto = 10000`**

**Nota**: Função centralizada precisa suportar este formato para compatibilidade com `gerarPagamentosVenda`.

**Validação**: ⚠️ Requer implementação que aceite ambos os formatos

---

## Cenários de Teste para `calcularFatorComissao`

### Cenário 11: Fator de Comissão Normal

**Dados de entrada**:
```javascript
percentualTotal = 7
```

**Cálculo esperado**:
- **`fatorComissao = 7 / 100 = 0.07`**

**Validação**: ✅

---

### Cenário 12: Fator de Comissão Zero

**Dados de entrada**:
```javascript
percentualTotal = 0
```

**Cálculo esperado**:
- **`fatorComissao = 0 / 100 = 0`**

**Validação**: ✅

---

### Cenário 13: Fator de Comissão Decimal

**Dados de entrada**:
```javascript
percentualTotal = 6.5
```

**Cálculo esperado**:
- **`fatorComissao = 6.5 / 100 = 0.065`**

**Validação**: ✅

---

### Cenário 14: Fator de Comissão com Percentual Alto

**Dados de entrada**:
```javascript
percentualTotal = 15
```

**Cálculo esperado**:
- **`fatorComissao = 15 / 100 = 0.15`**

**Validação**: ✅

---

### Cenário 15: Fator de Comissão com Valores Inválidos

**Dados de entrada**:
```javascript
percentualTotal = null
// ou
percentualTotal = undefined
// ou
percentualTotal = NaN
// ou
percentualTotal = 'abc'
```

**Cálculo esperado**:
- **`fatorComissao = 0`** (sem erros, sem NaN)

**Validação**: ✅

---

## Testes de Integração

### Teste 16: Cálculo Completo (valorProSoluto + fatorComissao)

**Dados de entrada**:
```javascript
vendaForm = {
  teve_sinal: true,
  valor_sinal: 10000,
  teve_entrada: true,
  parcelou_entrada: true,
  teve_balao: 'sim'
}
gruposParcelasEntrada = [{qtd: 5, valor: 2000}]
gruposBalao = [{qtd: 2, valor: 5000}]
comissoesDinamicas = { percentualTotal: 7 }
```

**Cálculo esperado**:
- `valorProSoluto = 10000 + (5 * 2000) + (2 * 5000) = 10000 + 10000 + 10000 = 30000`
- `fatorComissao = 7 / 100 = 0.07`
- `comissaoParcela = valorParcela * fatorComissao` (ex: 2000 * 0.07 = 140)

**Validação**: ✅

---

## Checklist de Execução

### Antes de Implementar
- [ ] Todos os cenários documentados
- [ ] Valores esperados calculados manualmente
- [ ] Cenários de erro identificados

### Durante Implementação
- [ ] Testar cada cenário individualmente
- [ ] Validar resultados no console
- [ ] Comparar com implementação antiga

### Após Implementação
- [ ] Todos os 16 cenários passando
- [ ] Nenhum erro ou NaN
- [ ] Valores idênticos à implementação antiga
- [ ] Testes manuais no sistema real

---

**Última atualização**: 23/12/2025  
**Versão**: 1.0


