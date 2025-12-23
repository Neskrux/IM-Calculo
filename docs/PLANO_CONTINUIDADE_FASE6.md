# 🚀 Plano de Continuidade - FASE 6: Substituição Gradual

**Data**: 23/12/2025  
**Status Atual**: ✅ FASE 5 Concluída (20/20 testes passando)  
**Próxima Fase**: FASE 6 - Substituição Gradual

---

## 📊 Estado Atual do Projeto

### ✅ Concluído

1. **FASE 1**: Centralização de cálculos de comissões
   - ✅ Função `calcularComissoesDinamicas` centralizada
   - ✅ Estrutura de módulos criada (`src/lib/calculos/`)

2. **FASE 2-4**: Preparação para Pro-Soluto
   - ✅ Análise completa das implementações
   - ✅ Funções centralizadas criadas (`calcularValorProSoluto`, `calcularFatorComissao`)
   - ✅ Funções exportadas em `src/lib/calculos/index.js`

3. **FASE 5**: Testes Comparativos
   - ✅ Script de testes criado e validado
   - ✅ **20/20 testes passando (100%)**
   - ✅ Funções importadas em `AdminDashboard.jsx` (linha 20-24)
   - ✅ Função de teste comparativo ativa (linha 847-909)

### ⏭️ Próximo Passo: FASE 6

**Objetivo**: Substituir código antigo pelas funções centralizadas, mantendo testes ativos para validação.

---

## 🎯 FASE 6: Substituição Gradual

### ⚠️ IMPORTANTE

- **NUNCA substituir sem testar antes**
- **Manter função de teste ativa durante toda a substituição**
- **Testar cada substituição manualmente**
- **Se qualquer teste falhar, REVERTER imediatamente**

---

## 📋 Plano de Execução

### 6.1 Substituir em `handleSaveVenda` (PRIORIDADE 1)

**Arquivo**: `src/pages/AdminDashboard.jsx`  
**Localização**: Linha ~811-844

**Estado Atual**:
- ✅ Funções já importadas (linha 20-24)
- ❌ Código antigo ainda em uso (linha 812-844)
- ✅ Função de teste ativa (linha 847-909)

**O que fazer**:

1. **Substituir cálculo de `valorProSoluto`** (linha 812-840)
   ```javascript
   // ANTES (código antigo):
   const valorSinal = vendaForm.teve_sinal ? (parseFloat(vendaForm.valor_sinal) || 0) : 0
   let valorEntradaTotal = 0
   // ... código complexo ...
   const valorProSoluto = valorSinal + valorEntradaTotal + valorTotalBalao
   
   // DEPOIS (função centralizada):
   const valorProSoluto = calcularValorProSoluto(vendaForm, gruposParcelasEntrada, gruposBalao)
   ```

2. **Substituir cálculo de `fatorComissao`** (linha 844)
   ```javascript
   // ANTES:
   const fatorComissao = comissoesDinamicas.percentualTotal / 100
   
   // DEPOIS:
   const fatorComissao = calcularFatorComissao(comissoesDinamicas.percentualTotal)
   ```

3. **Manter função de teste ativa** para validar

**Validação**:
- [ ] Código substituído
- [ ] Função de teste ainda funciona
- [ ] Teste manual: criar venda e verificar console (deve mostrar ✅)
- [ ] Verificar valores salvos no banco

**Tempo estimado**: 15 minutos

---

### 6.2 Substituir em `gerarPagamentosVenda` (PRIORIDADE 2)

**Arquivo**: `src/pages/AdminDashboard.jsx`  
**Localização**: Linha ~1630-1648

**Estado Atual**:
- ✅ Funções já importadas
- ❌ Código antigo ainda em uso
- ✅ Função de teste ativa (linha 1649-1678)

**O que fazer**:

1. **Substituir cálculo de `valorProSoluto`** (linha 1630-1645)
   ```javascript
   // ANTES:
   const valorSinal = venda.teve_sinal ? (parseFloat(venda.valor_sinal) || 0) : 0
   let valorEntradaTotal = 0
   // ... código complexo ...
   const valorProSoluto = valorSinal + valorEntradaTotal + valorTotalBalao
   
   // DEPOIS:
   // Esta função usa campos simples do banco, não grupos
   const valorProSoluto = calcularValorProSoluto(venda, [], [])
   ```

2. **Substituir cálculo de `fatorComissao`** (linha 1647)
   ```javascript
   // ANTES:
   const fatorComissao = comissoesDinamicas.percentualTotal / 100
   
   // DEPOIS:
   const fatorComissao = calcularFatorComissao(comissoesDinamicas.percentualTotal)
   ```

3. **Manter função de teste ativa** para validar

**Validação**:
- [ ] Código substituído
- [ ] Função de teste ainda funciona
- [ ] Teste manual: gerar pagamentos e verificar console (deve mostrar ✅)
- [ ] Verificar valores gerados no banco

**Tempo estimado**: 15 minutos

---

## 📝 Checklist de Execução

### Antes de Começar
- [ ] Fazer backup do código atual (commit)
- [ ] Verificar que todos os testes estão passando (20/20)
- [ ] Ter IDs de teste disponíveis:
  - Corretor: `0489316a-a963-415d-b9d1-1b6dac16482f`
  - Cliente: `f29a99ce-39cd-4824-aca5-ab60513d5673`

### Durante Execução
- [ ] Substituir código em `handleSaveVenda`
- [ ] Testar criando uma venda
- [ ] Verificar console (deve mostrar ✅)
- [ ] Verificar valores no banco
- [ ] Substituir código em `gerarPagamentosVenda`
- [ ] Testar gerando pagamentos
- [ ] Verificar console (deve mostrar ✅)
- [ ] Substituir código em `ImportarVendas.jsx`
- [ ] Testar importação Excel

### Após Execução
- [ ] Todos os testes passando
- [ ] Valores corretos no banco
- [ ] Nenhum erro no console
- [ ] Funcionalidades mantidas

---

## ⚠️ Regras de Ouro

1. **NUNCA substituir código sem testar antes**
2. **Sempre comparar valores antes/depois**
3. **Testar cada cenário crítico manualmente**
4. **Validar no banco de dados após cada mudança**
5. **Se qualquer teste falhar, REVERTER imediatamente**

---

## 🎯 Resultado Esperado

Após concluir a FASE 6:

- ✅ Código antigo substituído por funções centralizadas
- ✅ Funções de teste ainda ativas (para validação contínua)
- ✅ Todos os testes passando
- ✅ Valores corretos no banco de dados
- ✅ Pronto para FASE 7 (Limpeza e Validação Final)

---

## 📚 Documentos Relacionados

- `extrair_cálculos_pro-soluto_com_testes_rigorosos_35fe0bd6.plan.md` - Plano completo
- `REFATORACAO_FASE1_CONCLUIDA.md` - Fase 1 concluída
- `TESTES_PRO_SOLUTO.md` - Cenários de teste
- `script_testes_prosoluto.js` - Script de testes automatizado

---

**Última atualização**: 23/12/2025  
**Versão**: 1.0

