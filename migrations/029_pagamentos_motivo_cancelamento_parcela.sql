-- =============================================
-- MIGRATION 029: pagamentos_prosoluto.motivo_cancelamento_parcela
-- Ref: .claude/rules/sincronizacao-sienge.md
-- Data: 2026-06-05
-- Descrição: Motivo do cancelamento de uma PARCELA (status='cancelado'). Trilha de
--            auditoria pra separar cancelamento legítimo de defeito na reconciliação.
--            Nome distinto de vendas.motivo_cancelamento (razão do DISTRATO do contrato)
--            e de vendas.motivo_exclusao (soft-delete da venda). Metadado não protegido;
--            deve ser setado SÓ no passo pendente->cancelado (nunca no pago->pendente,
--            que é o fluxo "Excluir Baixa"). Idempotente.
-- =============================================

ALTER TABLE public.pagamentos_prosoluto
  ADD COLUMN IF NOT EXISTS motivo_cancelamento_parcela TEXT;

ALTER TABLE public.pagamentos_prosoluto
  DROP CONSTRAINT IF EXISTS pagamentos_prosoluto_motivo_cancelamento_parcela_check;

ALTER TABLE public.pagamentos_prosoluto
  ADD CONSTRAINT pagamentos_prosoluto_motivo_cancelamento_parcela_check
  CHECK (motivo_cancelamento_parcela IS NULL OR motivo_cancelamento_parcela IN (
    'duplicata',            -- gêmea criada pelo gerador antigo (ex c129)
    'cronograma_refeito',   -- substituída na regeneração a partir do income (ex c275)
    'distrato',             -- baixa de liquidação pós data_distrato (não é pago real)
    'aditivo_renegociado',  -- grade antiga substituída por remade-installments
    'sienge_removeu',       -- sumiu do income do Sienge
    'outro'
  ));

COMMENT ON COLUMN public.pagamentos_prosoluto.motivo_cancelamento_parcela IS
  'Por que a parcela foi cancelada (status=cancelado). Auditoria: duplicata, cronograma_refeito, distrato, aditivo_renegociado, sienge_removeu, outro. NULL em parcelas ativas/canceladas legadas.';
