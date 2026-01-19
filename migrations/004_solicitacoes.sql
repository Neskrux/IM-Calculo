-- ================================================
-- MIGRATION: Sistema de Solicitações
-- ================================================

-- Tabela de solicitações
CREATE TABLE IF NOT EXISTS solicitacoes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Quem solicitou
  corretor_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
  
  -- Tipo de solicitação
  tipo VARCHAR(50) NOT NULL, -- 'venda', 'cliente', 'alteracao_venda', 'alteracao_cliente'
  
  -- Status da solicitação
  status VARCHAR(20) DEFAULT 'pendente', -- 'pendente', 'aprovado', 'reprovado'
  
  -- Dados da solicitação (JSON com os dados do formulário)
  dados JSONB NOT NULL,
  
  -- Resposta do admin
  resposta_admin TEXT,
  admin_id UUID REFERENCES usuarios(id),
  data_resposta TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_solicitacoes_corretor ON solicitacoes(corretor_id);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_status ON solicitacoes(status);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_tipo ON solicitacoes(tipo);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_created ON solicitacoes(created_at DESC);

-- Comentários
COMMENT ON TABLE solicitacoes IS 'Solicitações de corretores aguardando aprovação do admin';
COMMENT ON COLUMN solicitacoes.tipo IS 'Tipo: venda, cliente, alteracao_venda, alteracao_cliente';
COMMENT ON COLUMN solicitacoes.dados IS 'JSON com os dados do formulário enviado pelo corretor';

-- RLS (Row Level Security)
ALTER TABLE solicitacoes ENABLE ROW LEVEL SECURITY;

-- Política: Corretores veem apenas suas próprias solicitações
CREATE POLICY "Corretores veem suas solicitacoes" ON solicitacoes
  FOR SELECT USING (
    corretor_id = auth.uid() OR 
    EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid() AND tipo = 'admin')
  );

-- Política: Corretores podem criar solicitações
CREATE POLICY "Corretores criam solicitacoes" ON solicitacoes
  FOR INSERT WITH CHECK (corretor_id = auth.uid());

-- Política: Admins podem atualizar solicitações
CREATE POLICY "Admins atualizam solicitacoes" ON solicitacoes
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid() AND tipo = 'admin')
  );

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_solicitacoes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_solicitacoes_updated_at
  BEFORE UPDATE ON solicitacoes
  FOR EACH ROW
  EXECUTE FUNCTION update_solicitacoes_updated_at();
