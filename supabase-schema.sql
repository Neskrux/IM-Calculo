-- =============================================
-- SCHEMA DO BANCO DE DADOS - SISTEMA DE COMISSÕES
-- Nohros Imobiliária
-- =============================================

-- Habilitar extensão UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- TABELA: usuarios
-- Armazena dados de todos os usuários (admin e corretores)
-- =============================================
CREATE TABLE usuarios (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('admin', 'corretor')),
    tipo_corretor TEXT CHECK (tipo_corretor IN ('interno', 'externo')),
    telefone TEXT,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- TABELA: vendas
-- Registra todas as vendas e comissões calculadas
-- =============================================
CREATE TABLE vendas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    corretor_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    valor_venda DECIMAL(15, 2) NOT NULL,
    tipo_corretor TEXT NOT NULL CHECK (tipo_corretor IN ('interno', 'externo')),
    data_venda DATE NOT NULL,
    descricao TEXT,
    status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago')),
    
    -- Comissões calculadas automaticamente
    comissao_diretor DECIMAL(15, 2) NOT NULL,
    comissao_nohros_imobiliaria DECIMAL(15, 2) NOT NULL,
    comissao_nohros_gestao DECIMAL(15, 2) NOT NULL,  -- Ferreti no sistema
    comissao_wsc DECIMAL(15, 2) NOT NULL,             -- Beton no sistema
    comissao_corretor DECIMAL(15, 2) NOT NULL,
    comissao_coordenadora DECIMAL(15, 2) NOT NULL,
    comissao_total DECIMAL(15, 2) NOT NULL,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- ÍNDICES para melhor performance
-- =============================================
CREATE INDEX idx_vendas_corretor_id ON vendas(corretor_id);
CREATE INDEX idx_vendas_data ON vendas(data_venda);
CREATE INDEX idx_vendas_status ON vendas(status);
CREATE INDEX idx_usuarios_tipo ON usuarios(tipo);

-- =============================================
-- TRIGGERS para atualizar updated_at
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_usuarios_updated_at
    BEFORE UPDATE ON usuarios
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vendas_updated_at
    BEFORE UPDATE ON vendas
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================

-- Habilitar RLS nas tabelas
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas ENABLE ROW LEVEL SECURITY;

-- Políticas para USUARIOS
-- Admin pode ver todos os usuários
CREATE POLICY "Admin pode ver todos usuarios" ON usuarios
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM usuarios u 
            WHERE u.id = auth.uid() AND u.tipo = 'admin'
        )
    );

-- Usuário pode ver seu próprio perfil
CREATE POLICY "Usuario pode ver proprio perfil" ON usuarios
    FOR SELECT
    USING (auth.uid() = id);

-- Admin pode inserir usuários
CREATE POLICY "Admin pode inserir usuarios" ON usuarios
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM usuarios u 
            WHERE u.id = auth.uid() AND u.tipo = 'admin'
        )
    );

-- Admin pode atualizar usuários
CREATE POLICY "Admin pode atualizar usuarios" ON usuarios
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM usuarios u 
            WHERE u.id = auth.uid() AND u.tipo = 'admin'
        )
    );

-- Políticas para VENDAS
-- Admin pode ver todas as vendas
CREATE POLICY "Admin pode ver todas vendas" ON vendas
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM usuarios u 
            WHERE u.id = auth.uid() AND u.tipo = 'admin'
        )
    );

-- Corretor pode ver suas próprias vendas
CREATE POLICY "Corretor pode ver proprias vendas" ON vendas
    FOR SELECT
    USING (auth.uid() = corretor_id);

-- Admin pode inserir vendas
CREATE POLICY "Admin pode inserir vendas" ON vendas
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM usuarios u 
            WHERE u.id = auth.uid() AND u.tipo = 'admin'
        )
    );

-- Admin pode atualizar vendas
CREATE POLICY "Admin pode atualizar vendas" ON vendas
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM usuarios u 
            WHERE u.id = auth.uid() AND u.tipo = 'admin'
        )
    );

-- Admin pode deletar vendas
CREATE POLICY "Admin pode deletar vendas" ON vendas
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM usuarios u 
            WHERE u.id = auth.uid() AND u.tipo = 'admin'
        )
    );

-- =============================================
-- DADOS INICIAIS (Exemplo)
-- Execute após criar um usuário no Authentication do Supabase
-- =============================================

-- Após criar um usuário admin no Supabase Auth, execute:
-- INSERT INTO usuarios (id, email, nome, tipo)
-- VALUES ('UUID_DO_USUARIO_CRIADO', 'admin@nohros.com', 'Administrador', 'admin');

-- Após criar um corretor no Supabase Auth, execute:
-- INSERT INTO usuarios (id, email, nome, tipo, tipo_corretor)
-- VALUES ('UUID_DO_USUARIO_CRIADO', 'corretor@nohros.com', 'João Silva', 'corretor', 'externo');

-- =============================================
-- TABELA: empreendimentos
-- =============================================
CREATE TABLE IF NOT EXISTS empreendimentos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome TEXT NOT NULL,
    descricao TEXT,
    comissao_total_externo DECIMAL(5, 2) NOT NULL DEFAULT 7.0,
    comissao_total_interno DECIMAL(5, 2) NOT NULL DEFAULT 6.0,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- TABELA: cargos_empreendimento
-- Cargos e percentuais por empreendimento (interno/externo)
-- =============================================
CREATE TABLE IF NOT EXISTS cargos_empreendimento (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empreendimento_id UUID NOT NULL REFERENCES empreendimentos(id) ON DELETE CASCADE,
    tipo_corretor TEXT NOT NULL DEFAULT 'externo', -- 'externo' ou 'interno'
    nome_cargo TEXT NOT NULL,
    percentual DECIMAL(5, 2) NOT NULL,
    ordem INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índice para buscar cargos por empreendimento
CREATE INDEX IF NOT EXISTS idx_cargos_empreendimento ON cargos_empreendimento(empreendimento_id);

-- Desabilitar RLS nas novas tabelas
ALTER TABLE empreendimentos DISABLE ROW LEVEL SECURITY;
ALTER TABLE cargos_empreendimento DISABLE ROW LEVEL SECURITY;

-- Adicionar coluna de empreendimento e cargo no usuário
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS empreendimento_id UUID REFERENCES empreendimentos(id);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cargo_id UUID REFERENCES cargos_empreendimento(id);

-- Adicionar coluna de empreendimento na venda
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS empreendimento_id UUID REFERENCES empreendimentos(id);

-- =============================================
-- TABELA: comissoes_venda
-- Armazena as comissões calculadas por cargo para cada venda
-- =============================================
CREATE TABLE IF NOT EXISTS comissoes_venda (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    venda_id UUID NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
    cargo_id UUID REFERENCES cargos_empreendimento(id),
    nome_cargo TEXT NOT NULL,
    percentual DECIMAL(5, 2) NOT NULL,
    valor_comissao DECIMAL(15, 2) NOT NULL,
    valor_pago DECIMAL(15, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- TABELA: pagamentos_prosoluto
-- Acompanhamento dos pagamentos do pro-soluto
-- =============================================
CREATE TABLE IF NOT EXISTS pagamentos_prosoluto (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    venda_id UUID NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL, -- 'sinal', 'parcela', 'balao'
    numero_parcela INTEGER,
    valor DECIMAL(15, 2) NOT NULL,
    data_prevista DATE,
    data_pagamento DATE,
    status TEXT DEFAULT 'pendente', -- 'pendente', 'pago', 'atrasado'
    comissao_gerada DECIMAL(15, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_comissoes_venda ON comissoes_venda(venda_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_venda ON pagamentos_prosoluto(venda_id);

-- Adicionar coluna para contrato na venda
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS contrato_url TEXT;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS contrato_nome TEXT;

-- Desabilitar RLS
ALTER TABLE comissoes_venda DISABLE ROW LEVEL SECURITY;
ALTER TABLE pagamentos_prosoluto DISABLE ROW LEVEL SECURITY;

-- =============================================
-- ADICIONAR COLUNAS PRO-SOLUTO (execute se já tem a tabela)
-- =============================================
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS teve_sinal BOOLEAN DEFAULT false;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS valor_sinal DECIMAL(15, 2);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS parcelou_entrada BOOLEAN DEFAULT false;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS qtd_parcelas_entrada INTEGER;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS valor_parcela_entrada DECIMAL(15, 2);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS teve_balao TEXT DEFAULT 'nao' CHECK (teve_balao IN ('nao', 'sim', 'pendente'));
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS valor_balao DECIMAL(15, 2);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS valor_pro_soluto DECIMAL(15, 2);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS fator_comissao DECIMAL(10, 6);

-- =============================================
-- NOTAS SOBRE OS PERCENTUAIS DE COMISSÃO:
-- =============================================
-- 
-- EXTERNO (Total: 7%):
-- - Diretor: 0,5%
-- - Nohros Imobiliária: 0,5%
-- - Nohros Gestão (Ferreti): 1%
-- - WSC (Beton): 0,5%
-- - Corretor Externo: 4%
-- - Coordenadora: 0,5%
--
-- INTERNO (Total: 6,5%):
-- - Diretor: 0,5%
-- - Nohros Imobiliária: 1,25%
-- - Nohros Gestão (Ferreti): 1%
-- - WSC (Beton): 1,25%
-- - Corretor Interno: 2,5%
-- - Coordenadora: 0%
-- =============================================

