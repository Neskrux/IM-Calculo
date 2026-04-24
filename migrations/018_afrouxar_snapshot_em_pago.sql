-- =============================================
-- MIGRATION 018: Afrouxar protecao dos snapshots em pagamentos pagos
-- Ref: ajuste na politica definida em 017, conforme decisao de 2026-04-21
-- Motivacao: fator_comissao_aplicado e percentual_comissao_total sao
-- metadados (snapshots historicos), nao valores financeiros. Trava-los em
-- pago gera retrabalho desnecessario (precisar "reverter baixa" para um
-- simples backfill de snapshot NULL).
-- Campos que continuam imutaveis em status=pago: tipo, valor,
-- comissao_gerada, data_pagamento. Estes sim representam dinheiro e
-- identidade da parcela.
-- =============================================

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
      IF NOT (NEW.status = 'pendente' AND NEW.data_pagamento IS NULL AND OLD.data_pagamento IS NOT NULL) THEN
        RAISE EXCEPTION
          'Operação bloqueada: não é permitido reverter o status de um pagamento auditado (pago → %) fora do fluxo de reversão explícita. id=%', NEW.status, OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;

    -- Bloqueia alteração das colunas imutáveis (apenas campos financeiros / identidade)
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
      -- NOTA: fator_comissao_aplicado e percentual_comissao_total foram
      -- liberados na migration 018. Sao snapshots/metadados, nao valores
      -- financeiros. A protecao real contra reescrita de dinheiro permanece
      -- em tipo/valor/comissao_gerada/data_pagamento.
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.proteger_pagamento_auditado() IS
  'Protege linhas com status=pago de DELETE e de UPDATE em colunas financeiras (tipo, valor, comissao_gerada, data_pagamento). fator_comissao_aplicado e percentual_comissao_total sao editaveis em pago (snapshots/metadados). Ref: migration 018.';
