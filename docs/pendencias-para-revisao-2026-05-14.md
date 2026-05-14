# Pendências para revisão — 2026-05-14

## 🚨 CLAUDIO MARTIRE — venda duplicada no sistema

**Cliente:** CLAUDIO MARTIRE — CPF 953.363.629-72 — Tel (47) 99908-7492

### O que aconteceu

O contrato do CLAUDIO foi **reemitido no Sienge**. Quando um contrato é reemitido, o Sienge cria um **Cód.Contrato novo** (aquela coluna "Cód.Co..." da tela de contratos). No caso dele:

- **Cód.Contrato antigo: 236** → não existe mais no Sienge
- **Cód.Contrato novo: 390** → é o contrato vivo (nº 273, unidade 1008 C)

> O "390" é o **Cód.Contrato** (o código interno que o Sienge usa). O número do contrato que aparece pra gente é o **273**. São a mesma venda — só nomes diferentes pro mesmo contrato.

### O problema no nosso sistema

O nosso sistema sincronizou **as duas versões** e ficou com elas cadastradas ao mesmo tempo:

| | Venda ANTIGA | Venda NOVA |
|---|---|---|
| Cód.Contrato Sienge | 236 (morto) | **390** |
| Unidade | 1007 C (errada) | **1008 C** |
| Parcelas pagas | 3 (duplicatas) | **12 (todas corretas)** |
| Situação | Obsoleta — deve sair | Em dia, completa |

A **venda nova (390) está 100% correta**. A **venda antiga (236)** é lixo que ficou pra trás — e como ela tem 3 parcelas marcadas como "pagas", o CLAUDIO aparece **duas vezes** no sistema e a comissão dele conta parcialmente em dobro.

### O que eu preciso de você

**Confirmar que posso eliminar a venda antiga (Cód.Contrato 236).**

Os pagamentos reais do CLAUDIO estão todos na venda nova (390) — **nada será perdido**. O sistema bloqueia a exclusão automática por segurança (porque ela tem parcelas marcadas como pagas), por isso preciso do seu "ok".

> Responda *"pode eliminar a venda 236 do CLAUDIO"* e eu faço a limpeza com segurança.

---

*Nada mais pendente da sua parte. As 11 vendas com parcelas duplicadas e os ajustes de cronograma da Mariane/Andressa estão sendo resolvidos automaticamente — não precisam de você.*
