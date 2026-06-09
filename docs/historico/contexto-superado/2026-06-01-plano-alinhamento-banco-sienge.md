---
status: PARCIALMENTE EXECUTADO (Passo 1 código + Passo 2 medição feitos; Passo 3 gated)
data: 2026-06-01
branch: sync/reconciliacao (worktree IM-reconciliacao; todo trabalho de banco fica aqui)
ver_tambem: 2026-06-01-north-star-reconciliacao.md · 2026-06-01-passo2-residuo-medido.md · 2026-06-01-distratos-mapa-completo.md
ancora_factual: docs/reconciliacao-geral-*-aplicado.json (cron run 26736891891, 01/06) + docs/rodadas/b8/reconciliacao-cauda-2026-05-29.json
---

# Plano: alinhar banco local ↔ Sienge e parar de gerar duplicações

> Documento de discussão. A decisão de **qual** linha duplicada manter/cancelar é do time (rodada-b),
> fora do escopo deste plano. Aqui só: código + alinhamento dos bancos + as filas que o time vai usar.

## ✅ Progresso (2026-06-01)

**Feito (código, branch `sync/reconciliacao`, build verde):**
- **Parte B** — `gerarPagamentosVenda` idempotente (Opção B skip-only) + grava `sienge_bill_id`. `AdminDashboard.jsx:~3408`.
- **Parte A.1** — ponte distrato no **edge** (`normalize/sales-contracts.ts:411`): `situacao_contrato='3'` → `status='distrato'` + `data_distrato`. Tolera reversão.
- **Parte A.3 (Admin)** — helper `isVendaAtiva` em `comissaoCalculator.js`; auditoria de unidade ignora distrato; `matchStatus` mostra distrato em vermelho no "Todos".
- **Limpeza** — cluster de sync legado **deletado** (`src/services/sienge/` 17 arq + `SincronizarSienge.jsx` + css). Era morto (build provou). **Única via de sync = edge function.**

**Medido (Passo 2, dry-run fresco):** ver [2026-06-01-passo2-residuo-medido.md](2026-06-01-passo2-residuo-medido.md) — **52 `parcela_entrada` pagas órfãs = R$ 21.194,06 em dobro** + 5 pendentes-órfãs + 49 parqueadas.

**Gated (Passo 3, escreve em produção, aguarda ok):**
- **A.2** — deploy do edge (A.1) **e depois** backfill dos 25 distratos. Ordem obrigatória (senão sync clobbera).
- **Limpeza do resíduo** — cancelar 5 pendentes-órfãs (livre) + "Excluir Baixa" das 52 pagas (R$21k, controlado).
- **A.3 Corretor/Cliente** — cosmético (números já corretos; lista entangled com soma → cirurgia segura pendente).

**Achado adicional:** cron passo ① (`gerar-plano-correcao-data-prevista`) lê arquivo **congelado** `varredura-...-2026-05-13.json` (99 vendas) → escopo preso ao passado. Fix: fundir no passo ② (`reconciliar-todas-vendas`, universo completo).

## Contexto

A investigação (read-only, 1 bulk já gasto) achou **dois problemas distintos** que inflam totais e inadimplência:

1. **Distratos contados como venda ativa.** 25 vendas têm `situacao_contrato='3'` (distrato, com `data_cancelamento` preenchida pelo sync) mas seguem com `excluido=false`. **Nenhum código lê `situacao_contrato`/`data_cancelamento`** — só `excluido`. Resultado: 14 unidades aparecem com >1 "venda ativa". Não é erro de geração (sienge_contract_id / bill_id / numero_contrato são 1:1 únicos) e **não gera inadimplência** (parcelas do distrato estão `pago`). É erro de *leitura*: a UI mostra o distrato como ativo.

2. **Gerador de parcelas não-idempotente + match heurístico.** `gerarPagamentosVenda()` insere sem checar duplicata e sem gravar a âncora Sienge; sync/backfill casam por `(venda_id, numero_parcela)` — chave que **colide** (Sienge manda `installmentNumber` "x/y" reiniciando por paymentTerm). Resultado confirmado: 93 grupos multi-pago / 97 linhas pagas excedentes / **R$ 27.552,21 de comissão contada em dobro**; + 188 pares pago+pendente (gêmeo "pendente" falso), 167 cancelado+pendente, 37 pendente+pendente.

Inadimplência real (Sienge income/D): **4,89% valor / 10,26% parcela** — vs. 14,14% / 11,29% que o banco local mostra inflado pelos gêmeos falsos.

**Fora de escopo (decisão do time, via rodada-b):** *qual* linha duplicada manter/cancelar. Este plano só entrega: (A) código que trata distrato como não-ativo, (B) gerador idempotente + âncora, (C) sync/backfill ancorados, (D) a fila de auditoria + script de aplicação que o time vai usar pra executar as decisões.

**Restrições:** não commitar direto na `main` (já estamos na branch `docs/contexto-banco-2026-05-29`; código vai por branch/PR). Nenhuma chamada Sienge (bulk único já gasto — tudo usa dado já baixado + DB local). Segredos só de `.env` em runtime, nunca no código.

### Conciliação de hoje (run 26736891891, 01/06 — verificado antes de implementar)

O cron diário está em **steady-state idempotente** (`populados=0 marcados=0 reativados=0 criados=0`, data_prevista `updated=0`). Consequências que moldam este plano:

- As duplicações **não se auto-corrigem**. `reconciliar-todas-vendas.mjs` já as **detecta e parquea** em `revisao_humana` (49–51 casos) porque são decisão humana — por isso persistem.
- **A detecção da Parte D já existe.** O report diário (`docs/reconciliacao-geral-AAAA-MM-DD-aplicado.json`) já lista: 6 "banco tem parcelas ATIVAS com mesmo (tipo,valor,data) — ambiguo", 3 "Sienge ... ambiguo", **54 parcelas pagas órfãs** (`processadas[].semMatch` com `status=pago`, em 49 vendas — onde mora o R$ 27.552 em dobro), e **~28 "soma income ≠ pro_soluto"** (pro_soluto local diverge do Sienge → afeta fator de comissão).
- Âncora travada em ~80% (`popular sienge_installment_id: 0`): o não-ancorado é o próprio conjunto ambíguo. `receivable-bills` dá `noMatch=33237/40266` → Parte C (match por âncora) melhora match **novo**, mas não destrava os 20% existentes sem decisão humana.
- **Parte B é a peça mais crítica:** o cron nunca conserta duplicata existente; só a idempotência do gerador **impede criar nova**.

---

## Parte A — Distrato vira de primeira classe (ponte sync #1→#2)

> **Decisões travadas (2026-06-01, gestora):** (1) comissão **paga** dos distratos — R$ 684.724,42 — **continua nos totais** (distrato zera só o futuro, nunca o que já foi repassado); (2) distratos **aparecem marcados em vermelho**, não somem da listagem; (3) tratamento vale em **todos os dashboards** (Admin, Corretor, Cliente, Home).

O mapa de distratos ([2026-06-01-distratos-mapa-completo.md](2026-06-01-distratos-mapa-completo.md)) achou que distrato tem **3 representações que não conversam**: a real (`situacao_contrato='3'`+`data_cancelamento`, 25 vendas, **ninguém lê**), a manual/morta (`status='distrato'`+`data_distrato`, 0 linhas, mas **a UI já sabe renderizar** — rótulo vermelho + `calcularComissaoVendaDistrato`), e o soft-delete (`excluido=true`, à parte).

A correção mais limpa **não** é um `isVendaAtiva` que exclui `situacao='3'` (bruto — arriscava derrubar os R$ 684k dos totais e não dava o "vermelho" pedido). É **construir a ponte #1→#2**: fazer o sistema enxergar `situacao_contrato='3'` como `status='distrato'`, e a máquina de UI que já existe passa a valer pros 25 **de graça** — com a comissão correta (paga preservada via `calcularComissaoVendaDistrato`, futuro zerado).

**A.1 — Sync grava a ponte (vendas novas/atualizadas):**
- `supabase/functions/sienge-sync/normalize/sales-contracts.ts:~411` (e equivalentes `syncVendasV2.js`/`syncUtils.js`): ao normalizar, **se `situacao_contrato==='3'`** → setar `status='distrato'` + `data_distrato = cancellationDate`. Tolera reversão: contrato reativado volta pra `situacao='2'` → sync naturalmente reverte `status` (cobre os 6 reemitidos do gap 31→25). Sync já sobrescreve `status` a cada upsert, então é o lugar natural — sem race.

**A.2 — Backfill one-shot dos 25 existentes (sem Sienge, dado já local):**
- PostgREST PATCH nas 25 vendas com `situacao_contrato='3'`: `status='distrato'`, `data_distrato = data_cancelamento` (já no banco). Triggers 017/018/020 são em `pagamentos_prosoluto` — **`vendas.status` é livre**; pagamentos `pago` ficam intactos. Idempotente (filtro `situacao_contrato=eq.3` + `status=neq.distrato`). Emite métrica canônica.

**A.3 — Garantir que a máquina de UI cobre os 3 concerns (a maioria já existe, só auditar):**
- **Exibição (vermelho):** rótulo já dispara em `status==='distrato'` → cobre os 25 automaticamente após A.1/A.2. Auditar que Corretor/Cliente/Home também renderizam o rótulo (decisão 3 = todos).
- **Comissão nos totais:** `calcularComissaoVendaDistrato` = pago + vencido até `data_distrato`. Confirmar que ela roda no caminho de soma de cada dashboard quando `status==='distrato'` (preserva os R$ 684k — decisão 1). **Esta é a parte mais crítica de auditar**: a função existe mas "nunca rodou" porque não havia linha `status='distrato'`.
- **Contagem de venda ativa / ocupação de unidade:** `AdminDashboard.jsx:417-449` (auditoria de unidade duplicada, `exactKey`) deve tratar `status==='distrato'` como **não-ativa** antes de agrupar → as 12 unidades "revenda + distrato" somem do falso alerta. Idem `matchStatus` (`:5261`) e cards que contam venda ativa.

**Helper de apoio** em `comissaoCalculator.js` pra padronizar o predicado de contagem (não de exibição):
```js
// distrato NÃO conta como venda ativa (mas continua exibido em vermelho e somado o pago)
export const isVendaAtiva = (v) =>
  (v?.excluido === false || v?.excluido == null) &&
  v?.status !== 'distrato'
```

Garantia: o sync **já grava** `situacao_contrato`/`data_cancelamento` (`syncVendasV2.js:386`, `syncUtils.js:385,400`) — A.1 só adiciona a derivação `status='distrato'`; A.2 retroage nos 25. Zero migration (só código + 1 backfill de dados).

## Parte B — Gerador idempotente + âncora (`AdminDashboard.jsx` ~3245-3423)

- No INSERT (~3409), trocar o `.insert(novosPagamentos)` cego por chamada à função **já existente e testada** `propagarCronogramaCirurgico()` (590-670), passando `pagamentosExistentes` (buscados antes) + `pagamentosNovos`. Ela já: nunca insere chave que colida com `pago` (set `chavesPagas`), nunca toca colunas imutáveis de pago, e na 1ª geração (`existentes=[]`) age como insert normal → **2ª execução vira no-op** (`inserted=0`). Isso mata a causa-raiz dos gêmeos pagos.
- Gravar `sienge_bill_id` nas linhas inseridas quando `venda.sienge_receivable_bill_id` existir (`sienge_installment_id` fica null na geração — só chega pelo income; o índice único parcial 023 não dispara com null).
- **Guard a confirmar no código:** `sinal`/`entrada`/`comissao_integral` devem ser únicos por venda (chave não pode colidir legitimamente). Verificar antes de mexer.

## Parte C — Match ancorado em sync + backfill

Padrão de referência: `scripts/reconciliar-todas-vendas.mjs` (único código que já usa a âncora).

- **`supabase/functions/sienge-sync/normalize/receivable-bills.ts`** (`matchPag` 129-150, UPDATE 263-277): incluir `sienge_bill_id`/`sienge_installment_id` no SELECT; **1º** passo de match por `installmentId`; só cai no heurístico (numero_parcela → valor+data ±0,01/≤30d) quando a âncora falta; e **backfillar a âncora** no mesmo UPDATE quando casar por heurístico (cresce 80%→100% naturalmente). `try/catch`; conflito de unique → logar drift e pular.
- **`scripts/dry-run-backfill-income.mjs`** (100-246): mesma lógica — mapa por `installmentId`, match âncora-first, anexar âncora nas linhas a atualizar. Degrada pro heurístico se `docs/backfill-stage.json` não tiver `installmentId`.

## Parte D — Fila de auditoria (rodada **b9**) + script de aplicação genérico

Decisão de qual linha manter é do time; aqui só geramos a fila e a ferramenta de aplicar. **Reaproveitar a detecção que já existe** — não reconstruir.

- **Novo `scripts/gerar-rodada-b-duplicatas.mjs`** (read-only, **sem Sienge**): lê o `docs/reconciliacao-geral-*-aplicado.json` **mais recente** (já produzido pelo cron) e **colhe** os casos em vez de varrer o banco do zero: `revisao_humana[]` com motivo "ambiguo" + `processadas[].semMatch` com `status=pago` (as 54 parcelas pagas órfãs — onde está o R$ 27.552). Para cada caso, faz uma leitura read-only complementar em `pagamentos_prosoluto` por `venda_id` pra montar `estado_atual.linhas[]` (id/status/valor/comissao_gerada/datas/tem_ancora). Emite `docs/rodadas/b9/b9-duplicatas-comissao.json` + `b9-texto-para-usuaria.md` + métrica canônica. **Não decide** (`acao_sugerida: null`). Schema por caso: identificadores (venda, contrato, unidade, cliente, corretor) + `estado_atual.linhas[]` + `opcoes[]` (manter / cancelar / renumerar) pra decidir sem voltar ao banco. **Vantagem:** zero risco de divergir do detector do cron — mesma fonte de verdade.
- **Novo `scripts/aplicar-rodada-b.mjs`** (genérico, reusável — **serve b9 e b10**): `node scripts/aplicar-rodada-b.mjs --rodada bN [--apply]`. Lê `b{N}-respostas.json` + casos; PostgREST PATCH (`.env` em runtime, `Prefer: return=representation`). Respeitando triggers:
  - `cancelar` em **pendente/cancelado** → `PATCH status=eq.pendente {status:'cancelado'}`.
  - `cancelar` em **pago** → **nunca DELETE/cancel** (017/020 bloqueiam) → manda pra `humano_pendente[]` ("usar Excluir Baixa manual"), não tenta PATCH.
  - `renumerar` → `{numero_parcela}` (liberado em qualquer status por 020; nunca toca tipo/valor/comissao_gerada).
  - `ajustar_pro_soluto` (b10) → só se a venda **não** tem parcela `pago` (invariante da spec): `PATCH vendas {valor_pro_soluto, fator_comissao recalculado}`. Se tem `pago` → `valor_pro_soluto` é **imutável** → manda pra `humano_pendente[]` (decisão de negócio); no máximo refaz snapshot `fator_comissao_aplicado` (liberado por 018), nunca `valor`/`comissao_gerada`.
  - `manter` → no-op.
  Idempotente (filtro de status/id em todo PATCH → 2ª run = 0). Saída `docs/rodadas/b{N}/b{N}-execucao.json` (schema canônico). Referência: `scripts/aplicar-b6-grupo1.mjs`.

## Parte E — Rodada **b10**: pro_soluto local ≠ Sienge (fila separada)

Mesma fonte (report do cron), tipo de problema diferente → rodada própria (regra rodadas-b: não amontoar).

- **Novo `scripts/gerar-rodada-b-prosoluto.mjs`** (read-only, **sem Sienge**): colhe do `reconciliacao-geral-*-aplicado.json` mais recente os `revisao_humana[]` com motivo `"soma income (X) != pro_soluto (Y)"` (~28 casos). Para cada: identificadores + `valor_pro_soluto` local + `soma_income` Sienge + nº de parcelas pagas (pra sinalizar se é auto-corrigível ou escala pra negócio) + `fator_comissao` atual. Emite `docs/rodadas/b10/b10-prosoluto-divergente.json` + `b10-texto-para-usuaria.md` + métrica canônica. **Não decide.** `opcoes[]`: `manter` / `usar_valor_sienge` / `investigar`.
- Aplicação via o **mesmo** `scripts/aplicar-rodada-b.mjs --rodada b10` (ação `ajustar_pro_soluto` acima). A maioria dos casos tem parcela paga → cairá em `humano_pendente[]` (decisão de negócio), que é o comportamento correto pela spec.

## Verificação

1. **Parte A:** rodar o app (`npm run dev`), abrir AdminDashboard → confirmar que as 14 unidades "duplicadas" caem (distratos somem do alerta); CorretorDashboard/ClienteDashboard não listam distratos. Comparar contagem de venda ativa antes/depois via SQL read-only (esperado: −25).
2. **Parte B:** em dev, "Gerar pagamentos" 2× na mesma venda → 2ª vez não cria linha nova (checar count em `pagamentos_prosoluto` por `venda_id`).
3. **Parte C:** `node scripts/dry-run-backfill-income.mjs` (dry-run) → reporta âncoras que *seriam* backfilladas, 0 alteração financeira; rodar 2× → 2ª run `updated=0`.
4. **Parte D (b9):** `node scripts/gerar-rodada-b-duplicatas.mjs` → gera b9 com os ambíguos + 54 parcelas pagas órfãs (surplus ≈ R$ 27.552), colhidos do report do cron; conferir que bate com o `revisao_humana`/`semMatch` do report. `aplicar-rodada-b.mjs --rodada b9` sem `--apply` confirma plano; 2ª run idempotente.
5. **Parte E (b10):** `node scripts/gerar-rodada-b-prosoluto.mjs` → gera b10 com os ~28 casos pro_soluto≠Sienge; conferir que casos com parcela paga vêm marcados como "escala negócio" (não auto-corrigíveis).
6. **Invariantes SQL** (`.claude/rules/sincronizacao-sienge.md`): zero pago sem data; zero pendente com data; nenhuma linha pago deletada.

**Entrega via branch/PR** (não na `main`). Nada aqui chama o Sienge.

---

## Casos de melhoria em aberto (discutir antes de executar)

Pontos onde há decisão/refino pendente — **não** travam o plano, mas vale alinhar:

1. ⚠️ **DECISÃO DE NEGÓCIO — Parte B, o que "Gerar pagamentos" faz numa venda que já tem cronograma.** Verificado: `propagarCronogramaCirurgico` (linhas 649-662) **DELETA todo pendente que não está na grade recém-calculada** (além de atualizar os que casam e inserir os que faltam). Os pagos são sempre preservados (idempotente). A questão é o que fazer com pendentes:
   - **Opção A — Reconciliar (reusar `propagarCronogramaCirurgico`):** alinha o banco à grade calculada dos campos da venda. Limpa pendentes espúrios (bom pra duplicata), mas **apaga pendente que exista por outro motivo** (ex.: parcela que o Sienge trouxe e a config local não modela). Destrutivo, porém é a função testada.
   - **Opção B — Só preencher buracos (pre-check skip):** se a venda já tem pagamentos, **nunca deleta**; no máximo insere chaves faltantes. Não-destrutivo, mas não limpa pendente espúrio (deixa pra rodada b9).
   - **Trade-off:** A grade local é calculada de `sinal/entrada/balão/qtd_parcelas` da venda. Se o Sienge tiver MAIS parcelas que a config local conhece (exatamente o cenário de drift que estamos consertando), a Opção A as apagaria — pode ser certo (espúrias) ou errado (parcelas Sienge reais). Só o negócio sabe a intenção. **Recomendação:** Opção B no botão "Gerar pagamentos" (não-destrutivo, seguro), deixando toda remoção de pendente espúrio pra rodada b9 (decisão humana caso-a-caso). Reservar a Opção A só pro fluxo de "editar venda/recriar cronograma", que já a usa hoje (linhas 2199, 2351).
2. **Parte C — âncora travada em 80%:** o backfill por âncora não destrava os ~20% sem âncora (são justamente os ambíguos). Eles só ganham âncora **depois** que o time decidir em b9. Ordem sugerida: b9 primeiro, âncora depois. Concorda?
3. ✅ **RESOLVIDO (2026-06-01) — `numero_parcela` de sinal/entrada/comissao_integral:** verificado em `gerarPagamentosVenda` (AdminDashboard.jsx:3330-3404). Esses 3 tipos **não recebem `numero_parcela`** (`null`) e são **1-por-venda** (ramos exclusivos do `if`). A chave de `propagarCronogramaCirurgico` (`tipo + '__' + (numero_parcela ?? '')`, linha 596) vira `sinal__`/`entrada__`/`comissao_integral__` — únicas por venda, **não colapsam**. Guard da Parte B satisfeito.
4. **b10 — quase tudo escala pra negócio:** a maioria das ~28 vendas com pro_soluto divergente tem parcela paga → `valor_pro_soluto` é imutável pela spec → vira decisão de negócio, não auto-fix. b10 entrega principalmente a *lista priorizada* (quanto cada divergência impacta a comissão), não a correção automática.
5. **Sequenciamento:** Parte A + Parte B podem ir num PR (corrige UI + estanca a sangria) antes mesmo das rodadas b9/b10 saírem. As filas (D/E) são paralelas e não bloqueiam A/B.
