# Raio-X de Integridade do Banco — IM-Calculo / FIGUEIRA GARCIA
**8 auditorias read-only (2026-06-09) · achados verificados contra o banco vivo**

> Workflow `raio-x-banco-im` (run wf_965b6421-d77): 8 auditores em paralelo + síntese. 27 tabelas cobertas. C1 reverificado manualmente pelo operador.

---

## 1. Veredito

Banco **estruturalmente saudável, núcleo financeiro íntegro** — mas há um **ferimento aberto de distrato** que precisa de cirurgia. A tese central se confirma: `vendas.status` é **decorativo** ("pago" = ">=1 parcela baixada", nunca "quitada" — só 8 de 262 vendas ativas estão de fato quitadas); a verdade vive em `pagamentos_prosoluto`; maio pago (fora distratos) está limpo; identidade `comissao = valor × fator` **100% intacta nas 4.446 pagas**; percentuais 7%/6,5% batem 100%; integridade referencial perfeita (0 FK órfã, 0 CPF/sienge_id duplicado, 0 venda ativa sem corretor, 0 venda excluída com paga). **O problema NÃO é fator nem âncora — é a baixa-de-distrato:** no distrato o Sienge baixa TODAS as parcelas, e o banco conta essas baixas-falsas como comissão recebida.

**Dinheiro em risco:** R$77.265,53 confirmado (C1) + até ~R$683k não-mensurável (C2, ~R$436k provável falso) + R$2.572,57 (C3) + R$203,56 (C4).

---

## 2. CRÍTICO — afeta dinheiro

### C1. Curativo de maio NÃO pegou: 158 parcelas pós-distrato ainda `pago` = R$77.265,53 (VERIFICADO)
| Contrato | Unid | Distrato | Pagas pós (falsas) | Comissão falsa |
|---|---|---|---|---|
| c382 | 1305 A | 04/05 | 50 (pagas 05/05) | R$ 30.288,93 |
| c279 | 903 D | 21/05 | 56 (pagas 22/05) | R$ 26.373,16 |
| c302 | 1403 D | 28/05 | 52 (pagas 29/05) | R$ 20.603,44 |

- Marcadas `motivo='distrato'` mas o flip `pago→cancelado` **nunca pegou** (só 2 viraram cancelado). CLAUDE.md diz "cancelei 158", banco vivo prova que não.
- **Cai em maio (05/05, 22/05, 29/05) → infla o relatório de maio desses 3 corretores.**
- **Investigar ANTES de reaplicar:** curativo não-commitado vs sync re-flipou pela âncora. `data_distrato` está preenchida nas 3 → o guard distrato-aware deveria ter funcionado. Validar idempotência do cron senão volta a sangrar.
- Correção: "Excluir Baixa" nas 156 pós-distrato (preservar ~17 pré-distrato reais) + `status='distrato'`. **GATED.**

### C2. 25 distratos com `data_distrato=NULL` = R$682.978,06 em 1.475 parcelas pagas — exposição não-mensurável
- `situacao='3'` mas `data_distrato NULL` + `status='pendente'`. Sem a data, o reconciliador fica cego.
- Perfil: **~10 vendas** com TODAS ~60 parcelas pagas num único dia (~R$269k → quase certo falso; ex. c290, c168, c361); **~6** em 2-3 datas (~R$167k); **~9** espalhadas (~R$247k → provável real pré-distrato).
- Correção: backfill `data_distrato` do Extrato de distrato Sienge → reconciliador → Excluir Baixa pós-distrato. **GATED + controladoria** (bucket "25 distratos" já enviado).

### C3. 6 parcelas "fantasma" (pagas, sem âncora) = R$2.572,57 double-count
- c8 (404A) R$350,50 · c11 (410A) R$325,46 · c64 (802A) R$319,80 (sinais) · c269 R$755,89 · c351 R$535,13 · c275 R$285,69 (parcela_entrada).
- Linha paga sem âncora ao lado do pagamento Sienge real. Par `(bill,installment)` único → o ancorado é a verdade.
- Correção: Excluir Baixa + cancelar fantasma `motivo='duplicata'`. **GATED.**

### C4. c351 (506 A, LILIAM): 3 pagas com fator 0,4647 vs canônico 0,35 = R$203,56 overpay
- Venda externa fator 0,35; 3 parcelas a 0,4647. Identidade consistente → passou no detector de identidade, falha na régua de fator. (É a venda que segurei do fix de fator de hoje por ter np2 duplicado + grade bagunçada.)
- Correção: restaurar fator 0,35 + recalcular comissão no mesmo UPDATE. **GATED** (entrelaçado com a dedup de C3).

---

## 3. MÉDIO — afeta relatório/contagem, não dinheiro

- **M1.** 28 distratos (`situacao='3'`) — nenhum tem `status='distrato'` (ponte A.1 não deployada). Mesma raiz de C1/C2.
- **M2.** 3 vendas ativas `status='pago'` com ZERO paga: c171 (1705A MIKAEL, 60 pendentes), c360 (605C ALEXANDRE), c236 (excluído). Reclassificar → pendente. **Não-gated.**
- **M3.** 2 vendas reais sem contrato Sienge: Gustavo (606) + Gabriel Adriano (412), 0 pagas. Na controladoria. **Não-gated.**
- **M4.** 50 vendas ativas com soma de parcelas > pro_soluto (~R$25k, balão/sinal extra do gerador). Maioria pendente. **GATED** (algumas com pago).
- **M5.** 35 grupos com `numero_parcela` colidido por aditivo (8 vendas). NÃO é double-count (cada linha ancora installment real), mas quebra a chave. **GATED.**
- **M6.** c269 (609D DIEGO RAMOS) grade gravemente malformada (np 3/4/6 múltiplas, datas 2029/30, 0% âncora). Rodada-b dedicada. **GATED.**
- **M7.** 2.016 de 2.018 canceladas SEM `motivo_cancelamento_parcela` — reconciliador motivo-aware cego em 99,9%. Backfill heurístico. **GATED.**
- **M8.** 3 corretores reais em 2 contas (repasse fragmentado):
  - **MATHEUS DE S. PIRES**: conta `interno` (31 vendas, R$144,5k) + `externo` (11 vendas, R$120k) — mesma pessoa paga 6,5% numa metade e 7% na outra. ~R$264k fragmentados.
  - **DIEGO BENITES**: "DIEGO BENITES" (c4) + "DIEGO JARDIM BENITES" (c187) — cadastro duplo no Sienge.
  - **ENZO TORMES**: conta real + conta-fantasma sob email de terceiro (carrega o distrato c25).
  - Correção: consolidar sob 1 `corretor_id`. NÃO recalcular comissão paga. **GATED** (decisão de qual tipo_corretor vale).
- **M9.** JEFERSON c405 cliente sem `sienge_customer_id`; **comissoes_venda funcionalmente abandonada** (cobre 0 das 298 vendas vivas — a "snapshot imutável" das regras não vale na prática, mas UI deriva de pagamentos → não afeta dinheiro); `cargos_empreendimento_historico` vazia (mudança 7%→6,5% nunca logada); `renegociacoes` subpopulada (1 linha, 0 pagamentos com `renegociacao_id`).
- **M10.** `unidades.status` 100% 'disponivel' mesmo as 284 vendidas — decorativo; armadilha pra relatório futuro de disponibilidade.

---

## 4. COSMÉTICO / BAIXO

- Identidade off R$0,01 em 559 pendentes (soma R$3,00) — ruído de arredondamento.
- c405: 46 pendentes com fator/percentual NULL (comissão correta). Backfill trivial.
- 3 typos de ano em `data_pagamento`: c327 (2026-12-19→2025), c287 (2026-11-19→2025), c87 (pago 35d antes da venda).
- Drift >365d em 6 vendas (R$101k) = quitação real, 100% ancorada — cosmético, não mexer.
- Ancoragem **89,87% das ativas / 92,65% das pagas**; 92 vendas <100% (22 com 0%) — as 327 pagas sem âncora são a raiz dos double-counts (C3).
- 23 clientes duplicados (Sienge real + gêmea manual órfã, 0 comissão dup); 15 órfãos sem venda (12 seeds); contas de teste ("jonas beton", "Jonasss teste").

**Confirmações positivas (núcleo íntegro):** identidade/fator/percentual 100% nas 4.446 pagas + 272 ativas; invariantes status×data limpas (0 pago-sem-data, 0 pendente-com-data); excluído⇒sem-pago íntegro; 11 corporativas PJ corretas; cargos 7%/6,5% exatos; sync vivo (último run 2026-06-09 04:47).

---

## 5. PESO MORTO

| Item | Linhas | Veredito |
|---|---:|---|
| `backup_pagamentos_prosoluto_prego_20260424` | 18.558 | backup, 0 ref → dump+DROP |
| `backup_vendas_prego_20260424` | 330 | backup → DROP |
| `backup_b5_falsos_cancelados_20260424` | 361 | backup → DROP |
| `leads`/`atividades`/`notificacoes`/`metas`/`mentoria_*`/`usuario_conquistas` | 0 | lixo → DROP |
| `conquistas` | 10 | vestígio seed → DROP |
| `cargos_empreendimento_historico` | 0 | conectar trigger OU DROP |
| `vendas.lead_id` (coluna) | NULL | referência quebrada → DROP COLUMN |
| `empreendimentos` 'Vista Park'+'Jardim das Flores' | 2 | seed/teste → DELETE |

---

## 6. PLANO DE AÇÃO PRIORIZADO

**Bloco 1 — Estancar distrato (DINHEIRO):**
1. [GATED] Investigar por que o curativo sumiu (não-commitado vs sync re-flipou) — pré-requisito.
2. [GATED] Excluir Baixa nas 156 de c279/c302/c382 → −R$77.265,53 + `status='distrato'`. (C1)
3. [GATED+controladoria] Backfill `data_distrato` dos 25 NULL → reconciliador → cancelar pós-distrato (~R$436k). (C2)
4. [GATED] Deploy ponte A.1 (sales-contracts.ts) → distratos pegam `status='distrato'` no sync. (M1)

**Bloco 2 — Double-count/overpay residual (DINHEIRO, baixo):**
5. [GATED] Excluir Baixa + cancelar 6 fantasmas → −R$2.572,57. (C3)
6. [GATED] Restaurar fator 0,35 em c351 → −R$203,56. (C4)

**Bloco 3 — Fundação âncora+gerador (já planejado):**
7. [GATED] Backfill âncora nas 92 vendas <100% (327 pagas sem âncora = raiz do C3).
8. [GATED] Cancelar extras das 50 (M4) + re-sequenciar numero_parcela dos 35 grupos aditivo (M5).
9. [GATED] c269 rodada-b dedicada (M6). 10. [GATED] Backfill motivo nas 2.016 canceladas (M7).

**Bloco 4 — Cadastro/relatório (não-dinheiro):**
11. [GATED] Consolidar MATHEUS/DIEGO/ENZO sob 1 corretor_id (M8).
12. [não-gated] Reclassificar c171/c360→pendente; investigar 606/412; popular sienge_customer_id de c405.

**Bloco 5 — Higiene de schema:**
13. [GATED] DROP backups (após dump) + 9 vazias + vendas.lead_id + 2 seeds.
14. [decisão] Aposentar/backfillar comissoes_venda; trigger em cargos_historico; derivar unidades.status.

> O Bloco 1 é o que mais distancia o banco do Sienge hoje. Quase tudo que escreve em produção é **gated** (linha paga / decisão humana).
