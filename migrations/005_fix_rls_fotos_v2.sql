-- =====================================================
-- FIX RLS PARA EMPREENDIMENTO_FOTOS
-- Execute este SQL completo no Supabase SQL Editor
-- =====================================================

-- Opção 1: Desabilitar RLS temporariamente (mais rápido para testar)
ALTER TABLE public.empreendimento_fotos DISABLE ROW LEVEL SECURITY;

-- OU Opção 2: Manter RLS mas com políticas permissivas
-- Descomente as linhas abaixo se preferir manter RLS ativo

/*
-- Remover todas as políticas existentes
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'empreendimento_fotos') 
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.empreendimento_fotos';
    END LOOP;
END $$;

-- Criar políticas permissivas
CREATE POLICY "fotos_select_all" ON public.empreendimento_fotos
  FOR SELECT USING (true);

CREATE POLICY "fotos_insert_all" ON public.empreendimento_fotos
  FOR INSERT WITH CHECK (true);

CREATE POLICY "fotos_update_all" ON public.empreendimento_fotos
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "fotos_delete_all" ON public.empreendimento_fotos
  FOR DELETE USING (true);
*/

-- Verificar status
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE tablename = 'empreendimento_fotos';

SELECT '✅ RLS desabilitado para empreendimento_fotos' as status;
