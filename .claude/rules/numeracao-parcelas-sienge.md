# Regra: as 3 numerações de parcela (e por que casar pela errada corrompe o cronograma)

> **Origem:** regressão de 2026-07-11 detectada em 2026-07-31 na unidade **1406 C**. Um passo legado do
> cron reescreveu `data_prevista` de **305 parcelas em 9 vendas** casando pela numeração errada.
> Esta regra existe pra que isso não se repita — e pra que ninguém "conserte" pelo mesmo caminho.

---

## 1. Existem TRÊS numerações diferentes. Elas não são intercambiáveis.

| # | Onde mora | O que é | Exemplo (bill 226 / 1406 C) |
|---|---|---|---|
| **A** | `pagamentos_prosoluto.numero_parcela` | Sequência **global** da venda no NOSSO banco (entrada + PM + balões numerados juntos, 1..59) | `6` = a 1ª parcela de R$ 875,97 |
| **B** | Sienge `installmentNumber` | String `"n/total"`, **por SÉRIE** — a entrada tem a sua, o PM a sua, o balão a sua | `"1/50"` = a 1ª de 50 do PM |
| **C** | Sienge `installmentId` | **ID único da parcela dentro do bill** — a única chave estável 1:1 | `6` |

**A colisão que morde:** A e C são inteiros e frequentemente coincidem no começo do contrato — até a
primeira série terminar. Depois disso divergem por exatamente o tamanho das séries anteriores.

Caso 1406 C (entrada = 5 parcelas de R$ 500):

```
banco numero_parcela = 6
  → casado por installmentNumber "6/50"  → installmentId 11 → dueDate 2026-08-20   ❌ ERRADO
  → casado por installmentId      6      → "1/50"           → dueDate 2026-03-20   ✅ CERTO
                                                              (= o contrato assinado)
```

Off-by-**5** = o número de parcelas de entrada. **Toda venda com entrada parcelada tem esse off-by-N.**
Vendas sem entrada parcelada passam ilesas — por isso o bug é silencioso e parcial.

---

## 2. A regra

> **Casar parcela banco↔Sienge SEMPRE por `sienge_installment_id` (+ `sienge_bill_id`). NUNCA por
> `numero_parcela`, NUNCA por `installmentNumber`.**

`numero_parcela` é rótulo de exibição nosso. `installmentNumber` é rótulo de exibição do Sienge.
Só `installmentId` é identidade.

Corolário já registrado no F4 (aditivos): *"numero_parcela NÃO serve — Sienge numera PM+balões juntos,
banco separa"*. Esta regra generaliza o mesmo aviso para o cronograma inteiro, não só aditivo.

**Fallback aceitável** quando ainda não há âncora: `(tipo, valor, data_prevista)` **exatos** — é o que o
[reconciliar-todas-vendas.mjs](../../scripts/reconciliar-todas-vendas.mjs) faz. Nunca por posição/ordem.

---

## 3. O cron roda da `main`. Branch não-mergeada = fix que não existe em produção.

O workflow `Reconciliacao Pagamentos` é `schedule:` — **o GitHub só dispara schedule do branch default**.
Consequência: o código que roda contra o banco de produção todo dia é o da **`main`**, não o do worktree.

Isso já queimou duas vezes:

| Quando | O quê |
|---|---|
| 2026-06-06→09 | Cron pré-merge re-pagou as 158 parcelas do curativo de maio (endurecimento estava na branch) |
| 2026-07-11 | Cron da `main` ainda tinha o passo legado `gerar-plano/aplicar-correcao-data-prevista` — desfez a b12 e as 254 AUTO |

**Checklist obrigatório ao mexer em qualquer script que o cron chama:**

1. `git show origin/main:.github/workflows/recurring-reconciliation.yml` — confira **quais passos a main
   realmente roda**, não os do seu branch.
2. Remover um passo do yml **no branch** não desarma nada. Só o merge desarma.
3. Depois de aplicar correção em produção, **confira o artifact do cron seguinte**
   (`gh run download <id> -n reconciliation-report-<id>`) e prove que ele não reverteu.

---

## 4. Guard S4 vira armadilha: bagunça de data trava o conserto

O reconciliador parqueia a venda inteira quando acha `parcelas ATIVAS com mesmo (tipo,valor,data)` (S4).
Deslocar `data_prevista` em bloco **cria** essas colisões (a cauda passa a repetir datas do miolo).
Resultado: um laço fechado —

```
passo legado desloca datas → cria data duplicada → S4 parqueia a venda
  → reconciliador ancorado nunca corrige o drift E nunca marca baixa nova
  → o passo legado converge no próprio erro (idempotente sobre o valor errado) → silêncio
```

**Sintoma de leitura:** venda em `revisao_humana` com motivo S4 **não aparece** em `revisao_data` nem em
`drift[]`. Métrica de espelho alta com venda parqueada ≠ venda correta. **Sempre cruzar o total de
`revisao_humana` antes de citar um % de espelho.**

---

## 5. Como medir de verdade (read-only)

Comparar `data_prevista` vs `dueDate` **pela âncora** `(sienge_bill_id, sienge_installment_id)` contra o
cache do income, cobrindo **todas** as parcelas ancoradas — sem escopo congelado em arquivo.

Medição de 2026-07-31: **13.955/14.260 exatas (97,86%)**; **305 em drift (2,14%) concentradas em 9 vendas**
(1204 B, 1607 A, 508 A, 908 A, 1406 C, 506 A, 803 D, 903 C, 1603 A) — todas as 9 parqueadas por S4.

> ⚠️ **Nunca derivar escopo de arquivo congelado.** O passo legado lia
> `varredura-pagamentos-bagunca-2026-05-13.json` (99 vendas) — as outras ~200 eram invisíveis. Escopo é
> sempre derivado do estado atual. (Mesma lição da rodada b11 supersedida.)
