-- Adiciona updated_at em pagamentos_prosoluto para auditoria de alterações
ALTER TABLE public.pagamentos_prosoluto
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Trigger para atualizar updated_at automaticamente em qualquer UPDATE
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pagamentos_prosoluto_updated_at ON public.pagamentos_prosoluto;
CREATE TRIGGER trg_pagamentos_prosoluto_updated_at
  BEFORE UPDATE ON public.pagamentos_prosoluto
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON COLUMN public.pagamentos_prosoluto.updated_at IS 'Última alteração do registro (confirmar, editar ou reverter baixa)';
