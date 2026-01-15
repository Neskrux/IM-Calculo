-- =============================================
-- MIGRATION: Campos completos para sincronização de Vendas
-- Data: 2026-01-15
-- Descrição: Adiciona TODOS os campos necessários para sync V2
-- =============================================

-- =============================================
-- TORNAR corretor_id NULLABLE (para contratos sem corretor)
-- =============================================
ALTER TABLE public.vendas ALTER COLUMN corretor_id DROP NOT NULL;

-- =============================================
-- CAMPOS DE SINCRONIZAÇÃO SIENGE
-- =============================================

ALTER TABLE public.vendas 
  ADD COLUMN IF NOT EXISTS sienge_customer_id text,
  ADD COLUMN IF NOT EXISTS sienge_contract_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS sienge_broker_id text,
  ADD COLUMN IF NOT EXISTS sienge_unit_id text,
  ADD COLUMN IF NOT EXISTS sienge_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS situacao_contrato text,
  ADD COLUMN IF NOT EXISTS data_emissao date,
  ADD COLUMN IF NOT EXISTS data_entrega_prevista date,
  ADD COLUMN IF NOT EXISTS data_cancelamento date,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento text,
  ADD COLUMN IF NOT EXISTS valor_venda_total numeric(14,2),
  ADD COLUMN IF NOT EXISTS numero_contrato text;

-- =============================================
-- CAMPOS PRO-SOLUTO (para cálculo de comissões)
-- =============================================

-- Sinal
ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS teve_sinal boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS valor_sinal numeric(14,2);

-- Entrada
ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS teve_entrada boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS valor_entrada numeric(14,2),
  ADD COLUMN IF NOT EXISTS parcelou_entrada boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS qtd_parcelas_entrada integer,
  ADD COLUMN IF NOT EXISTS valor_parcela_entrada numeric(14,2);

-- Balão
ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS teve_balao text DEFAULT 'nao' CHECK (teve_balao IN ('sim', 'nao')),
  ADD COLUMN IF NOT EXISTS qtd_balao integer,
  ADD COLUMN IF NOT EXISTS valor_balao numeric(14,2);

-- Pro-soluto total
ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS valor_pro_soluto numeric(14,2),
  ADD COLUMN IF NOT EXISTS fator_comissao numeric(6,4);

-- Unidade
ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS unidade text;

-- Cliente relacionado
ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS cliente_id uuid REFERENCES public.clientes(id);

-- Empreendimento relacionado
ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS empreendimento_id uuid REFERENCES public.empreendimentos(id);

-- =============================================
-- ÍNDICES PARA PERFORMANCE
-- =============================================

CREATE INDEX IF NOT EXISTS idx_vendas_sienge_contract_id ON public.vendas(sienge_contract_id);
CREATE INDEX IF NOT EXISTS idx_vendas_sienge_customer_id ON public.vendas(sienge_customer_id);
CREATE INDEX IF NOT EXISTS idx_vendas_sienge_broker_id ON public.vendas(sienge_broker_id);
CREATE INDEX IF NOT EXISTS idx_vendas_empreendimento_id ON public.vendas(empreendimento_id);
CREATE INDEX IF NOT EXISTS idx_vendas_cliente_id ON public.vendas(cliente_id);

-- =============================================
-- COMENTÁRIOS
-- =============================================

COMMENT ON COLUMN public.vendas.sienge_customer_id IS 'ID do cliente no Sienge (extraído de salesContractCustomers[])';
COMMENT ON COLUMN public.vendas.teve_sinal IS 'Se houve pagamento de sinal (AT, SN)';
COMMENT ON COLUMN public.vendas.valor_sinal IS 'Valor total do sinal';
COMMENT ON COLUMN public.vendas.teve_entrada IS 'Se houve pagamento de entrada (PM, EN)';
COMMENT ON COLUMN public.vendas.parcelou_entrada IS 'Se a entrada foi parcelada (PM)';
COMMENT ON COLUMN public.vendas.teve_balao IS 'Se houve balões (BA, B1-B5)';
COMMENT ON COLUMN public.vendas.valor_pro_soluto IS 'Soma de todos os pagamentos pro-soluto (sinal + entrada + balões)';
COMMENT ON COLUMN public.vendas.fator_comissao IS 'Fator de comissão (ex: 0.07 = 7%)';

-- =============================================
-- FIM DA MIGRATION
-- =============================================
