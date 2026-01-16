-- =============================================
-- MIGRATION: Adicionar campos de integração Sienge
-- Data: 2024-01-XX
-- Descrição: Adiciona campos para sincronização com API do Sienge
-- =============================================

-- =============================================
-- TABELA: clientes
-- =============================================

-- ID do cliente no Sienge (chave de sincronização)
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS sienge_customer_id TEXT UNIQUE;

-- CNPJ para clientes PJ
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cnpj TEXT;

-- CEP do endereço
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cep TEXT;

-- Data de última atualização no Sienge
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS sienge_updated_at TIMESTAMP WITH TIME ZONE;

-- Índice para busca rápida por ID do Sienge
CREATE INDEX IF NOT EXISTS idx_clientes_sienge_customer_id ON clientes(sienge_customer_id);

-- =============================================
-- TABELA: vendas
-- =============================================

-- ID do contrato no Sienge (chave de sincronização)
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS sienge_contract_id TEXT UNIQUE;

-- Número do contrato
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS numero_contrato TEXT;

-- Data de emissão do contrato
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS data_emissao DATE;

-- Valor total de venda (pode ser diferente de valor_venda)
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS valor_venda_total DECIMAL(15, 2);

-- Situação do contrato: 0=Solicitado, 1=Autorizado, 2=Emitido, 3=Cancelado
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS situacao_contrato TEXT;

-- ID do corretor no Sienge
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS sienge_broker_id TEXT;

-- ID da unidade no Sienge
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS sienge_unit_id TEXT;

-- Quantidade de parcelas (do paymentConditions)
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS qtd_parcelas INTEGER;

-- Data de cancelamento (se cancelado)
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS data_cancelamento DATE;

-- Motivo do cancelamento
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT;

-- Data de última atualização no Sienge
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS sienge_updated_at TIMESTAMP WITH TIME ZONE;

-- Índices para busca rápida
CREATE INDEX IF NOT EXISTS idx_vendas_sienge_contract_id ON vendas(sienge_contract_id);
CREATE INDEX IF NOT EXISTS idx_vendas_sienge_broker_id ON vendas(sienge_broker_id);
CREATE INDEX IF NOT EXISTS idx_vendas_sienge_unit_id ON vendas(sienge_unit_id);
CREATE INDEX IF NOT EXISTS idx_vendas_situacao_contrato ON vendas(situacao_contrato);

-- =============================================
-- TABELA: usuarios (corretores)
-- =============================================

-- ID do corretor/vendedor no Sienge
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sienge_broker_id TEXT;

-- Índice para busca rápida
CREATE INDEX IF NOT EXISTS idx_usuarios_sienge_broker_id ON usuarios(sienge_broker_id);

-- =============================================
-- TABELA: empreendimentos
-- =============================================

-- ID do empreendimento no Sienge (chave de sincronização)
ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS sienge_enterprise_id TEXT UNIQUE;

-- Índice para busca rápida
CREATE INDEX IF NOT EXISTS idx_empreendimentos_sienge_enterprise_id ON empreendimentos(sienge_enterprise_id);

-- =============================================
-- COMENTÁRIOS SOBRE OS CAMPOS
-- =============================================

COMMENT ON COLUMN clientes.sienge_customer_id IS 'ID do cliente no Sienge - chave de sincronização';
COMMENT ON COLUMN clientes.sienge_updated_at IS 'Data da última atualização no Sienge';

COMMENT ON COLUMN vendas.sienge_contract_id IS 'ID do contrato no Sienge - chave de sincronização';
COMMENT ON COLUMN vendas.numero_contrato IS 'Número do contrato no Sienge';
COMMENT ON COLUMN vendas.situacao_contrato IS 'Situação: 0=Solicitado, 1=Autorizado, 2=Emitido, 3=Cancelado';
COMMENT ON COLUMN vendas.sienge_broker_id IS 'ID do corretor no Sienge (extraído de brokers[])';
COMMENT ON COLUMN vendas.sienge_unit_id IS 'ID da unidade no Sienge';
COMMENT ON COLUMN vendas.sienge_updated_at IS 'Data da última atualização no Sienge';

COMMENT ON COLUMN usuarios.sienge_broker_id IS 'ID do corretor/vendedor no Sienge';

COMMENT ON COLUMN empreendimentos.sienge_enterprise_id IS 'ID do empreendimento no Sienge - chave de sincronização';

-- =============================================
-- FIM DA MIGRATION
-- =============================================

