# Spec: conferência diária parcela a parcela (IM × Sienge)

**Data:** 2026-11-16 · **Toca:** cron `recurring-reconciliation.yml` (passo novo, **só leitura**) · **Regras:** `.claude/rules/sincronizacao-sienge.md`, `.claude/rules/numeracao-parcelas-sienge.md`

## Por quê
Em uma semana, o operador novo achou erros que as nossas conferências não viam (803 D com valor de outra série desde 05/08, pagas sem dinheiro no Sienge). As conferências mediam somas e datas; nenhuma comparava **cada parcela** com o Sienge. Este passo compara e avisa **antes** do operador.

## O que faz
Todo dia, depois do reconciliador e do sync, para toda parcela **não cancelada** com âncora `(sienge_bill_id, sienge_installment_id)` (casar só pela âncora, nunca por número):

| Divergência | Regra |
|---|---|
| `valor` | `valor` ≠ `originalAmount` (tolerância R$ 0,01) |
| `status_pago_sem_dinheiro` | IM `pago`, Sienge sem baixa em dinheiro (`classificarBaixa`) |
| `status_dinheiro_sem_pago` | IM `pendente`, Sienge com baixa em dinheiro |
| `data_prevista` | `data_prevista` ≠ `dueDate` |
| `data_pagamento` | IM `pago` e Sienge pago, com data ≠ 1º recibo em dinheiro |
| `ancora_sem_sienge` | âncora que não existe no income |

- Cada divergência sai com unidade, título/parcela, o que o IM diz, o que o Sienge diz e a comissão da parcela.
- Divergência já decidida (cessão, fronteira combinada com a Controladoria) fica em `scripts/conferencia-parcelas-conhecidas.json` com motivo: aparece como **conhecida**, não como alarme ("confirmar no máximo uma vez", `edge-cases-externos.md`).

## O que NÃO faz
- Não escreve no banco. Não derruba o job (`continue-on-error`).
- Não gasta cota: usa o income que o reconciliador já baixou (cache de 1h).

## Saída
- `docs/auditorias/conferencia-parcelas-AAAA-MM-DD.json` (schema canônico de métrica), no artifact do cron.
- Resumo no painel do run (`GITHUB_STEP_SUMMARY`): contagem por tipo e as divergências **novas**.

## Verificação
- `tests/conferencia-parcelas.test.js`: um caso por tipo de divergência + parcela que bate + cancelada ignorada + conhecida marcada.
- Rodar local com o cache do cron de hoje: tem que reproduzir os casos já medidos (803 D, as 22 pagas sem dinheiro).
