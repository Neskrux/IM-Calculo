-- Migration 005: Sistema de Fotos de Empreendimentos
-- Criado em: 2026-01-16

-- =====================================================
-- 1. TABELA DE CATEGORIAS/SETORES DE FOTOS
-- =====================================================

CREATE TABLE IF NOT EXISTS public.foto_categorias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL UNIQUE, -- 'fachada', 'interior', 'planta', etc
  label TEXT NOT NULL, -- 'Fachada', 'Interior', 'Planta Baixa'
  icone TEXT, -- Nome do ícone (opcional)
  cor TEXT, -- Cor para identificação visual
  ordem INTEGER DEFAULT 0,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Categorias padrão
INSERT INTO public.foto_categorias (nome, label, cor, ordem) VALUES
  ('fachada', 'Fachada', '#3b82f6', 1),
  ('interior', 'Áreas Internas', '#10b981', 2),
  ('apartamento', 'Apartamento Modelo', '#8b5cf6', 3),
  ('planta', 'Planta Baixa', '#f59e0b', 4),
  ('area_lazer', 'Área de Lazer', '#ec4899', 5),
  ('area_comum', 'Áreas Comuns', '#06b6d4', 6),
  ('implantacao', 'Implantação', '#6366f1', 7),
  ('perspectiva', 'Perspectiva 3D', '#84cc16', 8),
  ('obra', 'Andamento da Obra', '#ef4444', 9),
  ('outros', 'Outros', '#64748b', 99)
ON CONFLICT (nome) DO NOTHING;

-- =====================================================
-- 2. TABELA DE FOTOS
-- =====================================================

CREATE TABLE IF NOT EXISTS public.empreendimento_fotos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empreendimento_id UUID NOT NULL REFERENCES public.empreendimentos(id) ON DELETE CASCADE,
  
  -- Dados da foto
  url TEXT NOT NULL, -- URL completa do Supabase Storage
  path TEXT NOT NULL, -- Caminho no bucket (ex: empreendimento-123/principal.jpg)
  nome_arquivo TEXT NOT NULL, -- Nome original do arquivo
  tamanho BIGINT, -- Tamanho em bytes
  tipo_mime TEXT, -- image/jpeg, image/png, etc
  
  -- Organização
  ordem INTEGER DEFAULT 0, -- Para ordenar no carrossel/galeria
  categoria_id UUID REFERENCES public.foto_categorias(id), -- FK para categoria
  categoria TEXT DEFAULT 'outros', -- Nome da categoria (fallback)
  descricao TEXT,
  destaque BOOLEAN DEFAULT false, -- Se deve aparecer no carrossel da home
  
  -- Metadados
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES public.usuarios(id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_fotos_empreendimento_id ON public.empreendimento_fotos(empreendimento_id);
CREATE INDEX IF NOT EXISTS idx_fotos_ordem ON public.empreendimento_fotos(empreendimento_id, ordem);
CREATE INDEX IF NOT EXISTS idx_fotos_categoria ON public.empreendimento_fotos(categoria);
CREATE INDEX IF NOT EXISTS idx_fotos_categoria_id ON public.empreendimento_fotos(categoria_id);
CREATE INDEX IF NOT EXISTS idx_fotos_destaque ON public.empreendimento_fotos(destaque) WHERE destaque = true;

-- Comentários
COMMENT ON TABLE public.foto_categorias IS 'Categorias/Setores para organizar fotos de empreendimentos';
COMMENT ON TABLE public.empreendimento_fotos IS 'Fotos dos empreendimentos armazenadas no Supabase Storage';
COMMENT ON COLUMN public.empreendimento_fotos.url IS 'URL pública completa da imagem';
COMMENT ON COLUMN public.empreendimento_fotos.path IS 'Caminho no bucket do Supabase Storage';
COMMENT ON COLUMN public.empreendimento_fotos.categoria IS 'Categoria da foto: fachada, interior, planta, etc';
COMMENT ON COLUMN public.empreendimento_fotos.destaque IS 'Se true, aparece no carrossel da home';

-- =====================================================
-- 3. FUNÇÃO E TRIGGER PARA UPDATED_AT
-- =====================================================

-- Criar função de atualização se não existir
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_fotos_updated_at ON public.empreendimento_fotos;
CREATE TRIGGER update_fotos_updated_at
    BEFORE UPDATE ON public.empreendimento_fotos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 4. POLÍTICAS RLS (Row Level Security)
-- =====================================================

-- Habilitar RLS
ALTER TABLE public.foto_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empreendimento_fotos ENABLE ROW LEVEL SECURITY;

-- Política: Todos podem ler categorias (público)
CREATE POLICY "Categorias são públicas para leitura"
  ON public.foto_categorias
  FOR SELECT
  USING (true);

-- Política: Todos podem ler fotos (público)
CREATE POLICY "Fotos são públicas para leitura"
  ON public.empreendimento_fotos
  FOR SELECT
  USING (true);

-- Política: Apenas autenticados podem inserir
CREATE POLICY "Usuários autenticados podem inserir fotos"
  ON public.empreendimento_fotos
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Política: Apenas autenticados podem atualizar
CREATE POLICY "Usuários autenticados podem atualizar fotos"
  ON public.empreendimento_fotos
  FOR UPDATE
  USING (auth.role() = 'authenticated');

-- Política: Apenas autenticados podem deletar
CREATE POLICY "Usuários autenticados podem deletar fotos"
  ON public.empreendimento_fotos
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- =====================================================
-- VERIFICAÇÃO
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 005 executada com sucesso!';
  RAISE NOTICE '   - Tabela foto_categorias criada (10 categorias padrão)';
  RAISE NOTICE '   - Tabela empreendimento_fotos criada';
  RAISE NOTICE '   - Índices criados';
  RAISE NOTICE '   - RLS habilitado';
END $$;
