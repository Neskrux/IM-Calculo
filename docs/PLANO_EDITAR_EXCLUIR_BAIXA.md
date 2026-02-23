# Plano: Editar e Excluir Baixa (Demanda 1)

## Fluxo atual (ponto de entrada → banco)

```
AdminDashboard (activeTab='pagamentos')
  → fetchData() carrega vendas, pagamentos, empreendimentos, etc.
  → pagamentos agrupados por venda_id (grupos)
  → Cada parcela: botão "Confirmar" se status !== 'pago'
  → confirmarPagamento(pag) → abre modal
  → processarConfirmarPagamento() → supabase.from('pagamentos_prosoluto').update(...)
```

## Arquivos envolvidos

| Arquivo | Alteração |
|---------|-----------|
| `src/pages/AdminDashboard.jsx` | Único arquivo - adicionar Editar/Excluir |

## Funções e ordem de chamadas

### Editar Baixa
1. `editarBaixa(pag)` - novo handler, abre modal com dados atuais
2. Reutiliza: `showModalConfirmarPagamento`, `formConfirmarPagamento`, `processarConfirmarPagamento`
3. `processarConfirmarPagamento` → `supabase.from('pagamentos_prosoluto').update({ status, data_pagamento, comissao_gerada? })`

### Excluir Baixa (reverter)
1. `excluirBaixa(pag)` - novo handler, abre modal de confirmação
2. `processarExcluirBaixa()` - UPDATE status='pendente', data_pagamento=null

## Riscos

| Risco | Mitigação |
|-------|-----------|
| Relatórios desatualizados após reverter | fetchData() recarrega; relatórios usam status para filtrar |
| Edição acidental | Modal exige ação explícita; botão Salvar |
| Exclusão acidental | Modal "Tem certeza?" antes de reverter |

## Testes manuais

1. **Editar baixa:** Parcela paga → Editar → alterar data e/ou comissão → Salvar → verificar UPDATE
2. **Excluir baixa:** Parcela paga → Excluir → confirmar → verificar status=pendente, data_pagamento=null
3. **Confirmar (existente):** Parcela pendente → Confirmar → deve continuar funcionando

## Schema - sem alteração

A tabela `pagamentos_prosoluto` atual já suporta:
- UPDATE em `status`, `data_pagamento`, `comissao_gerada`
- Nenhuma migration necessária para escopo mínimo

---

## Validação (como testar)

1. **Editar baixa**
   - Admin → Pagamentos → localizar parcela com status "Pago"
   - Clicar em "Editar"
   - Alterar data e/ou valor personalizado → "Salvar Alterações"
   - Conferir no Supabase: `pagamentos_prosoluto` com os novos valores

2. **Excluir baixa (reverter)**
   - Parcela paga → "Excluir" → confirmar "Reverter Baixa"
   - Parcela deve voltar a "Pendente", data de pagamento removida
   - Conferir no Supabase: `status='pendente'`, `data_pagamento=null`

3. **Confirmar (fluxo existente)**
   - Parcela pendente → "Confirmar" → deve continuar funcionando normalmente
