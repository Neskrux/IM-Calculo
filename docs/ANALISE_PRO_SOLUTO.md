# Análise: Implementações de Cálculos Pro-Soluto

**Data**: 23/12/2025  
**Objetivo**: Mapear todas as implementações atuais de `valorProSoluto` e `fatorComissao`  
**Relacionado a**: Plano de Extração de Cálculos Pro-Soluto

---

## 1. Cálculo de `valorProSoluto`

### 1.1 Implementação 1: `AdminDashboard.jsx` - `handleSaveVenda` (Linha ~836)

**Localização**: `src/pages/AdminDashboard.jsx` linha ~808-836

**Contexto**: Função chamada ao salvar/criar uma venda no formulário

**Código atual**:
```javascript
// Calcular valor pro-soluto e fator de comissão
const valorSinal = vendaForm.teve_sinal ? (parseFloat(vendaForm.valor_sinal) || 0) : 0

// Entrada: se parcelou, soma todos os grupos. Se não parcelou, usa valor_entrada
let valorEntradaTotal = 0
if (vendaForm.teve_entrada) {
  if (vendaForm.parcelou_entrada) {
    // Soma todos os grupos: cada grupo = qtd × valor (apenas grupos válidos)
    valorEntradaTotal = gruposParcelasEntrada.reduce((sum, grupo) => {
      // Garantir que grupo é um objeto válido
      if (!grupo || typeof grupo !== 'object' || grupo === null) return sum
      return sum + ((parseFloat(grupo.qtd) || 0) * (parseFloat(grupo.valor) || 0))
    }, 0)
  } else {
    valorEntradaTotal = parseFloat(vendaForm.valor_entrada) || 0
  }
}

// Balões: soma todos os grupos (apenas grupos válidos)
let valorTotalBalao = 0
if (vendaForm.teve_balao === 'sim') {
  valorTotalBalao = gruposBalao.reduce((sum, grupo) => {
    // Garantir que grupo é um objeto válido
    if (!grupo || typeof grupo !== 'object' || grupo === null) return sum
    return sum + ((parseFloat(grupo.qtd) || 0) * (parseFloat(grupo.valor) || 0))
  }, 0)
}

// Pro-soluto = sinal + entrada + balões
const valorProSoluto = valorSinal + valorEntradaTotal + valorTotalBalao
```

**Características**:
- ✅ Usa `parseFloat` em todos os cálculos
- ✅ Valida grupos antes de processar (verifica se é objeto válido)
- ✅ Suporta múltiplos grupos de parcelas e balões
- ✅ Usa `gruposParcelasEntrada` e `gruposBalao` (arrays de objetos `{qtd, valor}`)
- ✅ Tratamento defensivo de valores nulos/undefined

**Fórmula**: `valorProSoluto = valorSinal + valorEntradaTotal + valorTotalBalao`

**Cenários de uso**:
- Criar nova venda via formulário
- Editar venda existente
- Quando usuário preenche formulário com grupos de parcelas/balões

---

### 1.2 Implementação 2: `AdminDashboard.jsx` - `gerarPagamentosVenda` (Linha ~1576)

**Localização**: `src/pages/AdminDashboard.jsx` linha ~1561-1576

**Contexto**: Função chamada ao gerar pagamentos pro-soluto para uma venda existente

**Código atual**:
```javascript
const valorSinal = venda.teve_sinal ? (parseFloat(venda.valor_sinal) || 0) : 0

let valorEntradaTotal = 0
if (venda.teve_entrada) {
  if (venda.parcelou_entrada) {
    valorEntradaTotal = (parseFloat(venda.qtd_parcelas_entrada) || 0) * (parseFloat(venda.valor_parcela_entrada) || 0)
  } else {
    valorEntradaTotal = parseFloat(venda.valor_entrada) || 0
  }
}

const valorTotalBalao = venda.teve_balao === 'sim' 
  ? (parseFloat(venda.qtd_balao) || 0) * (parseFloat(venda.valor_balao) || 0)
  : 0

const valorProSoluto = valorSinal + valorEntradaTotal + valorTotalBalao
```

**Características**:
- ✅ Usa `parseFloat` em todos os cálculos
- ❌ **NÃO suporta múltiplos grupos** - usa campos simples do banco
- ❌ Usa `qtd_parcelas_entrada` e `valor_parcela_entrada` (campos únicos)
- ❌ Usa `qtd_balao` e `valor_balao` (campos únicos)
- ⚠️ **INCONSISTÊNCIA**: Diferente da implementação 1.1 (usa grupos vs campos simples)

**Fórmula**: `valorProSoluto = valorSinal + valorEntradaTotal + valorTotalBalao`

**Cenários de uso**:
- Gerar pagamentos para venda existente no banco
- Quando venda já foi salva e dados estão no formato do banco (campos simples)

---

### 1.3 Implementação 3: `ImportarVendas.jsx` (Linha ~672)

**Localização**: `src/components/ImportarVendas.jsx` linha ~672

**Contexto**: Função chamada ao importar vendas via arquivo Excel

**Código atual**:
```javascript
// 8. Calcular pro-soluto e fator de comissão
const valorProSoluto = valorSinal + (qtdParcelas * valorParcela) + (qtdBalao * valorBalao)
```

**Características**:
- ✅ Cálculo direto e simples
- ❌ **NÃO suporta múltiplos grupos** - usa campos simples
- ❌ Usa variáveis `qtdParcelas`, `valorParcela`, `qtdBalao`, `valorBalao` (valores únicos)
- ⚠️ **INCONSISTÊNCIA**: Diferente da implementação 1.1

**Fórmula**: `valorProSoluto = valorSinal + (qtdParcelas * valorParcela) + (qtdBalao * valorBalao)`

**Cenários de uso**:
- Importar vendas via arquivo Excel
- Quando dados vêm de planilha (formato simples)

---

## 2. Cálculo de `fatorComissao`

### 2.1 Implementação 1: `AdminDashboard.jsx` - `handleSaveVenda` (Linha ~840)

**Localização**: `src/pages/AdminDashboard.jsx` linha ~840

**Código atual**:
```javascript
// Fator de comissão = Percentual total de comissão / 100
// Ex: 7% -> 0.07, então parcela de R$ 1.000 x 0.07 = R$ 70 de comissão
const fatorComissao = comissoesDinamicas.percentualTotal / 100
```

**Características**:
- ✅ Cálculo simples e direto
- ✅ Usa `comissoesDinamicas.percentualTotal` (já calculado)
- ⚠️ Não valida se `percentualTotal` é null/undefined/NaN

**Fórmula**: `fatorComissao = percentualTotal / 100`

---

### 2.2 Implementação 2: `AdminDashboard.jsx` - `gerarPagamentosVenda` (Linha ~1578)

**Localização**: `src/pages/AdminDashboard.jsx` linha ~1578

**Código atual**:
```javascript
// Fator de comissão = Percentual total / 100
const fatorComissao = comissoesDinamicas.percentualTotal / 100
```

**Características**:
- ✅ Idêntico à implementação 2.1
- ⚠️ Não valida se `percentualTotal` é null/undefined/NaN

**Fórmula**: `fatorComissao = percentualTotal / 100`

---

### 2.3 Implementação 3: `ImportarVendas.jsx` (Linha ~692)

**Localização**: `src/components/ImportarVendas.jsx` linha ~692

**Código atual**:
```javascript
// Fator de comissão = percentual total de comissão / 100
// Ex: 7% -> 0.07, então parcela de R$ 1.000 x 0.07 = R$ 70 de comissão
const fatorComissao = comissoesDinamicas.percentualTotal / 100
```

**Características**:
- ✅ Idêntico às implementações 2.1 e 2.2
- ⚠️ Não valida se `percentualTotal` é null/undefined/NaN

**Fórmula**: `fatorComissao = percentualTotal / 100`

---

### 2.4 Implementação 4: `AdminDashboard.jsx` - `calcularComissaoPorCargoPagamento` (Linha ~389)

**Localização**: `src/pages/AdminDashboard.jsx` linha ~389

**Código atual**:
```javascript
// Se não houver comissao_gerada salva, calcular usando o percentual total de comissão
if (comissaoTotalParcela === 0) {
  // Calcular percentual total dos cargos
  const percentualTotal = cargosDoTipo.reduce((acc, c) => acc + (parseFloat(c.percentual) || 0), 0)
  const fatorComissao = percentualTotal / 100
  comissaoTotalParcela = valorPagamento * fatorComissao
}
```

**Características**:
- ✅ Calcula `percentualTotal` localmente (não usa `comissoesDinamicas`)
- ✅ Usa `parseFloat` para calcular percentual total
- ⚠️ Não valida se resultado é NaN

**Fórmula**: `fatorComissao = percentualTotal / 100` (onde `percentualTotal` é calculado localmente)

---

## 3. Diferenças Identificadas

### 3.1 Cálculo de Entrada Parcelada

**Implementação 1.1 (handleSaveVenda)**:
- Usa `gruposParcelasEntrada` (array de objetos `{qtd, valor}`)
- Suporta múltiplos grupos
- Valida cada grupo antes de processar
- Fórmula: `sum(grupo.qtd * grupo.valor)` para cada grupo válido

**Implementação 1.2 (gerarPagamentosVenda)**:
- Usa `qtd_parcelas_entrada` e `valor_parcela_entrada` (campos únicos do banco)
- Não suporta múltiplos grupos
- Fórmula: `qtd_parcelas_entrada * valor_parcela_entrada`

**Implementação 1.3 (ImportarVendas)**:
- Usa `qtdParcelas` e `valorParcela` (variáveis únicas)
- Não suporta múltiplos grupos
- Fórmula: `qtdParcelas * valorParcela`

**⚠️ RISCO**: Implementação 1.1 é mais robusta e suporta múltiplos grupos, mas 1.2 e 1.3 não. Isso pode causar inconsistências.

---

### 3.2 Cálculo de Balões

**Implementação 1.1 (handleSaveVenda)**:
- Usa `gruposBalao` (array de objetos `{qtd, valor}`)
- Suporta múltiplos grupos
- Valida cada grupo antes de processar
- Fórmula: `sum(grupo.qtd * grupo.valor)` para cada grupo válido

**Implementação 1.2 (gerarPagamentosVenda)**:
- Usa `qtd_balao` e `valor_balao` (campos únicos do banco)
- Não suporta múltiplos grupos
- Fórmula: `qtd_balao * valor_balao`

**Implementação 1.3 (ImportarVendas)**:
- Usa `qtdBalao` e `valorBalao` (variáveis únicas)
- Não suporta múltiplos grupos
- Fórmula: `qtdBalao * valorBalao`

**⚠️ RISCO**: Mesma inconsistência da entrada parcelada.

---

### 3.3 Cálculo de Fator de Comissão

**Todas as implementações**:
- Fórmula idêntica: `percentualTotal / 100`
- ⚠️ Nenhuma valida se `percentualTotal` é null/undefined/NaN
- ⚠️ Pode retornar `NaN` se `percentualTotal` for inválido

**Recomendação**: Adicionar validação defensiva.

---

## 4. Cenários de Uso

### 4.1 `handleSaveVenda` (Implementação 1.1)
- **Quando**: Usuário cria/edita venda via formulário
- **Dados**: `vendaForm` com `grupos_parcelas_entrada` e `grupos_balao`
- **Formato**: Arrays de objetos `{qtd, valor}`
- **Uso**: Mais flexível, suporta múltiplos grupos

### 4.2 `gerarPagamentosVenda` (Implementação 1.2)
- **Quando**: Sistema gera pagamentos para venda existente
- **Dados**: `venda` do banco de dados (campos simples)
- **Formato**: Campos únicos `qtd_parcelas_entrada`, `valor_parcela_entrada`, etc.
- **Uso**: Limitado a um grupo por tipo

### 4.3 `ImportarVendas` (Implementação 1.3)
- **Quando**: Importação via Excel
- **Dados**: Valores extraídos da planilha
- **Formato**: Variáveis simples
- **Uso**: Limitado a um grupo por tipo

---

## 5. Decisões Necessárias

### 5.1 Qual implementação usar como base?

**Recomendação**: Usar **Implementação 1.1** (`handleSaveVenda`) como base porque:
- ✅ Mais robusta (valida grupos)
- ✅ Suporta múltiplos grupos
- ✅ Usa `parseFloat` consistentemente
- ✅ Tratamento defensivo de valores inválidos

**Mas**: Precisamos garantir compatibilidade com dados do banco (campos simples).

### 5.2 Como lidar com inconsistências?

**Opção A**: Função centralizada que aceita ambos os formatos
- Aceita grupos (array) OU campos simples
- Detecta formato automaticamente
- Mais flexível, mas mais complexa

**Opção B**: Função centralizada que sempre usa grupos
- Converter campos simples em grupos antes de chamar
- Mais simples, mas requer conversão

**Recomendação**: **Opção A** - Função que aceita ambos os formatos para máxima compatibilidade.

---

## 6. Validações Necessárias

### 6.1 Validações para `calcularValorProSoluto`
- [ ] Valida se `dadosVenda` é objeto válido
- [ ] Valida se `gruposParcelasEntrada` é array (ou null/undefined)
- [ ] Valida se `gruposBalao` é array (ou null/undefined)
- [ ] Valida cada grupo antes de processar
- [ ] Trata valores null/undefined/NaN como 0
- [ ] Garante que resultado nunca é NaN

### 6.2 Validações para `calcularFatorComissao`
- [ ] Valida se `percentualTotal` é número válido
- [ ] Trata null/undefined/NaN como 0
- [ ] Garante que resultado nunca é NaN
- [ ] Retorna 0 se percentualTotal for inválido

---

## 7. Próximos Passos

1. ✅ Análise completa (este documento)
2. ⏭️ Criar função de teste comparativo
3. ⏭️ Criar documento de testes com todos os cenários
4. ⏭️ Implementar funções centralizadas
5. ⏭️ Testar comparativamente
6. ⏭️ Substituir gradualmente

---

**Última atualização**: 23/12/2025  
**Versão**: 1.0


