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

