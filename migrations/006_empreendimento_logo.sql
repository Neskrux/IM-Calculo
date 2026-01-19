-- =============================================
-- MIGRATION: Adicionar logo ao empreendimento
-- =============================================

-- Adicionar coluna para URL da logo do empreendimento
ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Comentário para documentação
COMMENT ON COLUMN empreendimentos.logo_url IS 'URL da logo do empreendimento armazenada no Supabase Storage';
