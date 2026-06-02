-- Migration 025: Corrigir percentual total interno padrao para 6,5%
-- Criada em: 2026-05-25
--
-- Contexto:
--   A planilha calculo.xlsx e as regras de comissao usam:
--     externo = 7,0%
--     interno = 6,5%
--
-- Esta migration corrige apenas o percentual atual/default de empreendimentos.
-- Nao recalcula pagamentos antigos: pagamentos_prosoluto.comissao_gerada e
-- fator_comissao_aplicado continuam sendo snapshots historicos.

ALTER TABLE public.empreendimentos
ALTER COLUMN comissao_total_interno SET DEFAULT 6.5;

UPDATE public.empreendimentos
SET comissao_total_interno = 6.5,
    updated_at = NOW()
WHERE comissao_total_interno = 6.0;
