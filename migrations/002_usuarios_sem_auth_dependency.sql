-- =============================================
-- MIGRATION: Remover dependência de Auth para usuarios
-- Permite criar corretores sincronizados SEM Supabase Auth
-- =============================================

-- =============================================
-- PASSO 1: Adicionar default UUID para usuarios.id
-- Isso permite inserir usuários sem passar pelo Auth
-- =============================================

-- Verificar se a extensão uuid-ossp está habilitada
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Adicionar default para id (se não tiver)
-- Isso NÃO quebra usuários existentes que vieram do Auth
ALTER TABLE public.usuarios
    ALTER COLUMN id SET DEFAULT uuid_generate_v4();

-- =============================================
-- PASSO 2: Garantir que sienge_broker_id tenha índice único
-- Para upsert funcionar corretamente
-- =============================================

-- Criar índice único se não existir
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_sienge_broker_id 
ON public.usuarios(sienge_broker_id) 
WHERE sienge_broker_id IS NOT NULL;

-- =============================================
-- PASSO 3: Adicionar campos extras para corretores sincronizados
-- =============================================

-- Campo para indicar origem do usuário
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'usuarios' 
                   AND column_name = 'origem') THEN
        ALTER TABLE public.usuarios ADD COLUMN origem TEXT DEFAULT 'manual';
    END IF;
END $$;

COMMENT ON COLUMN public.usuarios.origem IS 'Origem do cadastro: manual, sienge, importacao';

-- Campo para CPF (se não existir)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'usuarios' 
                   AND column_name = 'cpf') THEN
        ALTER TABLE public.usuarios ADD COLUMN cpf TEXT;
    END IF;
END $$;

-- Campo para CNPJ (se não existir)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'usuarios' 
                   AND column_name = 'cnpj') THEN
        ALTER TABLE public.usuarios ADD COLUMN cnpj TEXT;
    END IF;
END $$;

-- Campo para endereço (se não existir)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'usuarios' 
                   AND column_name = 'endereco') THEN
        ALTER TABLE public.usuarios ADD COLUMN endereco TEXT;
    END IF;
END $$;

-- Campo para nome fantasia (se não existir)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'usuarios' 
                   AND column_name = 'nome_fantasia') THEN
        ALTER TABLE public.usuarios ADD COLUMN nome_fantasia TEXT;
    END IF;
END $$;

-- =============================================
-- PASSO 4: Função para upsert de corretor (SEM Auth)
-- =============================================

CREATE OR REPLACE FUNCTION public.upsert_corretor_sienge(
    p_sienge_broker_id TEXT,
    p_nome TEXT,
    p_email TEXT DEFAULT NULL,
    p_telefone TEXT DEFAULT NULL,
    p_cpf TEXT DEFAULT NULL,
    p_cnpj TEXT DEFAULT NULL,
    p_endereco TEXT DEFAULT NULL,
    p_nome_fantasia TEXT DEFAULT NULL,
    p_tipo_corretor TEXT DEFAULT 'externo',
    p_ativo BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    usuario_id UUID,
    acao TEXT -- 'inserted' | 'updated' | 'unchanged'
) AS $$
DECLARE
    v_id UUID;
    v_acao TEXT;
    v_email_final TEXT;
BEGIN
    -- Gerar email fake determinístico se não tiver
    v_email_final := COALESCE(
        NULLIF(TRIM(p_email), ''),
        'corretor.' || p_sienge_broker_id || '@sync.local'
    );
    
    -- Verificar se já existe
    SELECT id INTO v_id
    FROM public.usuarios
    WHERE sienge_broker_id = p_sienge_broker_id;
    
    IF v_id IS NULL THEN
        -- Não existe, inserir
        INSERT INTO public.usuarios (
            id,
            sienge_broker_id,
            nome,
            email,
            telefone,
            cpf,
            cnpj,
            endereco,
            nome_fantasia,
            tipo,
            tipo_corretor,
            ativo,
            origem,
            created_at,
            updated_at
        ) VALUES (
            uuid_generate_v4(),
            p_sienge_broker_id,
            COALESCE(p_nome, 'Corretor ' || p_sienge_broker_id),
            v_email_final,
            p_telefone,
            p_cpf,
            p_cnpj,
            p_endereco,
            p_nome_fantasia,
            'corretor',
            COALESCE(p_tipo_corretor, 'externo'),
            p_ativo,
            'sienge',
            NOW(),
            NOW()
        )
        RETURNING id INTO v_id;
        
        v_acao := 'inserted';
    ELSE
        -- Existe, atualizar
        UPDATE public.usuarios
        SET nome = COALESCE(p_nome, nome),
            email = COALESCE(NULLIF(TRIM(p_email), ''), email),
            telefone = COALESCE(p_telefone, telefone),
            cpf = COALESCE(p_cpf, cpf),
            cnpj = COALESCE(p_cnpj, cnpj),
            endereco = COALESCE(p_endereco, endereco),
            nome_fantasia = COALESCE(p_nome_fantasia, nome_fantasia),
            tipo_corretor = COALESCE(p_tipo_corretor, tipo_corretor),
            ativo = COALESCE(p_ativo, ativo),
            updated_at = NOW()
        WHERE id = v_id;
        
        v_acao := 'updated';
    END IF;
    
    RETURN QUERY SELECT v_id, v_acao;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- PASSO 5: Função para criar corretor placeholder
-- Usado quando venda referencia corretor que não existe
-- =============================================

CREATE OR REPLACE FUNCTION public.get_or_create_corretor_placeholder(
    p_sienge_broker_id TEXT,
    p_nome TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    -- Tentar encontrar existente
    SELECT id INTO v_id
    FROM public.usuarios
    WHERE sienge_broker_id = p_sienge_broker_id;
    
    IF v_id IS NULL THEN
        -- Criar placeholder
        INSERT INTO public.usuarios (
            id,
            sienge_broker_id,
            nome,
            email,
            tipo,
            tipo_corretor,
            ativo,
            origem
        ) VALUES (
            uuid_generate_v4(),
            p_sienge_broker_id,
            COALESCE(p_nome, 'Corretor Sienge #' || p_sienge_broker_id),
            'corretor.' || p_sienge_broker_id || '@placeholder.local',
            'corretor',
            'externo',
            TRUE,
            'sienge'
        )
        RETURNING id INTO v_id;
    END IF;
    
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- GRANT para funções
-- =============================================
GRANT EXECUTE ON FUNCTION public.upsert_corretor_sienge TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_or_create_corretor_placeholder TO authenticated, service_role;

