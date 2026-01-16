-- =====================================================
-- MIGRATION 006: Correção do Fator de Comissão
-- 
-- PROBLEMA: A comissao_gerada estava sendo calculada como:
--   comissao = parcela × percentual  ❌ ERRADO
--
-- CORRETO: 
--   fator = (valor_venda × percentual) / pro_soluto
--   comissao = parcela × fator  ✅
--
-- Esta migration:
-- 1. Adiciona coluna fator_comissao_aplicado
-- 2. Recalcula TODOS os pagamentos existentes
-- =====================================================

-- 1. ADICIONAR COLUNA DE FATOR
ALTER TABLE public.pagamentos_prosoluto 
ADD COLUMN IF NOT EXISTS fator_comissao_aplicado NUMERIC(10,6);

COMMENT ON COLUMN public.pagamentos_prosoluto.fator_comissao_aplicado 
IS 'Fator usado para calcular a comissão: (valor_venda × percentual_total) / pro_soluto';

-- 2. ADICIONAR COLUNA DE PERCENTUAL TOTAL (para auditoria)
ALTER TABLE public.pagamentos_prosoluto 
ADD COLUMN IF NOT EXISTS percentual_comissao_total NUMERIC(5,2);

COMMENT ON COLUMN public.pagamentos_prosoluto.percentual_comissao_total 
IS 'Percentual total de comissão do empreendimento usado no cálculo (ex: 7.00)';

-- 3. RECALCULAR TODOS OS PAGAMENTOS
-- Esta query atualiza a comissao_gerada usando a fórmula correta
DO $$
DECLARE
  rec RECORD;
  v_fator NUMERIC(10,6);
  v_comissao NUMERIC(12,2);
  v_percentual NUMERIC(5,2);
  v_contador INTEGER := 0;
  v_erros INTEGER := 0;
BEGIN
  RAISE NOTICE '🔄 Iniciando recálculo de comissões...';
  
  FOR rec IN 
    SELECT 
      p.id as pagamento_id,
      p.valor as valor_parcela,
      p.venda_id,
      v.valor_venda,
      v.valor_pro_soluto,
      v.tipo_corretor,
      v.empreendimento_id,
      COALESCE(
        CASE WHEN v.tipo_corretor = 'interno' 
          THEN e.comissao_total_interno 
          ELSE e.comissao_total_externo 
        END, 
        7
      ) as percentual_total
    FROM public.pagamentos_prosoluto p
    INNER JOIN public.vendas v ON v.id = p.venda_id
    LEFT JOIN public.empreendimentos e ON e.id = v.empreendimento_id
    WHERE v.valor_venda > 0 
      AND v.valor_pro_soluto > 0
  LOOP
    BEGIN
      -- Calcular fator: (valor_venda × percentual) / pro_soluto
      v_percentual := rec.percentual_total;
      v_fator := (rec.valor_venda * (v_percentual / 100)) / rec.valor_pro_soluto;
      
      -- Calcular comissão: parcela × fator
      v_comissao := rec.valor_parcela * v_fator;
      
      -- Atualizar pagamento
      UPDATE public.pagamentos_prosoluto
      SET 
        fator_comissao_aplicado = v_fator,
        percentual_comissao_total = v_percentual,
        comissao_gerada = v_comissao
      WHERE id = rec.pagamento_id;
      
      v_contador := v_contador + 1;
      
    EXCEPTION WHEN OTHERS THEN
      v_erros := v_erros + 1;
      RAISE NOTICE '❌ Erro no pagamento %: %', rec.pagamento_id, SQLERRM;
    END;
  END LOOP;
  
  RAISE NOTICE '✅ Recálculo concluído!';
  RAISE NOTICE '   📊 Pagamentos atualizados: %', v_contador;
  RAISE NOTICE '   ❌ Erros: %', v_erros;
END $$;

-- 4. CRIAR ÍNDICE PARA PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_pagamentos_fator 
ON public.pagamentos_prosoluto(fator_comissao_aplicado);

-- 5. VERIFICAÇÃO - Mostrar amostra de pagamentos recalculados
SELECT 
  p.id,
  p.tipo,
  p.valor as valor_parcela,
  p.fator_comissao_aplicado as fator,
  p.percentual_comissao_total as percentual,
  p.comissao_gerada as comissao_nova,
  v.valor_venda,
  v.valor_pro_soluto,
  e.nome as empreendimento
FROM public.pagamentos_prosoluto p
INNER JOIN public.vendas v ON v.id = p.venda_id
LEFT JOIN public.empreendimentos e ON e.id = v.empreendimento_id
WHERE p.fator_comissao_aplicado IS NOT NULL
LIMIT 10;

-- 6. ESTATÍSTICAS
SELECT 
  COUNT(*) as total_pagamentos,
  COUNT(fator_comissao_aplicado) as com_fator_calculado,
  ROUND(AVG(fator_comissao_aplicado)::numeric, 4) as fator_medio,
  ROUND(SUM(comissao_gerada)::numeric, 2) as total_comissao
FROM public.pagamentos_prosoluto;
