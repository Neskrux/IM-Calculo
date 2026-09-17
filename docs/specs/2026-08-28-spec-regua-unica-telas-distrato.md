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
| D1 | ~~Pago real de distratada aparece em TODA soma de comissão.~~ **REVISTA no mesmo dia — ver §2.1.** |
| D1' | **Venda distratada fica FORA de todas as telas do corretor** (comissão, VGV e contagem). Ratifica o PR #54 (2026-07-03, "relatório do corretor exclui distratos"). O histórico segue íntegro no banco e no relatório do ADMIN. |
| D2 | **Contagem de "vendas" = ATIVAS em toda tela** (`isVendaAtiva`), com distratos visíveis rotulados do lado ("N ativas · M distratos"). "Clientes" ganha rótulo "clientes distintos". |
| D3 | Cura da 1002 D direto em produção (caso único; sem fluxo de homolog). |
| D4 | **Cura de distrato vira passo do cron** (auto, sem gate humano) — régua física mecânica e já provada 2×. Via PR na `main` (cron roda da main). |
| D5 | **UI não filtra baixa falsa** — uma verdade só: o dado curado. |
| D6 | Fix do header do PDF do Admin (7% × 4%) no mesmo pacote. |
| D7 | Controladoria já comunicada. |

## 2.1 Por que D1 foi revista horas depois (registro honesto)

Ao decidir D1 eu apresentei só a decisão de **2026-06-01** ("comissão paga de distratada
permanece nos totais") e classifiquei a aba Relatórios como violação. **Não pesquisei o
histórico daquele filtro antes de recomendar removê-lo.** Ele vinha do PR
[#54](https://github.com/Neskrux/IM-Calculo/pull/54) de **2026-07-03**, decisão deliberada e
aplicada de forma consistente nos DOIS geradores (tela + PDF do corretor). Ou seja: a tela
não estava desalinhada — estava seguindo a decisão mais recente e mais específica.

Pior: ao aplicar D1 só na tela (PR #90), **criei uma divergência tela × PDF que foi a
produção** e durou algumas horas. Foi exatamente o tipo de inconsistência que o financeiro
estava caçando.

**O argumento que fechou a revisão (do operador):** mostrar a comissão da distratada sem
mostrar o VGV dela quebra a conferência de quem confere. Números reais do Corazza:

| | |
|---|---:|
| VGV exibido COM distratos | R$ 12.194.701,91 |
| 4% disso | R$ 487.788,08 |
| Comissão exibida | R$ 390.240,58 |
| 4% do VGV só das ATIVAS (R$ 9.756.014,26) | R$ 390.240,57 ✓ |

A comissão já era só das ativas; o VGV é que carregava R$ 2.438.687,65 de contrato morto.
Manter os dois recortes iguais é o que torna o relatório conferível — e o único recorte que
fecha é **excluir a distratada dos dois**. Os R$ 6.687,27 de comissão paga de distratada do
Corazza (25 parcelas, todas `status='pago'`, verificado) saem da visão do corretor mas
continuam no banco e no relatório do admin.

⚠️ **Pendente de ratificação da gestora**: a decisão de 2026-06-01 era dela. Esta revisão é
específica das telas do CORRETOR e não altera admin/controladoria, mas vale confirmar.

## 3. A régua única (normativa)

Para QUALQUER tela/relatório do corretor:

**Um recorte só, aplicado a tudo que o CORRETOR vê: `isVendaAtiva`.**

1. **Soma de comissão** (total/paga/pendente): das linhas de `pagamentos_prosoluto` com
   `status !== 'cancelado'`, **das vendas ativas**. Filtrado na ORIGEM (`somarMinhaComissao`
   descarta pagamento de venda não-ativa), pra nenhum card precisar repetir a regra.
2. **VGV / Volume de Vendas**: soma `valor_venda` das **ativas**. Mesmo recorte da comissão —
   é isso que faz o teste dos 4% fechar.
3. **Contagem de vendas**: `isVendaAtiva`.
4. **Clientes**: clientes distintos **de vendas ativas**, rotulado "distintos".
5. **Admin/controladoria NÃO muda**: lá o distrato continua visível (badge vermelho, visão
   segregada) — é quem precisa auditar o histórico.

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
