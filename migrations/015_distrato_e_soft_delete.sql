-- =============================================
-- MIGRATION 015: Distrato e Soft Delete em Vendas
-- Data: 2026-04-01
-- Descrição: Adiciona suporte a distrato de contrato e exclusão
--            lógica (soft delete) na tabela vendas
-- ATENÇÃO: NÃO EXECUTAR AUTOMATICAMENTE — rodar manualmente no banco
-- =============================================

-- 1. Adiciona coluna para soft delete (exclusão lógica)
--    Vendas com excluido = true somem completamente da listagem
ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS excluido BOOLEAN DEFAULT false;

-- 2. Adiciona coluna para armazenar a data do distrato
ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS data_distrato DATE;

-- 3. Atualiza o CHECK constraint do campo status para incluir 'distrato'
--    Remove o constraint existente e recria com o novo valor permitido
ALTER TABLE public.vendas
  DROP CONSTRAINT IF EXISTS vendas_status_check;

ALTER TABLE public.vendas
  ADD CONSTRAINT vendas_status_check
  CHECK (status IN ('pendente', 'em_andamento', 'pago', 'distrato'));

-- 4. Índices para performance nas consultas de listagem
CREATE INDEX IF NOT EXISTS idx_vendas_excluido ON public.vendas(excluido);
CREATE INDEX IF NOT EXISTS idx_vendas_data_distrato ON public.vendas(data_distrato);
