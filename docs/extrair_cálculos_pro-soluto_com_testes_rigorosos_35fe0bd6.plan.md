---
name: Extrair Cálculos Pro-Soluto com Testes Rigorosos
overview: Plano focado 100% em testes para extrair cálculos de pro-soluto de forma segura, garantindo que não haja inconsistências financeiras. O plano identifica todas as implementações atuais, cria testes abrangentes para validar cenários críticos, e só depois extrai as funções centralizadas.
todos: []
---

# Plano: Extrair Cálculos de Pro-Soluto com Testes Rigorosos

## Objetivo

Extrair cálculos de `valorProSoluto` e `fatorComissao` para funções centralizadas, garantindo 100% de precisão financeira através de testes rigorosos antes e depois da extração.

## Contexto Crítico

- **Impacto Financeiro**: Erros em cálculos de pro-soluto afetam diretamente pagamentos e comissões
- **Múltiplas Implementações**: Cálculos aparecem em 3 lugares com lógicas diferentes:
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - `AdminDashboard.jsx` linha ~808-840 (usa grupos de parcelas/balões)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - `AdminDashboard.jsx` linha ~1561-1578 (usa campos simples)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - `ImportarVendas.jsx` linha ~672-692 (usa campos simples)
- **Inconsistências Identificadas**: Diferentes formas de calcular entrada parcelada e balões

---

## FASE 1: Mapeamento e Análise (ANTES DE QUALQUER CÓDIGO)

### 1.1 Documentar Todas as Implementações Atuais

**Arquivo**: Criar `ANALISE_PRO_SOLUTO.md`

**O que fazer:**

1. Documentar cada local onde `valorProSoluto` é calculado:

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - `src/pages/AdminDashboard.jsx` linha ~836 (handleSaveVenda)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - `src/pages/AdminDashboard.jsx` linha ~1576 (gerarPagamentosVenda)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - `src/components/ImportarVendas.jsx` linha ~672

2. Documentar cada local onde `fatorComissao` é calculado:

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - `src/pages/AdminDashboard.jsx` linha ~840
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - `src/pages/AdminDashboard.jsx` linha ~1578
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - `src/components/ImportarVendas.jsx` linha ~692
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - `src/pages/AdminDashboard.jsx` linha ~389 (calcularComissaoPorCargoPagamento)

3. Identificar diferenças entre implementações:

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Como entrada parcelada é calculada (grupos vs campos simples)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Como balões são calculados (grupos vs campos simples)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Validações aplicadas em cada caso

**Validação:**

- [ ] Documento criado com todas as implementações mapeadas
- [ ] Diferenças identificadas e documentadas
- [ ] Cenários de uso de cada implementação documentados

---

## FASE 2: Criar Função de Teste Comparativo

### 2.1 Criar Função de Teste no AdminDashboard

**Arquivo**: `src/pages/AdminDashboard.jsx`

**O que fazer:**

Criar função temporária que compara cálculo antigo vs novo em tempo real:

```javascript
// Função temporária de teste (adicionar após linha ~840)
const testarCalculoProSoluto = (vendaForm, gruposParcelasEntrada, gruposBalao, comissoesDinamicas) => {
  // CÁLCULO ANTIGO (atual)
  const valorSinalAntigo = vendaForm.teve_sinal ? (parseFloat(vendaForm.valor_sinal) || 0) : 0
  
  let valorEntradaTotalAntigo = 0
  if (vendaForm.teve_entrada) {
    if (vendaForm.parcelou_entrada) {
      valorEntradaTotalAntigo = gruposParcelasEntrada.reduce((sum, grupo) => {
        if (!grupo || typeof grupo !== 'object' || grupo === null) return sum
        return sum + ((parseFloat(grupo.qtd) || 0) * (parseFloat(grupo.valor) || 0))
      }, 0)
    } else {
      valorEntradaTotalAntigo = parseFloat(vendaForm.valor_entrada) || 0
    }
  }
  
  let valorTotalBalaoAntigo = 0
  if (vendaForm.teve_balao === 'sim') {
    valorTotalBalaoAntigo = gruposBalao.reduce((sum, grupo) => {
      if (!grupo || typeof grupo !== 'object' || grupo === null) return sum
      return sum + ((parseFloat(grupo.qtd) || 0) * (parseFloat(grupo.valor) || 0))
    }, 0)
  }
  
  const valorProSolutoAntigo = valorSinalAntigo + valorEntradaTotalAntigo + valorTotalBalaoAntigo
  const fatorComissaoAntigo = comissoesDinamicas.percentualTotal / 100
  
  // CÁLCULO NOVO (função centralizada - será importada depois)
  // Por enquanto, retornar null para indicar que ainda não existe
  const valorProSolutoNovo = null // calcularValorProSoluto(vendaForm, gruposParcelasEntrada, gruposBalao)
  const fatorComissaoNovo = null // calcularFatorComissao(comissoesDinamicas.percentualTotal)
  
  // COMPARAÇÃO
  const resultado = {
    antigo: {
      valorProSoluto: valorProSolutoAntigo,
      fatorComissao: fatorComissaoAntigo,
      detalhes: {
        valorSinal: valorSinalAntigo,
        valorEntradaTotal: valorEntradaTotalAntigo,
        valorTotalBalao: valorTotalBalaoAntigo
      }
    },
    novo: {
      valorProSoluto: valorProSolutoNovo,
      fatorComissao: fatorComissaoNovo
    },
    saoIguais: valorProSolutoNovo !== null && 
               Math.abs(valorProSolutoAntigo - valorProSolutoNovo) < 0.01 &&
               Math.abs(fatorComissaoAntigo - fatorComissaoNovo) < 0.01
  }
  
  // LOG DE TESTE
  if (valorProSolutoNovo !== null && !resultado.saoIguais) {
    console.error('❌ TESTE PRO-SOLUTO: Diferença encontrada!', resultado)
  } else if (valorProSolutoNovo !== null) {
    console.log('✅ TESTE PRO-SOLUTO: Resultados idênticos', resultado)
  }
  
  return resultado
}
```

**Validação:**

- [ ] Função de teste criada
- [ ] Função não interfere no código de produção
- [ ] Função pode ser chamada em pontos críticos

---

## FASE 3: Testes de Cenários Críticos

### 3.1 Criar Script de Testes Manuais

**Arquivo**: Criar `TESTES_PRO_SOLUTO.md`

**Cenários a testar:**

#### Cenário 1: Apenas Sinal

- Dados: `teve_sinal: true, valor_sinal: 10000`
- Esperado: `valorProSoluto = 10000`

#### Cenário 2: Apenas Entrada à Vista

- Dados: `teve_entrada: true, parcelou_entrada: false, valor_entrada: 20000`
- Esperado: `valorProSoluto = 20000`

#### Cenário 3: Entrada Parcelada (1 grupo)

- Dados: `teve_entrada: true, parcelou_entrada: true, grupos_parcelas_entrada: [{qtd: 5, valor: 2000}]`
- Esperado: `valorProSoluto = 10000`

#### Cenário 4: Entrada Parcelada (múltiplos grupos)

- Dados: `teve_entrada: true, parcelou_entrada: true, grupos_parcelas_entrada: [{qtd: 3, valor: 1000}, {qtd: 2, valor: 2000}]`
- Esperado: `valorProSoluto = 7000`

#### Cenário 5: Apenas Balões (1 grupo)

- Dados: `teve_balao: 'sim', grupos_balao: [{qtd: 2, valor: 5000}]`
- Esperado: `valorProSoluto = 10000`

#### Cenário 6: Balões (múltiplos grupos)

- Dados: `teve_balao: 'sim', grupos_balao: [{qtd: 1, valor: 10000}, {qtd: 2, valor: 5000}]`
- Esperado: `valorProSoluto = 20000`

#### Cenário 7: Sinal + Entrada + Balões

- Dados: Todos os campos preenchidos
- Esperado: Soma de todos os valores

#### Cenário 8: Valores Zero/Nulos

- Dados: Campos vazios, null, undefined, 0
- Esperado: `valorProSoluto = 0` (sem erros)

#### Cenário 9: Grupos Inválidos

- Dados: Grupos com null, undefined, objetos inválidos
- Esperado: Ignorar grupos inválidos, calcular apenas válidos

#### Cenário 10: Fator de Comissão

- Dados: `percentualTotal: 7`
- Esperado: `fatorComissao = 0.07`

#### Cenário 11: Fator de Comissão Zero

- Dados: `percentualTotal: 0`
- Esperado: `fatorComissao = 0`

#### Cenário 12: Fator de Comissão Decimal

- Dados: `percentualTotal: 6.5`
- Esperado: `fatorComissao = 0.065`

**Validação:**

- [ ] Documento de testes criado
- [ ] Todos os cenários documentados
- [ ] Valores esperados calculados manualmente

---

## FASE 4: Implementar Funções Centralizadas (SOMENTE DEPOIS DOS TESTES)

### 4.1 Criar `calcularValorProSoluto`

**Arquivo**: `src/lib/calculos/proSoluto.js`

**Implementação:**

```javascript
/**
 * Calcula o valor total do pro-soluto (sinal + entrada + balões)
 * 
 * @param {Object} dadosVenda - Dados da venda
 * @param {boolean} dadosVenda.teve_sinal
 * @param {number|string} dadosVenda.valor_sinal
 * @param {boolean} dadosVenda.teve_entrada
 * @param {boolean} dadosVenda.parcelou_entrada
 * @param {number|string} dadosVenda.valor_entrada - Usado se não parcelou
 * @param {Array} gruposParcelasEntrada - Array de {qtd, valor} - Usado se parcelou
 * @param {string} dadosVenda.teve_balao - 'sim', 'nao', 'pendente'
 * @param {Array} gruposBalao - Array de {qtd, valor}
 * @returns {number} Valor total do pro-soluto
 */
export function calcularValorProSoluto(dadosVenda, gruposParcelasEntrada = [], gruposBalao = []) {
  // Sinal
  const valorSinal = dadosVenda.teve_sinal ? (parseFloat(dadosVenda.valor_sinal) || 0) : 0
  
  // Entrada
  let valorEntradaTotal = 0
  if (dadosVenda.teve_entrada) {
    if (dadosVenda.parcelou_entrada) {
      // Soma grupos de parcelas (com validação)
      valorEntradaTotal = gruposParcelasEntrada.reduce((sum, grupo) => {
        if (!grupo || typeof grupo !== 'object' || grupo === null) return sum
        return sum + ((parseFloat(grupo.qtd) || 0) * (parseFloat(grupo.valor) || 0))
      }, 0)
    } else {
      // Entrada à vista
      valorEntradaTotal = parseFloat(dadosVenda.valor_entrada) || 0
    }
  }
  
  // Balões
  let valorTotalBalao = 0
  if (dadosVenda.teve_balao === 'sim') {
    valorTotalBalao = gruposBalao.reduce((sum, grupo) => {
      if (!grupo || typeof grupo !== 'object' || grupo === null) return sum
      return sum + ((parseFloat(grupo.qtd) || 0) * (parseFloat(grupo.valor) || 0))
    }, 0)
  }
  
  // Pro-soluto = sinal + entrada + balões
  return valorSinal + valorEntradaTotal + valorTotalBalao
}
```

### 4.2 Criar `calcularFatorComissao`

**Arquivo**: `src/lib/calculos/proSoluto.js`

**Implementação:**

```javascript
/**
 * Calcula o fator de comissão (percentual total / 100)
 * 
 * @param {number} percentualTotal - Percentual total de comissão (ex: 7 para 7%)
 * @returns {number} Fator de comissão (ex: 0.07 para 7%)
 */
export function calcularFatorComissao(percentualTotal) {
  if (percentualTotal === null || percentualTotal === undefined || isNaN(percentualTotal)) {
    return 0
  }
  return parseFloat(percentualTotal) / 100
}
```

### 4.3 Exportar no index.js

**Arquivo**: `src/lib/calculos/index.js`

```javascript
export { calcularComissoesDinamicas } from './comissoes.js'
export { calcularValorProSoluto, calcularFatorComissao } from './proSoluto.js'
```

**Validação:**

- [ ] Funções criadas
- [ ] Funções exportadas
- [ ] Código sem erros de sintaxe
- [ ] **NÃO usar ainda no código de produção**

---

## FASE 5: Testes Comparativos (CRÍTICO)

### 5.1 Atualizar Função de Teste

**Arquivo**: `src/pages/AdminDashboard.jsx`

**O que fazer:**

1. Importar funções centralizadas (temporariamente)
2. Atualizar `testarCalculoProSoluto` para usar funções novas
3. Adicionar chamadas de teste em pontos críticos:

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - No `handleSaveVenda` (linha ~840)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - No `gerarPagamentosVenda` (linha ~1578)

**Validação:**

- [ ] Função de teste atualizada
- [ ] Testes executados em todos os cenários
- [ ] Todos os testes passando (resultados idênticos)

---

## FASE 6: Substituição Gradual (SOMENTE SE TESTES PASSAREM)

### 6.1 Substituir em `handleSaveVenda`

**Arquivo**: `src/pages/AdminDashboard.jsx` linha ~808-840

**O que fazer:**

1. Importar funções: `import { calcularValorProSoluto, calcularFatorComissao } from '../lib/calculos'`
2. Substituir cálculo de `valorProSoluto`
3. Substituir cálculo de `fatorComissao`
4. Manter função de teste ativa para validar

**Validação:**

- [ ] Substituição feita
- [ ] Teste comparativo executado
- [ ] Resultados idênticos confirmados
- [ ] Teste manual: criar venda e verificar valores

### 6.2 Substituir em `gerarPagamentosVenda`

**Arquivo**: `src/pages/AdminDashboard.jsx` linha ~1561-1578

**O que fazer:**

1. Substituir cálculo de `valorProSoluto` (ATENÇÃO: esta função usa campos simples, não grupos)
2. Substituir cálculo de `fatorComissao`
3. Validar que funciona com dados do banco (vendas existentes)

**Validação:**

- [ ] Substituição feita
- [ ] Teste comparativo executado
- [ ] Teste manual: gerar pagamentos e verificar valores

### 6.3 Substituir em `ImportarVendas.jsx`

**Arquivo**: `src/components/ImportarVendas.jsx` linha ~672-692

**O que fazer:**

1. Importar funções
2. Substituir cálculos
3. Testar importação de arquivo Excel

**Validação:**

- [ ] Substituição feita
- [ ] Teste manual: importar Excel e verificar valores

---

## FASE 7: Validação Final e Limpeza

### 7.1 Testes Finais

**Checklist:**

- [ ] Criar venda com sinal → Verificar `valor_pro_soluto` no banco
- [ ] Criar venda com entrada à vista → Verificar cálculo
- [ ] Criar venda com entrada parcelada (1 grupo) → Verificar cálculo
- [ ] Criar venda com entrada parcelada (múltiplos grupos) → Verificar cálculo
- [ ] Criar venda com balões (1 grupo) → Verificar cálculo
- [ ] Criar venda com balões (múltiplos grupos) → Verificar cálculo
- [ ] Criar venda com sinal + entrada + balões → Verificar soma
- [ ] Gerar pagamentos → Verificar `comissao_gerada = valor * fatorComissao`
- [ ] Importar vendas via Excel → Verificar cálculos
- [ ] Comparar valores antes/depois da refatoração (mesmas vendas)

### 7.2 Remover Código de Teste

**O que fazer:**

1. Remover função `testarCalculoProSoluto`
2. Remover logs de teste
3. Remover imports temporários não utilizados

**Validação:**

- [ ] Código limpo
- [ ] Nenhum código de teste restante
- [ ] Funcionalidades mantidas

---

## Regras de Ouro

1. **NUNCA substituir código sem testar antes**
2. **Sempre comparar valores antes/depois**
3. **Testar cada cenário crítico manualmente**
4. **Validar no banco de dados após cada mudança**
5. **Se qualquer teste falhar, REVERTER imediatamente**

---

## Arquivos a Modificar

1. `src/lib/calculos/proSoluto.js` (criar funções)
2. `src/lib/calculos/index.js` (adicionar exports)
3. `src/pages/AdminDashboard.jsx` (substituir cálculos)
4. `src/components/ImportarVendas.jsx` (substituir cálculos)

## Arquivos de Documentação

1. `ANALISE_PRO_SOLUTO.md` (análise das implementações)
2. `TESTES_PRO_SOLUTO.md` (cenários de teste)

---

## Próximos Passos Imediatos

1. Criar `ANALISE_PRO_SOLUTO.md` documentando todas as implementações
2. Criar `TESTES_PRO_SOLUTO.md` com todos os cenários
3. Criar função de teste comparativo no AdminDashboard
4. Executar testes em todos os cenários
5. Só então criar funções centralizadas
6. Testar funções centralizadas vs código antigo
7. Substituir gradualmente se todos os testes passarem