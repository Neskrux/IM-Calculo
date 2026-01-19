-- =============================================
-- MIGRATION: Adicionar categoria "Logo" para fotos
-- =============================================

-- Adicionar categoria "logo" na tabela foto_categorias
INSERT INTO public.foto_categorias (nome, label, cor, ordem) 
VALUES ('logo', 'Logo', '#c9a962', 0)
ON CONFLICT (nome) DO NOTHING;

-- Comentário
COMMENT ON TABLE public.foto_categorias IS 'Categorias/Setores para organizar fotos de empreendimentos (inclui Logo)';
