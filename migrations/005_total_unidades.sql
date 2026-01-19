-- ================================================
-- MIGRATION: Adicionar campo total_unidades em empreendimentos
-- ================================================

-- Adicionar coluna total_unidades na tabela empreendimentos
ALTER TABLE public.empreendimentos
ADD COLUMN IF NOT EXISTS total_unidades INTEGER DEFAULT 0;

-- Comentário
COMMENT ON COLUMN public.empreendimentos.total_unidades IS 'Número total de unidades do empreendimento';
