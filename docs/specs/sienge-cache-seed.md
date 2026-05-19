# Procedimento — Seed do cache Sienge no cron

Documento operacional pro **Bruno** (ou quem mantém o sistema) sobre como popular o cache `.sienge-cache/` do workflow `Reconciliacao Pagamentos` quando ele nasce vazio.

---

## Quando precisa fazer

O workflow tem 3 mecanismos pra sobreviver a Sienge instável:

1. **`actions/cache@v4`** — persiste `.sienge-cache/` entre runs (até 7 dias sem uso).
2. **Stale-on-error em `_sienge-http.mjs`** — se Sienge retornar 429/5xx, serve cache vencido em vez de quebrar.
3. **Seed inicial** — se cache vazio E há secret `SIENGE_CACHE_SEED_URL`, baixa zip via curl no início do job.

**Você precisa fazer seed manual quando:**
- Cron passa 7 dias sem rodar (cache do GitHub expira).
- Reset completo do cache (raro).
- Primeira execução do workflow em um repo recém-clonado/forkado.

**Você NÃO precisa fazer seed quando:**
- Sienge teve 429 momentâneo. O stale-on-error sustenta.
- O cron rodou ontem com sucesso. `actions/cache@v4` restaura.

---

## Passo a passo

### 1. Gerar o zip a partir do seu cache local

Na máquina do Bruno (onde o `.sienge-cache/` foi populado pelos runs manuais):

```bash
cd c:/Users/bruno/IMGrupo/IM-Calculo
# Zip preservando estrutura, exclui temporarios
zip -rq sienge-cache-seed.zip .sienge-cache/
ls -lh sienge-cache-seed.zip  # tipico: 50-200 MB
```

### 2. Upload em local privado

**⚠️ ATENÇÃO: o cache contém dados Sienge (nomes, valores, etc).** Nunca subir em repositório público.

**Opção recomendada — Supabase Storage privado:**
```bash
# bucket privado, ex: 'sienge-cache-seed'
# upload via dashboard ou CLI supabase storage
```

Pegue uma URL assinada (signed URL) com expiração longa (1 ano) — esse é o valor do secret.

**Opção alternativa — GitHub Release privado:**
1. Criar release no repo (sem tag pública)
2. Anexar `sienge-cache-seed.zip` como asset
3. URL fica em `https://api.github.com/repos/Neskrux/IM-Calculo/releases/.../assets/...`
4. Precisa adicionar `GITHUB_TOKEN` ao curl (já disponível no Actions automaticamente)

### 3. Adicionar o secret no repo

GitHub → **Settings → Secrets and variables → Actions → New repository secret**:

- **Name:** `SIENGE_CACHE_SEED_URL`
- **Secret:** a URL assinada do passo 2

### 4. Pronto

Próximo run do workflow (manual via Actions tab ou cron diário) vai:

1. Restaurar cache via `actions/cache@v4` (se existir)
2. Se cache vazio, baixar do `SIENGE_CACHE_SEED_URL`
3. Rodar normal

---

## Como verificar que funcionou

Após o primeiro run com seed configurado, abrir os logs do workflow → step **"Seed cache (so se vazio e secret presente)"**:

- ✅ **Funcionou:** `Seed restaurado: N arquivos` onde N > 0
- ⚠️ **Cache já tinha:** `Cache nao-vazio, pulando seed`
- ❌ **Sem secret:** `SIENGE_CACHE_SEED_URL ausente, pulando seed`

E nos steps seguintes:
- Linhas `[cache] hit` em vez de `[429]`
- Tempo total do job menor (sem download bulk-data)

---

## Quando rotacionar o seed

A cada **3-6 meses**, ou quando:
- Houve sync manual grande (etapa massiva, gera muitas linhas novas no income)
- Reconciliação completa rodou com sucesso e queremos congelar o estado

Refazer o passo 1 (zip novo da máquina local) e atualizar o secret.

---

## Por que não automatizar o seed direto do banco

O cache contém o **dump bruto do Sienge** (incomes paginados, com PII e valores). Hoje ele só existe no disco da máquina do Bruno + nos runners do GitHub Actions. Pra automatizar (ex: job semanal que gera o seed do banco e faz upload), precisaríamos:

- Conseguir extrair income do Sienge sem quota (cron noturno?)
- Gerar zip determinístico
- Upload automatizado

Hoje, o esforço manual de re-seed a cada N meses é menor que essa automação. Se virar dor, vale revisitar.

---

## Referências

- Workflow: [.github/workflows/recurring-reconciliation.yml](../../.github/workflows/recurring-reconciliation.yml)
- Cache + stale-on-error: [scripts/_sienge-http.mjs](../../scripts/_sienge-http.mjs)
