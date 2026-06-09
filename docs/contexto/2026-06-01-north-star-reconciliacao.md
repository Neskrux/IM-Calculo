---
status: NORTE / síntese estratégica
data: 2026-06-01
branch: sync/reconciliacao (worktree IM-reconciliacao)
proposito: dar um objetivo único a todas as micro-camadas da reconciliação Sienge↔local
ancora_factual: fase0-universo-pagos.json (Sienge, snapshot 2026-04-23) + DB Supabase (live 2026-06-01) + artifact run 26736891891
---

# North Star da reconciliação Sienge ↔ banco local

## 🌟 O objetivo único (tudo serve a isto)

> **O corretor e o admin abrem o IM-Calculo e confiam 100% nos números de comissão —
> porque o banco local é um espelho fiel do Sienge, atualizado sozinho todo dia,
> sem ninguém precisar conferir nada na mão no Sienge.**

Por quê: o IM-Calculo é uma **calculadora de comissão**. Seu valor inteiro depende de o número
bater com o Sienge (a fonte que controladoria/financeiro validam no fechamento do repasse).
Se diverge, o corretor não confia, vai conferir no Sienge de qualquer jeito, e o sistema
vira enfeite. **Confiança no número = produto. Reconciliação = como se ganha essa confiança.**

## ✅ Definição de "pronto" (como sabemos que chegamos)

Métricas observáveis, não sensações:

1. **Inadimplência exibida = inadimplência real do Sienge** (~4,89% valor / ~10,26% parcela).
   Hoje o app mostra ~14% inflado por gêmeos falsos. Esse número é o **termômetro-mestre**.
2. **Distribuição de status ≈ Sienge:** ~95% pago / ~5% pendente (baseline ruim era 2,8% pago).
3. **Toda venda com bill 100% ancorada 1:1** — zero linha paga sem `(bill_id, installment_id)`.
4. **Zero par `(bill_id, installment_id)` duplicado** em linhas ativas.
5. **Distratos classificados** (não contam como venda ativa; comissão paga preservada).
6. **A Action se cura sozinha** — sem ponto cego silencioso; o que sobra pra humano é só
   decisão de **negócio real** (ex.: eliminar venda paga duplicada), não match mecânico.

Quando os 6 batem, o north star está atingido e a manutenção é só o cron diário.

---

## 🧭 O mapa: 3 baldes que dissolvem as micro-camadas

Toda micro-camada que discutimos cai em **um** destes três. É o modelo mental pra não se perder:

```
   [ SIENGE ]  ──①TRUTH IN──▶  [ BANCO LOCAL ]  ──③TRUTH OUT──▶  [ DASHBOARDS ]
                                      │
                                 ②MIRROR CLEAN
                              (local == Sienge?)
```

### ① TRUTH IN — trazer a verdade do Sienge de forma confiável
Garantir que temos o dado do Sienge, fresco e barato.

| Camada | O que é | Status hoje |
|---|---|---|
| bulk-data/income | 1 chamada traz universo inteiro (3719 pagas/294 bills), **fora da quota** | ✅ funciona; **pull fresco confirmado 2026-06-01** (17.567 linhas) |
| REST v1 (sales-contracts, receivable-bills) | 1 req por entidade, **quota 100/dia** — usar com parcimônia | ✅ usado só p/ vendas novas |
| Cron diário (`recurring-reconciliation.yml`) | baixa income (cache 1h) + reconcilia + sobe report como artifact | ✅ roda/passa todo dia |
| Cron **passo ① (`gerar-plano-correcao-data-prevista`)** | corrige drift de `data_prevista` | 🔴 **LEGADO: lê arquivo congelado `varredura-...-2026-05-13.json` (99 vendas).** Escopo preso ao passado; as outras ~200 são invisíveis. Fix: fundir no passo ② |
| `.sienge-cache/` | persiste income entre runs (stale-on-error) | ✅ resiliente |

**Gap de TRUTH IN:** o passo ① do cron está amarrado a um arquivo de 13/05 (99 vendas). O passo ②
(`reconciliar-todas-vendas`) já roda no universo completo e fresco — a correção de `data_prevista`
deve migrar pra lá, aposentando o arquivo congelado.

### ② MIRROR CLEAN — fazer o local ser fiel ao Sienge (o coração do trabalho)
Onde mora 90% do esforço e **todas** as dores que mapeamos.

| Camada / problema | O que é | Status | Plano |
|---|---|---|---|
| **Âncora** `(bill_id, installment_id)` | o link 1:1 local↔Sienge | 80% ancorado e **limpo** (0 dup); 20% não | Parte C (re-ancorar) |
| **52 `parcela_entrada` PAGAS órfãs = R$ 21.194,06 em dobro** | espúrio do gerador antigo (Sienge não tem) | 🔴 medido (Passo 2) | "Excluir Baixa" controlado |
| **5 PENDENTES órfãs** | falso pendente | 🔴 medido (Passo 2) | `cancelar` (livre) |
| **Gerador não-idempotente** (Parte B) | "Gerar pagamentos" insere cego, sem âncora → cria gêmeo | ✅ **FEITO** (skip-only + grava bill_id) | — |
| **Distratos** (Parte A) | 25 vendas `situacao=3` lidas como ativas | ✅ **código feito** (A.1 edge + A.3 Admin); falta deploy+backfill (A.2) | gated |
| **Sync legado duplicado** (`src/services/sienge/`) | implementação-fantasma do edge | ✅ **DELETADO** (19 arquivos, build verde) | — |
| **Duplicatas / ambíguos** (b9) | ~10 casos: par ativo mesmo (tipo,valor,data) | ⚠️ parqueado na Action | resolver via Sienge |
| **pro_soluto ≠ income** (b10) | 28 vendas: soma income diverge do pro_soluto local | ⚠️ parqueado | maioria escala negócio |
| **11 bills sem income relevante** | contrato sem parcela paga no income | ⚠️ parqueado | **provável distrato** (loop c/ Parte A) |
| **Triggers 017/018/020** | blindam pago (tipo/valor/comissao); liberam datas/snapshots | ✅ trilho de segurança | respeitar sempre |

**Gap de MIRROR CLEAN:** resíduo agora **medido com precisão** (ver [2026-06-01-passo2-residuo-medido.md](2026-06-01-passo2-residuo-medido.md)):
**52 pagas-órfãs (R$ 21.194,06) + 5 pendentes-órfãs + 49 parqueadas** (28 pro_soluto-negócio, 11 distrato-provável, ~10 ambíguo).
Quase tudo determinístico; humano genuíno ≈ 10 ambíguos + 28 de negócio.

### ③ TRUTH OUT — dashboards leem o espelho limpo corretamente
De nada adianta o banco limpo se a UI lê errado.

| Camada | O que é | Status |
|---|---|---|
| `comissaoCalculator.js` (somar de pagamentos) | regra: UI deriva de `pagamentos_prosoluto`, nunca de `vendas.*` stale | ✅ corrigido 04-27; +helper `isVendaAtiva` (2026-06-01) |
| Distrato na UI — **Admin** (Parte A.3) | auditoria de unidade ignora distrato + matchStatus mostra em vermelho | ✅ **feito** (2026-06-01) |
| Distrato na UI — **Corretor/Cliente** | comissão já correta (0 pendente); falta desacoplar lista p/ contagem + badge | ⏳ cosmético (entangled c/ soma — cirurgia segura pendente) |
| Cancelado na UI | parcela cancelada não infla total | ✅ corrigido 05-13 |

**Gap de TRUTH OUT:** Admin feito. Corretor/Cliente só cosmético (números já corretos porque distrato tem 0 pendente).

---

## 📍 Onde estamos vs o north star (gap honesto, 2026-06-01)

| Métrica de "pronto" | Hoje | Meta |
|---|---|---|
| Inadimplência **exibida pelo app** | ~14% (suspeita de erro de fórmula) | bater com o Sienge: **~4,86% valor / ~10,26% parcela** |
| Vendas-bill 100% ancoradas | não (~20% sem âncora) | sim |
| Pares duplicados ativos | 0 nos ancorados; resíduo nos 20% | 0 total |
| Distratos classificados | não (lidos como ativos) | sim |
| Cron sem ponto cego | não | sim |

> ⚠️ **Correção (2026-06-01, medido):** duas coisas que a versão anterior desta tabela dizia errado:
> 1. **"% pago → 95%" foi REMOVIDO** — era meta falsa. A maioria das parcelas é **futura** (contrato de 60 meses, poucos meses corridos), então ~23% pago é **normal**, não defeito. % pago de TODAS as parcelas nunca chega a 95%.
> 2. **A inadimplência real do Sienge é ~4,86% valor / ~10,26% parcela** (medido do bulk D, corte 29/05). O "14%" do app é inflação **local**.
>
> **De onde vem a inflação (decomposto contra o bulk):** das **328 pendentes-vencidas locais**, **0** são "Sienge já pagou" (não é pagamento-não-registrado), **85 (26%)** são sem-âncora (gêmeo/fantasma), **243 (74%)** são reais ou com `data_prevista` errada. Como só há 328 vencidas, a inadimplência local *bem calculada* daria ~7-8% — logo o **"14%" é provável erro de FÓRMULA do app (Truth Out)**, somado aos ~85 fantasmas. **Quem ataca isso é o Card 3 (curar Action + `data_prevista`) + revisar o cálculo no app + limpar os fantasmas — NÃO os pagos-órfãos da b9.**

Tradução: **TRUTH IN está quase pronto, TRUTH OUT falta só distrato, e MIRROR CLEAN é o
campo de batalha** — mas o inimigo é ~100 vendas, não um oceano.

---

## 🛤️ A sequência única (o through-line, não micro-decisões)

Em vez de decidir camada por camada, esta é a linha que leva direto ao north star:

1. ✅ **Estancar a sangria** (Parte A + B) — **FEITO (código)**: gerador idempotente (B) + ponte distrato no edge (A.1)
   + A.3-Admin + sync legado deletado. Build verde. Falta só deploy+backfill A.2 (gated) e o cosmético corretor/cliente.
2. ✅ **Medir o resíduo real** (dry-run) — **FEITO (2026-06-01)**: 52 pagas-órfãs (R$ 21.194,06) + 5 pendentes-órfãs
   + 49 parqueadas. Ver [2026-06-01-passo2-residuo-medido.md](2026-06-01-passo2-residuo-medido.md). *(read-only.)*
3. ⏭️ **Re-ancorar o determinístico** (Parte C) → fecha 80%→100% e mata o ponto cego da Action. *(PRÓXIMO — escreve em prod, gated.)*
4. ⏭️ **Curar a Action** → re-ancorar linha paga (sem ponto cego) + aplicar (a)+(b) sozinha + fundir passo ① no ②.
5. ⏭️ **Só o resíduo de negócio vai pra humano** → ~10 ambíguos + 28 pro_soluto. *(rodada b, minúscula.)*
6. ⏭️ **Verificar pelo termômetro** → inadimplência exibida → ~4,89%, % pago → ~95%. Quando bate, chegamos.

> **Estado 2026-06-01:** Passos 1 (código) e 2 prontos. Próximo = Passo 3 (limpeza em produção, gated por ok).

> O que muda de mentalidade: a "fila humana" (b9/b10) **não é o trabalho** — é o **resto**
> depois que o determinístico rodou. O trabalho é re-ancorar contra o Sienge e ensinar a
> Action a não ter ponto cego. Sienge decide; humano só no que é genuinamente negócio.
