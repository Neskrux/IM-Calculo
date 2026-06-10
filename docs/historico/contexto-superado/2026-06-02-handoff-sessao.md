---
status: HANDOFF — estado ao fim da sessão 2026-06-02 (pra retomar após /compact ou /clear)
data: 2026-06-02
branch: sync/reconciliacao
---

# Handoff — sessão 2026-06-02

## ✅ Writes em PRODUÇÃO feitos hoje (autorizados, read após cada um)
1. **`comissao_integral` da venda 138 → cancelado.** Era fantasma do gerador antigo (entrada parcelada 58x, viola a regra "20% no ato"). A venda fica só com as 58 `parcela_entrada` corretas. Era o ÚNICO no banco.
2. **2 `bens` → pago + ancorado:** Gabriel (R$125k, bill 243/inst 1, pago 2025-05-28) e Luis A. Genro (R$9k, bill 406/inst 3, pago 2025-11-13). Sienge-confirmados.
3. **2 vendas manuais duplicadas eliminadas** (dedup, unidade sem bloco): "603" (CAYO, dup de c411/bill483) + "1603" (HELOIZA, dup de c422/bill496). Confirmado clientes reais (CPF) + pagamentos refletidos no oficial (603 sinal ancorado inst_id=1; 1603 3 mensais batem data/valor). Fluxo: Excluir Baixa 4 pagas → cancelar 123 parcelas (56+67) → `excluido=true` + `motivo_exclusao`. Comissão duplicada removida R$1.951,96. Oficiais c411/c422 intactos. Restam 2 sem-bill p/ controladoria (Gabriel Adriano 412 + Gustavo 606, cliente real sem contrato Sienge, 0 pagas).
4. **2 vendas excluídas com paga-fantasma limpas** (item B): "002" (teste "jonas cliente", R$112) + **c236 CLAUDIO** (reemitido→c390, 3 pagas R$3.491,91 / comissão **R$1.344,39** fantasma — caso que aguardava gestora, autorizado). Fluxo: Excluir Baixa 4 pagas → cancelar 116 parcelas (56+60). Ambas já eram `excluido=true`. Pós-fix: 0 vendas excluídas com paga, 0 parcelas sem data_prevista em venda ativa. (10 sem-data restantes = lixo cancelado de vendas mortas 002/401, inofensivo.)

## ✏️ Código aplicado no working tree (NÃO commitado — commit só com ok do usuário)
- `supabase/functions/sienge-sync/normalize/receivable-bills.ts`: `tipoInternoOf` + `if (term==="BN") return "bens"` (causa-raiz: bens não recebia baixa). Precisa **PR + deploy**.

## 🌳 Estado do git
- Branch `sync/reconciliacao` foi **`git reset --soft 9f2e069`** (= main do Bruno como base). **TODO nosso trabalho está STAGED, não-commitado:** gerador idempotente (Parte B), ponte distrato A.1, helper `isVendaAtiva` + A.3 Admin, deleção do sync legado (19 arq), docs de contexto, geradores b9/b10. **Nada pushado.**
- Bruno (merge 9f2e069) já trouxe: **Parte C (match ancorado em receivable-bills)** ✅, migrations 024/025 (não aplicadas), feature de foto de perfil, scripts de correção 25/05.

## 📊 Inadimplência — RECONCILIADA
- Por valor: 13,62% → **9,07%** após os fixes. Em-atraso **R$ 411k local ≈ R$ 402k Sienge** (matched). O resto (~R$9k) fecha sozinho via sync diário + Parte C.
- Os "9,07% vs 4,77% Sienge" é maçã-com-laranja (denominador local = pro-soluto; Sienge = bill inteiro). O que importa (valor em atraso) está reconciliado.

## ✅ Decisão de negócio confirmada
- **Compra corporativa PJ via PU/PA NÃO comissiona** (Goncalves de Mendonça 8 unid + Ferretti 3 unid; ~R$5,5M). `pro_soluto=0` correto. Registrado em memória `corporate-pu-pa-sem-comissao.md`. NÃO mapear PU/PA (≠ BN que comissiona).

## 🎯 O que falta pra "bancos iguais" (resíduo)
1. **pagas-órfãs (b9):** ~10 ambíguo + 59 sem-match = **R$ 21k comissão em dobro** (linhas PAGAS → "Excluir Baixa"; cross-check com limpeza do Bruno 25/05 antes).
2. **pro_soluto ≠ Sienge (b10):** 28 vendas — decisão de negócio (imutável c/ pago).
3. **distrato (A.2):** 25 — classificar (deploy A.1 + backfill).
4. **subir código:** PR/deploy do staged (gerador, distrato, bens fix) + aplicar migrations 024/025.
5. **melhoria:** reconciliador filtrar `pro_soluto=0`/PU-PA da revisão (os 11 corporate param de aparecer).

## 📚 Docs-chave pra retomar
`docs/contexto/`: documento-mestre · north-star · passo2-residuo · mapa-decisoes · distratos-mapa · plano-alinhamento. Princípio de trabalho: **mapear (problema · por que existe · o que fazer), executar prod só com ok.**
