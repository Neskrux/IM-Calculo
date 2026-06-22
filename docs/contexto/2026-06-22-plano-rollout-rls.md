# Plano de Rollout do RLS — IM-Calculo

> **Status:** rascunho para revisão. Nada aplicado em produção.
> **Data:** 2026-06-22 · **Branch:** `docs/rls-rollout-plan`

---

## 1. Por que agora

Estado atual medido em produção (2026-06-22):

| Tabela | RLS | Policies |
|---|---|---|
| `vendas` | ❌ off | 5 (**inertes** — RLS desligado) |
| `pagamentos_prosoluto` | ❌ off | 0 |
| `clientes` | ❌ off | 0 |
| `usuarios` | ❌ off | 0 |
| `comissoes_venda` / `renegociacoes` / `cargos_empreendimento` / `empreendimentos` | ❌ off | 0 |

A chave **anon** do Supabase está no bundle do front (é o desenho normal — o RLS *é* a proteção). Com RLS off, qualquer um dos **76 corretores** logados consegue, via devtools, ler a comissão de todos os outros e o **CPF/telefone/endereço de todos os clientes**. Não é risco de escala — é confidencialidade já exposta hoje.

As 5 policies de `vendas` dão **falsa sensação de segurança**: existem mas não são aplicadas porque `relrowsecurity = false`.

**Pré-requisitos já concluídos** (ver `.claude/rules/leitura-de-listas-e-refetch.md`):
- Cap-1000 corrigido (`fetchAllPaginated`).
- Refetch escopado no Admin (não recarrega 19k linhas por mutação).
- Regra explícita: *"refetch escopado primeiro (feito), RLS depois — nunca o contrário."* → **estamos no ponto certo da sequência.**

**Gatilho extra:** a feature de puxar contratos (PDF assinado, PII) pro Storage exige RLS + policy de bucket. Fazer contratos antes do RLS amplia a exposição.

---

## 2. Modelo de identidade (fonte da verdade das policies)

```
usuarios.id          = auth.uid()          (uuid)   tipo ∈ {admin(1), corretor(76), cliente(3)}
vendas.corretor_id   → usuarios.id                  (corretor dono da venda)
vendas.cliente_id    → clientes.id
clientes.user_id     = auth.uid()                   (login do cliente)
clientes.corretor_id → usuarios.id                  (corretor dono do cliente)
pagamentos_prosoluto.venda_id → vendas.id           (NÃO tem corretor_id → passa por vendas)
```

- **`service_role`** (edge functions `sienge-sync` + scripts `.mjs`) **bypassa RLS** → o sync e os backfills continuam funcionando sem mudança.
- O **app** (corretor/cliente/admin) lê com a anon key + JWT do usuário → **RLS é aplicado**.
- O **admin** loga como usuário normal com `tipo='admin'` → enxerga tudo via policy de admin. ⚠️ Consequência crítica: **toda tabela com RLS ligado precisa de uma policy de admin**, senão o AdminDashboard quebra.

---

## 3. Princípios de design

1. **Helpers `SECURITY DEFINER STABLE`** (`is_admin()`, etc.). Dois motivos:
   - **Evitam recursão** quando `usuarios` ganhar RLS (uma policy em `usuarios` que consulta `usuarios` recursa; a função `SECURITY DEFINER` roda como owner e bypassa RLS lá dentro, quebrando o ciclo).
   - **Performance:** marcadas `STABLE`, o planner avalia uma vez por query (initplan) em vez de por linha — decisivo nas 19k linhas de `pagamentos_prosoluto`.
2. **Padrão `(select auth.uid())`** dentro das policies (vira initplan, não roda por linha).
3. **Cada fase = 1 migration** que liga RLS + cria policies. **Reversível na hora** (`disable row level security`).
4. **Testar por impersonação em transação ANTES de ligar em prod** (seção 6).
5. **Fetch-by-id que volta 0 linhas lança erro explícito** (já é regra) — sob RLS, ausência silenciosa é o modo de falha.
6. **Filtros explícitos no código permanecem** (`.eq('corretor_id', …)`): a policy é backstop de segurança, o filtro é o plano de query. Defense-in-depth.

---

## 4. Helpers (migration 034)

```sql
-- 034_rls_helpers.sql
create or replace function public.current_tipo()
returns text language sql stable security definer set search_path = public as $$
  select tipo from public.usuarios where id = (select auth.uid())
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where id = (select auth.uid()) and tipo = 'admin')
$$;

-- "sou o corretor dono desta venda?" — usado pelas policies de pagamentos/comissões
create or replace function public.is_corretor_da_venda(p_venda_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.vendas v
    where v.id = p_venda_id and v.corretor_id = (select auth.uid())
  )
$$;

revoke all on function public.current_tipo(), public.is_admin(), public.is_corretor_da_venda(uuid) from public;
grant execute on function public.current_tipo(), public.is_admin(), public.is_corretor_da_venda(uuid) to authenticated;
```

Índice de apoio (provável que já exista — confirmar): `create index if not exists idx_pagamentos_venda_id on pagamentos_prosoluto(venda_id);` e `idx_vendas_corretor_id on vendas(corretor_id)`.

---

## 5. Ordem de rollout (menor risco → maior)

Cada fase é uma migration própria, testada por impersonação e validada na UI antes da seguinte. **Uma tabela só liga depois que sua policy de admin existe.**

### Fase 0 — Mecanismo + tabelas de domínio (migration 034 + 035)
Tabelas de leitura geral, risco mínimo. Valida que "ligar RLS + policy de leitura" não quebra o app.
```sql
-- empreendimentos, cargos_empreendimento, coordenadoras
alter table empreendimentos enable row level security;
create policy "authenticated lê empreendimentos" on empreendimentos
  for select to authenticated using (true);
-- (admin/escrita: via is_admin() para insert/update/delete)
```
Domínio é não-sensível (lista de empreendimentos, percentuais de cargo) → `using (true)` para todo autenticado é aceitável. Escrita só admin.

### Fase 1 — `clientes` (migration 036) — PII máxima
```sql
alter table clientes enable row level security;

create policy "admin total clientes" on clientes
  for all to authenticated using (is_admin()) with check (is_admin());

create policy "corretor lê seus clientes" on clientes
  for select to authenticated
  using (
    corretor_id = (select auth.uid())
    -- refinamento a validar: incluir clientes ligados a uma venda do corretor,
    -- caso clientes.corretor_id divirja de vendas.corretor_id (cliente realocado):
    or exists (select 1 from vendas v where v.cliente_id = clientes.id and v.corretor_id = (select auth.uid()))
  );

create policy "cliente lê a si mesmo" on clientes
  for select to authenticated using (user_id = (select auth.uid()));
```
> ⚠️ Validar contra dados reais se o `or exists(...)` é necessário (cliente cuja venda é de um corretor ≠ `clientes.corretor_id`). Se nunca ocorre, remover pra simplificar/acelerar.

### Fase 2 — `vendas` (migration 037)
As 4 policies de admin + a de corretor **já existem** — só faltam a de **cliente** e ligar o RLS.
```sql
create policy "cliente lê suas vendas" on vendas
  for select to authenticated
  using (cliente_id in (select id from clientes where user_id = (select auth.uid())));

alter table vendas enable row level security;   -- ativa as 5 inertes + a nova
```
> Conferir se as 4 policies de admin existentes usam `is_admin()` ou o `EXISTS(usuarios…)` antigo — padronizar pra `is_admin()` (perf + recursão).

### Fase 3 — `pagamentos_prosoluto` + `comissoes_venda` + `renegociacoes` (migration 038) — **ponto de perf**
Sem `corretor_id` próprio → policy passa por `vendas`.
```sql
alter table pagamentos_prosoluto enable row level security;

create policy "admin total pagamentos" on pagamentos_prosoluto
  for all to authenticated using (is_admin()) with check (is_admin());

create policy "corretor lê pagamentos das suas vendas" on pagamentos_prosoluto
  for select to authenticated using (is_corretor_da_venda(venda_id));

create policy "cliente lê pagamentos das suas vendas" on pagamentos_prosoluto
  for select to authenticated
  using (venda_id in (
    select v.id from vendas v join clientes c on c.id = v.cliente_id
    where c.user_id = (select auth.uid())
  ));
```
**Medir antes/depois** com `explain analyze` numa conta de corretor grande (MATHEUS, 2.930 parcelas; CARLOS BRUNO, 2.559). Se a função `is_corretor_da_venda` por linha pesar, alternativa é materializar o filtro: o front já manda `.in('venda_id', [...])` escopado, então a policy é só backstop — o custo real é dominado pelo filtro explícito do app, não pela policy. Confirmar com EXPLAIN.

### Fase 4 — `usuarios` (migration 039) — cuidado com recursão
```sql
alter table usuarios enable row level security;

create policy "lê o próprio perfil" on usuarios
  for select to authenticated using (id = (select auth.uid()));

create policy "admin lê/gerencia todos usuarios" on usuarios
  for all to authenticated using (is_admin()) with check (is_admin());
```
> `is_admin()` é `SECURITY DEFINER` → não recursa. **Crítico:** o bootstrap de login (`auth.ts` / front) faz `select … from usuarios where id = user.id` — a policy "lê o próprio perfil" cobre isso. Testar login dos 3 papéis logo após ligar.
> Se o AdminDashboard lista corretores pra non-admin em algum ponto, mapear antes (provavelmente só admin lista).

### Fase 5 — Storage dos contratos (migration/route 040)
Hoje o upload usa `getPublicUrl` → URL pública é risco pra PII. Recomendação:
- **Bucket privado** `contratos`.
- Download via **signed URL** gerada por uma edge function pequena que, com `service_role`, confere se o requisitante (corretor dono / cliente / admin) pode ver aquela venda e só então assina a URL (TTL curto, ex. 60s).
- Alternativa só-policy: path `contratos/{venda_id}/arquivo.pdf` + policy em `storage.objects` casando o `venda_id` do path contra `is_corretor_da_venda`. Mais frágil (depende de convenção de path) — preferir a edge function.

---

## 6. Como testar uma policy SEM ligar em produção (impersonação em transação)

O `execute_sql` conecta como superuser (BYPASSRLS) → precisa trocar de role. Tudo dentro de `begin/rollback` não persiste:

```sql
begin;
  alter table vendas enable row level security;            -- liga só nesta transação
  set local role authenticated;                            -- agora RLS é aplicado
  set local request.jwt.claims = '{"sub":"<uuid-do-corretor>","role":"authenticated"}';
  select count(*) from vendas;                             -- deve ser só as dele
  select count(*) from vendas where corretor_id <> '<uuid-do-corretor>';  -- deve ser 0
rollback;                                                  -- desliga; nada mudou em prod
```
Rodar pra um corretor, um cliente e o admin antes de cada fase. `auth.uid()` lê de `request.jwt.claims.sub`.

---

## 7. Checklist de validação na UI (por fase, com login real)

- **Corretor:** Dashboard (cards de comissão batem), Minhas Vendas, Meus Pagamentos (conta grande não trunca), Relatórios.
- **Cliente:** Compras, Documentos, parcelas.
- **Admin:** todas as abas + baixa/excluir baixa + gerar relatório + sync.
- **Sync/cron:** rodar o `sienge-sync` (service_role) e confirmar que escreve normal.

Sintoma de policy errada = **tela/lista vazia sem erro**. Por isso o "0 linhas = erro explícito" e o teste por impersonação vêm antes.

---

## 8. Rollback

Qualquer fase reverte na hora:
```sql
alter table <tabela> disable row level security;
```
As policies continuam definidas (inertes), prontas pra religar após corrigir.

---

## 9. Riscos / armadilhas mapeados

| Risco | Mitigação |
|---|---|
| Admin dashboard quebra (sem policy admin na tabela) | Toda fase inclui policy `is_admin()` ANTES de ligar |
| Recursão em `usuarios` | Helpers `SECURITY DEFINER` |
| Perf em `pagamentos_prosoluto` (19k × policy) | Função `STABLE` + `(select auth.uid())` + filtro `.in()` do app domina; medir com EXPLAIN |
| Cliente realocado (clientes.corretor_id ≠ venda) | Cláusula `or exists(venda…)` na policy de `clientes` — validar se necessária |
| URLs públicas de contrato (PII) | Bucket privado + signed URL via edge |
| Escritas do app como non-service-role | **TODO: enumerar caminhos de escrita por papel** (corretor cria solicitação? cliente edita perfil?) e criar policies INSERT/UPDATE correspondentes — senão a ação falha silenciosa |
| Realtime/subscriptions (se houver) | Também sujeitos a RLS — revisar se o app usa |

**Pendência de descoberta antes da Fase 1:** mapear todos os pontos onde o app escreve (`insert/update/delete`) com a anon key (não service_role), por papel. Sem isso, ligar RLS pode bloquear uma escrita legítima do corretor/cliente.

---

## 10. Resumo executável

1. **034** helpers + índices.
2. **035** domínio (empreendimentos/cargos/coordenadoras) — valida mecanismo.
3. **036** `clientes` (PII).
4. **037** `vendas` (+ policy cliente, padronizar admin).
5. **038** `pagamentos` + `comissoes_venda` + `renegociacoes` (medir perf).
6. **039** `usuarios` (recursão).
7. **040** Storage contratos (bucket privado + signed URL).

Cada passo: enumerar escritas → escrever policies → testar por impersonação → ligar → validar UI nos 3 papéis → seguir. Reversível a qualquer momento.
