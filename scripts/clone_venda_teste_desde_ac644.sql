-- =============================================================================
-- Clonar venda ac644733-d731-44e5-8573-99b9231e90a8 como CÓPIA DE TESTE
--
-- - descricao = 'teste'
-- - corretor_id = o que você colar abaixo (ex.: Jonas — use find_corretor_jonas_beton.sql)
-- - novo id em vendas e em todas as parcelas / comissoes_venda
-- - sienge_contract_id / numero_contrato = NULL (evita UNIQUE)
-- - created_at / updated_at = now() nas cópias
--
-- v_corretor_id já vem com Jonas Beton (9a22fd92-…). Troque se quiser outro corretor.
-- Rode o bloco INTEIRO no SQL Editor.
-- =============================================================================

DO $$
DECLARE
  v_origem       uuid := 'ac644733-d731-44e5-8573-99b9231e90a8'::uuid;
  -- Corretor: jonas beton (externo) — ajuste se precisar de outro
  v_corretor_id  uuid := '9a22fd92-089a-4230-9ed3-4861e59cf493'::uuid;

  v_nova_venda   uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = v_corretor_id AND u.tipo = 'corretor') THEN
    RAISE EXCEPTION 'v_corretor_id não existe ou não é corretor: %', v_corretor_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.vendas v WHERE v.id = v_origem) THEN
    RAISE EXCEPTION 'Venda origem não encontrada: %', v_origem;
  END IF;

  v_nova_venda := gen_random_uuid();

  INSERT INTO public.vendas (
    id,
    corretor_id,
    valor_venda,
    tipo_corretor,
    data_venda,
    descricao,
    status,
    comissao_diretor,
    comissao_nohros_imobiliaria,
    comissao_nohros_gestao,
    comissao_wsc,
    comissao_corretor,
    comissao_coordenadora,
    comissao_total,
    created_at,
    updated_at,
    teve_sinal,
    valor_sinal,
    parcelou_entrada,
    qtd_parcelas_entrada,
    valor_parcela_entrada,
    teve_balao,
    valor_balao,
    valor_pro_soluto,
    fator_comissao,
    empreendimento_id,
    contrato_url,
    contrato_nome,
    teve_permuta,
    tipo_permuta,
    valor_permuta,
    qtd_balao,
    teve_entrada,
    valor_entrada,
    cliente_id,
    unidade,
    bloco,
    lead_id,
    nome_cliente,
    andar,
    primeiro_vencimento,
    valor_balao_unitario,
    vencimento_balao,
    condicao,
    sienge_contract_id,
    numero_contrato,
    data_emissao,
    valor_venda_total,
    situacao_contrato,
    sienge_broker_id,
    sienge_unit_id,
    qtd_parcelas,
    data_cancelamento,
    motivo_cancelamento,
    sienge_updated_at,
    data_entrega_prevista,
    sienge_customer_id,
    unidade_id,
    data_entrada,
    periodicidade_parcelas,
    periodicidade_balao,
    excluido,
    data_distrato
  )
  SELECT
    v_nova_venda,
    v_corretor_id,
    o.valor_venda,
    o.tipo_corretor,
    o.data_venda,
    'teste'::text,
    o.status,
    o.comissao_diretor,
    o.comissao_nohros_imobiliaria,
    o.comissao_nohros_gestao,
    o.comissao_wsc,
    o.comissao_corretor,
    o.comissao_coordenadora,
    o.comissao_total,
    now(),
    now(),
    o.teve_sinal,
    o.valor_sinal,
    o.parcelou_entrada,
    o.qtd_parcelas_entrada,
    o.valor_parcela_entrada,
    o.teve_balao,
    o.valor_balao,
    o.valor_pro_soluto,
    o.fator_comissao,
    o.empreendimento_id,
    o.contrato_url,
    o.contrato_nome,
    o.teve_permuta,
    o.tipo_permuta,
    o.valor_permuta,
    o.qtd_balao,
    o.teve_entrada,
    o.valor_entrada,
    o.cliente_id,
    o.unidade,
    o.bloco,
    o.lead_id,
    o.nome_cliente,
    o.andar,
    o.primeiro_vencimento,
    o.valor_balao_unitario,
    o.vencimento_balao,
    o.condicao,
    NULL,
    NULL,
    o.data_emissao,
    o.valor_venda_total,
    o.situacao_contrato,
    NULL,
    NULL,
    o.qtd_parcelas,
    o.data_cancelamento,
    o.motivo_cancelamento,
    o.sienge_updated_at,
    o.data_entrega_prevista,
    NULL,
    o.unidade_id,
    o.data_entrada,
    o.periodicidade_parcelas,
    o.periodicidade_balao,
    false,
    NULL
  FROM public.vendas o
  WHERE o.id = v_origem;

  INSERT INTO public.pagamentos_prosoluto (
    id,
    venda_id,
    tipo,
    numero_parcela,
    valor,
    data_prevista,
    data_pagamento,
    status,
    comissao_gerada,
    created_at,
    fator_comissao_aplicado,
    percentual_comissao_total,
    updated_at
  )
  SELECT
    gen_random_uuid(),
    v_nova_venda,
    p.tipo,
    p.numero_parcela,
    p.valor,
    p.data_prevista,
    p.data_pagamento,
    p.status,
    p.comissao_gerada,
    now(),
    p.fator_comissao_aplicado,
    p.percentual_comissao_total,
    now()
  FROM public.pagamentos_prosoluto p
  WHERE p.venda_id = v_origem;

  -- Copia comissões por cargo (se a tabela / colunas existirem no seu banco)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'comissoes_venda'
  ) THEN
    INSERT INTO public.comissoes_venda (
      id,
      venda_id,
      cargo_id,
      nome_cargo,
      percentual,
      valor_comissao,
      valor_pago,
      created_at,
      fator_aplicado,
      valor_base,
      percentual_snapshot,
      calculado_em
    )
    SELECT
      gen_random_uuid(),
      v_nova_venda,
      c.cargo_id,
      c.nome_cargo,
      c.percentual,
      c.valor_comissao,
      c.valor_pago,
      now(),
      c.fator_aplicado,
      c.valor_base,
      c.percentual_snapshot,
      COALESCE(c.calculado_em, now())
    FROM public.comissoes_venda c
    WHERE c.venda_id = v_origem;
  END IF;

  RAISE NOTICE 'Clone criado. nova_venda_id = % | corretor_id = % | descricao = teste', v_nova_venda, v_corretor_id;
END $$;
