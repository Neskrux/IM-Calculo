
-- Adicionar CRECI
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS creci_url TEXT;
COMMENT ON COLUMN public.usuarios.creci_url IS 'URL do documento CRECI no Storage (bucket documentos)';
