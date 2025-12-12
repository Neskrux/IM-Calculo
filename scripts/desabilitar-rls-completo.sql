-- =============================================
-- DESABILITAR RLS NAS TABELAS PRINCIPAIS
-- Execute este script no SQL Editor do Supabase
-- =============================================

-- Desabilitar RLS na tabela usuarios (resolve o loop de políticas)
ALTER TABLE usuarios DISABLE ROW LEVEL SECURITY;

-- Desabilitar RLS na tabela vendas
ALTER TABLE vendas DISABLE ROW LEVEL SECURITY;

-- Verificar se funcionou
SELECT 
    tablename,
    rowsecurity
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('usuarios', 'vendas', 'empreendimentos', 'clientes', 'cargos_empreendimento', 'pagamentos_prosoluto', 'comissoes_venda', 'complementadores_renda');

-- Resultado esperado: rowsecurity = false para todas as tabelas

