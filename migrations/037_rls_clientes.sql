-- =============================================
-- MIGRATION 037: RLS Fase 1 — clientes (PII máxima)
-- Ver docs/contexto/2026-06-22-plano-rollout-rls.md (§5 Fase 1) + enumeração de
-- escritas client-side (2026-06-22).
--
-- clientes guarda CPF/telefone/endereço — hoje legível por qualquer corretor logado.
-- Policies:
--   - admin: tudo (is_admin()).
--   - corretor: lê os seus (corretor_id próprio OU cliente de uma venda sua).
--   - cliente: lê e ATUALIZA só a si mesmo (upload de doc *_url — ClienteDashboard.jsx:504).
--
-- service_role (sync/scripts) bypassa RLS. Pré-req: migration 035 (is_admin()).
-- Reversível: alter table public.clientes disable row level security; drop policy ...;
-- =============================================

alter table public.clientes enable row level security;

create policy "admin total clientes" on public.clientes
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "corretor lê seus clientes" on public.clientes
  for select to authenticated
  using (
    corretor_id = (select auth.uid())
    -- cliente realocado: a venda pode ser de um corretor ≠ clientes.corretor_id.
    -- ⚠️ validar contra dados reais se esse OR é necessário; se nunca ocorre, remover.
    or exists (
      select 1 from public.vendas v
      where v.cliente_id = clientes.id and v.corretor_id = (select auth.uid())
    )
  );

create policy "cliente lê a si mesmo" on public.clientes
  for select to authenticated
  using (user_id = (select auth.uid()));

-- escrita do cliente sobre o PRÓPRIO registro (upload de documentos: colunas *_url)
create policy "cliente atualiza a si mesmo" on public.clientes
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
