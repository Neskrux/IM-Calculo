-- Migration 013: Adiciona campo periodicidade_parcelas na tabela vendas
-- Armazena o intervalo em meses entre parcelas da entrada (1=mensal, 3=trimestral, 4=quadrimestral, 6=semestral, 12=anual)

ALTER TABLE vendas
ADD COLUMN IF NOT EXISTS periodicidade_parcelas INTEGER DEFAULT 1;

COMMENT ON COLUMN vendas.periodicidade_parcelas IS 'Intervalo em meses entre parcelas da entrada: 1=mensal, 3=trimestral, 4=quadrimestral, 6=semestral, 12=anual';
