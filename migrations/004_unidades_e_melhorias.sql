-- Migration 004: Unidades e Melhorias de Sincronização
-- Criado em: 2026-01-15

-- =====================================================
-- 1. TABELA DE UNIDADES
-- =====================================================

CREATE TABLE IF NOT EXISTS public.unidades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sienge_unit_id TEXT UNIQUE,
  empreendimento_id UUID REFERENCES public.empreendimentos(id),
  sienge_enterprise_id TEXT,
  
  -- Dados da unidade
  nome TEXT NOT NULL,
  bloco TEXT,
  andar TEXT,
  numero TEXT,
  tipo TEXT, -- apartamento, sala, loja, etc.
  area_privativa DECIMAL(10,2),
  area_comum DECIMAL(10,2),
  area_total DECIMAL(10,2),
  
  -- Status
  status TEXT DEFAULT 'disponivel', -- disponivel, reservada, vendida
  valor_tabela DECIMAL(15,2),
  
  -- Metadados
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  sienge_updated_at TIMESTAMPTZ
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_unidades_sienge_unit_id ON public.unidades(sienge_unit_id);
CREATE INDEX IF NOT EXISTS idx_unidades_empreendimento_id ON public.unidades(empreendimento_id);
CREATE INDEX IF NOT EXISTS idx_unidades_status ON public.unidades(status);

-- Comentários
COMMENT ON TABLE public.unidades IS 'Unidades dos empreendimentos sincronizadas do Sienge';
COMMENT ON COLUMN public.unidades.sienge_unit_id IS 'ID da unidade no Sienge - chave de sincronização';

-- =====================================================
-- 2. MELHORIAS NA TABELA USUARIOS (CORRETORES)
-- =====================================================

-- Adicionar campos extras para corretores
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS telefone TEXT;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS celular TEXT;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS endereco_completo TEXT;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS estado TEXT;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS cep TEXT;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS observacoes TEXT;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS sienge_updated_at TIMESTAMPTZ;

-- =====================================================
-- 3. MELHORIAS NA TABELA CLIENTES
-- =====================================================

-- Adicionar campos extras para clientes
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS cnpj TEXT;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS cep TEXT;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS estado TEXT;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS data_nascimento DATE;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS rg TEXT;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS profissao TEXT;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS sienge_updated_at TIMESTAMPTZ;

-- =====================================================
-- 4. MELHORIAS NA TABELA COMPLEMENTADORES_RENDA
-- =====================================================

-- Adicionar campo para identificar cônjuge do Sienge
ALTER TABLE public.complementadores_renda ADD COLUMN IF NOT EXISTS sienge_spouse_id TEXT;
ALTER TABLE public.complementadores_renda ADD COLUMN IF NOT EXISTS profissao TEXT;
ALTER TABLE public.complementadores_renda ADD COLUMN IF NOT EXISTS data_nascimento DATE;
ALTER TABLE public.complementadores_renda ADD COLUMN IF NOT EXISTS rg TEXT;
ALTER TABLE public.complementadores_renda ADD COLUMN IF NOT EXISTS origem TEXT DEFAULT 'manual'; -- 'manual' ou 'sienge'

-- =====================================================
-- 5. VINCULAR VENDAS A UNIDADES
-- =====================================================

-- Adicionar referência de unidade na venda
ALTER TABLE public.vendas ADD COLUMN IF NOT EXISTS unidade_id UUID REFERENCES public.unidades(id);

-- =====================================================
-- 6. TRIGGER PARA UPDATED_AT
-- =====================================================

-- Função para atualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para unidades
DROP TRIGGER IF EXISTS update_unidades_updated_at ON public.unidades;
CREATE TRIGGER update_unidades_updated_at
    BEFORE UPDATE ON public.unidades
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- VERIFICAÇÃO
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 004 executada com sucesso!';
  RAISE NOTICE '   - Tabela unidades criada';
  RAISE NOTICE '   - Campos extras em usuarios adicionados';
  RAISE NOTICE '   - Campos extras em clientes adicionados';
  RAISE NOTICE '   - Campos extras em complementadores_renda adicionados';
END $$;
