# 📊 Análise: Implementações de Formatters - FASE 2

**Data**: 23/12/2025  
**Objetivo**: Analisar todas as implementações de funções de formatação para consolidar em `src/utils/formatters.js`  
**Status**: 🔍 Análise Completa

---

## 🔍 Resultados da Busca

**Total encontrado**: 90 resultados em 5 arquivos

### Arquivos com `formatCurrency`:
1. `src/pages/AdminDashboard.jsx` - **~50 ocorrências**
2. `src/pages/HomeDashboard.jsx` - **~10 ocorrências**
3. `src/pages/CorretorDashboard.jsx` - **~15 ocorrências**
4. `src/pages/ClienteDashboard.jsx` - **~10 ocorrências**
5. Outros arquivos - **~5 ocorrências**

---

## 📋 Análise das Implementações

### 1. `formatCurrency` - AdminDashboard.jsx (linha 2588)

```javascript
const formatCurrency = (value) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value)
}
```

**Características**:
- ❌ **Sem validação** de null/undefined/NaN
- ✅ Formato padrão (2 decimais)
- ⚠️ Pode quebrar com valores inválidos

**Uso**: ~50 vezes no arquivo

---

### 2. `formatCurrency` - HomeDashboard.jsx (linha 220)

```javascript
const formatCurrency = (value) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value)
}
```

**Características**:
- ❌ **Sem validação** de null/undefined/NaN
- ⚠️ **Sem decimais** (0 dígitos) - diferente dos outros!
- ⚠️ Pode quebrar com valores inválidos

**Uso**: ~10 vezes (valores grandes, sem decimais)

---

### 3. `formatCurrency` - CorretorDashboard.jsx (linha 174)

```javascript
const formatCurrency = (value) => {
  if (value === null || value === undefined || isNaN(value)) {
    return 'R$ 0,00'
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)
}
```

**Características**:
- ✅ **Com validação** de null/undefined/NaN
- ✅ Sempre 2 decimais (explícito)
- ✅ Mais robusta

**Uso**: ~15 vezes

---

### 4. `formatCurrency` - ClienteDashboard.jsx (linha 185)

```javascript
const formatCurrency = (value) => {
  if (!value) return 'R$ 0,00'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value)
}
```

**Características**:
- ✅ **Validação básica** (!value)
- ⚠️ Não valida NaN especificamente
- ✅ Formato padrão (2 decimais)

**Uso**: ~10 vezes

---

## 🔄 Outras Funções de Formatação Encontradas

### `formatCurrencyInput` - AdminDashboard.jsx (linha 2596)

```javascript
const formatCurrencyInput = (value) => {
  if (!value) return ''
  const num = parseFloat(value)
  if (isNaN(num)) return ''
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
```

**Características**:
- ✅ Validação de valor vazio
- ✅ Validação de NaN
- ⚠️ **Formato diferente**: sem símbolo R$, apenas números formatados
- **Uso**: Para inputs de formulário

---

### `formatTelefone` - AdminDashboard.jsx (linha 2579)

```javascript
const formatTelefone = (value) => {
  if (!value) return ''
  const numbers = value.replace(/\D/g, '')
  const limited = numbers.slice(0, 11)
  if (limited.length <= 2) return `(${limited}`
  if (limited.length <= 7) return `(${limited.slice(0, 2)}) ${limited.slice(2)}`
  return `(${limited.slice(0, 2)}) ${limited.slice(2, 7)}-${limited.slice(7)}`
}
```

**Características**:
- ✅ Validação de valor vazio
- ✅ Remove caracteres não numéricos
- ✅ Limita a 11 dígitos
- ✅ Formato brasileiro: (00) 00000-0000

**Uso**: ~3 vezes (formulários)

---

### `formatDate` - ClienteDashboard.jsx (linha 193)

```javascript
const formatDate = (date) => {
  if (!date) return '-'
  // Se for string no formato YYYY-MM-DD
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)) {
    const [year, month, day] = date.split('T')[0].split('-')
    return `${day}/${month}/${year}`
  }
  // Se for Date object
  if (date instanceof Date) {
    return date.toLocaleDateString('pt-BR')
  }
  return '-'
}
```

**Características**:
- ✅ Validação de valor vazio
- ✅ Suporta string (YYYY-MM-DD) e Date object
- ✅ Formato brasileiro: DD/MM/AAAA

**Uso**: ~5 vezes

---

## 🎯 Versão Unificada Proposta

### `formatCurrency` - Versão Robusta

**Requisitos**:
1. ✅ Validar null/undefined/NaN (como CorretorDashboard)
2. ✅ Suportar opções de decimais (para HomeDashboard)
3. ✅ Padrão: 2 decimais (maioria dos casos)
4. ✅ Compatível com todos os usos atuais

**Implementação proposta**:
```javascript
/**
 * Formata valor como moeda brasileira (R$)
 * 
 * @param {number|string} value - Valor a formatar
 * @param {Object} options - Opções de formatação
 * @param {number} options.minimumFractionDigits - Dígitos mínimos (padrão: 2)
 * @param {number} options.maximumFractionDigits - Dígitos máximos (padrão: 2)
 * @returns {string} Valor formatado (ex: "R$ 1.234,56")
 */
export function formatCurrency(value, options = {}) {
  // Validação robusta (como CorretorDashboard)
  if (value === null || value === undefined || isNaN(value)) {
    return 'R$ 0,00'
  }
  
  const {
    minimumFractionDigits = 2,  // Padrão: 2 decimais
    maximumFractionDigits = 2
  } = options
  
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits,
    maximumFractionDigits
  }).format(value)
}
```

**Migração**:
- **AdminDashboard**: Usar padrão (2 decimais) - 50 substituições
- **HomeDashboard**: Usar `{ minimumFractionDigits: 0, maximumFractionDigits: 0 }` - 10 substituições
- **CorretorDashboard**: Usar padrão (2 decimais) - 15 substituições
- **ClienteDashboard**: Usar padrão (2 decimais) - 10 substituições

---

## 📝 Plano de Consolidação

### FASE 2.2.1: Criar `src/utils/formatters.js` ✅ (Estrutura já criada)

**Arquivo**: `src/utils/formatters.js`

**Funções a criar**:
1. ✅ `formatCurrency(value, options)` - Versão unificada
2. ✅ `formatCurrencyInput(value)` - Para inputs
3. ✅ `formatTelefone(value)` - Formatação de telefone
4. ✅ `formatDate(date)` - Formatação de data

---

### FASE 2.2.2: Substituir em AdminDashboard.jsx

**Ordem de substituição**:
1. Adicionar import no topo
2. Substituir `formatCurrency` (50 ocorrências)
3. Substituir `formatCurrencyInput` (10 ocorrências)
4. Substituir `formatTelefone` (3 ocorrências)
5. Remover funções locais
6. Testar: criar/editar venda, visualizar valores

**Validação**:
- [ ] Import adicionado
- [ ] Todas as substituições feitas
- [ ] Funções locais removidas
- [ ] Teste: criar venda
- [ ] Teste: editar venda
- [ ] Teste: visualizar valores formatados

---

### FASE 2.2.3: Substituir em HomeDashboard.jsx

**Ordem de substituição**:
1. Adicionar import no topo
2. Substituir `formatCurrency` com opção `{ minimumFractionDigits: 0, maximumFractionDigits: 0 }`
3. Remover função local
4. Testar: visualizar dashboard

**Validação**:
- [ ] Import adicionado
- [ ] Todas as substituições feitas (com opção de 0 decimais)
- [ ] Função local removida
- [ ] Teste: visualizar dashboard home

---

### FASE 2.2.4: Substituir em CorretorDashboard.jsx

**Ordem de substituição**:
1. Adicionar import no topo
2. Substituir `formatCurrency` (15 ocorrências)
3. Remover função local
4. Testar: visualizar dashboard do corretor

**Validação**:
- [ ] Import adicionado
- [ ] Todas as substituições feitas
- [ ] Função local removida
- [ ] Teste: visualizar dashboard corretor

---

### FASE 2.2.5: Substituir em ClienteDashboard.jsx

**Ordem de substituição**:
1. Adicionar import no topo
2. Substituir `formatCurrency` (10 ocorrências)
3. Substituir `formatDate` (5 ocorrências)
4. Remover funções locais
5. Testar: visualizar dashboard do cliente

**Validação**:
- [ ] Import adicionado
- [ ] Todas as substituições feitas
- [ ] Funções locais removidas
- [ ] Teste: visualizar dashboard cliente

---

## ⚠️ Pontos de Atenção

### 1. HomeDashboard usa 0 decimais

**Solução**: Passar opção explícita
```javascript
// ANTES:
formatCurrency(valor)

// DEPOIS:
formatCurrency(valor, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
```

### 2. formatCurrencyInput é diferente

**Solução**: Manter função separada (sem símbolo R$)
```javascript
// Mantém função específica para inputs
formatCurrencyInput(value) // Retorna: "1.234,56" (sem R$)
```

### 3. Validação de NaN

**Solução**: Versão unificada valida NaN (como CorretorDashboard)

---

## 📊 Resumo de Impacto

### Arquivos a Modificar:
- ✅ `src/utils/formatters.js` - **CRIAR** (4 funções)
- 🔄 `src/pages/AdminDashboard.jsx` - **MODIFICAR** (~63 substituições)
- 🔄 `src/pages/HomeDashboard.jsx` - **MODIFICAR** (~10 substituições)
- 🔄 `src/pages/CorretorDashboard.jsx` - **MODIFICAR** (~15 substituições)
- 🔄 `src/pages/ClienteDashboard.jsx` - **MODIFICAR** (~15 substituições)

### Total de Substituições:
- **~103 substituições** de código
- **4 funções locais** a remover
- **1 arquivo novo** a criar

---

## ✅ Checklist de Validação

### Após Consolidação:
- [ ] Todas as funções criadas em `formatters.js`
- [ ] Todas as substituições feitas
- [ ] Funções locais removidas
- [ ] Imports adicionados
- [ ] Teste: AdminDashboard funcionando
- [ ] Teste: HomeDashboard funcionando
- [ ] Teste: CorretorDashboard funcionando
- [ ] Teste: ClienteDashboard funcionando
- [ ] Valores formatados corretamente em todas as telas
- [ ] Nenhum erro no console

---

## 🎯 Próximos Passos

1. **Criar implementação unificada** em `src/utils/formatters.js`
2. **Substituir uma página por vez** (começar por AdminDashboard)
3. **Testar após cada substituição**
4. **Remover funções locais** após validar
5. **Documentar mudanças**

---

**Última atualização**: 23/12/2025  
**Versão**: 1.0

