-- Migration 014: Adiciona campo periodicidade_balao na tabela vendas
-- Armazena o intervalo em meses entre balões (3=trimestral, 4=quadrimestral, 6=semestral, 12=anual)

ALTER TABLE vendas
ADD COLUMN IF NOT EXISTS periodicidade_balao INTEGER DEFAULT 6;

COMMENT ON COLUMN vendas.periodicidade_balao IS 'Intervalo em meses entre balões: 3=trimestral, 4=quadrimestral, 6=semestral, 12=anual';
