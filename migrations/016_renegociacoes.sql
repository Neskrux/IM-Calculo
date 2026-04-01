-- =====================================================
-- MIGRATION 016: Tabela de Renegociações de Parcelas
-- =====================================================

CREATE TABLE IF NOT EXISTS public.renegociacoes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  venda_id UUID NOT NULL REFERENCES public.vendas(id) ON DELETE CASCADE,
  usuario_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  data_renegociacao TIMESTAMPTZ NOT NULL DEFAULT now(),
  motivo TEXT NOT NULL,
  parcelas_originais JSONB NOT NULL DEFAULT '[]',
  parcelas_novas JSONB NOT NULL DEFAULT '[]',
  diferenca_valor NUMERIC(14, 2) NOT NULL DEFAULT 0,
  diferenca_comissao NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_renegociacoes_venda_id ON public.renegociacoes(venda_id);
CREATE INDEX IF NOT EXISTS idx_renegociacoes_data ON public.renegociacoes(data_renegociacao DESC);

-- Comentários
COMMENT ON TABLE public.renegociacoes IS 'Histórico de renegociações de parcelas/balões em vendas';
COMMENT ON COLUMN public.renegociacoes.venda_id IS 'Referência à venda renegociada';
COMMENT ON COLUMN public.renegociacoes.usuario_id IS 'Admin que realizou a renegociação';
COMMENT ON COLUMN public.renegociacoes.data_renegociacao IS 'Data/hora da renegociação';
COMMENT ON COLUMN public.renegociacoes.motivo IS 'Motivo descritivo da renegociação';
COMMENT ON COLUMN public.renegociacoes.parcelas_originais IS 'JSON com parcelas antes da renegociação';
COMMENT ON COLUMN public.renegociacoes.parcelas_novas IS 'JSON com parcelas depois da renegociação';
COMMENT ON COLUMN public.renegociacoes.diferenca_valor IS 'Delta de valor (novas - originais)';
COMMENT ON COLUMN public.renegociacoes.diferenca_comissao IS 'Delta de comissão (novas - originais)';
