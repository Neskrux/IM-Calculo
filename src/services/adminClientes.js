/**
 * Serviço de operações admin sobre clientes (exclusão soft delete).
 * Usado pelo AdminDashboard; permite testar a lógica de exclusão com mocks.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient
 * @param {string} clienteId - UUID do cliente
 * @returns {Promise<{ success: true }>}
 * @throws {Error} quando o Supabase retorna error
 */
export async function deleteCliente(supabaseClient, clienteId) {
  if (!clienteId) {
    throw new Error('ID do cliente é obrigatório')
  }

  const { data, error } = await supabaseClient
    .from('clientes')
    .update({ ativo: false })
    .eq('id', clienteId)
    .select('id')

  if (error) {
    throw new Error(error.message || 'Erro ao excluir cliente')
  }

  // Se nenhuma linha foi atualizada (RLS, coluna ativo inexistente, etc.), tratar como falha
  if (!data || data.length === 0) {
    throw new Error(
      'Nenhum registro atualizado. Verifique se a coluna "ativo" existe na tabela clientes e se há permissão de UPDATE (RLS).'
    )
  }

  return { success: true }
}
