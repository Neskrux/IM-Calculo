# Instruções: Testes de Pro-Soluto

## 📋 IDs de Teste Configurados

- **Corretor ID**: `5e721ccd-3435-47ae-a282-29d3b223f9f5` (tabela `usuarios`)
- **Cliente ID**: `f29a99ce-39cd-4824-aca5-ab60513d5673` (tabela `clientes`)

---

## 🚀 Como Executar os Testes

### Opção 1: Via Console do Navegador (Recomendado)

1. **Abra o sistema** e navegue até a página `AdminDashboard`
2. **Abra o Console do Navegador**:
   - Pressione `F12` ou `Ctrl+Shift+I` (Windows/Linux)
   - Ou `Cmd+Option+I` (Mac)
   - Vá para a aba **Console**
3. **Abra o arquivo** `docs/script_testes_prosoluto.js`
4. **Copie todo o conteúdo** do arquivo
5. **Cole no console** do navegador
6. **Execute o comando**:
   ```javascript
   executarTodosTestes()
   ```

### Opção 2: Testar Cenário Específico

Se quiser testar apenas um cenário específico:

```javascript
// Testar cenário 1 (Apenas Sinal)
testarCenarioEspecifico(1)

// Testar cenário 7 (Sinal + Entrada + Balões)
testarCenarioEspecifico(7)
```

---

## 📊 Cenários de Teste Incluídos

O script testa **15 cenários** completos:

### Testes de Valor Pro-Soluto:

1. ✅ **Cenário 1**: Apenas Sinal (valor: 10000)
2. ✅ **Cenário 1.1**: Sinal com valor zero
3. ✅ **Cenário 1.2**: Sinal com valor null
4. ✅ **Cenário 1.3**: Sinal como string ("10000")
5. ✅ **Cenário 1.4**: teve_sinal = false (deve ignorar valor_sinal)
6. ✅ **Cenário 2**: Apenas Entrada à Vista (valor: 20000)
7. ✅ **Cenário 3**: Entrada Parcelada (1 grupo) - 5x R$ 2.000 = R$ 10.000
8. ✅ **Cenário 4**: Entrada Parcelada (múltiplos grupos) - (3x R$ 1.000) + (2x R$ 2.000) = R$ 7.000
9. ✅ **Cenário 5**: Apenas Balões (1 grupo) - 2x R$ 5.000 = R$ 10.000
10. ✅ **Cenário 6**: Balões (múltiplos grupos) - (1x R$ 10.000) + (2x R$ 5.000) = R$ 20.000
11. ✅ **Cenário 7**: Sinal + Entrada + Balões (completo) - R$ 5.000 + R$ 10.000 + R$ 10.000 = R$ 25.000
12. ✅ **Cenário 8**: Valores Zero/Nulos (deve retornar 0 sem erros)
13. ✅ **Cenário 9**: Grupos Inválidos (null, undefined, strings inválidas) - deve ignorar inválidos
14. ✅ **Cenário 10**: Entrada Parcelada com Campos Simples (compatibilidade com banco)

### Testes de Fator de Comissão:

15. ✅ **Cenário 11**: Fator de Comissão Normal (7% = 0.07)
16. ✅ **Cenário 12**: Fator de Comissão Zero (0% = 0)
17. ✅ **Cenário 13**: Fator de Comissão Decimal (6.5% = 0.065)
18. ✅ **Cenário 14**: Fator de Comissão com Percentual Alto (15% = 0.15)
19. ✅ **Cenário 15**: Fator de Comissão com Valores Inválidos (null = 0)

---

## 📈 Interpretando os Resultados

### ✅ Teste Passou
```
✅ Cenário 1: Apenas Sinal
{
  cenario: "Cenário 1: Apenas Sinal",
  antigo: { valorProSoluto: 10000, fatorComissao: 0.07 },
  novo: { valorProSoluto: 10000, fatorComissao: 0.07 },
  saoIguais: true,
  resultadoEsperado: true,
  passou: true
}
```

### ❌ Teste Falhou
```
❌ Cenário X: Nome do Cenário
{
  cenario: "Cenário X: Nome do Cenário",
  antigo: { valorProSoluto: 10000, fatorComissao: 0.07 },
  novo: { valorProSoluto: 9999, fatorComissao: 0.07 },
  saoIguais: false,  // ← Diferença encontrada!
  resultadoEsperado: true,
  passou: false
}
```

### 📊 Resumo Final

Ao final, o script exibe um resumo:

```
════════════════════════════════════════════════════════════════════════════
📊 RESUMO DOS TESTES
════════════════════════════════════════════════════════════════════════════
✅ Passou: 19/19
❌ Falhou: 0/19
📈 Taxa de sucesso: 100.00%
════════════════════════════════════════════════════════════════════════════
```

---

## ⚠️ Importante

1. **O script NÃO cria vendas no banco de dados** - apenas testa os cálculos
2. **Os IDs de teste** (`corretor_id` e `cliente_id`) são apenas para referência - não são usados nos cálculos
3. **Todos os testes são comparativos** - comparam cálculo antigo vs novo
4. **Tolerância de erro**: Diferenças menores que R$ 0,01 são consideradas iguais (para lidar com arredondamentos)

---

## 🔧 Solução de Problemas

### Erro: "calcularValorProSoluto is not defined"

**Causa**: As funções não estão disponíveis no escopo do console.

**Solução**: O script inclui implementações locais das funções. Se ainda assim der erro, verifique se:
- Você está na página `AdminDashboard`
- O código foi carregado completamente
- Tente recarregar a página e executar novamente

### Erro: "ReferenceError: require is not defined"

**Causa**: O script tenta importar módulos, mas isso não funciona no console do navegador.

**Solução**: Isso é esperado. O script tem fallback para implementações locais. O erro pode ser ignorado.

### Testes falhando

**Causa**: Pode haver diferenças entre a implementação antiga e nova.

**Ação**: 
1. Verifique os logs detalhados do teste que falhou
2. Compare os valores `antigo` vs `novo`
3. Verifique se a diferença é significativa (> R$ 0,01)
4. Se necessário, ajuste a função centralizada em `src/lib/calculos/proSoluto.js`

---

## 📝 Próximos Passos

Após todos os testes passarem:

1. ✅ Validar que todos os 19 cenários passaram
2. ✅ Verificar se não há erros no console
3. ✅ Documentar resultados em `docs/teste_prosoluto_logs.txt`
4. ⏭️ Prosseguir para FASE 6: Substituição Gradual no código de produção

---

**Última atualização**: 23/12/2025  
**Versão do Script**: 1.0

