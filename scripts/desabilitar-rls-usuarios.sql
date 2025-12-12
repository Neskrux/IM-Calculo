-- =============================================
-- DESABILITAR RLS APENAS NA TABELA USUARIOS (TEMPORÁRIO)
-- Execute este script no SQL Editor do Supabase
-- =============================================

-- Desabilitar RLS na tabela usuarios
-- Isso permite que todos vejam todos os usuários
-- MAS mantém a segurança nas vendas (corretor só vê suas vendas)
ALTER TABLE usuarios DISABLE ROW LEVEL SECURITY;

-- =============================================
-- IMPORTANTE: A tabela VENDAS mantém RLS ativo!
-- Corretor só vê suas próprias vendas
-- Cliente só vê suas próprias compras
-- Admin vê todas as vendas
-- =============================================

-- Para reverter depois (reabilitar RLS):
-- ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;

