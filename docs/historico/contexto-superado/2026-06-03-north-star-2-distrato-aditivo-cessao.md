---
status: NORTH STAR #2 (desenho de banco) — base pra construir; nada aplicado
data: 2026-06-03
branch: sync/reconciliacao
escopo: modelar no banco os 3 eventos de contrato — DISTRATO · ADITIVO · CESSÃO — com best practices pra dados que incrementam via API
relacionado: memory/termos-contratuais-sienge.md · docs/contexto/2026-06-03-termos-contratuais-desenho-banco.md · docs/contexto/2026-06-03-context-eng-sync-entidade-ausente.md
---

# North Star #2 — Distrato · Aditivo · Cessão no banco

## Realinhamento (2026-06-03)

- **Entidades ausentes (corretor/unidade/empreendimento) NÃO precisam de criação automática.** O cadastro de
  contrato no Sienge é sempre feito junto no IM-Calculo (processo manual); só Figueira mapeado. → fora do escopo.
- **Este north star é exclusivo nos 3 eventos de contrato.** Foco: **o banco** — desenho, separação tabela
  atual × nova, revisão do que já existe — seguindo **best practices pra banco que incrementa via API**.

## Princípios de banco pra incremento via API (as regras de ouro)

1. **Idempotência:** toda escrita por **chave natural do Sienge** (upsert por `sienge_*_id` / `receivableBillId`),
   nunca insert cego. Rodar 2× = no-op.
2. **Estado ≠ Evento:** a **venda** guarda o **estado atual** (status, `cliente_id`); cada evento (distrato/aditivo/
   cessão) vira **linha append-only** numa tabela de evento (histórico/auditoria/reversão). Não sobrescrever
   silenciosamente o que mudou.
3. **Origem rastreável:** campo `_origem` nos pontos críticos (`cliente_id_origem`, `corretor_id_origem` já existem;
   estender com `cessao`; ligar parcelas ao evento que as criou).
4. **Imutabilidade financeira:** parcela paga nunca muda (triggers 017/018/020/026). Evento **adiciona/ajusta o
   futuro**, nunca reescreve o passado pago.
5. **Autorização humana no começo:** eventos sensíveis (cessão) entram como **pendente de autorização** → UI
   confirma → aplica. Observar os primeiros N casos antes de automatizar de vez.

---

## 1. DISTRATO

- **Natureza:** evento de cancelamento do contrato (Sienge `situation='3'`).
- **Já no banco (revisão):** `vendas.situacao_contrato`, `data_distrato`, `data_cancelamento`, `motivo_cancelamento`,
  `status='distrato'`. Ponte A.1 no sync (`sales-contracts.ts:415`). **25 vendas hoje.** → **banco já comporta.**
- **Estado × evento:** o **estado** na venda basta (distrato é raro, e tolera reversão via reemissão). Log de evento
  é *nice-to-have* (auditoria), não bloqueante.
- **Comportamento que o front exige (ponto 1 do Jonas):** badge **"DISTRATO"** no espaço ao lado de
  *Contrato/Calendário*; os casos de distrato **só aparecem quando esse selo aparece**. → o banco já entrega o sinal
  (`status='distrato'` + `data_distrato`); é leitura pura no front.
- **Falta:** deploy A.1 + backfill dos 25 + preencher `nome_cliente` (NULL nos 25). **Sem tabela nova.**

## 2. ADITIVO (reparcelamento)

- **Natureza:** evento que **renegocia parcelas em aberto** de um contrato que **continua ativo**.
- **Mecânica (exemplo confirmado c/ controladoria — caso base):** unid 1A, 6×R$1.000. Parc 1-3 **pagas** (intactas);
  parc 4-5 **não pagas** (R$2.000) entram na renegociação → viram **10×R$200** que começam na data da decisão e
  **correm EM PARALELO** com as parcelas originais restantes (a 6ª de R$1.000 continua). → num mês podem coexistir
  **2 cobranças** (original R$1.000 + aditivo R$200).
- **Desenho no banco (a mecânica acima):**
  - **Parcelas do aditivo = LINHAS NOVAS** em `pagamentos_prosoluto` (10×200), data/valor próprios, ligadas a
    `renegociacao_id` (= a "origem aditivo" que o front mostra). `tipo` segue a natureza (parcela_entrada/balao).
  - **Parcelas originais renegociadas (não pagas)** → saem do ativo (`cancelado` ou novo status `renegociado`).
    **Pagas e futuras restantes ficam intactas** (imutabilidade preservada — as renegociadas não eram pagas).
  - **Evento** em `renegociacoes`: `parcelas_originais=[4,5]`, `parcelas_novas=[10×200]`, motivo, data, `diferenca_valor`.
  - **Inadimplência:** o aditivo **cura** as parc 4-5 (saem de vencidas-em-aberto) → afeta o termômetro.
- **⚠️ Variações (decisões de negócio):** (a) **juros na renegociação** (ex 2.000→2.400) — os juros **comissionam?**
  (provável que não; explicaria parte do b10 onde income>pro_soluto); (b) marcar a original como `cancelado` vs
  `renegociado`. O caso base é sem juros (2.000→2.000); as variações é que confundem.
- **Já no banco (revisão):** tabela **`renegociacoes`** (migration 016) — esqueleto de **evento** pronto:
  `venda_id, motivo, parcelas_originais (JSONB), parcelas_novas (JSONB), diferenca_valor, diferenca_comissao,
  usuario_id, data_renegociacao`. **Hoje 1 linha (subutilizada).** `pagamentos_prosoluto` **não tem** tipo "aditivo".
- **MAPA DO SIENGE — achado 2026-06-03 (do nosso RAW `sienge_raw.objects`, SEM gastar Sienge):**
  - **DETECÇÃO grátis:** o payload de `sales-contracts` traz **`containsRemadeInstallments`** (boolean) → identifica
    QUEM tem aditivo. **14 contratos hoje** (de 302): c12, c63, c150, c165, c195, c228, c230, c277, c299, c305,
    c312, c334, c351, c411.
  - **🔗 Conexão com o b10:** esses **14 = exatamente a metade "grande" do bucket b10** (pro_soluto divergente que
    mandamos à controladoria). → **metade do b10 É aditivo, não erro de dado.** O pro_soluto divergiu porque o
    cronograma foi reparcelado; o valor correto é o do Sienge (não precisa "escolher"). O resto do b10 = 9 drift
    ±1,6% (arredondamento) + 5 a investigar de verdade (c191 −125k, c332, c422, c206, c267).
  - **Parcelas afetadas:** inferíveis comparando o `income` (cronograma novo) vs os pagamentos locais (antigo).
  - **FONTE COMPLETA (liberada 2026-06-03):** o endpoint **`/remade-installments`** (REST v1) foi **habilitado no
    plano** e dá tudo em **1 request** (`limit` ignorado → traz todos): `receivableBillId`, `remadeDate`,
    `customerDescription`, `remadeInstallmentsDescription` (parcelas renegociadas), `generatedInstallmentsDescription`
    (parcelas geradas), `remadeValue`, `generatedValue` (juros = generated−remade). **79 aditivos na base IM toda;
    14 são Figueira** (= exatamente o b10: c12,c63,c305,c228,c195,c277,c312,c165,c150,c230,c299,c334,c351,c411).
    74/79 sem juros. Um contrato pode ter **vários** aditivos (c165 tem 2). Extraído em
    `docs/auditorias/2026-06-03-aditivos/` (`scripts/extrair-aditivos-remade.mjs`).
  - **⚠️ GAP "negociado ≠ lançado":** aditivo só aparece quando **LANÇADO no Sienge**. Acordos futuros (ex: Ricardo
    c74/c75, renegociação "a partir de julho") **não aparecem** no `remade-installments` nem no flag até a
    controladoria lançar. O sistema espelha o lançado → decisão: esperar o lançamento (ou registro manual antecipado).
  - → **Conclusão:** aditivo **resolvido** — `remade-installments` é a fonte (1 request sob demanda, REST v1, fora do
    fluxo recorrente). Reproduzir no banco: parcelas renegociadas → `cancelado/renegociado`; geradas → linhas novas
    com `renegociacao_id`.
- **Comportamento que o front exige (ponto 2):** em *pagamentos*, ter o **tipo "aditivo"**. Desenho de banco
  recomendado (**best practice: tipo = natureza financeira; origem = de onde veio**):
  - **Recomendado (A):** manter o `tipo` da parcela (parcela_entrada/balao) e **ligar a parcela ao evento** via nova
    coluna **`pagamentos_prosoluto.renegociacao_id`** (FK → `renegociacoes`). O front mostra "aditivo" por esse
    vínculo. Não polui o cálculo de comissão (que depende do tipo).
  - **Alternativa (B):** criar `tipo='aditivo'` em pagamentos — mais simples no front, mas mistura origem com
    natureza → **pior** pra fator/somas. **Evitar.**
- **Banco deve comportar:** registrar o evento (`renegociacoes`) + ligar parcelas (`renegociacao_id`); ajustar
  `data_prevista` das **pendentes**; **não tocar nas pagas**; funcionar tanto **automático (sync)** quanto **manual (UI)**.
- **Falta:** coluna `pagamentos_prosoluto.renegociacao_id`; ponte sync→`renegociacoes`; UX manual; probe Sienge.

## 3. CESSÃO DE DIREITOS

- **Natureza:** evento de **troca de titular** (cliente), contrato/parcelas/pagas mantidos, mesmo corretor.
- **Já no banco (revisão):** **nada.** `vendas.cliente_id` (estado), `cliente_id_origem` = tudo `sync`. **Sem coluna
  de titular anterior, sem tabela de evento.**
- **Detecção (ponto do Jonas — preferido):** no **sync/UI**, ler que o **cliente mudou** (`income.clientId` ≠
  `cliente_id` local). O cliente novo **já vem cadastrado** (processo). → mostrar **aviso pra autorizar** no começo.
- **VARREDURA COMPLETA (2026-06-03, `scripts/detectar-cessao-figueira.mjs`, income inteiro 17.567 linhas):**
  **só 1 cessão em toda a Figueira — c340 (905 B) Caroline (sienge 102) → Gabriel (sienge 670).** Evento **RARO**
  (vs distrato=25, aditivo=14). → a **opção A (autorização manual)** é folgada; c340 serve de caso-teste do fluxo.
  Escopo: **só Figueira importa** (companyId 5).
- **Desenho de banco:**
  - **Estado (venda):** `cliente_id` = titular atual (muda na cessão); marcar `cliente_id_origem='cessao'`
    (estender o CHECK do enum, hoje `sync|manual|api_commissions`).
  - **Evento (NOVA TABELA `cessoes_direitos`):** append-only —
    `id, venda_id, sienge_receivable_bill_id, cliente_anterior_id, cliente_novo_id, data_cessao,
    origem ('sync_detectado'|'manual'), status ('pendente_autorizacao'|'aplicada'|'rejeitada'),
    autorizado_por, autorizado_em, created_at`.
  - **Múltiplos titulares + cônjuge + percentual** (o Sienge permite): prever **tabela filha**
    `cessao_titulares (cessao_id, cliente_id, percentual)` **ou** `titulares_depois JSONB` — começar simples
    (1 titular principal) mas deixar a porta aberta.
  - **Fluxo:** sync detecta divergência → grava `cessoes_direitos` em `pendente_autorizacao` → UI mostra aviso →
    admin autoriza → aplica (troca `cliente_id`, registra `cliente_id_origem='cessao'`, marca `aplicada`).
    **Parcelas/pagas/corretor intactos.**
- **Falta:** tabela `cessoes_direitos` (+ `cessao_titulares`); valor `cessao` no `cliente_id_origem`; detector no
  sync; tela de autorização.

---

## Separação tabela atual × nova (resumo)

| Conceito | Estado (tabela atual) | Evento (histórico) | Precisa tabela/coluna nova? |
|---|---|---|---|
| **Distrato** | `vendas` (`status`, `data_distrato`…) | — (estado basta) | ❌ não (só deploy+backfill) |
| **Aditivo** | `pagamentos_prosoluto` (+ `renegociacao_id`) | `renegociacoes` (016, expandir uso) | ➕ coluna `renegociacao_id` |
| **Cessão** | `vendas` (`cliente_id`, origem `cessao`) | **`cessoes_direitos` (NOVA)** + `cessao_titulares` | ✅ tabela nova |

## Best practices aplicadas (por que assim)

- **Event sourcing leve:** estado na venda + log de evento próprio → auditoria, reversão e idempotência sem poluir
  a venda. (distrato dispensa log; aditivo e cessão ganham com ele.)
- **Tipo × origem separados** (aditivo via `renegociacao_id`, não `tipo='aditivo'`) → cálculo de comissão intacto.
- **Chave natural do Sienge** em cada evento (`receivableBillId` + data) → idempotente no incremento via API.
- **Autorização gated** na cessão → segurança no começo, automação depois de validar 20 casos.
- **Imutabilidade financeira** preservada nos 3 (pagas nunca mudam).

## Roadmap (ordem sugerida)

1. **Aditivo — JÁ desenhável** (flag `containsRemadeInstallments` + `income`, 0 quota). Probe do `remade-installments`
   é **opcional** (só pro motivo, sob demanda) — não bloqueia.
2. **Migration**: `cessoes_direitos` (+`cessao_titulares`); `cliente_id_origem += 'cessao'`;
   `pagamentos_prosoluto.renegociacao_id`.
3. **Sync — detector de cessão** (`income.clientId` ≠ local) → fila `pendente_autorizacao`.
4. **UI**: badge distrato (ponto 1); origem "aditivo" em pagamentos (ponto 2); aviso de cessão no sync (autorizar).
5. **Distrato**: deploy A.1 + backfill 25 + `nome_cliente`.
6. **Observar 20 cessões** antes de relaxar a autorização.

## Decisões fechadas (2026-06-03)

- **Aditivo = automatizável SEM custo de quota.** Detecção pelo flag `containsRemadeInstallments` (já vem no
  `sales-contracts` que o sync puxa — **0 request extra**); parcelas novas via `income` (bulk, sem quota). O
  endpoint `remade-installments-v1` (REST v1, conta na quota 100/dia) só agrega o **motivo** — nice-to-have, sob
  demanda (~14 req pontuais), **fora do fluxo recorrente**.
- **Cessão = opção (A):** reflexo `income.clientId` (detecção) + **autorização manual** no sync (aviso, observar 20
  primeiros). **Sem webhook** (push fora de planos). Limitação aceita: data = "quando detectamos" (aproximada);
  cessão vs correção confirmada na autorização humana.
- **Não existe "bulk de cessão"** (confirmado nos 88 recursos; `customer-extract-history` é extrato financeiro).
  Cessão é o único dos 3 sem marcador pull dedicado.

## Decisões abertas (menores)

- Cessão: começar 1 titular ou já modelar múltiplos+percentual? (sugiro: tabela filha desde já, preencher 1).
- Distrato: vale um log de evento (auditoria/reversão) ou o estado na venda basta? (sugiro: estado basta agora).
