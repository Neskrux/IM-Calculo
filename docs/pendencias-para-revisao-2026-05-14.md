# Pendências para revisão — 2026-05-14

Hoje rodamos uma auditoria geral nos pagamentos. **A grande maioria foi corrigida automaticamente** (ver no fim do documento). Sobrou **1 caso** que precisa da sua decisão e **2 casos** que são só pra você ter ciência.

---

## 🚨 PRECISA DE DECISÃO — CLAUDIO MARTIRE tem a venda duplicada no sistema

**Cliente:** CLAUDIO MARTIRE — CPF 953.363.629-72 — Tel (47) 99908-7492

O contrato dele foi **reemitido no Sienge** (o ID antigo `236` virou `390`). O nosso sistema tem **as duas versões cadastradas ao mesmo tempo**:

| | Venda ANTIGA (lixo) | Venda NOVA (correta) |
|---|---|---|
| ID Sienge | 236 (não existe mais) | 390 |
| Unidade | 1007 C (errada) | **1008 C** |
| Parcelas pagas | 3 (com datas trocadas) | **12 (todas certas)** |
| Comissão registrada | R$ 1.344,39 | R$ 5.377,56 |
| Situação | Obsoleta | Em dia, completa |

**A venda NOVA (390) está 100% correta** — 60 parcelas, 12 pagas batendo com o Sienge, unidade certa, corretor vinculado. O sync já fez o trabalho dela direitinho.

**O problema:** a venda ANTIGA (236) continua no banco com 3 parcelas marcadas como pagas. Isso faz o CLAUDIO **aparecer duas vezes** no dashboard e a comissão dele ser contada parcialmente em dobro.

### O que precisa ser feito

Eliminar a venda antiga (236). Mas como ela tem parcelas marcadas como "pagas", o sistema bloqueia a exclusão automática por segurança (a regra existe pra ninguém apagar venda com pagamento real por engano).

**A decisão é sua:** confirma que posso eliminar a venda antiga 236 do CLAUDIO? As 3 "pagas" dela são duplicatas — os pagamentos reais do CLAUDIO estão todos na venda nova (390), nada será perdido.

> Se você responder "pode eliminar a 236", eu faço a limpeza com segurança (as parcelas reais e a comissão verdadeira ficam intactas na venda 390).

---

## 🟢 Só ciência — 11 vendas com parcelas duplicadas no banco

11 vendas têm registros de parcela em duplicidade (uma cancelada + uma ativa). Veio de uma falha antiga do sistema que **já foi corrigida** — não acontece mais.

O Sienge está correto; a bagunça é só no nosso banco. Vou limpar automaticamente assim que a quota da API do Sienge voltar (ela zerou ontem à tarde, volta hoje/amanhã).

Vendas afetadas (todas FIGUEIRA GARCIA): SAMUEL MUELLER LEMOS (803 D)¹, ALISSON RODRIGUES DO CARMO (1305 A), ANDREY LUIZ MESSIAS SANTOS (1405 C), DIOGO DA LUZ DOS SANTOS (1603 A), LEANDRO DE OLIVEIRA VICENTIN (908 A), MARIA VITORIA DA SILVA FRANCISCO (1302 C), DIEGO RAMOS (609 D), GHIZIERI JENNINFER FREITAS COSTA BOSZCZOWSKI (1607 A), SARA JANE DE OLIVEIRA BARBOSA (1204 B), MICHEL CHRISTIAN BORBA (508 A), WANDERLEY ROSA GUIMARÃES JÚNIOR (1406 C).

¹ A unidade 803 D está em nome do próprio SAMUEL (corretor). Já confirmado: ele comprou pra ele mesmo, não é erro.

**Ação sua:** nenhuma. Resolvo automático.

---

## 🟢 Só ciência — MARIANE e ANDRESSA (renegociação)

| Cliente | Unidade |
|---|---|
| MARIANE GOES DA SILVA GOMES | 1606 A |
| ANDRESSA THAYS MELO | 404 A |

Você informou que essas duas tiveram **renegociação**. Confirmamos: os contratos continuam ativos no Sienge (não foram reemitidos), e **os valores das parcelas estão corretos** — batem certinho com o Sienge.

O que pode estar diferente são algumas **datas de vencimento futuras** (o cronograma antigo vs. o renegociado). Isso **não afeta comissão** — as parcelas já pagas estão certas. É um ajuste cosmético do cronograma futuro que dá pra fazer depois, sem pressa.

Aproveitei e corrigi um **erro de digitação** que achei na Mariane: uma parcela estava com data de pagamento no ano "2202" (digitação errada) — corrigi pra 2026.

**Ação sua:** nenhuma. Me avisa se quiser que eu acerte o cronograma futuro delas pra refletir a renegociação.

---

## ✅ O que já foi resolvido automaticamente

Pra você ter noção da escala da limpeza:

- **138 parcelas com data de vencimento corrigida** (17 vendas) — pequenas divergências de dias entre o nosso banco e o Sienge.
- **54 parcelas extras canceladas** (5 vendas) — o sistema antigo gerava mais parcelas do que o cronograma do Sienge:
  - FERNANDA DOS SANTOS (1004 D): 14 extras
  - CAROLINE SARAIVA (905 B): 5 extras
  - CARLOS CRISTIANO (1805 A): 3 extras
  - JOSAPHA AMORIM (704 C): 1 extra
  - Contrato 228 (903 C): 31 extras
- **Bug visual corrigido** — parcelas canceladas apareciam como "Pendente" no dashboard e inflavam o total de Comissão Pendente. Agora aparecem corretamente como **Cancelado**.
- **Bug do gerador de parcelas corrigido** — não vai mais criar duplicatas quando uma venda for editada.
- **Reconciliação automática diária** — todo dia às 8h da manhã o sistema confere o banco com o Sienge e corrige pequenas divergências sozinho. Já testado e funcionando.

---

## Resumo do que eu preciso de você

| Caso | O que preciso | Urgência |
|---|---|---|
| 🚨 CLAUDIO MARTIRE — venda duplicada | Confirmar: "pode eliminar a venda antiga 236" | Quando puder |
| 🟢 11 vendas com duplicatas | Nada — resolvo automático | — |
| 🟢 Mariane + Andressa | Nada (opcional: pedir ajuste do cronograma) | — |

Qualquer dúvida me chama.
