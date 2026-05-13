# Configuração de CI/CD — passo a passo

Este documento explica como o sistema de deploy automatizado funciona e o que você precisa configurar uma vez pra ele rodar.

## Por que isso importa

Antes deste setup, atualizar o sistema envolvia:
- `git push` (front automatiza via Vercel/Netlify — OK)
- Lembrar de fazer `supabase functions deploy sienge-sync` (manual, fácil esquecer)
- Lembrar de aplicar migrations no SQL Editor (manual)

O problema é o "lembrar". Se esquecer o deploy da edge function, o código novo está no GitHub mas **não está rodando** no Supabase Cloud — exatamente o que aconteceu hoje, 2026-05-13, com o fix de proteção `corretor_id_origem`.

CI/CD elimina o "lembrar": cada push pra `main` que toca a edge function dispara o deploy automaticamente.

---

## O que foi criado

### 1. `.github/workflows/supabase-deploy.yml`
**O que faz**: quando alguém faz push pra `main` alterando algo em `supabase/functions/`, o GitHub Actions automaticamente:
1. Instala o Supabase CLI
2. Roda `supabase functions deploy sienge-sync`

**Tempo**: ~1 minuto.
**Trigger**: push pra `main` que toque `supabase/functions/**`, OU acionamento manual via aba "Actions" do GitHub.

### 2. `.github/workflows/ci.yml`
**O que faz**: em todo push e PR, roda `npm run lint`, `npm run build` e `npm run test:run`. Se algo quebrar, aparece um ❌ vermelho no commit/PR — você vê antes de mergear.

**Sem secrets** — pura validação de código.

---

## Conceitos (mini-glossário)

- **CI/CD**: Continuous Integration / Continuous Deployment. Automação de teste e deploy disparada por mudanças no código.
- **GitHub Actions**: mecanismo do próprio GitHub pra rodar essas automações. Os workflows ficam em `.github/workflows/*.yml`.
- **Workflow**: um arquivo YAML que descreve "quando isso, faz aquilo".
- **Job**: uma sequência de passos dentro de um workflow.
- **Step**: comando individual (instalar dependência, rodar script, etc).
- **Secrets**: variáveis sensíveis (tokens, senhas) guardadas criptografadas no GitHub. O workflow lê via `${{ secrets.NOME }}`. **Nunca** commitar tokens no código.
- **`workflow_dispatch`**: trigger que permite rodar o workflow manualmente, sem precisar de push (útil pra re-deployar sem fazer commit fake).

---

## Configuração inicial (~15 min, uma vez só)

### Passo 1: gerar Personal Access Token no Supabase

1. Acessa https://supabase.com/dashboard/account/tokens
2. Clica em **Generate new token**
3. Nome: algo como "GitHub Actions IM-Calculo"
4. **Copia o token** — só aparece uma vez, depois fica oculto. Se perder, gera outro.

### Passo 2: descobrir o Project Ref

1. Abre o Supabase Dashboard do projeto
2. Olha a URL: `https://supabase.com/dashboard/project/SEU_REF_AQUI`
3. Copia o `SEU_REF_AQUI` (algo tipo `abcdefghijklmnop`, 20 caracteres).

Alternativa: `Settings → General → Reference ID`.

### Passo 3: adicionar os secrets no GitHub

1. Vai no repositório no GitHub.
2. **Settings → Secrets and variables → Actions → New repository secret**
3. Adiciona 2 secrets:

| Nome | Valor |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | (token do Passo 1) |
| `SUPABASE_PROJECT_REF` | (ref do Passo 2) |

Depois disso, o workflow já funciona. Próximo push que toque `supabase/functions/` deploya automaticamente.

---

## Como confirmar que funciona

Após configurar os secrets:

1. **Forçar um deploy manual** (não precisa fazer commit):
   - Vai em **Actions** no GitHub.
   - Seleciona **"Deploy Supabase Edge Functions"** na barra lateral.
   - Clica em **Run workflow → Run workflow**.
   - Aguarda ~1min. Deve ficar verde ✅.

2. **Validar no banco**: rode `node scripts/check-integridade-geral.mjs` e confira que as vendas com `origem='manual'` continuam intactas.

---

## E as migrations?

**Por que não automatizei**: migrations alteram schema do banco em produção. Erro aí pode causar dados perdidos ou downtime. O risco/benefício não compensa pra um time pequeno — automatizar exige:
- Reorganizar `migrations/` pra `supabase/migrations/` com naming padrão (`YYYYMMDDhhmmss_*.sql`).
- Inicializar `schema_migrations` no banco marcando todas as antigas (001-022) como aplicadas. Se errar, o CI roda 001 de novo em produção.
- Branch protection rigorosa pra evitar push direto na main com migration delicada.

Por enquanto, fluxo manual continua: você abre [migrations/NNN_*.sql](../migrations/), copia, cola no SQL Editor do Supabase, roda.

Quando o time crescer ou frequência de migrations subir, vale planejar essa migração — não é grande deal, mas merece um esforço focado de ~2h.

---

## O que mais dá pra fazer no futuro

Coisas que vão na próxima onda quando essa estabilizar:

1. **Branch protection** em `main` — impede push direto, força PR.
2. **Preview deploys** em PRs — Vercel já faz isso pro front; pra edge function dá pra ter um projeto Supabase staging.
3. **Validar edge function antes do deploy** — `supabase functions deploy --no-verify-jwt --dry-run` (ou step de `deno check`).
4. **Notificar Slack** quando deploy fica verde/vermelho.
5. **Rollback automático** se health check falhar pós-deploy.

Tudo isso é depois — não vale empurrar agora. Primeiro deixa o básico rodando, ganha confiança, e expande quando sentir gargalo.

---

## Troubleshooting

### "Error: unauthorized" no deploy
Token do Passo 1 expirou ou foi revogado. Gera outro e atualiza o secret `SUPABASE_ACCESS_TOKEN`.

### Workflow não dispara
Confere:
- Push foi pra branch `main`? (Outros branches não disparam.)
- Mudança tocou `supabase/functions/**` ou `.github/workflows/supabase-deploy.yml`? (Outras paths não disparam.)
- Workflow está habilitado? (Em **Actions** → garantir que não está pausado.)

### Build do front falha no CI mas funciona local
- Diferença de Node version: o CI usa Node 20. Se você usa outro local, alinhar.
- Dependência faltando em `package.json`: `npm ci` no CI é mais estrito que `npm install`.

---

## Resumo executivo

| O quê | Como deploya hoje | Frequência típica | Como deploya com CI/CD |
|---|---|---|---|
| Front | Vercel/Netlify (automático) | Várias por dia | Igual (sem mudança) |
| Edge function | Manual (`supabase functions deploy`) | Semanas/meses | Automático no push |
| Migration SQL | Manual (SQL Editor) | Raro | Continua manual (revisão humana) |

Investimento: ~15min uma vez (gerar token + adicionar 2 secrets).
Ganho recorrente: nunca mais esquecer deploy de edge function.
