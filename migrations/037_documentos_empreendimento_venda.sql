-- Migration 037: Documentos do empreendimento e da venda
-- Criado em: 2026-08-04
--
-- Contexto: portal do cliente precisa exibir a documentação do imóvel
-- (registro de incorporação, matrícula da obra, alvará, memorial descritivo)
-- e os documentos da compra (contrato, aditivos). Fotos já existem em
-- empreendimento_fotos (categorias: fachada, planta, etc. — migrations 005/007);
-- esta migration cobre a parte documental (PDFs no bucket 'documentos').

-- =====================================================
-- 1. DOCUMENTOS DO EMPREENDIMENTO
-- =====================================================

CREATE TABLE IF NOT EXISTS public.empreendimento_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empreendimento_id UUID NOT NULL REFERENCES public.empreendimentos(id) ON DELETE CASCADE,

  -- registro_incorporacao, matricula_obra, alvara, memorial_descritivo,
  -- manual_proprietario, convencao_condominio, outros
  categoria TEXT NOT NULL DEFAULT 'outros',
  titulo TEXT NOT NULL,

  url TEXT NOT NULL,
  path TEXT,               -- caminho no bucket 'documentos' (pra remoção)
  nome_arquivo TEXT,
  tamanho BIGINT,
  tipo_mime TEXT,

  -- controla se o cliente vê no portal (admin sempre vê tudo)
  visivel_cliente BOOLEAN NOT NULL DEFAULT TRUE,
  ordem INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emp_docs_empreendimento
  ON public.empreendimento_documentos(empreendimento_id);

COMMENT ON TABLE public.empreendimento_documentos IS
  'Documentação do empreendimento (registro, matrícula, alvará, memorial) exibida no portal do cliente quando visivel_cliente=true';

-- =====================================================
-- 2. DOCUMENTOS DA VENDA (contrato do cliente, aditivos)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.venda_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venda_id UUID NOT NULL REFERENCES public.vendas(id) ON DELETE CASCADE,

  -- contrato, aditivo, distrato, quitacao, outros
  categoria TEXT NOT NULL DEFAULT 'contrato',
  titulo TEXT NOT NULL,

  url TEXT NOT NULL,
  path TEXT,
  nome_arquivo TEXT,
  tamanho BIGINT,
  tipo_mime TEXT,

  visivel_cliente BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_venda_docs_venda
  ON public.venda_documentos(venda_id);

COMMENT ON TABLE public.venda_documentos IS
  'Documentos da venda (contrato assinado, aditivos, distrato) exibidos no portal do cliente quando visivel_cliente=true';
