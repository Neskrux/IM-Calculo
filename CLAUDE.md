# IM-Calculo — Regras do Projeto

Regras de negócio críticas que **SEMPRE** devem ser respeitadas ao alterar código, gerar queries ou calcular comissões neste repositório.

---

## Regras de comissão (carregadas automaticamente)

@.claude/rules/fator-comissao.md
@.claude/rules/comissao-corretor.md
@.claude/rules/comissao-integral-20.md

## Regras de sincronização (carregadas automaticamente)

@.claude/rules/sincronizacao-sienge.md

## Regras de visualização e processo (carregadas automaticamente)

@.claude/rules/visualizacao-totais.md
@.claude/rules/rodadas-b.md

---

## Princípios gerais

1. **Fórmula canônica do fator:** `Fcom = (Valor_Venda × Percentual_Total) / Valor_ProSoluto`. Nunca aplicar percentual direto na parcela.
2. **Comissão por pagamento, não por venda:** somar sempre das linhas de `pagamentos_prosoluto`, nunca de `vendas.comissao_corretor`.
3. **Comissão integral só quando entrada ≥ 20% paga à vista (não parcelada).**
4. **Nunca recalcular comissões de vendas antigas ao alterar percentuais.** O snapshot em `pagamentos_prosoluto.fator_comissao_aplicado` é a fonte da verdade histórica.
5. **Migrations 017 + 018 + 020** protegem linhas com `status = 'pago'`:
   - **Imutáveis em pago:** `tipo`, `valor`, `comissao_gerada` (financeiras/identidade).
   - **Editáveis em pago:** `data_pagamento` (020 — 2026-04-23, Sienge é fonte da verdade temporal); `fator_comissao_aplicado`, `percentual_comissao_total` (018 — 2026-04-21, snapshots/metadados).
   - **DELETE de pago:** bloqueado.
   - **Reversão pago→pendente:** só via fluxo explícito "Excluir Baixa" (`status='pendente'` + `data_pagamento=NULL` no mesmo UPDATE).

---

## Tabelas-chave

| Tabela | Propósito |
|--------|-----------|
| `vendas` | Dados da venda (valor, pro-soluto, fator canônico) |
| `pagamentos_prosoluto` | Parcelas geradas + snapshot de fator aplicado |
| `cargos_empreendimento` | Percentuais **atuais** por cargo por empreendimento |
| `cargos_empreendimento_historico` | Log de alterações de percentuais |
| `comissoes_venda` | Snapshot por venda (imutável) |

---

## Auditorias recentes

- [docs/auditorias/etapa0/p1-p2-execucao.md](docs/auditorias/etapa0/p1-p2-execucao.md) — P1 (fator de venda) e P2 (snapshot de pagamentos) executados em 2026-04-21
- [docs/auditorias/etapa0/p3-vendas-divergentes-decisao.md](docs/auditorias/etapa0/p3-vendas-divergentes-decisao.md) — 6 vendas divergentes aguardando decisão de negócio (causa: mudança de `tipo_corretor` com regeneração de grade)
- [migrations/018_afrouxar_snapshot_em_pago.sql](migrations/018_afrouxar_snapshot_em_pago.sql) — libera snapshots metadados em `status=pago` (trigger 017 afrouxado)
- [migrations/020_liberar_data_pagamento_sienge.sql](migrations/020_liberar_data_pagamento_sienge.sql) — libera `data_pagamento` em `status=pago` pra sync corrigir drift vs Sienge (2026-04-23)
- [migrations/021_corretor_cliente_id_origem.sql](migrations/021_corretor_cliente_id_origem.sql) — adiciona `corretor_id_origem` e `cliente_id_origem` em `vendas` pra proteger correções manuais contra sync (2026-04-27)
- [docs/auditorias/2026-05-13-drift/varredura-pagamentos-bagunca-2026-05-13.json](docs/auditorias/2026-05-13-drift/varredura-pagamentos-bagunca-2026-05-13.json) — varredura 2026-05-13: 99 vendas FIGUEIRA (30% do universo) com drift > 30d entre `data_prevista` e `data_pagamento` em pago e/ou `numero_parcela` duplicado. Causa-raiz: backfill antigo (`scripts/dry-run-backfill-income.mjs`) fez match heurístico apenas por `(venda_id, numero_parcela)` e nunca corrigiu `data_prevista` — só `data_pagamento`.
- [docs/rodadas/b7/b7-texto-para-usuaria.md](docs/rodadas/b7/b7-texto-para-usuaria.md) — rodada B.7 (2026-05-13): 11 vendas com `numero_parcela` duplicado (par cancelado+ativo). Aguardando re-baixa `/bulk-data/v1/income` (quota Sienge esgotou) pra reconciliação por `installmentId` real.
- [migrations/023_pagamentos_sienge_installment_id.sql](migrations/023_pagamentos_sienge_installment_id.sql) — adiciona `sienge_bill_id` e `sienge_installment_id` em `pagamentos_prosoluto` pra ancoragem 1:1 com Sienge (substitui match heurístico). **Não aplicada — pendente de revisão.**
- [docs/auditorias/2026-05-13-drift/aplicacao-data-prevista-2026-05-13.json](docs/auditorias/2026-05-13-drift/aplicacao-data-prevista-2026-05-13.json) — **132 parcelas em 16 vendas tiveram `data_prevista` corrigida pelo cache Sienge** (zero quota gasta, 2026-05-13). Drift entre 2 e 365 dias. Idempotente (rerun reporta 0 updated). Drift > 365d (19 parcelas) e sem-match (19) ficaram pra revisão humana.
- **Fix UI 2026-05-13** ([src/pages/AdminDashboard.jsx](src/pages/AdminDashboard.jsx), [CorretorDashboard](src/pages/CorretorDashboard.jsx), [ClienteDashboard](src/pages/ClienteDashboard.jsx), [HomeDashboard](src/pages/HomeDashboard.jsx), [comissaoCalculator](src/utils/comissaoCalculator.js)): parcelas `cancelado` agora renderizam corretamente (antes eram tratadas como `pendente`, inflando totais). `somarComissao` por default ignora canceladas.
- **Fix `propagarCronogramaCirurgico` 2026-05-13** ([AdminDashboard.jsx:181-184](src/pages/AdminDashboard.jsx#L181-L184)): a função antes filtrava `status !== 'pago'` (incluía canceladas como pendentes). Agora separa em 3 grupos (pagos/pendentes/cancelados) e canceladas são **ignoradas** — não entram em UPDATE nem DELETE. Elimina a causa-raiz que estava criando pares `cancelado+pendente` com mesma `numero_parcela` a cada regeneração de grade.
- [.github/workflows/recurring-reconciliation.yml](.github/workflows/recurring-reconciliation.yml) — **cron diário 08h BRT** que baixa income do Sienge (bulk-data, sem quota), gera plano de correção de `data_prevista` e aplica drifts pequenos (2-365d) automaticamente. Idempotente. Drifts >365d e sem-match ficam pra revisão humana. Falha o job se houver erros. **Pré-requisito:** configurar secrets no repo (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SIENGE_USERNAME, SIENGE_PASSWORD, SIENGE_SUBDOMAIN).
- [docs/rodadas/b6/aplicacao-b6-g1-2026-05-13.json](docs/rodadas/b6/aplicacao-b6-g1-2026-05-13.json) — **19 parcelas extras canceladas** (b6 Grupo 1, parcial): 14 da venda Fernanda c287 + 5 da Caroline c340.
- [docs/auditorias/2026-05-13-drift/plano-correcao-data-prevista-ampla-2026-05-13.json](docs/auditorias/2026-05-13-drift/plano-correcao-data-prevista-ampla-2026-05-13.json) + [docs/rodadas/b6/aplicacao-b6-g1-expandido-2026-05-13.json](docs/rodadas/b6/aplicacao-b6-g1-expandido-2026-05-13.json) — **varredura ampla 2026-05-13** sobre todas as 299 vendas FIGUEIRA com bill_id (não só as 99 da varredura inicial). Resultado: **96.6% das parcelas já corretas**. **+35 parcelas extras canceladas** em 3 contratos novos (c173 Carlos×3, c219 Josapha×1, c228 Letícia×31 — todas extras do gerador antigo, status pendente→cancelado, num > max_parcela_sienge). Algoritmo agora é genérico (não hard-coda contratos).
- [docs/auditorias/2026-05-14-reconciliacao-geral/pendencias-para-revisao-2026-05-14.md](docs/auditorias/2026-05-14-reconciliacao-geral/pendencias-para-revisao-2026-05-14.md) — **investigação 2026-05-14** dos casos da revisão humana:
  - **c236 → c390 (CLAUDIO MARTIRE)**: contrato 236 foi **reemitido** como 390 no Sienge. O sync já trouxe a venda 390 **completa e correta** (60 parcelas, 12 pagas, unidade 1008 C, comissão R$ 5.377,56). A venda 236 antiga é **duplicata obsoleta** com 3 parcelas pagas-fantasma — precisa ser eliminada mas o trigger bloqueia (tem pago). **Aguardando autorização da gestora pra eliminar a venda 236.**
  - **Mariane c165 + Andressa c8**: **renegociação** (não bug, não reemissão). Contratos seguem ativos no Sienge com o mesmo id; valores das parcelas batem (Mariane 60×1397.33=83.839,80 = Sienge PM; Andressa 60×1016.67+1000 = Sienge). Drift de "5 anos" era artefato de comparação posicional — o bill no income tem parcelas antigas+novas misturadas pós-renegociação (Mariane: 67 entradas pra 60 parcelas). Só o cronograma futuro (`data_prevista`) pode estar com datas do plano antigo — não afeta comissão. Corrigido em passagem: typo `data_pagamento='2202-02-18'` → `2026-02-18` na parc 8 da Mariane.

### Sessão 2026-06-01 — north star, estancar a sangria, medir o resíduo

- [docs/contexto/2026-06-01-north-star-reconciliacao.md](docs/contexto/2026-06-01-north-star-reconciliacao.md) — **norte único** da reconciliação: corretor/admin confia 100% no número porque o banco é espelho fiel do Sienge, atualizado sozinho. Modelo de 3 baldes (Truth In / Mirror Clean / Truth Out) + through-line de 6 passos. Termômetro-mestre: inadimplência exibida (~14% inflada → ~4,89% real).
- [docs/contexto/2026-06-01-plano-alinhamento-banco-sienge.md](docs/contexto/2026-06-01-plano-alinhamento-banco-sienge.md) — plano A–E (distrato, gerador idempotente, match ancorado, filas b9/b10). **Parcialmente executado.**
- **Parte B — gerador idempotente** ([AdminDashboard.jsx:~3408](src/pages/AdminDashboard.jsx)): `gerarPagamentosVenda` deixou de inserir cego. Opção B (skip-only não-destrutivo): só insere chaves `(tipo, numero_parcela)` inexistentes, nunca deleta/toca existente; grava `sienge_bill_id` quando a venda tem bill. Rodar 2× = no-op. Mata a causa-raiz de gêmeos novos.
- **Parte A.1 — ponte distrato no sync** ([sales-contracts.ts:411](supabase/functions/sienge-sync/normalize/sales-contracts.ts)): `situacao_contrato='3'` → `status='distrato'` + `data_distrato=cancellationDate`. Tolera reversão (reemissão volta a `pago`). É o **único caminho de sync vivo** (cron + botão Admin → edge function).
- **Parte A.3 (Admin)** ([comissaoCalculator.js](src/utils/comissaoCalculator.js), [AdminDashboard.jsx](src/pages/AdminDashboard.jsx)): novo helper `isVendaAtiva` (distrato/excluída não contam como ativa — **só p/ contagem, nunca p/ soma de comissão**, preserva R$684k pago). Auditoria de unidade ignora distrato; `matchStatus` mostra distrato em vermelho no "Todos". Decisões da gestora: comissão paga mantida · vermelho (não some) · todos os dashboards.
- **Sync legado DELETADO** — `src/services/sienge/` (17 arq: syncVendasV2, syncUtils, syncOrchestrator, etc.) + `SincronizarSienge.jsx` + css. Era **código morto** (nenhum import vivo; build verde provou). Eram implementação-fantasma duplicada do edge. **Agora há uma única via de sync.**
- [docs/contexto/2026-06-01-passo2-residuo-medido.md](docs/contexto/2026-06-01-passo2-residuo-medido.md) — **Passo 2: resíduo medido contra Sienge fresco** (dry-run de `reconciliar-todas-vendas.mjs`, bulk fresco 17.567 linhas). Resultado ancorado: **52 `parcela_entrada` pagas órfãs = R$ 21.194,06 de comissão contada em dobro** (não os ~R$27k do detector heurístico antigo, que inflava) + 5 pendentes-órfãs + 49 parqueadas (28 pro_soluto-negócio, 11 distrato-provável, ~10 ambíguo). Sienge verificado limpo (3.719 pagas/294 bills, par `(billId,installmentId)` único; `installmentId` reinicia por bill). Âncora local 80% limpa (0 dup pelo par correto).
- **Achado — cron passo ① legado:** `scripts/gerar-plano-correcao-data-prevista.mjs` lê arquivo **congelado** `docs/auditorias/2026-05-13-drift/varredura-pagamentos-bagunca-2026-05-13.json` (99 vendas) como escopo → as outras ~200 ficam invisíveis pra correção de `data_prevista`. Fix recomendado: fundir no passo ② (`reconciliar-todas-vendas`, universo completo) e aposentar o arquivo.
- **Pendente (Passo 3, gated — escreve em produção):** deploy do edge + backfill dos 25 distratos (A.2, nessa ordem); cancelar 5 pendentes-órfãs; "Excluir Baixa" das 52 pagas (R$21k); atacar as 49 parqueadas. A.3 Corretor/Cliente (cosmético).

### Sessão 2026-06-03 — buckets pra controladoria, dedup, auditoria do fator

- [docs/controladoria/conferencia-sienge-2026-06-02.xlsx](docs/controladoria/conferencia-sienge-2026-06-02.xlsx) — **planilha enviada à controladoria** (linguagem de negócio, coluna RESPOSTA): aba 1 parcelas a conferir (b9, 59), aba 2 saldo divergente (b10, 28), aba 3 distratos a confirmar (25), aba 4 análise interna (6 ambíguos). Cruzamento dos buckets: **7 vendas em b9∩distrato**; **c411/c334 do b10 = revenda de unidade distratada** (c181/c168).
- **Writes em produção (autorizados):** dedup 2 vendas manuais duplicadas "603"(CAYO→c411) + "1603"(HELOIZA→c422) — clientes reais, pagamentos conferidos no oficial; Excluir Baixa 4 pagas + cancelar 123 parcelas + soft-delete. Limpeza venda-teste "002" (jonas cliente) + **c236 CLAUDIO** (reemitido→c390, R$1.344 comissão fantasma) — Excluir Baixa 4 pagas + cancelar 116. Pós-fix: 0 vendas excluídas com paga, 0 parcela sem `data_prevista` em venda ativa.
- **2 vendas reais sem contrato Sienge** (Gabriel Adriano 412 + Gustavo 606, 0 pagas) → mandadas à controladoria confirmar (texto).
- [docs/contexto/2026-06-03-plano-reconciliacao-fator-comissao.md](docs/contexto/2026-06-03-plano-reconciliacao-fator-comissao.md) — **auditoria GERAL do fator** (275 vendas ativas, independente da THAI). Resultado: **`fator_comissao` da venda 100% correto** (externo 7,0% / interno 6,5%); **externos 100% íntegros**; **internos pendentes íntegros**; resíduo = **108 parcelas internas PAGAS / 11 vendas com `comissao_gerada` congelado = R$ 3.054,95 overpay** (imutabilidade travou a reescrita quando o fator foi corrigido). Composição de cargos documentada em [fator-comissao.md](.claude/rules/fator-comissao.md) (interno: Corretor 2,5 + Beton 1,25 + Nohros 1,25 + Ferretti 1,0 + Diretor 0,5).
- **Planilha THAI = pré-correção** (`docs/controladoria/porcentagem corretores(THAI).csv`): mede o **fator do CORRETOR**; "NOHROS"=100% internos, "CORRETA"=100% externos. "ATUAL 27%" era o estado antigo/total; o banco hoje já bate com "CORRETA" (1005 A = 11,67%). **Não confiar na coluna DEVIDA** (THAI errou 48/81).
- **Relatório da controladoria validado** (`admin@imincorporadora` → AdminDashboard `gerarRelatorioPDF` l.4557, abas "Relatórios"/"Ver PDF"): cálculo correto; decomposição por cargo proporcional. ⚠️ **Filtro de cargo importa:** "Total/Todos" mostra comissão TOTAL; pra ver o que o corretor recebe, filtrar cargo **"Corretor"**.
- **Frente #4 (outcome/repasse) ARQUIVADA** — repasse ao corretor (dias 10/20) é externo/incerto; não é fonte de verdade. Sistema é a fonte do pagamento (calcula sobre `status=pago` do income). Nenhum relatório foi enviado pelo sistema ainda → correção de fator pode ser retroativa (exceção auditada em [fator-comissao.md](.claude/rules/fator-comissao.md)).
- **Ação A APLICADA (2026-06-03):** [migrations/026_comissao_gerada_restaura_identidade.sql](migrations/026_comissao_gerada_restaura_identidade.sql) — `comissao_gerada` vira editável em pago **só pra restaurar a identidade** `=valor×fator_comissao_aplicado` (exceção cirúrgica, não afrouxa nada). + [scripts/B1-reconciliar-fator-interno-pago.mjs](scripts/B1-reconciliar-fator-interno-pago.mjs) `--apply`: **109 parcelas / 11 vendas internas corrigidas, R$ 3.054,99 overpay removido** (gravadas a 7% → 6,5% canônico). Causa-raiz: correção de percentual 7%→6,5% (~22/05) ficou pela metade — pagas travadas pela imutabilidade 017. Validado: 0 identidade quebrada (todas as pagas), idempotente (rerun=0). Saída: [docs/auditorias/2026-06-03-fator/B1-fator-interno-aplicado.json](docs/auditorias/2026-06-03-fator/B1-fator-interno-aplicado.json). **Fator agora 100% íntegro na carteira.**
- **Pendente (gated):** investigar 3 vendas com decomposição de cargo zerada (1206A/1408A/509A); aguardando respostas da controladoria (b9/b10/distrato/412/606).
