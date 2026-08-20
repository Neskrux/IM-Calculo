# Spec: Relatório das coordenadoras (papel + taxa snapshotada)

> Demanda do card "Relatório cordenadoras" (20/08/2026). Caroline e Jessica atuam nos
> DOIS papéis: corretoras (vendas próprias) e coordenadoras (vendas direcionadas a elas
> via `vendas.coordenadora_id` — Carol 172, Jessica 12). O relatório precisa direcionar
> qual papel está sendo reportado, e a taxa da coordenadora precisa respeitar a história.

## Comportamento (BDD)

**Cenário 1 — papel Corretora (default)**
- Dado que seleciono a Caroline no filtro de corretor
- Então o relatório traz as vendas que ELA vendeu, com a fatia do cargo Corretor
- (comportamento que já existia; zero regressão)

**Cenário 2 — papel Coordenadora**
- Dado que seleciono a Caroline e troco o Papel para "Coordenadora"
- Então o relatório traz as vendas DIRECIONADAS a ela (`coordenadora_id`),
  excluindo as vendas próprias (coordenadora não reporta venda que ela vendeu),
  com a fatia do cargo Coordenadora
- E o cargo do relatório muda sozinho para "Coordenadora"

**Cenário 3 — taxa histórica (cutover 15/07/2025)**
- Dado uma venda direcionada com contrato assinado antes de 15/07/2025
- Então a fatia da coordenadora usa 1,0% (snapshot `vendas.coordenadora_taxa`)
- E uma venda a partir de 15/07/2025 usa 0,5%
- E a taxa VIGENTE (`coordenadoras.percentual_padrao`) vale só como fallback
  quando o snapshot está NULL

## Peças

| peça | arquivo |
|---|---|
| Snapshot por venda | `migrations/040_vendas_coordenadora_taxa.sql` |
| Backfill (dry/apply, idempotente, métrica canônica) | `scripts/backfill-coordenadora-taxa.mjs` |
| Helpers testados | `src/utils/comissaoCalculator.js` (`taxaCoordenadoraDaVenda`, `taxaCoordenadoraPorCutover`) |
| Testes (TDD) | `src/utils/comissaoCalculator.test.js` |
| Toggle Papel + filtro + fatia | `src/pages/AdminDashboard.jsx` |

## Regras que este spec respeita

- Totais SEMPRE de `pagamentos_prosoluto` (visualizacao-totais.md) — a taxa só decide a
  PROPORÇÃO da fatia (`comissao_gerada × taxa/percentualTotal`), nunca recalcula comissão.
- Snapshot > vigente (mesma filosofia do `fator_comissao_aplicado` — regra de ouro do
  fator-comissao.md). Sem data_venda → não grava, vai pra revisão (rodadas-b.md).
- Fonte da regra do cutover: `scripts/repasse-mensal-coordenadora.mjs` (valor de NOTA
  já aprovado pela gestão).
