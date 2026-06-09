-- =============================================
-- MIGRATION 026: Permitir reescrever comissao_gerada em pago SOMENTE para
-- restaurar a identidade canonica (comissao_gerada = valor x fator_comissao_aplicado)
-- Ref: .claude/rules/fator-comissao.md (excecao de reconciliacao auditada, 2026-06-03)
--      docs/contexto/2026-06-03-plano-reconciliacao-fator-comissao.md
--
-- Motivacao: 108 parcelas internas PAGAS ficaram com comissao_gerada gravado a
-- 7% (percentual externo) enquanto o fator correto e 6,5% (interno). A correcao
-- do percentual (~22/05/2026) ajustou fator_comissao_aplicado, fator_comissao da
-- venda e as pendentes, mas o comissao_gerada das ja-pagas ficou congelado pela
-- trigger 017/020. Resultado: comissao_gerada != valor x fator_comissao_aplicado
-- (overpay de R$ 3.054,95). Enquanto NENHUM relatorio foi repassado aos
-- corretores pelo sistema, o snapshot nao tem valor historico a preservar.
--
-- Esta migration NAO e afrouxamento geral: comissao_gerada continua imutavel em
-- pago, EXCETO quando o novo valor e EXATAMENTE o canonico (valor x fator). Ou
-- seja, so se permite RESTAURAR a corretude — nunca gravar um valor arbitrario.
-- valor, tipo e a reversao pago->pendente continuam protegidos como antes.
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

  IF TG_OP = 'UPDATE' THEN
    -- Bloqueia rebaixar status de 'pago' fora do fluxo "Excluir Baixa"
    IF OLD.status = 'pago' AND NEW.status <> 'pago' THEN
      IF NOT (NEW.status = 'pendente' AND NEW.data_pagamento IS NULL AND OLD.data_pagamento IS NOT NULL) THEN
        RAISE EXCEPTION
          'Operação bloqueada: não é permitido reverter o status de um pagamento auditado (pago → %) fora do fluxo de reversão explícita. id=%', NEW.status, OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;

    -- Colunas financeiras imutaveis (tipo, valor, comissao_gerada)
    -- (não aplica quando é reversão explícita de baixa)
    IF OLD.status = 'pago' AND NOT (NEW.status = 'pendente' AND NEW.data_pagamento IS NULL AND OLD.data_pagamento IS NOT NULL) THEN
      IF OLD.tipo IS DISTINCT FROM NEW.tipo THEN
        RAISE EXCEPTION
          'Operação bloqueada: campo "tipo" é imutável em pagamento auditado. id=%', OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF OLD.valor IS DISTINCT FROM NEW.valor THEN
        RAISE EXCEPTION
          'Operação bloqueada: campo "valor" é imutável em pagamento auditado. id=%', OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
      -- comissao_gerada: imutavel EXCETO para restaurar a identidade canonica.
      -- Permitido apenas quando NEW.comissao_gerada == ROUND(NEW.valor x NEW.fator_comissao_aplicado, 2)
      -- com fator valido (>0). Ver migration 026 / .claude/rules/fator-comissao.md.
      IF OLD.comissao_gerada IS DISTINCT FROM NEW.comissao_gerada THEN
        IF NEW.fator_comissao_aplicado IS NULL
           OR NEW.fator_comissao_aplicado <= 0
           OR ROUND(NEW.comissao_gerada::numeric, 2)
              IS DISTINCT FROM ROUND((NEW.valor * NEW.fator_comissao_aplicado)::numeric, 2) THEN
          RAISE EXCEPTION
            'Operação bloqueada: "comissao_gerada" é imutável em pagamento auditado, exceto para restaurar a identidade canônica (valor × fator_comissao_aplicado). id=%', OLD.id
            USING ERRCODE = 'restrict_violation';
        END IF;
      END IF;
      -- data_pagamento: liberada (020). fator_comissao_aplicado / percentual_comissao_total: liberados (018).
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.proteger_pagamento_auditado() IS
  'Protege linhas status=pago: bloqueia DELETE, reversao pago->pendente (exceto "Excluir Baixa"), e UPDATE de tipo/valor. comissao_gerada e imutavel EXCETO para restaurar a identidade canonica (=valor*fator_comissao_aplicado). data_pagamento/fator_comissao_aplicado/percentual_comissao_total editaveis. Ref: migrations 017/018/020/026.';
