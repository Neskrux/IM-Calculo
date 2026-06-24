# RLS como North Star — estado "bem feito", onde começar, quanto tempo

## Context

RLS está desligado em todas as tabelas sensíveis (prod, 2026-06-22). Hoje qualquer um dos 76
corretores logados lê, via devtools, a comissão de todos + CPF/telefone/endereço de todos os clientes.
É confidencialidade já exposta — risco independente de escala.

A auditoria do front (2 Explore agents) mostrou terreno favorável: cliente Supabase único com anon key,
**zero service_role no front**, leituras já escopadas com filtro explícito, e superfície de escrita de
não-admin minúscula e auto-escopada (corretor → `solicitacoes`/perfil próprio; cliente → perfil próprio).
Service_role (sync/cron/scripts) bypassa RLS → não quebra.

O usuário pediu pra pensar como **north star**, padrão de mercado de segurança, com a régua
**"bem feito > perfeito nunca feito"** — ou seja, definir o estado seguro suficiente e parar ali,
sem gold-plating.

## North Star — o que é "bem feito" (padrão de mercado Supabase)

1. **Deny-by-default em toda tabela exposta via PostgREST.** RLS ligado (+ `FORCE` onde fizer sentido)
   em todas; nenhuma tabela legível pela anon key sem policy. (É exatamente o que o **Supabase linter**
   marca como erro — ele vira o nosso portão de "pronto".)
2. **Least-privilege por papel** (admin / corretor / cliente) para **todas** as operações que o app
   realmente faz — SELECT *e* INSERT/UPDATE/DELETE — espelhando os escopos que já estão no código
   (`corretor_id = auth.uid()`, `user_id = auth.uid()`, `venda_id ∈ vendas do dono`).
3. **Checagem de papel via funções `SECURITY DEFINER STABLE`** (`is_admin`, `is_corretor_da_venda`) —
   evita recursão em `usuarios` e mantém perf (avaliação 1×/query).
4. **Buckets privados + signed URL** para PII (contratos, RG, comprovantes). Zero URL pública de documento.
5. **Validado**: testes de policy por impersonação (todos os papéis × tabelas) **e** Supabase linter limpo.
6. **Rollout observável**: durante a virada, fetch-by-id que volta 0 linhas lança erro explícito
   (já é regra do projeto) — ausência silenciosa é o modo de falha do RLS.

### Fora de escopo de propósito (o "perfeito" que NÃO vamos perseguir agora)
pgAudit/audit-log completo, column-level security, roles Postgres por tenant, pentest contratado,
e os edge-cases de features congeladas. Para 55 usuários, isso é gold-plating — o north star acima já
é padrão de mercado e defensável. Entram só se um requisito de cliente/compliance exigir.

## Onde começar — sequência (dependência + risco crescente)

**Passo 0 — Spike de terreno (zero prod).** Impersonação em `BEGIN…ROLLBACK` na conta do maior corretor
(**CARLOS BRUNO**, `aa7b6ac3-6279-42e9-a0f7-c5a334262037`, 2.874 parcelas) + um cliente, ligando RLS só
dentro da transação em `vendas` + `pagamentos_prosoluto` (caminho quente + único risco de perf). Prova
corretude (vê só o dele, 0 dos outros), perf (EXPLAIN sob RLS ≈ sem RLS) e ausência de recursão. Rollback.
**É o go/no-go.**

```sql
begin;
  alter table vendas enable row level security;
  alter table pagamentos_prosoluto enable row level security;
  create policy p_v on vendas for select to authenticated using (corretor_id = (select auth.uid()));
  create policy p_p on pagamentos_prosoluto for select to authenticated using (is_corretor_da_venda(venda_id));
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aa7b6ac3-6279-42e9-a0f7-c5a334262037","role":"authenticated"}';
  select count(*) from vendas;                                          -- só do Carlos
  select count(*) from vendas where corretor_id <> (select auth.uid()); -- = 0
  explain analyze select * from pagamentos_prosoluto where venda_id in (select id from vendas);
rollback;  -- nada persiste
```

**Passos seguintes (cada um = 1 migration, reversível com `disable`):**
- **034** helpers (`is_admin`, `current_tipo`, `is_corretor_da_venda`) + índices de apoio.
- **035** domínio (`empreendimentos`, `cargos_empreendimento`, `coordenadoras`): leitura aberta a
  autenticado, escrita só admin. Valida o mecanismo com risco zero.
- **036** `clientes` (PII): admin tudo; corretor → clientes das suas vendas (Opção A); cliente → si mesmo.
- **037** `vendas`: liga RLS (4 policies admin já existem — padronizar p/ `is_admin()`) + add policy cliente.
- **038** `pagamentos_prosoluto` + `comissoes_venda` + `renegociacoes` (via `vendas`). Medir perf.
- **039** `usuarios`: self-read + admin + leitura básica de corretor (cliente precisa do nome do corretor).
- **040** escritas non-admin: policies INSERT/UPDATE pros poucos caminhos do corretor/cliente
  (`solicitacoes corretor_id=auth.uid()`, perfil próprio, etc.) — o app já manda escopado.
- **041** Storage: buckets `documentos`/`contratos` privados + edge function de signed URL com checagem de acesso.
- **042** hardening final: `FORCE row level security` onde couber, revogar grants desnecessários da anon,
  e **rodar o Supabase linter até ficar limpo** (portão de "pronto").

Detalhe completo das policies está em `docs/contexto/2026-06-22-plano-rollout-rls.md` (branch `docs/rls-rollout-plan`).

## Quanto tempo até o North Star (com IA)

| Bloco | Esforço focado | Gating |
|---|---|---|
| Spike (go/no-go) | ~meio dia | IA + 1 execução |
| Helpers + policies de leitura (034–039) | ~1 dia | IA |
| Policies de escrita (040) | ~meio dia | IA |
| Storage privado + signed URL (041) | ~1 dia | IA + edge deploy |
| Hardening + linter limpo (042) | ~meio dia | IA |
| Flip em prod por fase + validar UI nos 3 logins | ~1 semana **calendário** | **humano** (login real, vigiar "lista vazia") |

**Veredito:** **go/no-go em < 1 dia.** **North star atingido em ~1 semana de calendário / ~4–5 dias-pessoa
de trabalho focado.** A IA comprime autoria e testes; **o gargalo é a validação cuidadosa nos 3 papéis**
(policy errada = tela vazia sem erro) — por isso espalhar em ~1 semana, não correr em 2 dias.

Isso é o "bem feito": deny-by-default, least-privilege, PII em bucket privado, linter limpo, validado.
Defensável como padrão de mercado para um app Supabase — sem virar projeto infinito.

## Verificação

- **Spike:** contagens por papel batem com o filtro explícito atual; EXPLAIN sob RLS ≈ sem RLS no CARLOS.
- **Cada fase:** login real corretor/cliente/admin → dashboards com totais corretos; conta grande (2.874)
  não trunca/degrada; sync (`sienge-sync`, service_role) escreve normal; reversível com `disable`.
- **Portão final:** Supabase linter sem alertas de "RLS disabled / policy exists but RLS off".

## Não-objetivos
- Não liga RLS em prod no spike (só transação rolled-back).
- Não decide o Ponto 1 (`fetchTodosClientes`, feature congelada) — gate da fase `clientes`, com a gestora.
- Não persegue audit-log/column-security/pentest agora (fora do north star definido).
- Não mexe na divisão de pages (adiada — valor de dev, não de segurança).
