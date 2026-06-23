-- =============================================
-- MIGRATION 036: RLS Fase 0 — tabelas de domínio (risco mínimo)
-- Ver docs/contexto/2026-06-22-plano-rollout-rls.md (§5 Fase 0).
--
-- Liga RLS em tabelas de leitura geral, NÃO-sensíveis (lista de empreendimentos,
-- percentuais de cargo, coordenadoras): todo autenticado LÊ, só admin ESCREVE.
-- Objetivo: validar que "ligar RLS + policy" não quebra o app ANTES de mexer nas
-- tabelas sensíveis (clientes/vendas/pagamentos).
--
-- service_role (sync/scripts) bypassa RLS → não afetado.
-- Pré-req: migration 035 (is_admin()).
-- Reversível: alter table ... disable row level security; drop policy ...;
-- =============================================

-- ── empreendimentos ──────────────────────────────────────────────────────────
alter table public.empreendimentos enable row level security;

create policy "auth lê empreendimentos" on public.empreendimentos
  for select to authenticated using (true);

create policy "admin escreve empreendimentos" on public.empreendimentos
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── cargos_empreendimento ────────────────────────────────────────────────────
alter table public.cargos_empreendimento enable row level security;

create policy "auth lê cargos" on public.cargos_empreendimento
  for select to authenticated using (true);

create policy "admin escreve cargos" on public.cargos_empreendimento
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── coordenadoras ────────────────────────────────────────────────────────────
alter table public.coordenadoras enable row level security;

create policy "auth lê coordenadoras" on public.coordenadoras
  for select to authenticated using (true);

create policy "admin escreve coordenadoras" on public.coordenadoras
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
