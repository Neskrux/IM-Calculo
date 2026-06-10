# Pontos levantados — Visão do Corretor (input pra spec-driven development)

> **Documento vivo.** Cada item é uma observação capturada navegando a visão do corretor.
> **NÃO alterar código/dados nesta fase** — só coletar. A spec e as decisões de correção vêm depois.

## Contexto da coleta
- **Data:** 2026-06-09
- **Visão:** Corretor (conta de teste: **Carlos Bruno** — `carlos.correa.bruno@gmail.com`, 43 vendas ativas)
- **Ambiente:** dev local (`localhost:5176`) apontando pro Supabase de **produção** (`jdkkusrxullttyeakwib`)
- **Branch atual:** `feature/melhorias-de-usabilidade` — _obs.: docs devem ser commitadas em branch dedicada (preferência do projeto)._
- **Flags de teste ativas:** `FORCAR_FOTO_PRIMEIRO_ACESSO=false` (modal de foto desligado); login temporário do Carlos. Ambos a reverter depois.

---

## Ponto 1 — "Meus Pagamentos": Comissão Total não bate com Pendente + Paga (filtro de Junho)

**Onde:** aba **Meus Pagamentos**, filtro de período = **mês de Junho**.

**Observado (screenshot):**

| Card | Valor |
|---|---|
| Comissão Pendente | R$ 9.688,92 |
| Comissão Paga | R$ 0,00 |
| **Comissão Total** | **R$ 11.852,37** |

**Anomalia:** `Pendente + Paga = R$ 9.688,92`, mas o card **Total** mostra **R$ 11.852,37**.
Diferença não explicada = **R$ 2.163,45**.

**Pergunta pra spec:** o card "Comissão Total" respeita o mesmo filtro de período (Junho) que Pendente/Paga?
Hipóteses a confirmar depois (sem mexer agora):
- (a) Total soma a carteira inteira (ignora o filtro de mês), enquanto Pendente/Paga aplicam Junho;
- (b) Total inclui parcelas `cancelado` que não entram em Pendente nem Paga;
- (c) diferença de fonte/cálculo entre os três cards.

**Status:** 🔴 a investigar (não mexer agora)

---

## Ponto 2 — "Minhas Vendas": filtro "Este Mês" zera todos os cards e a lista

**Onde:** aba **Minhas Vendas**, PERÍODO = **"Este Mês"** (Status: Todos, Empreendimento: Todos, sem data início/fim).

**Observado (screenshot):**

| Card | Valor |
|---|---|
| Total a Receber | R$ 0,00 |
| Comissão Paga | R$ 0,00 |
| Pendente | R$ 0,00 |
| Total em Vendas | R$ 0,00 |

Lista: **"Nenhuma venda encontrada"** — apesar do corretor ter **43 vendas ativas**.

**Anomalia:** o filtro "Este Mês" zera tudo. Inconsistente com o **Ponto 1** (em Meus Pagamentos, o filtro de Junho mostra Pendente R$ 9.688,92 — ou seja, há movimentação no mês).

**Pergunta pra spec:** por qual campo de data cada filtro de período filtra?
- Se "Minhas Vendas" filtra por `data_venda` (data de fechamento), zero pode ser tecnicamente correto caso nenhuma venda tenha sido **fechada** em junho/2026 — mas aí "Minhas Vendas" e "Meus Pagamentos" usam critérios diferentes (data da venda × data da parcela), o que confunde o corretor.
- Definir: qual campo cada tela usa e qual o comportamento esperado de "Este Mês" (vendas fechadas no mês? vendas com parcela no mês?).

**Relação:** mesmo tema do Ponto 1 — **semântica do filtro de período** entre telas.

**Status:** 🔴 a investigar (não mexer agora)

---

## Ponto 3 — "Meus Pagamentos": vários cards de venda NÃO expandem (e isso parece causar o Ponto 1)

**Onde:** aba **Meus Pagamentos**, visão **Contrato**. Repro com busca = `renan` → 2 contratos FIGUEIRA GARCIA do cliente **Renan Da Silva Marinho**.

**Sintoma:** ao clicar no card da venda pra abrir as parcelas, **várias vendas não expandem** (nada acontece). "Algumas, na verdade várias" — não é caso isolado.

**Dados observados (os 2 contratos do Renan):**

| Contrato | Parcelas | Pro-soluto | Minha comissão | Recebido | Pendente |
|---|---|---|---|---|---|
| Unidade 1507 | 13 | R$ 25.511,07 | R$ 5.102,22 | R$ 0,00 | R$ 5.102,22 |
| Unidade 1507 D | 14 | R$ 27.473,46 | R$ 5.494,70 | R$ 1.177,44 | R$ 4.317,27 |

**Cards de resumo (com a busca "renan" aplicada):** Pendente R$ 4.317,27 · Paga R$ 1.177,44 · **Total R$ 10.596,93**.

**Conexão com o Ponto 1 (forte):**
- `Total (10.596,93)` ≈ soma da comissão dos **dois** contratos (5.102,22 + 5.494,70 = 10.596,92).
- `Pendente (4.317,27) + Paga (1.177,44)` = **só o contrato 1507 D**.
- O que falta (R$ 5.102,22) é **exatamente o contrato 1507** — um dos que **não abre**.

**Hipótese (a confirmar, sem mexer agora):** os cards **Pendente/Paga** são somados a partir das **parcelas carregadas/expandidas** de cada venda; quando uma venda **não expande** (parcelas não carregam), ela **some do Pendente/Paga** mas **continua no Total** (que vem do nível da venda / `comissao` agregada). Isso unificaria Ponto 1 + Ponto 3 numa única causa-raiz.

**A investigar depois:**
- Por que o card não expande? (erro ao carregar parcelas? `pagamentos_prosoluto` faltando pra essa venda? erro JS no toggle?)
- Total e Pendente/Paga vêm de **fontes diferentes**? (regra do projeto: derivar SEMPRE de `pagamentos_prosoluto`, nunca de snapshot de `vendas`.)
- Conferir no banco quantas parcelas o contrato 1507 (não-abre) tem em `pagamentos_prosoluto`.

**Status:** 🔴 a investigar (não mexer agora) — **forte candidato a causa-raiz do Ponto 1**

---

## Ponto 4 — ❌ DESCARTADO: corretor edita dados do cliente → fila de aprovação

**Decisão 2026-06-09:** descartado — não faz sentido pro negócio. (Conteúdo abaixo mantido só como registro do que foi considerado.)

**Tipo:** ideia de feature (não é bug).

**Fluxo atual (hoje):** em **Solicitações**, o corretor tem **dois fluxos de criação (POST)** que entram numa fila de aprovação do admin:
- `handleEnviarSolicitacaoVenda` (CorretorDashboard.jsx:491) → solicita **venda nova**;
- `handleEnviarSolicitacaoCliente` (CorretorDashboard.jsx:545) → solicita **cliente novo**.
- Ambos fazem `INSERT` em `solicitacoes` com `status='pendente'`; o admin aprova/reprova (AdminDashboard, `filtroSolicitacao` pendente/aprovado/reprovado).

**Proposta:** estender o mesmo fluxo para **edição (PUT)**. Na aba **Meus Clientes**, o corretor edita os dados de um cliente **existente** → gera uma **solicitação de edição** → entra na **mesma fila de aprovação**. Quando o admin aprovar, aplica o `UPDATE` no cliente.

**Perguntas em aberto pra detalhar a spec** (aguardando detalhes do usuário):
1. Quais campos do cliente o corretor pode editar? (nome, CPF, email, telefone, endereço, cônjuge…) Todos ou subconjunto?
2. A solicitação mostra pro admin o **antes → depois** (diff dos campos)?
3. Onde dispara: botão "Editar" no card do cliente em Meus Clientes, abrindo form pré-preenchido que, em vez de salvar direto, cria a solicitação?
4. O cliente fica com flag "edição pendente" enquanto aguarda? Pode haver mais de uma edição pendente pro mesmo cliente?
5. Corretor só pode editar clientes vinculados a ele?
6. **(regra do projeto)** Ao aprovar, o `UPDATE` deve marcar `cliente_id_origem='manual'` (migration 021) pra proteger a correção contra sobrescrita do sync Sienge?

**Status:** ❌ DESCARTADO (2026-06-09) — aprovação de edição de cliente não faz sentido pro negócio.

---

## Ponto 5 — 🔴 SEGURANÇA (ALTA): upload de documento (CRECI) + storage exposto

**Tipo:** não é bug funcional — é **hardening de segurança**. Duas perguntas do usuário: (a) quais arquivos podem ser enviados; (b) o upload é seguro.

### (a) Quais arquivos podem ser enviados
- **Client-side** (`uploadDocumentoCorretor`, CorretorDashboard.jsx:658): allowlist de **extensão** `['pdf','jpg','jpeg','png','gif','webp']`, **máx 10MB**, input com `accept="image/*,.pdf"` (linha 3516).
- **Server-side (bucket `documentos`):** **SEM restrição** — `allowed_mime_types = null`, `file_size_limit = null`. Ou seja, qualquer tipo/tamanho passa se a API de storage for chamada direto (a validação do React é bypassável).

### (b) É seguro? — Pontos bons
- ✅ Allowlist de extensão + limite de 10MB (client).
- ✅ Guard de path traversal: `if (filePath.includes('..') || filePath.includes('//')) throw`.
- ✅ Path namespaceado por usuário: `corretores/${user.id}/creci_*`.

### (b) É seguro? — 🔴 Problemas (backend escancarado)
1. **Bucket `documentos` é PÚBLICO** (`public=true`, servido via `getPublicUrl`). CRECI é documento pessoal → fica acessível por **URL pública sem autenticação**.
2. **Policies allow-all no `storage.objects`:** quatro policies `"Permitir tudo 1ra9fyl_0..3"` com `roles={public}` e `USING(true)`/`CHECK(true)` pra **SELECT/INSERT/UPDATE/DELETE**, **sem filtro de bucket**. Como RLS é permissivo (OR), elas **anulam** as policies granulares ("Corretor só na pasta clientes", "Cliente…", "Admin…"). Efeito: **qualquer um com a anon key (pública, embutida no frontend) lê/baixa/sobrescreve/deleta QUALQUER arquivo de QUALQUER bucket** — CRECI, contratos, docs de cliente com CPF. Vazamento de PII + destruição/adulteração de dados.
3. **Sem limite server-side de tamanho/MIME** (`file_size_limit=null`, `allowed_mime_types=null`) → validação client-side é contornável.
4. Validação por **extensão do nome**, não por conteúdo/MIME real (renomear `malware.exe`→`foto.png` passa na checagem do front). Menor que os itens 1–2, mas relevante.

### A fazer depois (spec / correção — NÃO mexer agora)
- Tornar `documentos` **privado** e servir via **signed URLs** (com expiração) em vez de `getPublicUrl`.
- **Remover as policies "Permitir tudo 1ra9fyl_*"** e manter só as granulares por pasta/role (corretor↔`corretores/{id}`, cliente, admin).
- Setar `allowed_mime_types` (`application/pdf`, `image/png`, `image/jpeg`, `image/webp`, `image/gif`) e `file_size_limit` (10MB) **no bucket** (server-side).
- (Opcional) validar magic bytes / `file.type` além da extensão.
- Revisar se as policies allow-all afetam **outros buckets** também (contratos, fotos) — provável que sim, dado `USING(true)` sem filtro de bucket.

**Status:** 🔴 ALTA — segurança. Não mexer agora (modo coleta), mas é o ponto mais crítico até aqui.

---

## Ponto 6 — 💡 DESIGN/DADOS: "Membro desde" usa data de import (sem significado real)

**Tipo:** design + escolha de fonte de dado (não é bug crítico).

**Onde:** aba **Meu Perfil** → "Membro desde". Vem de `userProfile.created_at` formatado como mês+ano (CorretorDashboard.jsx:3471-3476):
```jsx
{userProfile?.created_at
  ? new Date(userProfile.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  : 'N/A'}
```

**Problema (medido no banco):**
- `usuarios.created_at` ≈ **data do import em lote**: **65 dos 76 corretores** foram criados em **2026-01-15** (mesmo dia). Não é "quando virou membro".
- Exemplo Carlos Bruno: perfil criado em **2026-01-15**, mas **primeira venda em 2025-04-29** → "Membro desde janeiro/2026" está errado pros dois lados (data de import **e** ~9 meses *depois* de ele já estar produzindo).
- **Restrição do usuário:** NÃO basear em "primeiro contato/acesso real" do corretor (login), porque **nenhum corretor acessa o sistema hoje** — esse dado não existe / não é confiável.

**Opções de fonte a mapear (spec):**
1. **`MIN(vendas.data_venda)` do corretor** → "Atuando desde" / primeira venda. Disponível e significativo (Carlos = abr/2025). Provável melhor opção.
2. **Data de admissão/cadastro no Sienge** (se vier no payload do corretor) → mais fiel a "tempo de casa", se existir.
3. **Esconder o campo** quando não houver base confiável (ex.: corretor sem vendas).

**Decisões a tomar:**
- Semântica desejada: **tempo de casa** (admissão) ou **tempo de atividade** (1ª venda)?
- Renomear o label? ("Membro desde" → "Atuando desde" / "Primeira venda") pra refletir a fonte escolhida.
- Fallback para corretor sem vendas (ex.: "—" em vez de jan/2026).

**Status:** 💡 a especificar — não basear em created_at nem em primeiro acesso.

---

## Ponto 7 — 🟡 Reconferir abas Solicitações e Relatórios (sem teste há tempo)

**Tipo:** área de risco (sem teste há tempo) — revisão estática feita + itens pra testar clicando.

### Relatórios (revisão estática do código — boas notícias)
- ✅ O PDF (`gerarMeuRelatorioPDF`) e o resumo de tela (`getRelatorioResumo`) **derivam comissão de `pagamentos` via `calcularComissaoPagamento`** (CorretorDashboard.jsx:1042-1048, 1069-1075, 1153) — **compatível com a regra** de visualização-totais (não usa snapshot de `vendas`).
- ✅ `getRelatorioDados` (1020-1037) **exclui `status='cancelado'`** e aplica filtro de status. Com status="todos", `Total = Pendente + Paga` (internamente consistente — diferente do bug do Ponto 1).

### 🔑 Achado que amarra Pontos 1 e 2 — duas semânticas de "período"
- **Minhas Vendas** e **Relatórios** filtram período por **`venda.data_venda`** (data da venda) — `getRelatorioVendasBase` (1003-1018) aplica `dataInicio/dataFim` em `data_venda` e inclui **todas** as parcelas das vendas filtradas.
- **Meus Pagamentos** filtra por **data da parcela** (`data_prevista`/`data_pagamento`).
- **Consequência:** "Este Mês" **zera Minhas Vendas** (nenhuma venda *fechada* em junho) mas **Meus Pagamentos de junho tem valor** (parcelas *vencendo* em junho). → Não é bug isolado: é **falta de uma semântica de período única/clara** entre telas. Decisão de spec: o que "Este Mês" deve significar em cada tela, e deixar isso explícito pro corretor.

### A testar clicando (não dá pra garantir por código)
- Relatórios: o **PDF gera mesmo** após tempo sem uso? (jsPDF/autoTable) Layout ok? E ele **subconta** quando os pagamentos não carregam (Ponto 3)? — provável que sim, pois soma só `pagamentosFiltrados` carregados.
- Solicitações: fluxos `handleEnviarSolicitacaoVenda` (criar venda) e `handleEnviarSolicitacaoCliente` (criar cliente) → INSERT em `solicitacoes` `pendente`; lista "Minhas Solicitações" renderiza com status? O admin recebe/aprova/reprova? (cruzar com a **feature do Ponto 4** — edição de cliente entra na mesma fila.)

**Status:** 🟡 Relatórios parcialmente OK na revisão estática; **Solicitações pendente de teste manual**.

---

## Ponto 8 — 💡 O que FALTA na visão do corretor (leitura do Claude)

**Tipo:** análise de lacunas (opinião embasada). Marcado o que foi **verificado** vs **opinião**.

**Verificações feitas:**
- `usuarios` tem 32 colunas e **nenhuma bancária** (sem `pix`/`banco`/`agencia`/`conta`).
- `CorretorDashboard.jsx` **não** aparece na busca por `repasse|outcome|notificac` — esses conceitos só existem em outras telas/serviços.

### ❌ Lacuna 1 (DESCARTADA 2026-06-09) — Confirmação do repasse IM→corretor
- **Decisão:** NÃO faz sentido. Os corretores **já sabem quando vão receber** o pagamento. O papel do sistema, nesse aspecto, é só **mostrar quais clientes pagaram** (`income`) — não rastrear/confirmar o repasse IM→corretor.
- Mantido aqui só como registro da decisão.

### 🟢 Lacuna 2 — Dados bancários / PIX pra repasse [PRIORITÁRIO]
- **Decisão 2026-06-09:** "bem importante" — manter e priorizar.
- Não há onde o corretor informe **como recebe** (PIX/conta/banco) — verificado: ausente em `usuarios` (32 colunas, nenhuma bancária).
- Spec: adicionar dados de pagamento ao perfil (decidir se é fonte local ou espelho do Sienge).

### ➡️ Lacuna 3 — Notificações → MOVIDA pra documento separado
- **Decisão 2026-06-09:** é **feature à parte**. Mapeada em [`features-futuras-corretor.md`](./features-futuras-corretor.md) (Feature A).

### ➡️ Menores → parcialmente movidas
- Acesso ao **PDF do contrato** da venda / detalhe da unidade → **MOVIDO** pra [`features-futuras-corretor.md`](./features-futuras-corretor.md) (Feature B).
- Recibo/comprovante de repasse → caiu junto com a Lacuna 1 (descartada).
- Canal de suporte/contato com o admin → em aberto (sem prioridade definida).

**Status:** ✅ triado (2026-06-09) — fica só a **Lacuna 2 (dados bancários, prioritária)**; Lacuna 1 descartada; notificações + PDF de contrato movidas pra doc separado.

---
