# P3 — Vendas com Divergência Estrutural de Fator

Data: 2026-04-21
Banco: Calculo IM (`jdkkusrxullttyeakwib`)
Status: **AGUARDANDO DECISÃO DE NEGÓCIO** — nada foi alterado em `comissao_gerada`
Escopo: 6 vendas do empreendimento **FIGUEIRA GARCIA** com parcelas pagas geradas por fatores diferentes

---

## 1. Causa raiz confirmada

A divergência **não** é mudança de percentual nos cargos (`cargos_empreendimento_historico` está vazio para essas vendas). É **mudança de `tipo_corretor` na venda** seguida de regeneração da grade.

### Padrão comum (5 das 6 vendas)

Timeline reconstruída a partir de `pagamentos_prosoluto.created_at` e `vendas.updated_at`:

1. **Jan/2026** — venda importada do Sienge como `tipo_corretor = externo` (7% total). Parcelas geradas com fator ~0,35.
2. **Algumas parcelas foram pagas** com esse fator 0,35.
3. **Abr/2026** — usuário do admin alterou `tipo_corretor` para `interno` (6,5% total). O sistema regerou toda a grade com o novo fator (~0,325).
4. A regeneração **substituiu as parcelas ainda não pagas**. As pagas foram **trancadas pelo trigger 017** e permaneceram com o fator 0,35 antigo.

Resultado: mesma venda hoje tem parcelas pagas com fator "histórico externo" e parcelas novas com fator "interno atual". O fator da venda (`vendas.fator_comissao`) reflete o **estado atual (interno)**.

### Caso especial: 1005 A

Essa venda tem **três** estados em vez de dois — passou por duas regenerações entre janeiro e abril. O fator intermediário (~0,3035 ≈ 6,06%) provavelmente veio de um erro de cadastro transitório corrigido em seguida.

| Momento | Ratio gerado | Qtd parcelas | Situação |
|---|---|:---:|---|
| 2026-01-15 22:01 | 0,326872 | 3 | Criação inicial |
| 2026-04-10 19:18 | 0,303519 | 10 | **Regeração intermediária com fator errado** |
| 2026-04-13 14:23 | 0,325274 | 53 | Regeração final (fator correto) |

As 10 parcelas da regeração intermediária foram pagas entre 10 e 13 de abril e ficaram congeladas com fator errado. As 3 originais de janeiro também permanecem, mas com fator próximo do atual.

---

## 2. Evidência por venda (timestamps reais)

| Unidade | Venda criada em | Venda editada em | Fator antigo (pagos) | Fator novo (grade) | Gap de horas entre edição e regen |
|---|---|---|:---:|:---:|:---:|
| 404 A | 2026-01-15 14:55 | 2026-04-10 17:29 | 0,3505 | 0,3255 | Regen na mesma sessão (~45min) |
| 802 A | 2026-01-15 14:56 | 2026-04-10 18:10 | 0,3500 | 0,3250 | Regen na mesma sessão |
| 805 A | 2026-01-15 14:56 | 2026-04-10 19:45 | 0,3507 | 0,3256 | Regen na mesma sessão |
| 1005 B | 2026-01-15 14:58 | 2026-04-13 20:52 | 0,3502 | 0,3252 | Regen na mesma sessão |
| 1106 A | 2026-01-15 14:57 | 2026-04-13 20:34 | 0,1891 | 0,1756 | Regen na mesma sessão |
| 1005 A | 2026-01-15 14:56 | 2026-04-13 14:23 | 0,3269 + 0,3035 | 0,3253 | Dois ciclos (10-abr e 13-abr) |

---

## 3. Onde está o "bug" do fluxo

A causa raiz não é bug de cálculo, é **política de regeração**. Quando muda `tipo_corretor`:

- A grade é regerada com o fator novo.
- O sistema **não** recalcula parcelas pagas (porque o trigger 017 impede — corretamente).
- O sistema **não** sinaliza pro usuário que isso aconteceu.
- O resultado é esse estado misto silencioso.

### Possíveis melhorias no fluxo (prevenção, não correção)

Ao mudar `tipo_corretor` de uma venda que tem parcelas pagas com fator diferente do novo:

1. **Exibir warning antes de confirmar:** "Esta venda tem X parcelas pagas com fator Y. Mudar pra tipo_corretor Z deixaria Y ≠ fator da grade nova. Continuar?"
2. **Bloquear mudança automática** se houver pagos com fator divergente e exigir ato explícito da controladoria.
3. **Registrar o evento** numa tabela tipo `vendas_reclassificacoes` com antes/depois/usuário/motivo.

Nenhuma dessas ações vai ser tomada agora — é sugestão pro roadmap.

---

## 4. Delta financeiro por venda (estado atual)

| Unidade | Parcelas pagas divergentes | Delta R$ | Sinal | Interpretação |
|---|:---:|---:|:---:|---|
| 1005 A | 13 | **−476,20** | empresa deve | 10 parcelas foram pagas com fator ERRADO (0,3035 em vez de 0,3253) |
| 805 A | 3 | +115,06 | empresa recebe | parcelas pagas como externo antes da reclassificação |
| 802 A | 4 | +83,62 | empresa recebe | parcelas pagas como externo antes da reclassificação |
| 1005 B | 2 | +57,36 | empresa recebe | parcelas pagas como externo antes da reclassificação |
| 1106 A | 2 | +54,92 | empresa recebe | parcelas pagas como externo antes da reclassificação |
| 404 A | 1 | +25,04 | empresa recebe | sinal pago como externo antes da reclassificação |

**Saldo líquido:** se tudo fosse realinhado ao fator atual da venda, a empresa teria que pagar **R$ 140,20** (R$ 476,20 a pagar em 1005 A menos R$ 336,00 a receber das outras cinco).

---

## 5. Detalhamento das 25 parcelas divergentes

### 1005 A — 13 parcelas, delta −R$ 476,20

| Tipo | Parc | Valor | Comissão Atual | Ratio | Comissão se fator atual | Delta R$ | Data Pag |
|------|:---:|---:|---:|:---:|---:|---:|---|
| sinal | — | 17.500,00 | 5.311,69 | 0,3035 | 5.692,30 | −380,61 | 2025-04-22 |
| parc_entrada | 1 | 537,99 | 163,29 | 0,3035 | 174,99 | −11,70 | 2025-05-20 |
| parc_entrada | 2 | 537,99 | 163,29 | 0,3035 | 174,99 | −11,70 | 2025-06-20 |
| parc_entrada | 3 | 537,99 | 163,29 | 0,3035 | 174,99 | −11,70 | 2025-07-21 |
| parc_entrada | 4 | 537,99 | 163,29 | 0,3035 | 174,99 | −11,70 | 2025-08-20 |
| parc_entrada | 5 | 537,99 | 163,29 | 0,3035 | 174,99 | −11,70 | 2025-09-22 |
| parc_entrada | 6 | 537,99 | 163,29 | 0,3035 | 174,99 | −11,70 | 2025-10-20 |
| parc_entrada | 7 | 537,99 | 163,29 | 0,3035 | 174,99 | −11,70 | 2025-11-21 |
| parc_entrada | 8 | 537,99 | 175,85 | 0,3269 | 174,99 | +0,86 | 2025-12-22 |
| parc_entrada | 9 | 537,99 | 163,29 | 0,3035 | 174,99 | −11,70 | 2026-01-20 |
| parc_entrada | 10 | 537,99 | 175,85 | 0,3269 | 174,99 | +0,86 | 2026-02-20 |
| parc_entrada | 11 | 537,99 | 163,29 | 0,3035 | 174,99 | −11,70 | 2026-03-20 |
| balao | 1 | 5.000,00 | 1.634,36 | 0,3269 | 1.626,37 | +7,99 | 2025-12-10 |

### 805 A — 3 parcelas, delta +R$ 115,06

| Tipo | Parc | Valor | Comissão Atual | Comissão se fator atual | Delta R$ | Data Pag |
|------|:---:|---:|---:|---:|---:|---|
| parc_entrada | 8 | 296,67 | 104,03 | 96,60 | +7,43 | 2025-12-22 |
| parc_entrada | 10 | 296,67 | 104,03 | 96,60 | +7,43 | 2026-02-20 |
| balao | 1 | 4.000,00 | 1.402,67 | 1.302,47 | +100,20 | 2026-01-19 |

### 802 A — 4 parcelas, delta +R$ 83,62

| Tipo | Parc | Valor | Comissão Atual | Comissão se fator atual | Delta R$ | Data Pag |
|------|:---:|---:|---:|---:|---:|---|
| sinal | — | 1.000,00 | 350,02 | 325,02 | +25,00 | 2025-04-18 |
| parc_entrada | 8 | 781,48 | 273,53 | 253,99 | +19,54 | 2025-12-09 |
| parc_entrada | 9 | 781,48 | 273,53 | 253,99 | +19,54 | 2026-01-09 |
| parc_entrada | 10 | 781,48 | 273,53 | 253,99 | +19,54 | 2026-02-10 |

### 1005 B — 2 parcelas, delta +R$ 57,36

| Tipo | Parc | Valor | Comissão Atual | Comissão se fator atual | Delta R$ | Data Pag |
|------|:---:|---:|---:|---:|---:|---|
| parc_entrada | 8 | 1.146,67 | 401,55 | 372,87 | +28,68 | 2025-12-02 |
| parc_entrada | 10 | 1.146,67 | 401,55 | 372,87 | +28,68 | 2026-02-05 |

### 1106 A — 2 parcelas, delta +R$ 54,92

| Tipo | Parc | Valor | Comissão Atual | Comissão se fator atual | Delta R$ | Data Pag |
|------|:---:|---:|---:|---:|---:|---|
| parc_entrada | 1 | 2.033,33 | 384,56 | 357,10 | +27,46 | 2025-06-24 |
| parc_entrada | 7 | 2.033,33 | 384,56 | 357,10 | +27,46 | 2025-12-15 |

### 404 A — 1 parcela, delta +R$ 25,04

| Tipo | Parc | Valor | Comissão Atual | Comissão se fator atual | Delta R$ | Data Pag |
|------|:---:|---:|---:|---:|---:|---|
| sinal | — | 1.000,00 | 350,50 | 325,46 | +25,04 | 2025-04-20 |

---

## 6. Caminhos de decisão

| Caminho | Descrição | Risco | Dinheiro movimentado |
|---|---|:---:|---|
| **A. Manter como está** | Assumir que o fator vigente no momento do pagamento era correto | baixo | R$ 0 |
| **B. Compensar nas parcelas pendentes** | Ajustar fator das próximas parcelas pra compensar o acumulado | médio | nenhum realizado retroativo, ajuste prospectivo |
| **C. Realinhar pagas retroativamente** | UPDATE em `comissao_gerada` das 25 parcelas (requer desabilitar parte do trigger) | **alto** | R$ 140,20 líquido (empresa paga) |
| **D. Reverter fator da venda** | Trazer `vendas.fator_comissao` de volta ao que era no momento do pagamento (externo/7%) | médio | nenhum retroativo, muda parcelas pendentes |

---

## 7. Perguntas para a controladoria

1. A mudança de `tipo_corretor` de externo para interno foi **correção de erro de cadastro** ou **reclassificação efetiva**?
2. Se foi correção de erro: as comissões já pagas com fator externo precisam ser ajustadas? Pra quem a diferença é paga/recebida?
3. Especificamente na venda 1005 A: o fator 0,3035 (6,06%) era uma configuração intencional ou bug? As 10 parcelas pagas nesse fator estão **comprovadamente** com comissão a menor.
4. A regeração automática ao mudar `tipo_corretor` deveria ser bloqueada se houver parcelas pagas?

---

## 8. Queries úteis

### Detectar vendas com divergência estrutural

```sql
WITH ratios AS (
  SELECT venda_id,
         ROUND((comissao_gerada::numeric / NULLIF(valor::numeric, 0)), 6) AS ratio
  FROM public.pagamentos_prosoluto
  WHERE valor::numeric > 0 AND comissao_gerada::numeric > 0
)
SELECT v.unidade, v.fator_comissao::numeric,
       MIN(r.ratio), MAX(r.ratio),
       ROUND(MAX(r.ratio) - MIN(r.ratio), 6) AS spread
FROM ratios r
JOIN public.vendas v ON v.id = r.venda_id
GROUP BY v.unidade, v.fator_comissao
HAVING COUNT(DISTINCT r.ratio) > 1 AND (MAX(r.ratio) - MIN(r.ratio)) > 0.001
ORDER BY spread DESC;
```

### Ver timeline de criação das parcelas (causa raiz)

```sql
SELECT v.unidade, p.created_at::date AS criado_em,
       ROUND(p.comissao_gerada::numeric / NULLIF(p.valor::numeric, 0), 6) AS ratio,
       COUNT(*) AS qtd,
       COUNT(*) FILTER (WHERE p.status = 'pago') AS pagos
FROM public.pagamentos_prosoluto p
JOIN public.vendas v ON v.id = p.venda_id
WHERE v.unidade IN ('805 A','404 A','1005 A','1005 B','802 A','1106 A')
GROUP BY v.unidade, p.created_at::date, ratio
ORDER BY v.unidade, criado_em;
```
