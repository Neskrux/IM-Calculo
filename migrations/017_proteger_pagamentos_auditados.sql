-- =============================================
-- MIGRATION 017: Proteção de pagamentos auditados (RF-0 da SPEC)
-- Ref: docs/SPEC_PRESERVACAO_PAGAMENTOS_AUDITADOS.md §C
-- Data: 2026-04-02
-- ATENÇÃO: NÃO EXECUTAR AUTOMATICAMENTE — rodar manualmente no banco
-- =============================================

-- Função usada pelos triggers abaixo
CREATE OR REPLACE FUNCTION public.proteger_pagamento_auditado()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Bloqueia DELETE em linhas com status = 'pago'
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'pago' THEN
      RAISE EXCEPTION
        'Operação bloqueada: não é permitido excluir um pagamento já auditado (status=pago). id=%', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- Bloqueia UPDATE que rebaixe status de 'pago' para qualquer outro valor
  -- EXCETO quando for reversão explícita de baixa (data_pagamento sendo zerada
  -- intencionalmente pelo fluxo de "Excluir Baixa" do painel — ato deliberado
  -- de correção pela controladoria, linha a linha, nunca em massa).
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'pago' AND NEW.status <> 'pago' THEN
      -- Permite reversão explícita: status volta a pendente E data_pagamento é zerada
      -- (sinal de que é o fluxo deliberado de "Excluir Baixa", não edição de venda)
      IF NOT (NEW.status = 'pendente' AND NEW.data_pagamento IS NULL AND OLD.data_pagamento IS NOT NULL) THEN
        RAISE EXCEPTION
          'Operação bloqueada: não é permitido reverter o status de um pagamento auditado (pago → %) fora do fluxo de reversão explícita. id=%', NEW.status, OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;

    -- Bloqueia alteração das colunas imutáveis do "selo de auditoria"
    -- (não aplica quando é reversão explícita de baixa)
    IF OLD.status = 'pago' AND NOT (NEW.status = 'pendente' AND NEW.data_pagamento IS NULL AND OLD.data_pagamento IS NOT NULL) THEN
      IF OLD.tipo IS DISTINCT FROM NEW.tipo THEN
        RAISE EXCEPTION
          'Operação bloqueada: campo "tipo" é imutável em pagamento auditado. id=%', OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF OLD.comissao_gerada IS DISTINCT FROM NEW.comissao_gerada THEN
        RAISE EXCEPTION
          'Operação bloqueada: campo "comissao_gerada" é imutável em pagamento auditado. id=%', OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF OLD.fator_comissao_aplicado IS DISTINCT FROM NEW.fator_comissao_aplicado THEN
        RAISE EXCEPTION
          'Operação bloqueada: campo "fator_comissao_aplicado" é imutável em pagamento auditado. id=%', OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF OLD.percentual_comissao_total IS DISTINCT FROM NEW.percentual_comissao_total THEN
        RAISE EXCEPTION
          'Operação bloqueada: campo "percentual_comissao_total" é imutável em pagamento auditado. id=%', OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF OLD.valor IS DISTINCT FROM NEW.valor THEN
        RAISE EXCEPTION
          'Operação bloqueada: campo "valor" é imutável em pagamento auditado. id=%', OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF OLD.data_pagamento IS DISTINCT FROM NEW.data_pagamento THEN
        RAISE EXCEPTION
          'Operação bloqueada: campo "data_pagamento" é imutável em pagamento auditado. id=%', OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

-- Trigger de DELETE
DROP TRIGGER IF EXISTS trg_bloquear_delete_pago ON public.pagamentos_prosoluto;
CREATE TRIGGER trg_bloquear_delete_pago
  BEFORE DELETE ON public.pagamentos_prosoluto
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_pagamento_auditado();

-- Trigger de UPDATE
DROP TRIGGER IF EXISTS trg_bloquear_update_pago ON public.pagamentos_prosoluto;
CREATE TRIGGER trg_bloquear_update_pago
  BEFORE UPDATE ON public.pagamentos_prosoluto
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_pagamento_auditado();

-- Comentários
COMMENT ON FUNCTION public.proteger_pagamento_auditado() IS
  'Protege linhas com status=pago de DELETE e de UPDATE que reverta status ou altere colunas imutáveis do selo de auditoria. Ref: SPEC_PRESERVACAO_PAGAMENTOS_AUDITADOS.md §C';
