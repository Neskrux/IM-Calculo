# North Star #3 — A ÂNCORA CORRETA

> **Status:** norte vivo · 2026-06-10 · branch `sync/reconciliacao`
> **Pré-leitura obrigatória:** [North Star #1 — 3 baldes](2026-06-01-north-star-reconciliacao.md) · [North Star #2 — 3 termos](2026-06-05-north-star-2-tres-termos-DEFINITIVO.md) · [Fundação âncora+gerador (o pivô)](2026-06-05-fundacao-ancora-gerador.md)
> **Não é um terceiro norte que compete com os outros dois.** É a correção de uma **premissa escondida** que estava dentro deles: a de que âncora *preenchida* = âncora *correta*. O caso MICHEL provou que não é.

---

## 1. A virada

O sistema sempre respondeu **duas perguntas**, e ambas passam pela âncora:

1. **"Tudo que o Sienge diz PAGO está marcado pago no banco?"** → o **reconciliador** (`scripts/reconciliar-todas-vendas.mjs`). Pega sub-registro / falso-pendente.
2. **"Tudo que o banco diz PAGO está pago no Sienge?"** → o **detector de over-pay** (`scripts/detectar-overpay-vs-sienge.mjs`). Pega comissão contada em dobro.

As duas leem o Sienge **através do par** `(sienge_bill_id, sienge_installment_id)`. Elas perguntam *sobre o installment apontado pela âncora*. Logo, **se a âncora aponta pro installment errado, as duas respondem certo sobre a pergunta errada** — e o resultado é falso mesmo quando o pagamento é real.

Surgiu agora a **3ª pergunta, mais profunda**:

> **"A ÂNCORA é o par CERTO?"** — a parcela local está ligada ao installment **correto** do Sienge (aquele cujo valor e data batem com ela), ou só a *algum* installment que não colide com outro?

**O caso MICHEL (contrato c346, bill 422)** é a prova concreta:

- A parcela local **np3** está **PAGA** e **ancorada no installment 7**.
- O Sienge diz: **installment 7 NÃO pago**.
- O pagamento real dela (06/02) corresponde ao **installment 3** — que o Sienge confirma pago na mesma data.
- **Veredito:** âncora trocada. O pagamento real (inst 3) ficou ligado ao installment errado (inst 7).

O efeito em cascata:
- **Para a pergunta 2 (over-pay):** o detector olha o inst 7 (ancorado), vê "Sienge não confirma pago" → cospe **FALSO over-pay** (`detectar-overpay-vs-sienge.mjs` L122). Comissão real vira "contada em dobro" no relatório de detecção.
- **Para a pergunta 1 (reconciliador):** o reconciliador procura o inst 3 pago no Sienge, não acha nenhuma parcela local ancorada nele (porque a np3 está "ocupada" no inst 7), e **arrisca criar uma duplicata** pra cobrir o inst 3.

**Por que isso é a FUNDAÇÃO e não um detalhe:** o 1:1 local↔Sienge é o que sustenta os dois baldes de borda do North Star #1 (① TRUTH IN e ③ TRUTH OUT). Se o link 1:1 está *preenchido mas errado*, ele é uma **mentira que "bate por acaso"** — e toda métrica derivada herda a mentira. A âncora-correta não estende as perguntas 1 e 2; ela é a **condição de verdade** delas.

---

## 2. Definição de ÂNCORA CORRETA

### A invariante exata

> Uma parcela local `p` está **corretamente ancorada** quando existe um installment `i` do Sienge tal que:
> - `p.sienge_bill_id == i.billId` **E** `p.sienge_installment_id == i.installmentId`
> - **E** `i.originalAmount` (ou valor equivalente) bate com `p.valor` (dentro de tolerância de centavos)
> - **E** `i.dueDate` bate com `p.data_prevista` **OU** (para parcela paga) `i.paymentDate` bate com `p.data_pagamento`
>
> Em outras palavras: **o par aponta para o installment cujo (valor, data) é o mesmo da parcela** — não apenas para *um* installment que não colide com outro.

### "% correto" ≠ "% preenchido" — hoje só sabemos o 2º

- A âncora são duas colunas em `pagamentos_prosoluto` (migration **023**): `sienge_bill_id bigint` e `sienge_installment_id text` (TEXT pra absorver formatos como `'13/60'`).
- Há um índice **UNIQUE condicional** `idx_pagamentos_sienge_bill_inst_unique ON (sienge_bill_id, sienge_installment_id) WHERE ambos NOT NULL`.
- **O que o UNIQUE garante:** que **duas** linhas locais não apontem para o **mesmo** par Sienge (zero colisão de par).
- **O que o UNIQUE NÃO garante:** que **uma** linha local aponte para o installment **certo**. Ele impede par-duplicado, **não** par-errado. MICHEL passa pelo UNIQUE sem problema — np3↔inst7 é único; só está errado.

**Os dois números, hoje:**

| Métrica | Valor | O que mede |
|---|---|---|
| **% preenchido** | ~84% (3911/4679 parcelas Figueira — `plano-estancar-sangria.md`) | parcelas com âncora **não-NULL** |
| **% correto** | **DESCONHECIDO** | parcelas cuja âncora **bate em valor+data** com o installment apontado |

> **"84% ancorado" significa "84% PREENCHIDO", NÃO "84% CORRETO".** Quantas das preenchidas estão trocadas (como MICHEL) **ainda não foi medido no banco** — exige query contra o income fresco. **A confirmar:** o número real de âncoras-trocadas.

---

## 3. Os 3 termos × âncora

Os 3 termos contratuais (North Star #2) mexem na **grade de parcelas** do Sienge — por isso são a **taxonomia de causas** da âncora-trocada. Ranking de impacto, do pior ao inofensivo:

### 3a. ADITIVO / reparcelamento — **o culpado provável do MICHEL** (quebra a âncora)

**Mecânica:** renegocia parcelas em aberto criando **N parcelas NOVAS em paralelo** às originais restantes; o contrato continua ativo (situação não muda). A grade nova recebe `installmentId`s **novos**, em faixa de numeração alta/contínua a partir de ~57–67 (ex.: parcOrig 2/3 → parcGer 57/58/59/60/61/62). A grade antiga renegociada **permanece** no contrato. Fonte API: `/remade-installments` (REST v1, 1 request traz tudo: renegociadas→geradas + `remadeDate` + juros).

**Como quebra a âncora:** o backfill antigo casava por `(venda_id, numero_parcela)`. Quando o aditivo renumera, o `installmentId` real da parcela paga **muda**, mas a âncora antiga continua apontando pro `installmentId` velho/errado. **Isto é exatamente o MICHEL** — bill 422 passou de `'1/4..4/4'` para `'1/50..'`. A grade antiga não-paga ainda existe no banco como **pendente**, inflando total/pendente (é a metade "grande" do bucket **b10** "pro_soluto divergente" = aditivo, não erro).

**Números reais:** **15 reparcelamentos em 14 contratos** (MARIANE tít 225 tem 2). Relatório oficial e `/remade-installments` **batem 100%** (sem gap com a controladoria). Casos-chave: tít 483 CAYO (2→25), tít 176 CAROLINE HONORATO (12→50, o maior), tít 418 LILIAM (cessão **E** aditivo no mesmo contrato).

**O que a regra tem que fazer:** **re-ancorar a grade nova** (1 linha por `installmentId` gerado, ligada via `renegociacao_id` — migration 027) e **marcar a grade antiga** como `renegociado` (migration 029). Materializar do income por `(billId, installmentId)` real — **nunca** do `numero_parcela`. Os 14 contratos com aditivo são **prioridade máxima** numa re-validação, porque ali o par 1:1 está sistematicamente errado mesmo com pagamento real.

> ⚠️ **Débito técnico já existente:** 2 parcelas de aditivo (c150 inst 66, c351 inst 68) foram inseridas como `parcela_entrada` padrão só pra fechar maio. Precisam virar parcelas ancoradas ligadas por `renegociacao_id`, e a grade antiga marcada renegociado — senão inflam o total. (`debito-aditivo-para-schema.json`)

### 3b. DISTRATO — preserva a âncora; muda só o **status**

**Mecânica:** cancelamento do contrato (`situacao_contrato='3'`). **Pegadinha:** o Sienge dá **baixa em TODAS as parcelas** (marca pagas), inclusive futuras — só as pagas com `paymentDate < data_distrato` são pagamentos **reais**. Os installments **seguem existindo** (`installmentId` não some, datas ficam).

**Como afeta a âncora:** **NÃO renumera nem cria parcela** — os mesmos installments continuam, só ganham `paymentDate` de baixa. **O par parcela↔installment continua VÁLIDO.** O risco do distrato é de **STATUS** (a baixa de liquidação marcar pago indevido → over-pay falso / comissão inflada), **não de par**.

**Números reais:** **36 distratos** no relatório oficial / **25 marcados** no banco / **11 pendentes** (10 com venda + 1 "412 B GABRIEL ADRIANO" sem venda, já na controladoria). 8 dos 10 têm valor recebido > 0 (pago real a preservar). c195/c279/c302 já curados em maio (158 parcelas de baixa canceladas; molde AMANDA c195).

**O que a regra tem que fazer:** **nada na âncora** (ela está íntegra). O reconciliador de hoje **já é distrato-aware** (`paymentDate >= data_distrato` não conta como pago — `reconciliar-todas-vendas.mjs` L185-186) e **motivo-aware** (não reativa cancelada de propósito — L207). A ação é de **status** (cancelar a baixa pós-distrato, preservar o pago real pré-distrato).

### 3c. CESSÃO de direitos — **não toca a âncora** (impacto ≈ zero)

**Mecânica:** troca de titular — o contrato passa a um novo cliente (mesmo corretor intermedia). Contrato, parcelas e installments são **mantidos**; só o `cliente_id` muda. Parcelas pagas continuam pagas.

**Como afeta a âncora:** **≈ ZERO.** Não mexe na grade: `installmentId` não renumera, não cria installment novo, datas intactas. O par parcela↔installment continua **100% válido**. Impacto em comissão ≈ zero (corretor não muda).

**Números reais:** **3 cessões** (não 1). tít 160 (1208 C, c245): EDUARDO→KAINÃ + cônjuge TAYNARA — banco já KAINÃ ✅. tít 410 (905 B, c340): CAROLINE→GABRIEL — banco ainda CAROLINE ⏳ (único pendente). tít 418 (506 A, c351): BEATRIZ→LILIAM — banco já LILIAM ✅ (este tem cessão **E** aditivo). **Achado:** cessão **autocura** pelo sync — 2/3 já corretas porque `/sales-contracts` traz o titular novo sozinho.

**O que a regra tem que fazer:** **nada na âncora.** Só garantir o `cliente_id` vigente (autocura via sync, ou UPDATE manual da 905 B). O relatório "Extrato de cessão" serve pro **censo**, não pra corrigir âncora.

### Resumo do ranking

| Termo | Mexe na grade? | Quebra a âncora? | Ação na âncora | Nº casos |
|---|---|---|---|---|
| **Aditivo** | Sim — renumera + cria installments novos (~57-67+) | **SIM** (= MICHEL) | **re-ancorar grade nova + marcar antiga** | 15 / 14 contratos |
| **Distrato** | Não — só baixa em tudo | Não (par íntegro) | nenhuma — corrigir **status** | 36 |
| **Cessão** | Não — só troca titular | Não (par íntegro) | nenhuma | 3 |

---

## 4. As 3 perguntas integradas — o termômetro completo

```
            ┌─────────── A ÂNCORA é o par CERTO? (Q3, NOVA) ───────────┐
            │  parcela local ↔ installment cujo (valor,data) bate       │
            │  SE errada → Q1 e Q2 respondem certo sobre o alvo errado  │
            ▼                                                           │
  [SIENGE] ──Q1: Sienge-PAGO → banco-pago?──► [BANCO] ──Q2: banco-PAGO → Sienge-pago?──► [Sienge]
            (reconciliador,                            (detector over-pay,
             pega sub-registro)                         pega contagem-dobro)
```

- **Q1 (reconciliador)** e **Q2 (over-pay)** olham o installment **através do par**. Perguntam *sobre o installment apontado*.
- **Q3 (âncora-correta)** pergunta *se o par aponta pro installment certo*.

**Por que Q1 e Q2 são CEGAS sem Q3:** elas assumem que a âncora é verdade. Confirmado em código — os **três** consumidores da âncora fazem match **installmentId-FIRST** e tratam a âncora existente como verdade absoluta, sem nunca conferir valor+data:

- **reconciliador** (`reconciliar-todas-vendas.mjs` L189-201): `porInstallmentId` captura a parcela já ancorada antes do fallback; o `popular` só dispara quando a âncora era NULL e o fallback decidiu. Âncora errada nunca é re-validada.
- **detector over-pay** (`detectar-overpay-vs-sienge.mjs` L111-122): faz `incIdx.get(bill__installment)` só pra ver se o installment ancorado existe e está pago; **nunca** compara valor/data. MICHEL cai como FALSO over-pay.
- **sync vivo edge** (`receivable-bills.ts` L138-202): `matchPag` é âncora-first (par exato L145-151); `siengeAnchorBody` só **preenche** quando diverge, nunca re-valida.

**A cegueira é sistêmica, não isolada de um script.** Nenhum dos três responde Q3. É por isso que ela vira fundação: até existir, Q1 e Q2 ficam apoiadas numa premissa não-verificada.

---

## 5. Detecção (read-only, não auto-corrige)

A primeira entrega é **medir**, sem tocar em nada. Detecção é separada de reparo de propósito (reparo é gated — §6).

### Métrica nova: "% âncora correta"

Estender o reconciliador (ou um verificador novo `scripts/validar-ancora-vs-sienge.mjs`) com um **modo anchor-validate** (hoje é **anchor-fill-only**). Para cada parcela com âncora não-NULL:

```
lookup installment i = income[(sienge_bill_id, sienge_installment_id)]
SE i não existe                       → ancora_orfa      (installment sumiu do bill)
SE i existe E (valor, data) batem     → ancora_valida    ✅
SE i existe E (valor, data) DIVERGEM  → ancora_suspeita  ⚠️ (= MICHEL)
```

- **`ancora_suspeita`** é o achado novo: par único, não-NULL, mas o installment apontado tem valor/data diferentes da parcela. Cross-check extra do tipo-MICHEL: existe **outro** installment **no mesmo bill** cujo (valor, data) bate com a parcela e que está livre? Se sim, forte sinal de âncora-trocada e candidato a re-match (§6).
- **Saída:** JSON no schema canônico de métrica (`.claude/rules/sincronizacao-sienge.md`), com `ancora_suspeita[]` carregando `{venda_id, parcela, ancora_atual, installment_sugerido, valor_local, valor_sienge, data_local, data_sienge}`.

### Detector de âncora-suspeita como passo do cron (o "filme")

O cron diário (`.github/workflows/recurring-reconciliation.yml`) hoje: baixa income (sem quota) → gera plano data_prevista → aplica drifts pequenos. **Adicionar um passo read-only de validação de âncora** que roda a métrica "% âncora correta" e registra `ancora_suspeita` sem corrigir. Isso transforma um número estático ("84% preenchido") num **filme** ("% correto, medido todo dia contra o Sienge fresco"). Falha o job só pra **reportar regressão**, nunca pra auto-reparar.

---

## 6. Reparo da âncora (gated)

Detectar é barato e seguro. **Corrigir** uma âncora paga toca o ponto mais sensível do sistema — é **gated** e respeita todas as invariantes de `.claude/rules/sincronizacao-sienge.md`.

### Algoritmo de re-match (determinístico)

Para cada `ancora_suspeita`:
1. Buscar, **dentro do MESMO bill**, o installment cujo `(valor, data_pagamento real do income)` **bate** com a parcela local.
2. **Match único e inequívoco** → re-ancorar: `sienge_installment_id` ← installment correto. **Só toca a coluna da âncora.**
3. **Zero match ou múltiplos candidatos** (ambíguo) → **rodada-b** (revisão humana, `.claude/rules/rodadas-b.md`). Script automatizado nunca decide o delicado.

### Invariantes que o reparo NUNCA viola

- **Nunca tocar `valor`, `comissao_gerada`, `tipo`** de linha paga (financeiros imutáveis — trigger 017). Re-ancorar mexe **só** em `sienge_installment_id` (+ `sienge_bill_id` se necessário), que são metadados de ligação, não financeiros.
- **Nunca reverter pago→pendente automaticamente.** Se o re-match implicar que a parcela "não estava paga", isso vira caso de rodada-b — não flip automático. (No MICHEL, a np3 **continua paga** — o pagamento é real; só a âncora migra de inst 7 para inst 3.)
- **Nunca DELETE de linha paga.**
- **Respeitar o UNIQUE da 023:** se o installment-alvo já estiver ocupado por outra linha, é sinal de duplicata/gêmeo → rodada-b.
- **Idempotente:** rerun = no-op (2º run reporta `updated=0`).
- **Emitir métrica** no schema canônico, com `drift[]` (campo `sienge_installment_id`, antes/depois, motivo) e `humano_pendente[]` pros ambíguos.

### Sequência segura por termo

1. **Distrato e cessão primeiro** (não mexem em âncora — só status/cliente_id), pra limpar o ruído.
2. **Aditivo por último e com mais cuidado:** o reparo de aditivo é **conjunto com o wiring de `/remade-installments`** — não dá pra re-ancorar a grade nova sem materializar a grade nova. Priorizar os **14 contratos** com aditivo.

---

## 7. Through-line / fases — estende NS#1 e NS#2, não reinventa

A âncora-correta **não cria um terceiro norte**. Ela:

- **Adiciona uma 7ª métrica de "pronto" ao NS#1**, entre a #3 e a #4: **"Toda parcela paga ancorada aponta para o installment cujo (paidAmount, paymentDate) BATE com o Sienge — zero âncora trocada."** As métricas #3 ("100% ancorada 1:1") e #4 ("zero par duplicado") medem **preenchimento e unicidade** — escritas assumindo que preenchido = correto. MICHEL quebrou a premissa.
- **Estende o passo 3 do through-line do NS#1** ("re-ancorar o determinístico"): de **anchor-fill-only** (só preenche NULL) para **anchor-validate + re-anchor** (re-valida e corrige preenchidas).
- **Posiciona os 3 termos do NS#2 como a TAXONOMIA DE CAUSAS** da âncora-trocada (§3), fechando o loop entre os dois nortes em vez de abrir um terceiro.

**Mapa para os baldes do NS#1:** a âncora vive como uma linha de **② MIRROR CLEAN**, mas é estruturalmente **pré-requisito** de ① TRUTH IN e ③ TRUTH OUT — porque ambos respondem **através dela**.

### Fases

| Fase | O quê | Estado | Gate |
|---|---|---|---|
| **F0** | Schema da âncora (023) + colunas de termo (027 renegociacao_id, 029 motivo, 028 cessao) | ✅ feito | — |
| **F1 — Medir** | Verificador anchor-validate + métrica "% âncora correta" + classificar `ancora_suspeita`. **Não escreve.** | ✅ medido (97,83% limpo) | read-only |
| **F2 — Curar o barato** | Distrato: **✅ EXECUTADO 2026-06-11 (OK da gestão)** — backfill 35 datas (22 xlsx + 7 limbo confirmados via REST `Cancelado`; ponte A.1 já deployada de carona no merge de 06-09, edge v21) + cura de **1.908 baixas falsas = R$ 886.693,03** removidos, 100 pagas reais pré-distrato preservadas (R$ 46,5k). Ground-truth triplo: xlsx ↔ baixa-em-massa ↔ REST. Verificado: rerun=0, pagas pós-distrato=0, reconciliador não desfaz (quem desfez o curativo de maio foi o cron rodando código pré-merge 06-06→06-09 — forense: 158 re-pagas ainda com motivo='distrato'). | ✅ feito | executado c/ OK |
| **F3 — Re-ancorar o determinístico** | Reparo de âncoras-suspeitas com match único (§6). Ambíguo → rodada-b. F3 v1 rodado (0 re-ancorável, 16 ambíguo→rodada-b, over-pay aguarda income fresco). c312 np3 curado cirurgicamente (over-pay de âncora errada: baixa do B1 gravada no B3 → Excluir Baixa + ancorado inst 36). | parcial — over-pay aguarda income fresco | gated, prod |
| **F4 — Aditivo wiring** | **✅ EXECUTADO 2026-06-11 (OK da gestão)** — mecânica validada no income: renegociada ganha **baixa de renegociação na data do aditivo** (primo do distrato). 16 eventos/14 contratos: **15 `renegociacoes` + 43 baixas falsas (R$ 18.355,98) + 4 pendentes velhas → cancelado motivo='aditivo_renegociado'** + **241 parcelas da grade nova inseridas ancoradas** + 23 ancoradas + débito c150/c351 linkado. Matcher income-driven (valor+dueDate EXATOS; fallback "pago na data" removido — mordia gêmeos mis-matched). Reconciliador agora **aditivo-aware** (renegociadas saem do universo → soma fecha exata; sem isso o S2 parqueava aditivo pra sempre): S2 parqueadas 28→16, reativar=0. | ✅ feito | executado c/ OK |
| **F5 — Fechar 84%→100%** | Parte C: não-ancorados nas vendas de revisão humana. Reconciliador pós-F4 já consegue popular +553 âncoras no próximo run. Restam c228 + c351 (bagunçados, rodada-b) + ambíguos. | destravado pelo F4 | gated |
| **F6 — Verificar pelo termômetro** | % âncora validada → 100%; inadimplência exibida → ~4,89%. Re-medir com income fresco (Sienge 429 até ~12/06 de manhã). | re-medir | — |

### Por que parou — e por que volta a ser prioridade

Este trabalho (os 3 termos + fundação-âncora) foi **mapeado** em 2026-06-05 mas ficou **pela metade** porque **a prioridade virou o relatório das coordenadoras**. O **aditivo é o único termo cujo "trabalho de verdade" não foi feito** (schema pronto, wiring `/remade-installments` inexistente) — e é justamente o que produz a âncora-trocada. A descoberta da 3ª pergunta (MICHEL) **promove o aditivo de "opcional" a pré-requisito da Parte C**: não dá pra chegar a 100% de âncora **correta** sem materializar as grades novas dos aditivos. Por isso volta a ser prioridade agora.

---

## 8. Termômetro-mestre

> **% de parcelas PAGAS com âncora VALIDADA por valor+data contra o Sienge.**
>
> = `parcelas pagas onde o installment ancorado tem (paidAmount, paymentDate) batendo com a parcela ÷ total de parcelas pagas com âncora não-NULL`.

- **Hoje (medido — F1 v2 segmentada, 2026-06-10):** **97,83%** no **segmento LIMPO** (3558/3637 pagas ancoradas, valor+data **exatos**). A medição confirmou a decisão de engenharia: segmentar por termo (LIMPO = valor+data exatos, sem tolerância; COM-TERMO = trilho do termo). Fora do limpo: distrato (6 contratos / 357 pagas → F2), aditivo (28 / 160 → F4), e **331 sem-âncora** seguem cegas (F5). Resíduo do limpo a olhar: **54 installment-não-pago (R$37k) + 5 valor + 20 data**. *(income de 2 dias — irrelevante pro limpo, que é estável; a confirmar a borda recente no run fresco.)* Saída: [docs/auditorias/2026-06-10-ancora/f1-validacao-ancora-v2.json](../auditorias/2026-06-10-ancora/f1-validacao-ancora-v2.json).
- **Chegada:** **100%** — toda parcela paga aponta pro installment certo; zero âncora-trocada; MICHEL e seus análogos resolvidos.
- **Relação com o termômetro do NS#1:** quando este chegar a 100%, a inadimplência exibida do NS#1 pode finalmente convergir pra ~4,89% **com confiança** — porque o número não vai mais estar apoiado num 1:1 que "bate por acaso". Este termômetro mede a **fundação**; o do NS#1 mede a **borda** que a fundação sustenta.

---

## 9. Decisões abertas (framadas pra decidir bem)

- **D1 — A IMPORTANTE: o detector vira passo DIÁRIO do cron (read-only)?** É o que transforma "% âncora correta" de **foto** em **filme** e faz o sistema se **auto-policiar**: a reconciliação cospe `ancora_suspeita` todo dia, e a controladoria **confirma uma lista curta** em vez de **caçar erro**. Fecha a pergunta original que abriu este norte. Recomendação: **SIM** — passo read-only que **reporta**, nunca auto-repara (respeita "nunca reverter pago sozinho").
- **D2 — ordem dos writes (todos gated):** **distrato** (F2, R$158k, conhecido) → **re-âncora do limpo** (F3, 79 parcelas, determinístico) → **aditivo** (F4, 28 contratos, o projeto). Dinheiro+conhecido primeiro; projeto por último.
- **D3 — preservar:** commitar a tooling (`detectar-overpay-vs-sienge.mjs`, `validar-ancora-vs-sienge.mjs`) + este doc, pra não perder; o detector entra no cron via PR.

---

### Avisos de honestidade (a confirmar / não inventado)

- **Quantas das ~84% âncoras preenchidas estão trocadas (como MICHEL)** não foi medido no banco — exige query contra o income fresco (F1).
- **O caso MICHEL** está descrito no prompt/CLAUDE.md mas **não há doc consolidado em `docs/contexto/`** — este é o registro. Os números do MICHEL (np3↔inst7, real=inst3, 06/02) vêm do prompt da descoberta.
- **Causa-raiz** (backfill heurístico por `venda_id+numero_parcela` + reconciliador anchor-fill-only) está **confirmada por leitura estática** de `reconciliar-todas-vendas.mjs` L189-201, `detectar-overpay-vs-sienge.mjs` L111-122 e `receivable-bills.ts` L138-202 — **nenhuma query foi rodada** nesta passagem.
- O **valor de comparação** do installment (`originalAmount` vs `paidAmount`) e a tolerância exata de data precisam ser fixados na implementação da F1 — escolha de engenharia, **a confirmar**.

---

### Fontes de código citadas
- [scripts/reconciliar-todas-vendas.mjs](../../scripts/reconciliar-todas-vendas.mjs) (match installmentId-first, anchor-fill-only)
- [scripts/detectar-overpay-vs-sienge.mjs](../../scripts/detectar-overpay-vs-sienge.mjs) (lookup sem validar valor/data → falso over-pay MICHEL)
- [supabase/functions/sienge-sync/normalize/receivable-bills.ts](../../supabase/functions/sienge-sync/normalize/receivable-bills.ts) (sync vivo, mesma cegueira)
- [migrations/023_pagamentos_sienge_installment_id.sql](../../migrations/023_pagamentos_sienge_installment_id.sql) (UNIQUE só contra colisão de par)
- [src/pages/AdminDashboard.jsx](../../src/pages/AdminDashboard.jsx) (gerador UI ancora só bill_id, deixa installment_id NULL)
