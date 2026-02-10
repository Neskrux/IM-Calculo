-- Migration: Documentos do corretor (Meu Perfil)
-- CRECI: upload pessoal por corretor (bucket documentos)
-- Informativo de cálculo: mesmo arquivo para todos (bucket informativo) - em desenvolvimento

ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS creci_url TEXT;

COMMENT ON COLUMN public.usuarios.creci_url IS 'URL do documento CRECI no Storage (bucket documentos)';
