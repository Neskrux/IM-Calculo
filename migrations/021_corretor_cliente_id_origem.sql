-- Migration 021 — vendas.corretor_id_origem + vendas.cliente_id_origem
--
-- Contexto: ver .claude/rules/sincronizacao-sienge.md (secao "vendas.corretor_id /
-- vendas.cliente_id - protecao contra sobrescrita")
--
-- Motivacao: Etapa C/D do plano de limpeza pos-validacao (2026-04-27) precisa
-- mapear corretor_id (via API /commissions) e cliente_id (via raw local) em
-- vendas que estao com NULL. Sem esse campo, sync futuro de sales-contracts
-- pode sobrescrever a correcao manual/api e perder o trabalho.
--
-- Semantica:
--   'sync'           = preenchido por sync Sienge (default). Sync pode sobrescrever.
--   'manual'         = corrigido por humano. Sync NAO sobrescreve.
--   'api_commissions'= mapeado via /accounts-receivable/receivable-bills/{billId}/commissions.
--                      Sync de sales-contracts nao sobrescreve.
--
-- Reversivel: ALTER TABLE vendas DROP COLUMN corretor_id_origem, DROP COLUMN cliente_id_origem;

ALTER TABLE vendas ADD COLUMN IF NOT EXISTS corretor_id_origem text NOT NULL DEFAULT 'sync'
  CHECK (corretor_id_origem IN ('sync','manual','api_commissions'));

ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cliente_id_origem text NOT NULL DEFAULT 'sync'
  CHECK (cliente_id_origem IN ('sync','manual'));

COMMENT ON COLUMN vendas.corretor_id_origem IS
  'Origem do corretor_id: sync (default), manual (corrigido por humano, protegido contra sobrescrita), api_commissions (via endpoint /commissions).';

COMMENT ON COLUMN vendas.cliente_id_origem IS
  'Origem do cliente_id: sync (default) ou manual (corrigido por humano, protegido contra sobrescrita).';
