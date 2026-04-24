-- 019_add_sienge_receivable_bill_id.sql
-- Materializa a ponte vendas <-> income (Sienge bulk-data).
-- ver .claude/rules/sincronizacao-sienge.md
--
-- Hoje:
--   vendas.sienge_contract_id  ──► sienge_raw.objects (entity='sales-contracts').payload.id
--                                       │
--                                       └─► payload.receivableBillId ──► income.billId
-- O JOIN em tempo real exige extrair JSON a cada backfill/consulta. Custoso e frágil.
--
-- Esta migration:
--   1. Adiciona coluna vendas.sienge_receivable_bill_id (bigint, nullable).
--   2. Indexa parcial (WHERE IS NOT NULL) — usado só em JOINs de sync.
--
-- Popular a coluna NÃO é DDL; é feito no próximo step (UPDATE data migration)
-- rodado separadamente pela aplicação/script, porque depende dos dados de RAW.

ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS sienge_receivable_bill_id bigint;

CREATE INDEX IF NOT EXISTS idx_vendas_sienge_receivable_bill_id
  ON public.vendas (sienge_receivable_bill_id)
  WHERE sienge_receivable_bill_id IS NOT NULL;

COMMENT ON COLUMN public.vendas.sienge_receivable_bill_id IS
  'ID do título (bill) no Sienge — chave de JOIN com /bulk-data/v1/income.billId. Materializado de sienge_raw.objects.payload.receivableBillId.';
