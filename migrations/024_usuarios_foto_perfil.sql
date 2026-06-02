-- Migration 024: Foto de Perfil de Usuários
-- Criada em: 2026-05-25
-- Objetivo:
--   1. Adicionar coluna `foto_url` em `usuarios` pra guardar URL da foto de perfil
--   2. Criar bucket `usuarios-fotos` público (read) com RLS de escrita por dono
--   3. Permitir que cada usuário gerencie só a própria foto (pasta = auth.uid())
--
-- Frontend (CorretorDashboard / AdminDashboard) bloqueia primeiro acesso quando
-- foto_url IS NULL, forçando upload antes de usar o sistema.

-- =====================================================
-- 1. COLUNA foto_url em usuarios
-- =====================================================

ALTER TABLE public.usuarios
ADD COLUMN IF NOT EXISTS foto_url TEXT;

COMMENT ON COLUMN public.usuarios.foto_url IS
  'URL pública da foto de perfil (bucket usuarios-fotos). NULL = sem foto. '
  'Frontend força upload no primeiro acesso pra admin/corretor.';

-- =====================================================
-- 2. BUCKET usuarios-fotos
-- =====================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('usuarios-fotos', 'usuarios-fotos', true)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- 3. RLS POLICIES do bucket
-- =====================================================
-- Convenção: arquivos vão em "usuarios-fotos/{auth.uid()}/avatar.{ext}"
-- A pasta raiz dentro do bucket é o ID do usuário — RLS valida via storage.foldername().

-- 3.1 SELECT: qualquer autenticado vê (foto aparece em cards, listas, etc.)
DROP POLICY IF EXISTS "usuarios_fotos_select_autenticado" ON storage.objects;
CREATE POLICY "usuarios_fotos_select_autenticado"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'usuarios-fotos');

-- 3.2 INSERT: usuário só faz upload na própria pasta
DROP POLICY IF EXISTS "usuarios_fotos_insert_owner" ON storage.objects;
CREATE POLICY "usuarios_fotos_insert_owner"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'usuarios-fotos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 3.3 UPDATE: usuário só substitui a própria foto
DROP POLICY IF EXISTS "usuarios_fotos_update_owner" ON storage.objects;
CREATE POLICY "usuarios_fotos_update_owner"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'usuarios-fotos'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'usuarios-fotos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 3.4 DELETE: usuário só deleta a própria foto
DROP POLICY IF EXISTS "usuarios_fotos_delete_owner" ON storage.objects;
CREATE POLICY "usuarios_fotos_delete_owner"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'usuarios-fotos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
