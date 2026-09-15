# Contexto: balões com periodicidade errada e três meses de correção manual

> **Gatilho:** 06/08/2026 — a unidade **1603 C** (Heloiza Marchini Sanches, corretora Carolina Rita)
> apareceu na tela com balões **semestrais a partir de ago/2026**, quando o contrato da cliente tem
> balões **anuais em dezembro**. Ao investigar, o caso isolado virou achado sistêmico.

---

## 1. O que está errado

O gerador de pagamentos cria balões usando `vendas.periodicidade_balao`, cuja **default no schema é 6**
(semestral). O contrato real, na esmagadora maioria dos casos, tem balão **anual**.

Medição de 06/08/2026 (universo: vendas ativas Figueira, exclui seed `99%`):

| medida | valor |
|---|---|
| vendas com balão | 51 |
| balões ativos | 239 |
| **vendas com `periodicidade_balao = 6` e intervalo real ≈ anual** | **49** |
| balões nesse grupo | 183 |
| **intervalo real médio entre balões** | **329 dias** (≈ anual) |
| balões editados depois de criados | 221 de 239 |
| balões sem âncora (`sienge_installment_id` nulo) | 58 |
| janela das edições manuais | 24/04/2026 → 06/08/2026 |

Leitura: **o dado exibido hoje está majoritariamente certo**, porque o time vem corrigindo balão a balão
há três meses e meio. O que nunca foi corrigido é o **campo que gera** — `periodicidade_balao` segue 6.

---

## 2. Por que isso é uma bomba armada, não um erro cosmético

As parcelas foram acertadas na mão; o cadastro da venda **não**. Qualquer caminho que **regenere a grade**
recria os balões semestrais por cima da correção:

- editar/salvar a venda no `AdminDashboard`
- "Gerar pagamentos" numa venda existente
- qualquer rotina futura que leia `periodicidade_balao` como verdade

O gerador é **skip-only** desde 01/06 (só insere chave `(tipo, numero_parcela)` inexistente, nunca
deleta), o que reduz o estrago — mas **balão novo com data semestral entra**, convivendo com os anuais
corretos. Resultado esperado: cronograma com balões duplicados em datas erradas, e potencialmente o
guard S4 (`parcelas ATIVAS com mesmo tipo/valor/data`) parqueando a venda inteira.

---

## 3. O caso 1603 C, ponta a ponta

| fonte | o que diz |
|---|---|
| **Sienge** (`/sales-contracts/422`, consultado 06/08) | `BA: 4x de 3.000, 1º venc 2026-12-15` · `PM: 53x de 1.535,91, 1º venc 2026-03-10` · `FI: 373.613,17` |
| **banco, balões** | 4x R$ 3.000 em 15/12/2026, 2027, 2028, 2029 — **corretos**, editados 06/08 17:21 |
| **banco, cadastro da venda** | `periodicidade_balao = 6` — **errado**, nunca tocado |
| **pro-soluto** | R$ 93.403,23 = PM 81.403,23 + BA 12.000 — **bate exatamente com o Sienge** |

### O caso da b10 estava resolvido e ninguém sabia

A 1603 C está em [docs/rodadas/b10/b10-prosoluto-divergente.json](../rodadas/b10/b10-prosoluto-divergente.json)
desde **01/06/2026**, marcada como "pro-soluto divergente, −R$ 6.000, bloqueado: 3 parcelas pagas →
`pro_soluto` imutável, decisão de negócio".

A diferença de R$ 6.000 **não era divergência de pro-soluto**: o `income` do Sienge só materializa os
balões já emitidos como título — 2 dos 4. O contrato tem os 4, o banco tem os 4, e a soma bate.

**Lição:** comparar `valor_pro_soluto` com `soma(income)` produz falso positivo em toda venda com balão
futuro não emitido. A régua certa é contra os `paymentConditions` do contrato (REST), não contra o income.
Vale revisar os outros 27 casos da b10 com essa régua antes de tratá-los como divergência real.

---

## 4. O que consertar (e o que NÃO consertar)

**Consertar — a causa:**
1. `periodicidade_balao` das 49 vendas → 12, derivando do intervalo real das parcelas existentes (não do
   default). É metadado de venda, não toca dinheiro.
2. Rever a default do schema: `6` não representa a realidade da Figueira.
3. O gerador deveria derivar a periodicidade do **contrato Sienge** (`paymentConditions` BA), não de um
   campo cadastrado à mão.

**NÃO consertar — as parcelas:** já estão certas. Regenerar grade "pra padronizar" desfaz três meses de
trabalho manual do time e cria duplicata.

**Ancorar os 58 balões sem `sienge_installment_id`:** enquanto não ancorarem, ficam invisíveis pro
reconciliador e pro detector de drift — nenhuma das nossas redes de segurança os alcança.

---

## 5. Rastro que não existe (e por isso este documento existe)

Os 221 balões editados **não têm registro de quem, quando e por quê**. A informação de que "o time
corrigiu isso na mão" só sobrevive na memória de quem fez — e foi por isso que o mesmo problema voltou
à tona hoje como se fosse novo.

É o mesmo padrão que o levantamento histórico de 03/08 já tinha catalogado: *"escrita em produção sem
artefato versionado — o banco muda e o git não sabe"*.

Ver também: [.claude/rules/sincronizacao-sienge.md](../../.claude/rules/sincronizacao-sienge.md) ·
[docs/contexto/2026-07-03-BDD-geracao-relatorios.md](2026-07-03-BDD-geracao-relatorios.md)
