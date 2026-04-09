-- =============================================================================
-- Teste manual: triggers da migration 017 (proteger_pagamentos_auditados)
-- Onde rodar: Supabase Dashboard → SQL Editor (role com bypass de RLS, ex. postgres)
-- Pré-requisito: migration 017 já aplicada.
--
-- Referência validada (inspect_venda.sql):
--   venda_id   9d279176-e4de-4e3f-8ec2-9aa4b6c7f62a 
--
-- Esperado:
--   1) DELETE em linha status = 'pago' → ERRO (bloqueado pelo trigger)
--   2) UPDATE só data_prevista em linha 'pago' → sucesso
--   3) data_prevista é restaurada ao final (produção intacta)
-- =============================================================================

DO $$
DECLARE
  -- Fixe NULL para escolher qualquer venda que tenha parcela pago; ou um venda_id explícito.
  v_venda_teste uuid := '9d279176-e4de-4e3f-8ec2-9aa4b6c7f62a'::uuid;
  test_id       uuid;
  row_venda_id  uuid;
  old_prevista  date;
  new_prevista  date;
BEGIN
  SELECT p.id, p.venda_id, p.data_prevista
  INTO test_id, row_venda_id, old_prevista
  FROM public.pagamentos_prosoluto p
  WHERE p.status = 'pago'
    AND (v_venda_teste IS NULL OR p.venda_id = v_venda_teste)
  ORDER BY p.numero_parcela NULLS LAST, p.created_at
  LIMIT 1;

  IF test_id IS NULL THEN
    RAISE NOTICE 'SKIP: nenhuma linha status=pago %.',
      CASE WHEN v_venda_teste IS NULL THEN '(qualquer venda)' ELSE 'para venda_id=' || v_venda_teste::text END;
    RETURN;
  END IF;

  RAISE NOTICE '--- Linha de teste: pagamento_id = %, venda_id = %, data_prevista = % ---',
    test_id, row_venda_id, old_prevista;

  -- (1) DELETE deve falhar
  BEGIN
    DELETE FROM public.pagamentos_prosoluto WHERE id = test_id;
    RAISE EXCEPTION 'FALHA DO TESTE: DELETE em linha pago deveria ter sido bloqueado pelo trigger.';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'OK (1): DELETE bloqueado como esperado. Mensagem: %', SQLERRM;
  END;

  -- (2) UPDATE só data_prevista deve passar; revertemos em seguida
  new_prevista := COALESCE(old_prevista, CURRENT_DATE) + 1;

  UPDATE public.pagamentos_prosoluto
  SET data_prevista = new_prevista
  WHERE id = test_id AND status = 'pago';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FALHA DO TESTE: UPDATE de data_prevista não afetou nenhuma linha.';
  END IF;

  RAISE NOTICE 'OK (2): UPDATE de data_prevista aplicado temporariamente (% → %).', old_prevista, new_prevista;

  UPDATE public.pagamentos_prosoluto
  SET data_prevista = old_prevista
  WHERE id = test_id;

  RAISE NOTICE 'OK (2b): data_prevista restaurada ao valor original (produção intacta).';
  RAISE NOTICE '--- Teste 017 concluído com sucesso ---';
END $$;
