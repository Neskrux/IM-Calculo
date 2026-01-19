-- ================================================
-- MIGRATION: Adicionar campo progresso_obra
-- ================================================

-- Adicionar coluna progresso_obra na tabela empreendimentos
ALTER TABLE empreendimentos 
ADD COLUMN IF NOT EXISTS progresso_obra INTEGER DEFAULT 0;

-- Comentário para documentação
COMMENT ON COLUMN empreendimentos.progresso_obra IS 'Percentual de progresso da obra (0-100)';

-- Garantir que o valor está entre 0 e 100
ALTER TABLE empreendimentos 
ADD CONSTRAINT check_progresso_obra 
CHECK (progresso_obra >= 0 AND progresso_obra <= 100);
