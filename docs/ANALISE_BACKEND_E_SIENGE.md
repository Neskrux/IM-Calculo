# Análise: “Backend” do projeto e integração 100% com a API Sienge

## 1. O que existe hoje

### 1.1 Stack e estrutura

- **Único deploy**: um app **Vite + React** (SPA).
- **Nenhum servidor próprio**: não há Express, Fastify, Node API, Nest, etc.
- **Supabase** é usado como:
  - Banco (PostgreSQL)
  - Auth (login/sessão)
  - Storage (arquivos)
- **“Backend” documentado** no `ANALISE_PROJETO.md` é, na prática, **o próprio Supabase** (serviço gerenciado), não um código de backend no repositório.

### 1.2 Onde roda a lógica de negócio

| O quê | Onde roda | Observação |
|------|-----------|------------|
| Chamadas à API Sienge | **Browser** | `siengeClient.js`, `rawIngestion.js` usam `fetch` no cliente |
| Credenciais Sienge | **Browser** | `VITE_SIENGE_*` → expostas no bundle (qualquer um que abrir o app pode ver) |
| Ingestão RAW (sienge_raw) | **Browser** | `rawIngestion.js` chama Sienge e faz `supabase.from('sienge_raw.objects').upsert(...)` direto do cliente |
| Sync corretores/clientes/vendas | **Browser** | `syncCorretoresV2.js`, `syncClientesV2.js`, `syncVendasV2.js`, orquestrador, etc. |
| Persistência (Supabase) | **Browser → Supabase** | Cliente Supabase (`createClient`) no front com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` |
| Regras de acesso | **Servidor Supabase** | RLS (Row Level Security) definido nas migrations |
| Schema e funções SQL | **Servidor Supabase** | Migrations (tabelas, índices, funções como `sienge_raw.upsert_object`) |

Ou seja: **toda a integração com o Sienge e toda a orquestração de sync rodam no frontend**. O único “servidor” que existe é o Supabase (PostgreSQL + Auth + Storage), sem uma camada de aplicação sua em cima.

### 1.3 Proxy do Vite

- Em **dev**, `vite.config.js` define um proxy: `/api/sienge` → `https://api.sienge.com.br`.
- Objetivo: contornar **CORS** (o browser não chama a API Sienge diretamente em produção se o Sienge não permitir origem do seu domínio).
- Em **build de produção** esse proxy **não existe**: o Vite não sobe servidor. Ou seja, em produção as chamadas seriam direto do browser para `api.sienge.com.br`, sujeitas a CORS e a expor credenciais no cliente.

### 1.4 Resumo da arquitetura atual

```
[Browser]
  ├── React (UI)
  ├── supabase.from() / supabase.auth / supabase.storage  → Supabase (PostgreSQL, Auth, Storage)
  └── fetch(Sienge API) com getSiengeAuth() (VITE_SIENGE_*)  → API Sienge (credenciais no cliente)
```

Não há um “backend” no sentido de **servidor de aplicação seu** que:
- guarde segredos (ex.: credenciais Sienge),
- chame APIs externas em nome do usuário,
- faça filas, retries, rate limit, logs centralizados.

---

## 2. Problemas para integrar 100% com a API Sienge

### 2.1 Segurança

- **Credenciais Sienge no frontend**: `VITE_SIENGE_USERNAME`, `VITE_SIENGE_PASSWORD` (e afins) são embutidas no bundle. Qualquer pessoa que inspecionar o app pode ver e reutilizar.
- Para integração “100%” com Sienge (incluindo produção e possivelmente dados sensíveis), **credenciais não podem ficar no cliente**.

### 2.2 CORS e ambiente de produção

- O proxy do Vite só existe em desenvolvimento.
- Em produção, chamadas do browser para `https://api.sienge.com.br` dependem do **CORS** configurado no Sienge. Se eles não liberarem a origem do seu domínio, as chamadas falham.
- Integração “100%” e confiável normalmente exige que as chamadas ao Sienge partam de **um servidor seu** (ou de uma função serverless), não do browser.

### 2.3 Confiabilidade e controle

- Sync pesado (muitos registros, várias páginas) roda no **navegador**:
  - Usuário pode fechar a aba e interromper o processo.
  - Não há fila, retry automático nem garantia de “execução em background” real.
- Para integração “100%” (sync completo, incremental, reprocessamento), é desejável ter **job em servidor** (cron/scheduler) ou **funções serverless** agendadas, não dependentes da aba aberta.

### 2.4 Rate limit e padrões da API Sienge

- APIs costumam ter rate limit (429). Tratar isso no cliente é possível, mas:
  - Retries e backoff ficam espalhados no front.
  - Em servidor você pode centralizar política de retry, logs e métricas.
- Integração “100%” tende a exigir mais endpoints e mais chamadas; um **backend (ou BFF)** facilita controle e evolução.

---

## 3. Isso pode ser chamado de “backend”?

**Resposta direta: não.** Pelo menos não no sentido usual de “servidor de aplicação” ou “API própria”.

- O que existe é:
  - **Frontend** (React + Vite) com toda a lógica de Sienge e de sync.
  - **Supabase** como serviço de banco, auth e storage (e as migrations como “definição” do modelo e RLS).

Ou seja:

- **Backend “como serviço”**: Sim, no sentido de que o **Supabase** é o backend (DB + Auth + Storage).
- **Backend “como código do projeto”**: Não. Não há um servidor de aplicação, nem Edge Functions no repositório, nem RPCs customizados sendo usados para a integração Sienge. A “lógica de backend” (chamar Sienge, ingerir, mapear, orquestrar) está no **frontend**.

Para integrar **100% com a API do Sienge** de forma segura e sustentável, o ideal é passar a ter um **backend de verdade** (ou um BFF) que:

1. Guarde credenciais Sienge em variáveis de ambiente **não** expostas ao cliente.
2. Faça todas as chamadas à API Sienge **no servidor** (ou em Edge/Cloud Functions).
3. Opcionalmente: exponha endpoints ou jobs (sync completo, incremental, etc.) que o frontend apenas aciona, sem conhecer usuário/senha do Sienge.
4. Centralize retry, rate limit, logs e, se necessário, filas para sync pesado.

---

## 4. Recomendações para evoluir

1. **Introduzir uma camada backend** (ex.: Node + Express/Fastify, ou Supabase Edge Functions, ou outro FaaS) que:
   - Leia credenciais Sienge de env (nunca `VITE_*`).
   - Chame a API Sienge e, se desejado, escreva em `sienge_raw` e nas tabelas core (ou deixe o backend ser o único a falar com o Sienge e o front só ler do Supabase).

2. **Frontend**:
   - Remover `VITE_SIENGE_*` do bundle.
   - Trocar chamadas diretas ao Sienge por chamadas ao **seu** backend (ou a Edge Functions), por exemplo: “POST /api/sync/sienge” ou “POST /api/sienge/ingest”.

3. **Produção**:
   - Garantir que em produção não exista dependência do proxy do Vite para o Sienge; todo tráfego Sienge deve ser “browser → seu backend → Sienge”.

4. **Sync pesado / 100%**:
   - Considerar jobs agendados (cron) ou workers que rodem a ingestão RAW e o sync (corretores, clientes, vendas) em background, sem depender do usuário com a tela aberta.

Com isso, você terá um **backend real** e uma integração com o Sienge que pode ser considerada “100%” do ponto de vista de segurança, CORS, confiabilidade e controle.
