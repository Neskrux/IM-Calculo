-- =============================================
-- MIGRATION 027: pagamentos_prosoluto.renegociacao_id (FK -> renegociacoes)
-- Ref: migrations/016_renegociacoes.sql, .claude/rules/sincronizacao-sienge.md
-- Data: 2026-06-05
-- Descrição: Liga a parcela gerada por aditivo ao evento em renegociacoes (016).
--            É metadado — NÃO entra na lista de colunas protegidas pelos triggers
--            017/020/026 (tipo/valor/comissao_gerada/data_pagamento), então pode ser
--            setado inclusive em parcela com status='pago'. Idempotente.
--            Sem juros inicialmente: renegociacoes.diferenca_valor/comissao ficam 0.
-- =============================================

ALTER TABLE public.pagamentos_prosoluto
  ADD COLUMN IF NOT EXISTS renegociacao_id UUID
    REFERENCES public.renegociacoes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pagamentos_renegociacao_id
  ON public.pagamentos_prosoluto (renegociacao_id)
  WHERE renegociacao_id IS NOT NULL;

COMMENT ON COLUMN public.pagamentos_prosoluto.renegociacao_id IS
  'FK -> renegociacoes(id): aditivo que gerou/alterou esta parcela. Metadado editável em qualquer status (não protegido pelo trigger de imutabilidade). NULL = parcela original.';
