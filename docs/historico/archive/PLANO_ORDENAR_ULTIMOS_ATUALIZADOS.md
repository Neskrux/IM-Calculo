# Plano: Visualização por Últimos Atualizados

## Objetivo
Ordenar a lista da aba Pagamentos (Admin) pelos grupos com pagamentos mais recentemente alterados (confirmar, editar, excluir baixa) no topo.

## Arquivos

| Arquivo | Alteração |
|---------|-----------|
| `src/pages/AdminDashboard.jsx` | Alterar `.sort()` de `filteredPagamentos` para usar `updated_at` |

## Lógica

- **Atual:** Ordena por `venda.data_venda` (data da venda)
- **Nova:** Ordena pelo **maior `updated_at`** entre os pagamentos do grupo (última alteração em qualquer parcela)
- **Fallback:** Se nenhum pagamento tiver `updated_at`, usar `created_at` do pagamento; se ainda assim não houver, usar `venda.data_venda`

## Riscos

| Risco | Mitigação |
|-------|-----------|
| `updated_at` null em registros antigos | Fallback para `created_at` e `data_venda` |
| Migration 011 não aplicada | `updated_at` será null; fallback garante ordenação |

## Testes

1. Confirmar pagamento → grupo deve subir ao topo
2. Editar baixa → grupo deve subir ao topo
3. Excluir baixa → grupo deve subir ao topo
4. Sem alterações recentes → ordenação por data da venda (fallback)

## Validação

1. Aba Pagamentos → alterar uma parcela (confirmar/editar/excluir) → grupo deve aparecer no topo após `fetchData()`
2. Grupos sem `updated_at` (dados antigos) → ordenados por `data_venda` (fallback)
3. Verificar que a lista não quebra com arrays vazios
