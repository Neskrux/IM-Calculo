-- =====================================================
-- Migration 008: Campo tem_acesso_sistema
-- =====================================================
-- Adiciona campo para identificar se o corretor tem
-- acesso ao sistema (conta no Supabase Auth)
-- =====================================================

-- Adicionar coluna tem_acesso_sistema
ALTER TABLE public.usuarios
ADD COLUMN IF NOT EXISTS tem_acesso_sistema BOOLEAN DEFAULT false;

-- Comentário explicativo
COMMENT ON COLUMN public.usuarios.tem_acesso_sistema IS 
'Indica se o usuário tem conta no Supabase Auth e pode fazer login. 
Corretores sincronizados do Sienge iniciam com false.
Quando o admin ativa o acesso, este campo é marcado como true.';

-- Atualizar corretores que já têm acesso (não são do Sienge ou têm email real)
-- Corretores com email @sync.local ou @placeholder.local não têm acesso
UPDATE public.usuarios
SET tem_acesso_sistema = true
WHERE tipo = 'corretor'
  AND email IS NOT NULL
  AND email NOT LIKE '%@sync.local'
  AND email NOT LIKE '%@placeholder.local'
  AND origem IS NULL;

-- Marcar explicitamente os sincronizados como sem acesso
UPDATE public.usuarios
SET tem_acesso_sistema = false
WHERE tipo = 'corretor'
  AND (
    email LIKE '%@sync.local'
    OR email LIKE '%@placeholder.local'
    OR origem = 'sienge'
  )
  AND tem_acesso_sistema IS NULL;

-- Admins e clientes com email real têm acesso
UPDATE public.usuarios
SET tem_acesso_sistema = true
WHERE tipo IN ('admin', 'cliente')
  AND email IS NOT NULL
  AND email NOT LIKE '%@sync.local'
  AND email NOT LIKE '%@placeholder.local';

-- Índice para consultas rápidas
CREATE INDEX IF NOT EXISTS idx_usuarios_tem_acesso_sistema 
ON public.usuarios(tem_acesso_sistema) 
WHERE tipo = 'corretor';

-- Verificação final
DO $$
DECLARE
  total_corretores INT;
  com_acesso INT;
  sem_acesso INT;
BEGIN
  SELECT COUNT(*) INTO total_corretores FROM public.usuarios WHERE tipo = 'corretor';
  SELECT COUNT(*) INTO com_acesso FROM public.usuarios WHERE tipo = 'corretor' AND tem_acesso_sistema = true;
  SELECT COUNT(*) INTO sem_acesso FROM public.usuarios WHERE tipo = 'corretor' AND tem_acesso_sistema = false;
  
  RAISE NOTICE '📊 RESUMO DA MIGRATION 008';
  RAISE NOTICE 'Total de corretores: %', total_corretores;
  RAISE NOTICE 'Com acesso ao sistema: %', com_acesso;
  RAISE NOTICE 'Sem acesso (sincronizados): %', sem_acesso;
END $$;
