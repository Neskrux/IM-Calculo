---
status: PLANO (read-only feito; execução gated) — auditoria geral do fator de comissão
data: 2026-06-03
branch: sync/reconciliacao
fontes: vendas + pagamentos_prosoluto (Supabase, read-only) · docs/controladoria/porcentagem corretores(THAI).csv
---

# Plano — Reconciliação do Fator de Comissão (auditoria GERAL, não só a amostra THAI)

## TL;DR

O **mecanismo do fator está são** e a correção principal **já foi aplicada** no banco. Auditoria
independente (banco, não a THAI) sobre **275 vendas ativas** (219 externo + 56 interno):

- **`fator_comissao` da venda: 100% correto** — externo 7,00%, interno 6,50%, zero fora.
- **Externos: 100% íntegros** — identidade `comissão = valor × fator` perfeita em ~12.000 parcelas.
- **Internos pendentes: 100% íntegros.**
- **Resíduo único = 108 parcelas internas PAGAS** (11 vendas) com `comissao_gerada` **congelado no valor
  antigo** = **R$ 3.054,95 de overpay**. É a ponta que a imutabilidade (migration 017) impediu de reescrever
  quando o fator foi corrigido.
- **Bônus:** 3 vendas internas (1206 A, 1408 A, 509 A) com decomposição de cargo zerada na venda.

**Não é "refazer todos os fatores" (já foi feito). É reescrever 108 `comissao_gerada` pra restaurar a
identidade `= valor × fator` (que já está correto), + 2 limpezas menores + atualizar a spec.**

## Como a auditoria foi feita (independente da THAI)

1. `fator_comissao` da venda vs `(valor_venda × %)/pro_soluto`, %=7 externo / 6,5 interno → 0 fora (264 vendas c/ dados).
2. Identidade `comissao_gerada == valor × fator_comissao_aplicado` por parcela → quebrada só em 108 internas pagas.
3. Medição do overpay: gravado R$ 42.780,81 vs canônico R$ 39.725,86 = **R$ 3.054,95**.

## Reconciliação com a planilha THAI (cross-check, não fonte)

- A planilha mede o **fator do CORRETOR** (a fatia dele, ~12,5%); a auditoria mede integridade do **total**.
- **NOHROS = 100% corretores internos** (48/48); **CORRETA = 100% externos** (31/31). "NOHROS" era só a marca
  da THAI pros internos.
- Spot-check: **1005 A** banco `comissao_corretor/pro_soluto` = **11,67%** = THAI "CORRETA 11,67%". A coluna
  "ATUAL 27,04%" da THAI é **pré-correção**. → A THAI **confirma** que o banco já está certo; ela é validação,
  não lista de tarefas. **Não confiar na coluna DEVIDA** (THAI errou em 48/81).

## Decisão de negócio (do Jonas, 2026-06-03)

- **Correção retroativa, inclusive em parcelas pagas: SIM.** Justificativa: **nenhum relatório foi enviado aos
  corretores pelo sistema até hoje** → nada foi repassado → o snapshot `comissao_gerada` não tem valor histórico
  a preservar; se está errado, corrige. (Envio de relatórios = próxima fase.)
- **Fonte da verdade do fator:** `fator_comissao` da venda = `valor_venda × %(7 externo / 6,5 interno) / pro_soluto`.
- **Visão interno + externo** deve virar parte explícita da spec.

## Ações

### A. Reescrever `comissao_gerada` das 108 parcelas internas pagas  [GATED — toca pago]
- Setar `comissao_gerada = ROUND(valor × fator_comissao_aplicado, 2)` (o fator já está correto).
- Remove os R$ 3.054,95 de overpay; restaura a identidade.
- **Bloqueio:** migration 017 torna `comissao_gerada` imutável em pago. Precisa de **migration nova** que libere
  o UPDATE **somente quando restaura a identidade** (`novo = valor × fator_comissao_aplicado`) — não um afrouxamento
  geral. (É a única peça de "código" — alinhada com a decisão de negócio acima.)

### B. Investigar 3 vendas com decomposição de cargo zerada  [READ-ONLY → gated]
- 1206 A (c147), 1408 A (c156), 509 A (c12): `comissao_corretor`/nohros/wsc = 0 na venda, mas parcelas têm
  `comissao_gerada`. Decidir se repopula a decomposição (metadado) — não afeta o total pago.

### C. Atualizar a spec (regras)  [DOCS — branch]
- `.claude/rules/fator-comissao.md`: adicionar visão **interno (6,5%) + externo (7,0%)** lado a lado (hoje só tem
  exemplo externo 7%).
- `.claude/rules/comissao-corretor.md`: idem + nota de que o fator total difere por `tipo_corretor`.
- `CLAUDE.md`: registrar a **exceção de reconciliação auditada** — correção de `comissao_gerada` em pago é
  permitida UMA vez, pra restaurar identidade `= valor × fator`, enquanto nenhum relatório foi repassado.

### D. Validar  [READ-ONLY]
- Pós-fix: identidade 100% (0 quebradas), `fator_comissao` 7/6,5 mantido, e cruzar com a THAI col CORRETA (corretor).

## Conexão com os outros buckets

Várias das 11 vendas internas cruzam com b9/b10 (ex.: 509 A = b10 c12; 1108 A, 1206 A aparecem em b9). Ao
processar b9/b10 com a controladoria, alinhar a correção do fator junto pra não tocar a mesma venda 2×.

## Escopo do "conferir tudo"

Auditoria cobriu **todas as 275 vendas ativas** (externo + interno), não só as 81 da THAI nem só os internos.
Resultado: externos limpos, internos com o resíduo de R$ 3k acima. Pendentes futuras já corretas.
