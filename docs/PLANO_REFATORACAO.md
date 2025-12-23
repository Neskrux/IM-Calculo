# 📋 PLANO DE REFATORAÇÃO - IM-Calculo

## 🎯 Objetivo Geral

Este documento descreve o plano completo de refatoração do sistema IM-Calculo, dividido em 3 fases principais:
1. **Fase 1**: Centralizar cálculos de comissões (evitar bugs críticos)
2. **Fase 2**: Modularizar código (facilitar manutenção)
3. **Fase 3**: Reorganizar estrutura + Migrar para Tailwind (preparar para escalar)

**IMPORTANTE**: Este é um plano de execução. NÃO altere código ainda. Leia tudo, entenda o contexto, e só depois comece a executar.

---

## 📚 Contexto e Justificativa

### Por que refatorar?

**Problema atual:**
- Código duplicado: função `calcularComissoesDinamicas` existe em 2 lugares diferentes
- Arquivos gigantes: `AdminDashboard.jsx` tem 6134 linhas
- Lógica espalhada: cálculos aparecem em vários lugares com implementações diferentes
- Difícil manutenção: mudar uma regra de cálculo exige alterar múltiplos arquivos
- Risco de bugs: inconsistências entre diferentes implementações

**Solução:**
- Centralizar cálculos em módulos dedicados
- Dividir componentes grandes em partes menores
- Organizar código por features (domínios de negócio)
- Preparar estrutura para Edge Functions (futuro)

### Regras de Ouro

1. **NUNCA quebrar funcionalidades existentes**
   - Sempre teste após cada mudança
   - Compare valores antes/depois
   - Commit após cada micro tarefa concluída

2. **Migração incremental**
   - Não tente fazer tudo de uma vez
   - Uma micro tarefa por vez
   - Valide antes de prosseguir

3. **Mantenha compatibilidade**
   - Durante migração, mantenha código antigo funcionando
   - Só remova código antigo quando novo estiver 100% validado

---

## 🗺️ FASE 1: Centralizar Cálculos de Comissões

**Tempo estimado**: 2-3 dias  
**Objetivo**: Eliminar duplicação de código de cálculos  
**Risco**: Baixo (só reorganiza, não muda lógica)  
**Status**: ✅ **CONCLUÍDA** - Ver `REFATORACAO_FASE1_CONCLUIDA.md` para detalhes

### 📍 Contexto da Fase 1

**Situação atual:**
- `calcularComissoesDinamicas` existe em:
  - `src/pages/AdminDashboard.jsx` (linha ~299)
  - `src/components/ImportarVendas.jsx` (linha ~274)
- Pequenas diferenças entre as implementações
- Outras funções de cálculo espalhadas em vários lugares

**O que vamos fazer:**
- Criar módulos centralizados de cálculos
- Mover todas as funções de cálculo para esses módulos
- Fazer todos os lugares usarem os mesmos módulos

### 📝 Micro Tarefas Detalhadas

#### 1.1 Criar Estrutura de Cálculos (30 minutos)

**Status**: ✅ **CONCLUÍDO**

**O que foi feito:**
1. ✅ Criada pasta `src/lib/calculos/`
2. ✅ Criados os seguintes arquivos:
   - `src/lib/calculos/comissoes.js` - Cálculos de comissões por cargo
   - `src/lib/calculos/proSoluto.js` - Cálculos de pro-soluto (preparado)
   - `src/lib/calculos/pagamentos.js` - Cálculos de comissão por pagamento (preparado)
   - `src/lib/calculos/index.js` - Export centralizado

**Validação:**
- [x] Pasta `src/lib/calculos/` criada
- [x] 4 arquivos criados (comissoes.js, proSoluto.js, pagamentos.js, index.js)

**📄 Detalhes**: Ver `REFATORACAO_FASE1_CONCLUIDA.md` seção 1.1

---

#### 1.2 Extrair `calcularComissoesDinamicas` (1 hora)

**Status**: ✅ **CONCLUÍDO E TESTADO**

**O que foi feito:**
1. ✅ Função unificada criada em `src/lib/calculos/comissoes.js`
2. ✅ Baseada na versão do `AdminDashboard.jsx` (mais robusta com `parseFloat`)
3. ✅ Função recebe `empreendimentos` como parâmetro
4. ✅ Exportada no `index.js`

**Implementação:**
- Versão segura com `parseFloat` em todos os cálculos
- Validações defensivas com optional chaining
- Tratamento seguro de casos extremos

**Validação:**
- [x] Função criada em `comissoes.js`
- [x] Função recebe `empreendimentos` como parâmetro
- [x] Função exportada no `index.js`
- [x] Código sem erros de sintaxe
- [x] **Testes realizados e validados** - Ver `TESTES_VALIDACAO_FASE1.md`

**📄 Detalhes**: 
- Ver `REFATORACAO_FASE1_CONCLUIDA.md` seção 1.2
- Ver `TESTES_VALIDACAO_FASE1.md` para detalhes dos testes realizados

---

#### 1.3 Extrair Cálculos de Pro-Soluto (1 hora)

**O que fazer:**
1. Localizar no `AdminDashboard.jsx` a lógica de cálculo de pro-soluto (linhas ~850-860)
2. Identificar todas as funções relacionadas
3. Criar `src/lib/calculos/proSoluto.js` com funções:
   - `calcularValorProSoluto` - Calcula valor total pro-soluto
   - `calcularFatorComissao` - Calcula fator de comissão

**Passo a passo:**

**Passo 1: Localizar código**
- Abra `src/pages/AdminDashboard.jsx`
- Procure por "valorProSoluto" ou "fatorComissao"
- Anote todas as linhas onde isso aparece

**Passo 2: Identificar lógica**
A lógica geralmente está assim:
```javascript
// Exemplo do que você vai encontrar (não copie, só entenda)
const valorSinal = vendaForm.teve_sinal ? parseFloat(vendaForm.valor_sinal) : 0
const valorEntradaTotal = // cálculo da entrada
const valorTotalBalao = // cálculo dos balões
const valorProSoluto = valorSinal + valorEntradaTotal + valorTotalBalao
const fatorComissao = comissoesDinamicas.percentualTotal / 100
```

**Passo 3: Criar funções**
```javascript
// src/lib/calculos/proSoluto.js

/**
 * Calcula o valor total do pro-soluto (sinal + entrada + balões)
 * 
 * @param {Object} dadosVenda - Objeto com dados da venda
 * @param {boolean} dadosVenda.teve_sinal
 * @param {number} dadosVenda.valor_sinal
 * @param {boolean} dadosVenda.teve_entrada
 * @param {boolean} dadosVenda.parcelou_entrada
 * @param {number} dadosVenda.qtd_parcelas_entrada
 * @param {number} dadosVenda.valor_parcela_entrada
 * @param {number} dadosVenda.valor_entrada
 * @param {string} dadosVenda.teve_balao - 'sim', 'nao', 'pendente'
 * @param {number} dadosVenda.qtd_balao
 * @param {number} dadosVenda.valor_balao
 * @returns {number} Valor total do pro-soluto
 */
export function calcularValorProSoluto(dadosVenda) {
  // Implementação aqui
  // Lógica: sinal + entrada + balões
}

/**
 * Calcula o fator de comissão (percentual total / 100)
 * 
 * @param {number} percentualTotal - Percentual total de comissão (ex: 7 para 7%)
 * @returns {number} Fator de comissão (ex: 0.07 para 7%)
 */
export function calcularFatorComissao(percentualTotal) {
  // Implementação aqui
  // Simples: percentualTotal / 100
}
```

**Passo 4: Exportar**
```javascript
// src/lib/calculos/index.js
export { calcularComissoesDinamicas } from './comissoes.js'
export { calcularValorProSoluto, calcularFatorComissao } from './proSoluto.js'
```

**Validação:**
- [ ] Funções criadas em `proSoluto.js`
- [ ] Funções exportadas no `index.js`
- [ ] Código não tem erros de sintaxe

**⚠️ ATENÇÃO**: 
- NÃO altere `AdminDashboard.jsx` ainda
- Apenas crie as funções centralizadas
- Teste sintaxe antes de prosseguir

---

#### 1.4 Extrair Cálculos de Pagamentos (1.5 horas)

**O que fazer:**
1. Localizar no `AdminDashboard.jsx`:
   - `calcularComissaoPorCargoPagamento` (linha ~384)
   - `calcularComissaoTotalPagamento` (linha ~432)
2. Localizar no `CorretorDashboard.jsx`:
   - `calcularComissaoProporcional` (linha ~295)
3. Criar `src/lib/calculos/pagamentos.js` com todas essas funções

**Passo a passo:**

**Passo 1: Analisar funções**
- Abra `src/pages/AdminDashboard.jsx`
- Leia as funções `calcularComissaoPorCargoPagamento` e `calcularComissaoTotalPagamento`
- Entenda o que cada uma faz
- Abra `src/pages/CorretorDashboard.jsx`
- Leia `calcularComissaoProporcional`
- Entenda a diferença entre elas

**Passo 2: Criar módulo de pagamentos**
```javascript
// src/lib/calculos/pagamentos.js

/**
 * Calcula comissão detalhada por cargo para um pagamento específico
 * 
 * @param {Object} pagamento - Objeto do pagamento
 * @param {string} pagamento.venda_id
 * @param {number} pagamento.valor
 * @param {number} pagamento.comissao_gerada
 * @param {Object} venda - Objeto da venda relacionada
 * @param {Array} empreendimentos - Lista de empreendimentos
 * @returns {Array} Array de objetos { nome_cargo, percentual, valor }
 */
export function calcularComissaoPorCargoPagamento(pagamento, venda, empreendimentos) {
  // Implementação aqui
  // Base: AdminDashboard.jsx linha ~384
  // IMPORTANTE: Adicione parâmetros venda e empreendimentos
}

/**
 * Calcula comissão total de um pagamento (soma de todos os cargos)
 * 
 * @param {Object} pagamento
 * @param {Object} venda
 * @param {Array} empreendimentos
 * @returns {number} Valor total da comissão
 */
export function calcularComissaoTotalPagamento(pagamento, venda, empreendimentos) {
  // Implementação aqui
  // Base: AdminDashboard.jsx linha ~432
  // Pode usar calcularComissaoPorCargoPagamento internamente
}

/**
 * Calcula comissão proporcional do corretor para uma parcela
 * 
 * @param {Object} pagamento - Objeto do pagamento
 * @param {Object} venda - Objeto da venda relacionada
 * @returns {number} Valor da comissão proporcional
 */
export function calcularComissaoProporcional(pagamento, venda) {
  // Implementação aqui
  // Base: CorretorDashboard.jsx linha ~295
  // Fórmula: (comissaoTotalCorretor * valorParcela) / valorTotalVenda
}
```

**Passo 3: Exportar**
```javascript
// src/lib/calculos/index.js
export { calcularComissoesDinamicas } from './comissoes.js'
export { calcularValorProSoluto, calcularFatorComissao } from './proSoluto.js'
export { 
  calcularComissaoPorCargoPagamento,
  calcularComissaoTotalPagamento,
  calcularComissaoProporcional
} from './pagamentos.js'
```

**Validação:**
- [ ] Funções criadas em `pagamentos.js`
- [ ] Funções exportadas no `index.js`
- [ ] Código não tem erros de sintaxe

**⚠️ ATENÇÃO**: 
- NÃO altere os arquivos originais ainda
- Apenas crie as funções centralizadas
- Teste sintaxe antes de prosseguir

---

#### 1.5 Refatorar AdminDashboard (2 horas)

**Status**: ✅ **CONCLUÍDO E TESTADO**

**O que foi feito:**
1. ✅ Import adicionado: `import { calcularComissoesDinamicas } from '../lib/calculos'`
2. ✅ Função local removida (linha ~301)
3. ✅ Todas as chamadas substituídas (3 locais: linha ~673, ~799, ~1553)
4. ✅ Parâmetro `empreendimentos` adicionado em todas as chamadas
5. ✅ **Testes realizados em 3 pontos críticos** - Ver `TESTES_VALIDACAO_FASE1.md`

**O que fazer:**
1. Importar módulos de cálculos no `AdminDashboard.jsx`
2. Substituir funções locais por chamadas aos módulos
3. Ajustar chamadas para passar parâmetros corretos
4. Testar cada substituição

**Passo a passo:**

**Passo 1: Adicionar imports**
No topo de `src/pages/AdminDashboard.jsx`, adicione:
```javascript
import { 
  calcularComissoesDinamicas,
  calcularValorProSoluto,
  calcularFatorComissao,
  calcularComissaoPorCargoPagamento,
  calcularComissaoTotalPagamento
} from '../lib/calculos'
```

**Passo 2: Substituir `calcularComissoesDinamicas`**
- Localize a função local (linha ~299)
- Comente a função (não delete ainda)
- Substitua todas as chamadas para usar a versão importada
- IMPORTANTE: A versão importada precisa receber `empreendimentos` como parâmetro

**Antes:**
```javascript
const comissoesDinamicas = calcularComissoesDinamicas(
  valorVenda,
  empreendimentoId,
  tipoCorretor
)
```

**Depois:**
```javascript
const comissoesDinamicas = calcularComissoesDinamicas(
  valorVenda,
  empreendimentoId,
  tipoCorretor,
  empreendimentos  // ← Adicionar este parâmetro
)
```

**Passo 3: Substituir cálculos de pro-soluto**
- Localize onde `valorProSoluto` é calculado
- Substitua pela função `calcularValorProSoluto`
- Localize onde `fatorComissao` é calculado
- Substitua pela função `calcularFatorComissao`

**Passo 4: Substituir cálculos de pagamentos**
- Localize chamadas de `calcularComissaoPorCargoPagamento`
- Substitua pela versão importada
- Adicione parâmetros `venda` e `empreendimentos`
- Localize chamadas de `calcularComissaoTotalPagamento`
- Substitua pela versão importada

**Passo 5: Remover funções locais (SÓ DEPOIS DE TESTAR)**
- Após validar que tudo funciona
- Remova as funções locais comentadas
- Limpe código não utilizado

**Validação:**
- [x] Imports adicionados
- [x] Funções locais substituídas
- [x] Código compila sem erros
- [x] **TESTE CRÍTICO**: Criar uma venda e verificar comissões calculadas ✅
- [x] **TESTE CRÍTICO**: Gerar pagamentos e verificar valores ✅
- [x] **TESTE CRÍTICO**: Visualizar comissões na lista ✅
- [x] **Detalhes dos testes**: Ver `TESTES_VALIDACAO_FASE1.md`

**⚠️ ATENÇÃO**: 
- Teste CADA substituição antes de prosseguir
- Se algo quebrar, reverta e ajuste
- Compare valores antes/depois para garantir que são idênticos

---

#### 1.6 Refatorar ImportarVendas (1 hora)

**Status**: ✅ **CONCLUÍDO**

**O que foi feito:**
1. ✅ Import adicionado: `import { calcularComissoesDinamicas } from '../lib/calculos'`
2. ✅ Função local removida (linha ~274)
3. ✅ Chamada atualizada para usar função centralizada
4. ✅ Parâmetro `empreendimentos` adicionado na chamada

**O que fazer:**
1. Importar módulo de cálculos no `ImportarVendas.jsx`
2. Substituir função local `calcularComissoesDinamicas`
3. Remover função duplicada
4. Testar importação

**Passo a passo:**

**Passo 1: Adicionar import**
No topo de `src/components/ImportarVendas.jsx`:
```javascript
import { calcularComissoesDinamicas } from '../lib/calculos'
```

**Passo 2: Substituir função**
- Localize a função local (linha ~274)
- Comente a função
- Substitua chamadas para usar versão importada
- Adicione parâmetro `empreendimentos` nas chamadas

**Passo 3: Remover função local**
- Após testar, remova função comentada

**Validação:**
- [x] Import adicionado
- [x] Função local substituída
- [x] Código compila sem erros
- [ ] **TESTE CRÍTICO**: Importar arquivo Excel e verificar cálculos (preparado para teste)

**⚠️ ATENÇÃO**: 
- Teste importação completa antes de remover função local
- Valide que valores calculados são idênticos

---

#### 1.7 Refatorar CorretorDashboard (1 hora)

**O que fazer:**
1. Importar `calcularComissaoProporcional` no `CorretorDashboard.jsx`
2. Substituir função local
3. Testar visualização

**Passo a passo:**

**Passo 1: Adicionar import**
```javascript
import { calcularComissaoProporcional } from '../lib/calculos'
```

**Passo 2: Substituir função**
- Localize função local (linha ~295)
- Comente função
- Substitua chamadas

**Passo 3: Remover função local**
- Após testar, remova função comentada

**Validação:**
- [ ] Import adicionado
- [ ] Função local substituída
- [ ] Código compila sem erros
- [ ] **TESTE CRÍTICO**: Visualizar vendas e comissões no dashboard do corretor

---

#### 1.8 Validação Final da Fase 1 (1 hora)

**Checklist completo:**

**Testes funcionais:**
- [ ] Criar venda no AdminDashboard → Verificar comissões calculadas
- [ ] Gerar pagamentos pro-soluto → Verificar valores
- [ ] Confirmar pagamento → Verificar comissões por cargo
- [ ] Importar vendas via Excel → Verificar cálculos
- [ ] Visualizar vendas no CorretorDashboard → Verificar comissões

**Testes de valores:**
- [ ] Comparar valores antes/depois da refatoração
- [ ] Validar que comissões são idênticas
- [ ] Validar que pro-soluto é idêntico
- [ ] Validar que pagamentos são idênticos

**Limpeza:**
- [ ] Remover todas as funções locais comentadas
- [ ] Remover código não utilizado
- [ ] Verificar que não há imports não utilizados

**Documentação:**
- [ ] Documentar mudanças feitas
- [ ] Anotar qualquer ajuste necessário

**✅ Fase 1 concluída quando:**
- Todos os cálculos estão centralizados em `src/lib/calculos/`
- Nenhum código duplicado de cálculos
- Todos os testes passando
- Valores idênticos antes/depois

---

## 🗺️ FASE 2: Modularizar Código

**Tempo estimado**: 3-4 dias  
**Objetivo**: Dividir código em módulos reutilizáveis  
**Risco**: Médio (pode quebrar se não testar)

### 📍 Contexto da Fase 2

**Situação atual:**
- `formatCurrency` existe em 4 lugares diferentes com pequenas variações
- `AdminDashboard.jsx` tem 6134 linhas (muito grande)
- Lógica de negócio misturada com UI
- Código difícil de reutilizar

**O que vamos fazer:**
- Centralizar funções utilitárias
- Criar hooks customizados
- Dividir componentes grandes
- Separar lógica de apresentação

### 📝 Micro Tarefas Detalhadas

#### 2.1 Criar Estrutura de Utils (30 minutos)

**O que fazer:**
1. Criar pasta `src/utils/`
2. Criar arquivos:
   - `src/utils/formatters.js` - Formatação (moeda, data, telefone)
   - `src/utils/validators.js` - Validações
   - `src/utils/normalizers.js` - Normalização (CPF, telefone)

**Validação:**
- [ ] Pasta `src/utils/` criada
- [ ] 3 arquivos criados

---

#### 2.2 Consolidar Formatters (1.5 horas)

**O que fazer:**
1. Localizar todas as funções `formatCurrency` no projeto
2. Comparar implementações
3. Criar versão unificada
4. Substituir em todos os lugares

**Passo a passo:**

**Passo 1: Localizar todas as implementações**
- `src/pages/AdminDashboard.jsx` (linha ~2309)
- `src/pages/CorretorDashboard.jsx` (linha ~174)
- `src/pages/HomeDashboard.jsx` (linha ~220)
- `src/pages/ClienteDashboard.jsx` (linha ~185)

**Passo 2: Comparar e criar versão unificada**
```javascript
// src/utils/formatters.js

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
  if (value === null || value === undefined || isNaN(value)) {
    return 'R$ 0,00'
  }
  
  const {
    minimumFractionDigits = 2,
    maximumFractionDigits = 2
  } = options
  
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits,
    maximumFractionDigits
  }).format(value)
}

/**
 * Formata data para formato brasileiro (DD/MM/AAAA)
 * 
 * @param {string|Date} date - Data a formatar
 * @returns {string} Data formatada
 */
export function formatDate(date) {
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

/**
 * Formata telefone para formato brasileiro ((00) 00000-0000)
 * 
 * @param {string} value - Telefone a formatar
 * @returns {string} Telefone formatado
 */
export function formatTelefone(value) {
  if (!value) return ''
  const numbers = value.replace(/\D/g, '')
  const limited = numbers.slice(0, 11)
  if (limited.length <= 2) return `(${limited}`
  if (limited.length <= 7) return `(${limited.slice(0, 2)}) ${limited.slice(2)}`
  return `(${limited.slice(0, 2)}) ${limited.slice(2, 7)}-${limited.slice(7)}`
}
```

**Passo 3: Substituir em todos os arquivos**
- Substituir uma implementação por vez
- Testar após cada substituição
- Remover funções locais após validar

**Validação:**
- [ ] Funções criadas em `formatters.js`
- [ ] Todas as implementações substituídas
- [ ] Formatação funcionando em todas as telas
- [ ] Funções locais removidas

---

#### 2.3 Criar Hooks Customizados (2 horas)

**O que fazer:**
1. Criar pasta `src/hooks/`
2. Extrair lógica de busca/filtro de `AdminDashboard.jsx`
3. Criar hooks reutilizáveis

**Estrutura:**
```
src/hooks/
├── useVendas.js
├── usePagamentos.js
├── useEmpreendimentos.js
└── useCorretores.js
```

**Exemplo de hook:**
```javascript
// src/hooks/useVendas.js
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Hook para buscar e filtrar vendas
 * 
 * @param {Object} options - Opções de filtro
 * @param {string} options.corretorId - Filtrar por corretor
 * @param {string} options.empreendimentoId - Filtrar por empreendimento
 * @param {string} options.status - Filtrar por status
 * @returns {Object} { vendas, loading, error, refetch }
 */
export function useVendas(options = {}) {
  const [vendas, setVendas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  const fetchVendas = async () => {
    setLoading(true)
    setError(null)
    
    try {
      let query = supabase.from('vendas').select('*')
      
      if (options.corretorId) {
        query = query.eq('corretor_id', options.corretorId)
      }
      
      if (options.empreendimentoId) {
        query = query.eq('empreendimento_id', options.empreendimentoId)
      }
      
      if (options.status) {
        query = query.eq('status', options.status)
      }
      
      const { data, error: queryError } = await query.order('data_venda', { ascending: false })
      
      if (queryError) throw queryError
      
      setVendas(data || [])
    } catch (err) {
      setError(err.message)
      console.error('Erro ao buscar vendas:', err)
    } finally {
      setLoading(false)
    }
  }
  
  useEffect(() => {
    fetchVendas()
  }, [options.corretorId, options.empreendimentoId, options.status])
  
  return {
    vendas,
    loading,
    error,
    refetch: fetchVendas
  }
}
```

**Validação:**
- [ ] Hooks criados
- [ ] Lógica extraída de AdminDashboard
- [ ] Hooks funcionando corretamente
- [ ] Filtros funcionando

---

#### 2.4 Extrair Componentes de Formulário (3 horas)

**O que fazer:**
1. Criar pasta `src/components/forms/`
2. Extrair formulários de `AdminDashboard.jsx`
3. Criar componentes reutilizáveis

**Estrutura:**
```
src/components/forms/
├── VendaForm.jsx
├── ClienteForm.jsx
└── CorretorForm.jsx
```

**Estratégia:**
- Manter estado no componente pai (AdminDashboard)
- Passar estado e handlers como props
- Componente apenas renderiza UI

**Validação:**
- [ ] Componentes criados
- [ ] Formulários extraídos
- [ ] Funcionalidade mantida
- [ ] Teste: criar/editar venda, cliente, corretor

---

#### 2.5 Extrair Componentes de Tabela (2 horas)

**O que fazer:**
1. Criar pasta `src/components/tables/`
2. Extrair tabelas de `AdminDashboard.jsx`
3. Criar componentes reutilizáveis

**Estrutura:**
```
src/components/tables/
├── VendasTable.jsx
├── PagamentosTable.jsx
└── CorretoresTable.jsx
```

**Validação:**
- [ ] Componentes criados
- [ ] Tabelas extraídas
- [ ] Funcionalidade mantida
- [ ] Teste: visualizar tabelas

---

#### 2.6 Dividir AdminDashboard (4 horas)

**O que fazer:**
1. Criar pasta `src/components/sections/`
2. Dividir AdminDashboard em seções:
   - `VendasSection.jsx`
   - `PagamentosSection.jsx`
   - `CorretoresSection.jsx`
   - `ClientesSection.jsx`
   - `EmpreendimentosSection.jsx`

**Estratégia:**
- Manter estado no AdminDashboard
- Passar estado e handlers como props
- Cada seção renderiza sua parte

**Validação:**
- [ ] Seções criadas
- [ ] AdminDashboard dividido
- [ ] Todas as abas funcionando
- [ ] Teste: validar todas as funcionalidades

---

#### 2.7 Dividir CorretorDashboard (2 horas)

**O que fazer:**
1. Extrair componentes de `CorretorDashboard.jsx`:
   - `VendasList.jsx`
   - `ComissoesCard.jsx`
   - `PagamentosList.jsx`

**Validação:**
- [ ] Componentes criados
- [ ] CorretorDashboard dividido
- [ ] Funcionalidade mantida
- [ ] Teste: visualizar dashboard

---

#### 2.8 Validação Final da Fase 2 (1 hora)

**Checklist:**
- [ ] Utils centralizados
- [ ] Hooks criados e funcionando
- [ ] Componentes de formulário extraídos
- [ ] Componentes de tabela extraídos
- [ ] AdminDashboard dividido
- [ ] CorretorDashboard dividido
- [ ] Todas as funcionalidades testadas
- [ ] Código mais limpo e organizado

**✅ Fase 2 concluída quando:**
- Código modularizado
- Componentes reutilizáveis
- Hooks customizados funcionando
- Arquivos menores e mais fáceis de manter

---

## 🗺️ FASE 3: Reorganizar Estrutura + Tailwind

**Tempo estimado**: 5-7 dias  
**Objetivo**: Reorganizar por features e migrar para Tailwind  
**Risco**: Alto (muitas mudanças, pode quebrar imports)

### 📍 Contexto da Fase 3

**Situação atual:**
- Estrutura plana (tudo em `components/`, `pages/`)
- CSS customizado em vários arquivos
- Difícil localizar código relacionado

**O que vamos fazer:**
- Reorganizar por features (domínios de negócio)
- Migrar para Tailwind CSS
- Preparar estrutura para Edge Functions (futuro)

### 📝 Micro Tarefas Detalhadas

#### 3.1 Instalar e Configurar Tailwind (1 hora)

**O que fazer:**
1. Instalar Tailwind CSS
2. Configurar `tailwind.config.js`
3. Configurar `postcss.config.js`
4. Criar `src/styles/globals.css`

**Comandos:**
```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

**Configuração `tailwind.config.js`:**
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Adicionar cores do tema atual se necessário
      },
    },
  },
  plugins: [],
}
```

**Validação:**
- [ ] Tailwind instalado
- [ ] Configuração criada
- [ ] Teste: aplicar classes Tailwind em um componente

---

#### 3.2 Planejar Nova Estrutura (1 hora)

**Estrutura proposta:**
```
src/
├── app/
│   ├── router/
│   │   └── routes.jsx
│   ├── providers/
│   │   ├── auth-provider.jsx
│   │   └── query-provider.jsx
│   ├── layouts/
│   │   ├── app-layout.jsx
│   │   ├── admin-layout.jsx
│   │   ├── corretor-layout.jsx
│   │   └── cliente-layout.jsx
│   └── main.jsx
├── routes/
│   ├── auth/
│   │   └── login.jsx
│   ├── admin/
│   │   ├── dashboard.jsx
│   │   ├── vendas.jsx
│   │   ├── corretores.jsx
│   │   ├── clientes.jsx
│   │   └── pagamentos.jsx
│   ├── corretor/
│   │   └── dashboard.jsx
│   └── cliente/
│       └── dashboard.jsx
├── features/
│   ├── auth/
│   │   ├── api/
│   │   └── hooks/
│   ├── vendas/
│   │   ├── api/
│   │   ├── hooks/
│   │   └── components/
│   ├── corretores/
│   ├── clientes/
│   ├── comissoes/
│   │   └── lib/  (mover src/lib/calculos/ para cá)
│   └── pagamentos/
├── components/
│   ├── layout/
│   ├── ui/
│   └── icons/
├── lib/
│   ├── supabase/
│   │   └── client.js
│   └── env.js
└── utils/
```

**Documentar:**
- Criar arquivo `ESTRUTURA_MIGRACAO.md` com mapa de migração
- Listar cada arquivo e seu novo local

**Validação:**
- [ ] Estrutura planejada
- [ ] Mapa de migração criado
- [ ] Validado com equipe

---

#### 3.3 Criar Estrutura de Pastas (30 minutos)

**O que fazer:**
1. Criar todas as pastas da nova estrutura
2. Não mover arquivos ainda, só criar pastas

**Validação:**
- [ ] Todas as pastas criadas
- [ ] Estrutura pronta para migração

---

#### 3.4 Migrar lib/calculos (1 hora)

**O que fazer:**
1. Mover `src/lib/calculos/` para `src/features/comissoes/lib/`
2. Atualizar todos os imports
3. Testar cálculos

**Validação:**
- [ ] Arquivos movidos
- [ ] Imports atualizados
- [ ] Cálculos funcionando

---

#### 3.5 Migrar Utils (30 minutos)

**O que fazer:**
1. Mover `src/utils/` para `src/shared/utils/` (ou manter em `src/utils/`)
2. Atualizar imports
3. Testar formatação

**Validação:**
- [ ] Arquivos movidos
- [ ] Imports atualizados
- [ ] Formatação funcionando

---

#### 3.6 Migrar Hooks (1 hora)

**O que fazer:**
1. Mover hooks para features correspondentes
2. Atualizar imports
3. Testar hooks

**Validação:**
- [ ] Hooks movidos
- [ ] Imports atualizados
- [ ] Hooks funcionando

---

#### 3.7 Criar Camada API (2 horas)

**O que fazer:**
1. Criar estrutura `features/*/api/` em cada feature
2. Criar wrappers que por enquanto chamam Supabase direto
3. Preparar para trocar implementação depois

**Exemplo:**
```javascript
// src/features/vendas/api/vendas-api.js

import { supabase } from '../../../lib/supabase/client'

/**
 * API de vendas
 * Por enquanto chama Supabase direto
 * Futuro: trocar por Edge Functions
 */
export const vendasApi = {
  async list(filters = {}) {
    let query = supabase.from('vendas').select('*')
    
    if (filters.corretorId) {
      query = query.eq('corretor_id', filters.corretorId)
    }
    
    // ... outros filtros
    
    const { data, error } = await query
    if (error) throw error
    return data
  },
  
  async create(vendaData) {
    const { data, error } = await supabase
      .from('vendas')
      .insert([vendaData])
      .select()
      .single()
    
    if (error) throw error
    return data
  },
  
  // ... outros métodos
}
```

**Validação:**
- [ ] Estrutura API criada
- [ ] Wrappers funcionando
- [ ] Preparado para Edge Functions (futuro)

---

#### 3.8 Migrar Componentes por Feature (4 horas)

**O que fazer:**
1. Migrar componentes de vendas para `features/vendas/components/`
2. Migrar componentes de corretores para `features/corretores/components/`
3. Atualizar imports
4. Testar funcionalidades

**Validação:**
- [ ] Componentes migrados
- [ ] Imports atualizados
- [ ] Funcionalidades testadas

---

#### 3.9 Migrar Rotas (2 horas)

**O que fazer:**
1. Criar `src/routes/`
2. Migrar páginas para `routes/`
3. Configurar router em `app/router/routes.jsx`
4. Testar navegação

**Validação:**
- [ ] Rotas migradas
- [ ] Router configurado
- [ ] Navegação funcionando

---

#### 3.10 Criar Layouts (2 horas)

**O que fazer:**
1. Extrair layouts de dashboards
2. Criar `app/layouts/`
3. Aplicar layouts nas rotas
4. Testar layouts

**Validação:**
- [ ] Layouts criados
- [ ] Aplicados nas rotas
- [ ] Layouts funcionando

---

#### 3.11 Migrar para Tailwind (6 horas - INCREMENTAL)

**Estratégia:**
1. Migrar componente por componente
2. Começar por componentes menores (botões, inputs)
3. Depois: cards, tabelas
4. Por último: layouts
5. Manter CSS antigo durante migração
6. Remover CSS antigo só no final

**Ordem sugerida:**
1. Botões
2. Inputs
3. Cards
4. Tabelas
5. Modais
6. Layouts

**Validação:**
- [ ] Componentes migrados
- [ ] Visual mantido
- [ ] CSS antigo removido
- [ ] Tailwind funcionando

---

#### 3.12 Configurar shadcn/ui (opcional - 2 horas)

**O que fazer:**
1. Instalar shadcn/ui
2. Configurar para Vite
3. Migrar alguns componentes

**Validação:**
- [ ] shadcn/ui instalado
- [ ] Componentes migrados
- [ ] Funcionando corretamente

---

#### 3.13 Limpar Código Antigo (1 hora)

**O que fazer:**
1. Remover CSS não utilizado
2. Remover arquivos não utilizados
3. Limpar imports não utilizados
4. Atualizar documentação

**Validação:**
- [ ] Código limpo
- [ ] Arquivos não utilizados removidos
- [ ] Documentação atualizada

---

#### 3.14 Validação Final da Fase 3 (2 horas)

**Checklist:**
- [ ] Estrutura feature-based criada
- [ ] Rotas migradas
- [ ] Layouts criados
- [ ] Tailwind configurado
- [ ] Componentes migrados para Tailwind
- [ ] Camada API preparada
- [ ] Fluxo completo funcionando
- [ ] Visual mantido
- [ ] Performance ok

**✅ Fase 3 concluída quando:**
- Estrutura reorganizada
- Tailwind funcionando
- Tudo testado e funcionando

---

## 🎯 Checklist Geral de Validação

### Antes de Começar
- [ ] Li e entendi todo o plano
- [ ] Entendi o contexto de cada fase
- [ ] Tenho ambiente de desenvolvimento configurado
- [ ] Tenho acesso ao banco de dados para testes

### Durante Execução
- [ ] Faço uma micro tarefa por vez
- [ ] Testo após cada mudança
- [ ] Commit após cada micro tarefa
- [ ] Comparo valores antes/depois
- [ ] Documento mudanças

### Após Cada Fase
- [ ] Todos os testes passando
- [ ] Funcionalidades mantidas
- [ ] Código limpo
- [ ] Documentação atualizada

---

## ⚠️ Riscos e Mitigações

### Risco 1: Quebrar Cálculos
**Mitigação:**
- Testar cada substituição
- Comparar valores antes/depois
- Commit após cada mudança
- Reverter se necessário

### Risco 2: Quebrar Imports na Fase 3
**Mitigação:**
- Migrar incrementalmente
- Manter imports antigos funcionando
- Testar após cada migração
- Usar busca e substituição com cuidado

### Risco 3: Tailwind Quebrar Visual
**Mitigação:**
- Migrar componente por componente
- Manter CSS antigo durante migração
- Testar visual em cada migração
- Reverter se necessário

### Risco 4: Perder Funcionalidades
**Mitigação:**
- Testar fluxo completo após cada fase
- Checklist de validação
- Documentar mudanças
- Code review se possível

---

## 📚 Recursos e Referências

### Documentação
- [React Router v7](https://reactrouter.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [TanStack Query](https://tanstack.com/query)

### Padrões de Arquitetura
- Feature-based architecture
- Unidirectional data flow
- Separation of concerns

---

## 🚀 Próximos Passos Após Refatoração

### Curto Prazo
1. Migrar APIs sensíveis para Edge Functions
2. Implementar TanStack Query para server state
3. Aplicar Hardening do Data API

### Médio Prazo
1. Implementar RLS por tabela
2. Adicionar testes automatizados
3. Melhorar performance

### Longo Prazo
1. Escalar para múltiplos empreendimentos
2. Adicionar novas features
3. Melhorar UX/UI

---

## 📝 Notas Finais

**Lembre-se:**
- Este é um plano detalhado, não código
- Execute uma micro tarefa por vez
- Teste sempre antes de prosseguir
- Não tenha pressa, qualidade > velocidade
- Em caso de dúvida, pare e pergunte

**Boa sorte na refatoração! 🚀**

---

**Última atualização**: [Data]  
**Versão**: 1.0  
**Autor**: Plano de Refatoração IM-Calculo

