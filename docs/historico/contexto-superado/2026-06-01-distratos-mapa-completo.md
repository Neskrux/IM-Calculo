---
status: MAPA / entendimento (read-only) — base pra decisão
data: 2026-06-01
branch: sync/reconciliacao (worktree IM-reconciliacao)
fontes: vendas + pagamentos_prosoluto (Supabase, read-only) · código src/ + supabase/functions · docs/auditorias/cancelados (fase5, 2026-04-24)
---

# Distratos no IM-Calculo — mapa completo

> **Status de implementação (2026-06-01):** ponte #1→#2 **implementada no código** —
> `normalize/sales-contracts.ts:411` agora faz `situacao_contrato='3'` → `status='distrato'` + `data_distrato`
> (A.1, no edge — único sync vivo). UI Admin tratada (A.3): `isVendaAtiva` + auditoria de unidade + matchStatus vermelho.
> **Falta:** deploy do edge + backfill dos 25 (A.2, gated). Decisões da gestora travadas: comissão paga (R$684k) **mantida**,
> distrato **em vermelho** (não some), **todos** os dashboards. Conexão Passo 2: as **11 "bill sem income"** do dry-run são
> provavelmente distratos/sem-movimento — confirmar quando A.2 rodar.

## TL;DR

Existem **3 representações de "distrato" que NÃO conversam entre si**:

| # | Representação | Campos | Quantas vendas hoje | Quem escreve | Quem lê |
|---|---------------|--------|---------------------|--------------|---------|
| 1 | **Sienge/sync** (a real) | `situacao_contrato='3'` + `data_cancelamento` + `motivo_cancelamento` | **25** | sync (cliente + edge) | **ninguém** lê `situacao_contrato` |
| 2 | **Manual UI** (morta) | `status='distrato'` + `data_distrato` | **0** | botão "Distrato" no AdminDashboard | AdminDashboard (label vermelho + cálculo especial) |
| 3 | **Soft-delete** (à parte) | `excluido=true` | 30 (não-distrato) | UI "Excluir" | filtro de listagem |

**Consequência central:** os 25 distratos reais (Sienge) aparecem como **venda ativa pendente normal** em toda a UI, porque nenhum código lê `situacao_contrato`/`data_cancelamento`. A máquina bonita de distrato (label vermelho + `calcularComissaoVendaDistrato`) só roda pra `status='distrato'` — que tem **zero linhas**.

---

## 1. O estado real no banco (25 distratos)

- **25 vendas** `situacao_contrato='3'`, todas com `status='pendente'` (nível venda), `data_cancelamento` preenchida (2025-09-23 → 2026-04-09), `motivo_cancelamento` preenchido, `excluido=false`, `data_distrato=NULL`.
- **Parcelas:** 1.475 `pago` + 8 `cancelado` + **0 `pendente`** → **zero inadimplência** (futuro já foi cancelado/baixado).
- **Comissão paga (preservada):** **R$ 684.724,42** nessas 25 vendas. Dinheiro/comissão apurado **antes** do distrato — legítimo, protegido pela trigger 017.
- `nome_cliente` está **NULL** nas 25 (exibição apareceria em branco).
- **Outliers de pro_soluto** (cruzam com a rodada b10): c259/906A `175.999,86`/372k = 47%; c198/1008D `109.571,60`/349k = 31%; c186/901D pro_soluto `69.146,67` vs valor_venda `345.733,70` (= o caso "soma income 69147 != pro_soluto 345733" do b10).

### Unidade compartilhada (revenda)
- **12 dos 25** dividem a unidade com uma venda **ativa** (`situacao='2'`) → revenda legítima (unidade distratada e revendida). São esses que disparam o falso alerta de "unidade duplicada".
- **13 sem revenda ativa**, incluindo **unidade 1707 A com 3 distratos** (contratos 258, 215, 253) e **604 D com 2** (270, 176) — mesma unidade distratada várias vezes.

### Gap 31 → 25 (reemissões)
A auditoria fase5 (2026-04-24) registrou **31 cancelados** no Sienge. Hoje só 25 estão `situacao='3'`. Os **6 restantes** (contratos 103, 104, 154, 167, 174, 254) voltaram pra `situacao_contrato='2'` / `status='pago'` / sem data_cancelamento → **reemitidos/reativados** no Sienge depois de 2026-04-23 (mesmo padrão do c236→c390; cluster tratado na rodada b7 por causa de `numero_parcela` duplicado). Conclusão: distrato no Sienge **não é terminal** — pode ser revertido (o sync reflete isso corretamente).

---

## 2. Como o sync escreve (Sienge → banco)

Idêntico em três lugares — **nenhum** seta `status='distrato'` nem `data_distrato`:

- `src/services/sienge/syncUtils.js:357-400`
- `src/services/sienge/syncVendasV2.js:41-52, 365-366, 419-420`
- `supabase/functions/sienge-sync/normalize/sales-contracts.ts:411-430` (produção/edge)

```
situacaoMap: 0=Solicitado 1=Autorizado 2=Emitido 3=Cancelado
situacao_contrato = map[contract.situation]              // '3' p/ cancelado
status            = (situacao === '2') ? 'pago' : 'pendente'   // '3' → 'pendente'  ⚠️
data_cancelamento = contract.cancellationDate
motivo_cancelamento = contract.cancellationReason
```

⚠️ **`venda.status` é derivado cru** (só Emitido vira 'pago'; resto 'pendente'). Não é status de pagamento — a verdade de pagamento está em `pagamentos_prosoluto`. Por isso o plano não deve usar `venda.status` pra nada financeiro.

⚠️ **Sync sobrescreve `status`** a cada upsert (sales-contracts.ts:411). A linha 434 só preserva `corretor_id`/`cliente_id` (migration 021). Logo, um `status='distrato'` setado manualmente **seria clobberado** pelo próximo sync → a representação #2 é frágil por construção (provável causa das 0 linhas).

---

## 3. O fluxo manual (representação #2 — efetivamente morta)

Tudo em `src/pages/AdminDashboard.jsx`, e **só lá** (Corretor/Cliente/Home **não** tratam distrato):

- **`processarDistratoVenda` (2817-2837):** `UPDATE vendas SET status='distrato', data_distrato=… WHERE id`. Não toca `situacao_contrato`/`data_cancelamento`.
- **`calcularComissaoVendaDistrato` (2841-2860):** regra de negócio correta → comissão = parcelas `pago` **OU** vencidas até `data_distrato`. **É dead code hoje** (precisa de `status==='distrato' && data_distrato`, que não existe em nenhuma linha).
- **`matchStatus` (5261-5264):** distrato só aparece quando filtrado explicitamente (some da listagem default).
- **Exibição (6167-6217):** rótulo vermelho `"NOME - DISTRATO dd/mm/aaaa"` + ícone XCircle.
- **Modal (12164+):** passo 1 escolhe Excluir vs Distrato; passo 2 pede data → chama `processarDistratoVenda`.

---

## 4. Regra de negócio (auditoria fase5, `docs/auditorias/cancelados/cancelados-sienge-registry.md`)

> Parcelas `pendente` de venda cancelada → `cancelado`. Parcelas `pago` → **intocadas** (caixa que entrou antes do distrato; comissão já apurada/repassada; trigger 017 protege). `vendas.excluido` continua `false` (registro histórico). Dashboards podem esconder via `pagamentos_prosoluto.status`.

Resumo financeiro histórico (31 contratos): R$ 2.044.013,08 pagos preservados (1.518 parcelas) · R$ 507.796,34 pendentes cancelados (297 parcelas).

**Implicação:** a comissão de um distrato = só a parte paga (futuro zerado). Como os 25 já têm ~0 pendente, a comissão deles ≈ tudo-pago = R$ 684 mil. Tratá-los como "ativa pendente" ou como "distrato" dá **o mesmo total de comissão** — a diferença é **classificação/exibição**, não dinheiro.

---

## 5. Bugs / lacunas

1. **Distratos disfarçados de ativos:** os 25 contam como venda ativa (inflam contagem) e geram o falso alerta de "14 unidades duplicadas" (12 são revenda).
2. **Fluxo manual morto + frágil:** 0 linhas; sync clobbera `status='distrato'`; `calcularComissaoVendaDistrato` nunca roda.
3. **`nome_cliente` NULL** nos 25 → exibição em branco.
4. **Reemissão (Cancelado→Emitido)** acontece (6 casos) e o sync reflete — qualquer lógica de distrato precisa tolerar reversão (não tornar terminal).
5. **Sobreposição com b10:** alguns distratos têm `pro_soluto` divergente (c259, c198, c186).
6. **Cobertura parcial:** se decidir tratar distrato na UI, hoje só o AdminDashboard sabe — Corretor/Cliente/Home não.

---

## 6. Implicação direta pro plano (Parte A)

A Parte A do plano (`isVendaAtiva` excluindo `situacao='3'`) está **na direção certa, mas exige cuidado**:

- ✅ **Certo:** tirar os 25 da **contagem de carteira ativa** e da **auditoria de unidade duplicada**.
- ⚠️ **Risco:** se o mesmo filtro for aplicado às **somas de comissão**, derruba **R$ 684 mil de comissão paga legítima**. As parcelas `pago` dos distratos **devem continuar** somando em "comissão paga" histórica (regra fase5 + trigger 017). → Excluir só de *contagem/ocupação*, **nunca** das somas de pagamentos pagos.
- 💡 **Alternativa mais limpa — fazer a ponte #1→#2:** o sync, ao ver `situacao='3'`, setar também `status='distrato'` + `data_distrato = cancellationDate`. Aí a máquina **que já existe** no AdminDashboard (rótulo vermelho, `calcularComissaoVendaDistrato`, filtro "distrato só quando filtrado") passa a valer pros 25 **de graça**, com a semântica de comissão correta (paga preservada, futuro zerado). Precisa: (a) o sync gerar essa ponte de forma idempotente e tolerante a reemissão (Emitido volta a status normal), e (b) estender Corretor/Cliente/Home se quisermos esconder distrato lá também.

**A decisão "exclui de tudo" vs "faz a ponte pra status=distrato" é de negócio/produto — está em aberto pra você.**

---

## 7. Perguntas em aberto

1. Comissão paga de distrato (R$ 684k) **continua** nos totais? (regra fase5 diz que sim — confirmar com a gestora.)
2. Os 25 devem **sumir** da listagem default (como o `status='distrato'` faz) ou aparecer marcados em vermelho?
3. Esconder distrato também em Corretor/Cliente/Home, ou só no Admin?
4. Unidade 1707 A (3 distratos) / 604 D (2) sem revenda — quer tratamento especial ou é só histórico?
5. Reemissão: quando Sienge reativa (Cancelado→Emitido), o sync deve **limpar** `data_distrato`/voltar `status`? (a ponte precisa lidar com isso.)
