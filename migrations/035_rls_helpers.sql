-- =============================================
-- MIGRATION 035: Helpers de RLS (SECURITY DEFINER STABLE)
-- Fase 0 do rollout de RLS. Ver docs/contexto/2026-06-22-plano-rollout-rls.md (§3, §4).
--
-- Mecanismo base usado pelas policies das fases seguintes:
--   - SECURITY DEFINER → roda como owner e bypassa RLS lá dentro (evita recursão
--     quando usuarios ganhar RLS: policy em usuarios que consulta usuarios recursaria).
--   - STABLE + padrão (select auth.uid()) → vira initplan (avaliado 1x por query,
--     não por linha — decisivo nas 19k linhas de pagamentos_prosoluto).
--
-- NÃO liga RLS em nada aqui — só cria as funções e índices de apoio.
-- Reversível: DROP FUNCTION public.current_tipo(), public.is_admin(),
--             public.is_corretor_da_venda(uuid);
-- =============================================

create or replace function public.current_tipo()
returns text language sql stable security definer set search_path = public as $$
  select tipo from public.usuarios where id = (select auth.uid())
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuarios where id = (select auth.uid()) and tipo = 'admin'
  )
$$;

-- "sou o corretor dono desta venda?" — usado pelas policies de pagamentos/comissões
-- (pagamentos_prosoluto não tem corretor_id → a autorização passa por vendas).
create or replace function public.is_corretor_da_venda(p_venda_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.vendas v
    where v.id = p_venda_id and v.corretor_id = (select auth.uid())
  )
$$;

revoke all on function public.current_tipo(), public.is_admin(), public.is_corretor_da_venda(uuid) from public;
grant execute on function public.current_tipo(), public.is_admin(), public.is_corretor_da_venda(uuid) to authenticated;

-- Índices de apoio (idempotentes): a policy de pagamentos passa por vendas.
create index if not exists idx_pagamentos_venda_id on public.pagamentos_prosoluto(venda_id);
create index if not exists idx_vendas_corretor_id on public.vendas(corretor_id);
