-- =============================================
-- MIGRATION 020: Liberar data_pagamento em status=pago
-- Ref: decisao 5A(a) do roadmap Sienge (2026-04-23)
-- Motivacao: data_pagamento deve refletir a realidade do Sienge (fonte da
-- verdade financeira). Travar em "pago" impedia correcao automatica de 278
-- divergencias detectadas na Etapa 3 do backfill — datas locais inseridas
-- manualmente com +20/+40 dias de diferenca vs extrato Sienge.
--
-- Campos que continuam imutaveis em status=pago: tipo, valor, comissao_gerada.
-- Estes representam dinheiro e identidade da parcela.
-- data_pagamento passa a ser editavel livremente: e informacao temporal que
-- deve espelhar o Sienge, nao "selo" comercial.
--
-- Continua bloqueado: DELETE de linha pago, reversao pago->pendente
-- (exceto pelo fluxo explicito "Excluir Baixa": status=pendente +
-- data_pagamento=NULL num so UPDATE).
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
  -- intencionalmente pelo fluxo de "Excluir Baixa" do painel).
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'pago' AND NEW.status <> 'pago' THEN
      IF NOT (NEW.status = 'pendente' AND NEW.data_pagamento IS NULL AND OLD.data_pagamento IS NOT NULL) THEN
        RAISE EXCEPTION
          'Operação bloqueada: não é permitido reverter o status de um pagamento auditado (pago → %) fora do fluxo de reversão explícita. id=%', NEW.status, OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;

    -- Bloqueia alteração das colunas financeiras imutaveis (tipo, valor, comissao_gerada)
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
      -- NOTA: data_pagamento foi LIBERADA na migration 020. Sienge e a fonte
      -- da verdade financeira — se a data local divergir, o sync corrige
      -- para espelhar o extrato. Reversao pago->pendente continua protegida
      -- pelo ramo acima (so permite via "Excluir Baixa" com data_pagamento=NULL).
      -- NOTA: fator_comissao_aplicado e percentual_comissao_total foram
      -- liberados na migration 018 (snapshots/metadados, nao financeiros).
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.proteger_pagamento_auditado() IS
  'Protege linhas com status=pago de DELETE e de UPDATE em colunas financeiras imutaveis (tipo, valor, comissao_gerada). data_pagamento, fator_comissao_aplicado e percentual_comissao_total sao editaveis em pago (reflete Sienge e snapshots/metadados). Reversao pago->pendente so via fluxo "Excluir Baixa" (status+data_pagamento juntos). Ref: migrations 017/018/020.';
