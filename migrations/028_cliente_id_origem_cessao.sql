-- =============================================
-- MIGRATION 028: vendas.cliente_id_origem += 'cessao'
-- Ref: migrations/021_corretor_cliente_id_origem.sql, .claude/rules/sincronizacao-sienge.md
-- Data: 2026-06-05
-- Descrição: Permite rastrear o titular trocado por CESSÃO DE DIREITOS.
--            'cessao' = cliente_id alterado por cessão; o sync de sales-contracts deve
--            tratar como 'manual' (não sobrescrever cego, só logar drift).
--            Mantém corretor_id_origem intacto. Idempotente.
-- =============================================

ALTER TABLE public.vendas DROP CONSTRAINT IF EXISTS vendas_cliente_id_origem_check;

ALTER TABLE public.vendas
  ADD CONSTRAINT vendas_cliente_id_origem_check
  CHECK (cliente_id_origem IN ('sync', 'manual', 'cessao'));

COMMENT ON COLUMN public.vendas.cliente_id_origem IS
  'Origem do cliente_id: sync (default, sync pode sobrescrever); manual (corrigido por humano, sync NÃO sobrescreve); cessao (titular trocado por cessão de direitos, sync NÃO sobrescreve).';
