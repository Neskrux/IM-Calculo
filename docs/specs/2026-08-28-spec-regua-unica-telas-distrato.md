# Spec: régua única de totais nas telas do corretor + cura automática de distrato

> **Origem:** 2026-08-28. O financeiro da Imobiliária Corazza (que emite pelos 6 corretores do
> acordo 2×) comparou as 3 telas do login do Luiz Corazza — todas SEM filtro — e achou 3 números
> diferentes de vendas (31 / 25 / 27) e duas comissões pagas (97.620,76 / 78.064,87).
> Grill fechado com o operador em 7 decisões (abaixo). Nada disso é dado errado no banco —
> frota validada no mesmo dia (242 vendas / 14.329 parcelas: fator, % por tipo e identidade ok,
> exceto fila conhecida 1501 A / 509 B / 1006 A).

## 1. Diagnóstico (provado a centavos)

Anatomia da divergência do Corazza (produção, 2026-08-28):

| Tela | Conta o quê | Número |
|---|---|---|
| Dashboard (donut) | TODAS as vendas não-excluídas (25 ativas + 6 distratos) | 31 |
| Meus Clientes | clientes DISTINTOS | 27 |
| Relatórios | só ativas (exclui distrato na base) | 25 |
| Dashboard "comissão paga" | ativas + distratadas, **inclusive 45 baixas falsas da 1002 D** | 97.620,76 |
| Relatórios "recebida" | só ativas | 78.064,87 |

Delta 19.555,89 = 6.687,27 (pago real de distratadas) + **12.868,71 (baixa-em-massa da 1002 D,
distratada em 25/08)**. O salto foi abrupto porque o veneno entrou da noite pro dia — a cura de
distrato era script one-shot gated (`curar-distrato-apply.mjs`), não passo do cron; todo distrato
novo re-envenenava a base até alguém rodar na mão.

Resíduo menor (~R$ 83 na paga, ~R$ 90 na pendente) entre a derivação 4/7 e a tela: investigar no
T5 (provável diferença entre `percentualCorretorDaVenda`+fator vs `comissao_gerada×4/7` em vendas
com juros/arredondamento de snapshot).

## 2. Decisões (grill 2026-08-28, operador)

| # | Decisão |
|---|---|
| D1 | **Pago real de distratada aparece em TODA soma de comissão** (decisão da gestora 2026-06-01 mantida). O corretor sabe o caso dele fora do sistema; o valor ou volta ou entra pra ele. Relatórios hoje viola — alinhar. |
| D2 | **Contagem de "vendas" = ATIVAS em toda tela** (`isVendaAtiva`), com distratos visíveis rotulados do lado ("N ativas · M distratos"). "Clientes" ganha rótulo "clientes distintos". |
| D3 | Cura da 1002 D direto em produção (caso único; sem fluxo de homolog). |
| D4 | **Cura de distrato vira passo do cron** (auto, sem gate humano) — régua física mecânica e já provada 2×. Via PR na `main` (cron roda da main). |
| D5 | **UI não filtra baixa falsa** — uma verdade só: o dado curado. |
| D6 | Fix do header do PDF do Admin (7% × 4%) no mesmo pacote. |
| D7 | Controladoria já comunicada. |

## 3. A régua única (normativa)

Para QUALQUER tela/relatório do corretor:

1. **Soma de comissão** (total/paga/pendente): das linhas de `pagamentos_prosoluto` com
   `status !== 'cancelado'`, **sem filtrar por status de venda** (distratada entra — as falsas
   estão/estarão `cancelado` pela cura). É o que `somarMinhaComissao`/`somarComissao` já fazem.
2. **Contagem de vendas**: `isVendaAtiva` (exclui distrato e excluída). Onde houver espaço,
   mostrar o complemento: "25 ativas · 6 distratos".
3. **Clientes**: contagem de clientes distintos, rotulada como tal.
4. **Ninguém re-deriva a regra localmente**: contagens vêm de `contarVendas(vendas)` (novo helper
   canônico no `comissaoCalculator`).

## 4. Tickets

### T1 — Cura da 1002 D (produção) — SEM CÓDIGO
45 pagas com `data_prevista > data_distrato` (venda `07c77c8e`, distrato 2026-08-25) →
Excluir Baixa (pago→pendente + data NULL) → `cancelado` motivo `distrato`. Preserva as 13 reais
(R$ 18.588,05). Rollback registrado. **Status: SQL entregue ao operador (classificador do
harness bloqueia reversão de baixa via agente — correto); ele aplica no SQL Editor.**
Verificação: 13 pagas / 45 canceladas / `pago_sem_data=0` / `pendente_com_data=0`.

### T2 — Cron auto-cura distrato (PR na main)
- `scripts/curar-distrato-apply.mjs` ganha modo `--auto`: escopo derivado do estado
  (vendas `situacao_contrato='3'` com `data_distrato` preenchida; parcela `pago` com
  `data_prevista > data_distrato` → duas etapas sancionadas). Continua idempotente
  (rerun = 0) e emite métrica canônica.
- Novo step no `recurring-reconciliation.yml` DEPOIS do `Sincronizar vendas Sienge`
  (é o sync que traz `situacao=3`/`data_distrato`; a ordem importa) e antes do
  `Detectar distrato-stale`. Report no artifact; falha ruidosa via step `Verificar erros`.
- A régua compartilhada vira helper testável: `ehBaixaFalsaDeDistrato(pagamento, venda)`
  no `comissaoCalculator` (usada pelo script; espelha o filtro do reconciliador).

### T3 — CorretorDashboard: régua única
- a) `getRelatorioVendasBase` **deixa de excluir distrato** (remove o `return false` da L1063 de
  origin/main) → Relatórios passa a somar o pago real de distratada como as outras telas.
- b) `getVendasCount` passa a contar ativas (`contarVendas(vendas).ativas`); o donut e o ticker
  mostram "N vendas ativas" e, quando `distratos > 0`, o complemento "· M distratos".
- c) Card "TOTAL DE CLIENTES" ganha subtítulo/rótulo "clientes distintos".
- d) "TOTAL EM VENDAS" (valor R$): mantém TODAS as vendas? **Não** — mesma régua: soma
  `valor_venda` das ATIVAS (o VGV de contrato morto não é carteira), rotulado "vendas ativas".

### T4 — AdminDashboard `gerarRelatorioPDF`: header do card
- Header "Valor Comissão" decide pela MESMA condição das linhas (`relatorioFiltros.cargoId` +
  `mostrarTotal`), não por `percentualCorretorTotais` (que depende de `usuarios.percentual_corretor`
  estar preenchido — é NULL pro Carlos/Madona/Alecxander/Rodrigo e por isso o header caía no total).
- Rótulos: filtro de cargo → `Comissão (cargo X)`; total/todos → `Comissão total (todos os cargos)`.
- Lógica extraída pra helper puro testável (`comissaoHeaderVenda(pagamentos, filtros, calcPorCargo)`).

### T5 — Investigar resíduo ~R$ 83 (read-only)
Diferença entre fatia via `percentualCorretorDaVenda`+fator e `comissao_gerada×4/7` no universo do
Corazza. Documentar a causa; corrigir só se for bug (não é bloqueante do pacote).

## 5. Testes (TDD — escritos antes da implementação)

Em `src/utils/comissaoCalculator.test.js`:
- `contarVendas`: ativas/distratos/excluídas; lista vazia; venda sem status.
- `ehBaixaFalsaDeDistrato`: paga com venc>distrato em venda situacao=3 → true; venc≤distrato →
  false; venda ativa → false; sem `data_distrato` → false (S6 do reconciliador cobre); pendente →
  false.
- `comissaoHeaderVenda`: filtro cargo Corretor → soma da fatia; `__total__`/sem cargo → soma de
  `comissao_gerada`; parcela cancelada nunca entra; rótulo correto nos dois modos.
- Regressão da régua única: `somarComissao` NÃO exclui parcela paga de venda distratada (já é o
  comportamento — trava por teste).

## 6. Fora de escopo
- Reprocessar distratos antigos (já curados em 06/2026; frota validada).
- Filtro/segregação visual nova de distrato nas listas (já existe: badge vermelho + visão segregada).
- RLS, homologação.
