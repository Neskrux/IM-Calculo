-- Migration 023 — pagamentos_prosoluto.sienge_installment_id + sienge_bill_id
--
-- Contexto: ver .claude/rules/sincronizacao-sienge.md
--
-- Motivacao: a varredura de 2026-05-13 (docs/varredura-pagamentos-bagunca-2026-05-13.json)
-- encontrou 98 vendas com drift > 30d entre data_prevista local e data_pagamento, e 11
-- vendas com `numero_parcela` duplicado (par cancelado+ativo) — sintomas do backfill
-- antigo (scripts/dry-run-backfill-income.mjs) que faz match heuristico apenas por
-- (venda_id, numero_parcela) e nao corrige data_prevista. Sem ancoragem 1:1 com o
-- installment do Sienge, o sync nunca consegue resolver drift de forma deterministica.
--
-- Esta migration:
--   1. Adiciona `sienge_bill_id` (bigint, nullable) — pareia com /bulk-data/v1/income.billId
--      (= vendas.sienge_receivable_bill_id, materializado tambem em pagamentos pra evitar
--      JOIN em hot-path).
--   2. Adiciona `sienge_installment_id` (text, nullable) — id unico da parcela dentro do
--      bill no Sienge. Sienge as vezes retorna "13/60" no campo installmentNumber, mas o
--      identificador unico real e o installmentId numerico do payload. Guardamos como text
--      pra absorver formatos variados (numerico, alfanumerico, "13/60") sem perder dado.
--   3. Indexa parcial nos dois (apenas WHERE NOT NULL — usado em JOIN de sync).
--   4. Unique constraint condicional em (sienge_bill_id, sienge_installment_id) quando
--      ambos NOT NULL — impede que o sync re-amarre a mesma parcela Sienge a duas linhas
--      locais. Idempotencia testavel: rodar backfill 2x nao cria duplicata.
--
-- Popular as colunas NAO e DDL — vai ser feito pelo proximo script de re-reconciliacao
-- (a rodar quando a quota Sienge bulk-data voltar; hoje 2026-05-13 bati 429 nas 3
-- tentativas com retry-after de ~8000s).
--
-- Compatibilidade com trigger 017/018/020:
--   - As novas colunas nao sao protegidas em status='pago' — sao metadados de origem,
--     equivalente a fator_comissao_aplicado liberado por 018. Sync pode preencher/corrigir
--     em qualquer estado da linha.
--   - Nao toca em tipo/valor/comissao_gerada (financeiros imutaveis em pago).
--
-- Reversivel:
--   DROP INDEX IF EXISTS idx_pagamentos_sienge_bill_inst_unique;
--   ALTER TABLE pagamentos_prosoluto DROP COLUMN sienge_installment_id, DROP COLUMN sienge_bill_id;

ALTER TABLE public.pagamentos_prosoluto
  ADD COLUMN IF NOT EXISTS sienge_bill_id bigint;

ALTER TABLE public.pagamentos_prosoluto
  ADD COLUMN IF NOT EXISTS sienge_installment_id text;

CREATE INDEX IF NOT EXISTS idx_pagamentos_sienge_bill_id
  ON public.pagamentos_prosoluto (sienge_bill_id)
  WHERE sienge_bill_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pagamentos_sienge_installment_id
  ON public.pagamentos_prosoluto (sienge_installment_id)
  WHERE sienge_installment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pagamentos_sienge_bill_inst_unique
  ON public.pagamentos_prosoluto (sienge_bill_id, sienge_installment_id)
  WHERE sienge_bill_id IS NOT NULL AND sienge_installment_id IS NOT NULL;

COMMENT ON COLUMN public.pagamentos_prosoluto.sienge_bill_id IS
  'ID do titulo (bill) no Sienge — equivalente a vendas.sienge_receivable_bill_id, materializado em pagamentos pra evitar JOIN em hot-path do sync. Popular via /bulk-data/v1/income.billId.';

COMMENT ON COLUMN public.pagamentos_prosoluto.sienge_installment_id IS
  'ID unico da parcela dentro do bill no Sienge (/bulk-data/v1/income.installmentId). Substitui o match heuristico por (venda_id, numero_parcela) — que provou ser fragil quando ha duplicatas ou lotes (ex: contrato 275, 19xR$2650 + 37xR$1500).';
