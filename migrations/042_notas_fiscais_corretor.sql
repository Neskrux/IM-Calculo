-- Migration 042: Nota fiscal do corretor (envio + acompanhamento de quem mandou)
-- Criada em: 2026-08-31
--
-- Spec:  docs/specs/2026-08-31-spec-nota-fiscal-corretor.md
-- Doc:   docs/features/2026-08-31-nota-fiscal-corretor.md
-- ADRs:  docs/adr/0001-uma-nota-por-competencia.md
--        docs/adr/0002-bucket-privado-para-notas-fiscais.md
--
-- Contexto: a coleta hoje e um JotForm fora do sistema, que nem pergunta a que
-- mes a nota se refere. Sem competencia explicita nao existe "quem nao mandou".
--
-- APLICADA EM PRODUCAO em 2026-08-31 (OK do Jonas), projeto jdkkusrxullttyeakwib.
-- Verificada com controle positivo e negativo: bucket false (documentos=true na
-- mesma query), RLS true (vendas=false), indice UNIQUE presente, e as duas CHECKs
-- testadas ATIVAMENTE — segunda nota do mesmo mes deu 23505, competencia dia 15
-- deu 23514. Linhas de teste removidas; tabela zerada.

-- =====================================================
-- 1. TABELA
-- =====================================================

CREATE TABLE IF NOT EXISTS public.notas_fiscais_corretor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- OBRIGADO: de quem e a nota. Sempre usuarios.id.
  corretor_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,

  -- COMPETENCIA: o mes a que a nota se refere, canonicamente o dia 1.
  -- Uma nota NUNCA cobre mais de um mes (ADR 0001).
  competencia DATE NOT NULL,

  -- EMISSOR: autonomo emite como PF (CPF); imobiliaria emite como PJ (CNPJ).
  tipo_emissor TEXT NOT NULL CHECK (tipo_emissor IN ('autonomo', 'imobiliaria')),
  documento TEXT NOT NULL,                -- so digitos: 11 (CPF) ou 14 (CNPJ)
  nome_imobiliaria TEXT,                  -- texto livre, declarado no envio; obrigatorio se PJ

  telefone TEXT NOT NULL,
  chave_pix TEXT NOT NULL,
  valor_declarado NUMERIC(15, 2) NOT NULL CHECK (valor_declarado > 0),

  arquivo_path TEXT NOT NULL,             -- caminho no bucket privado 'notas-fiscais'
  arquivo_nome TEXT,
  arquivo_tamanho BIGINT,
  arquivo_tipo_mime TEXT,

  -- OBSERVACAO DA NOTA: pertence a esta nota, nunca ao corretor nem ao mes.
  observacao TEXT,

  -- Quem de fato gravou. Igual a corretor_id no envio proprio; diferente quando
  -- a controladoria envia em nome do corretor (D11). Dois campos, nunca um so.
  criado_por UUID NOT NULL REFERENCES public.usuarios(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- competencia e um MES: comparar mes vira comparar igualdade
  CONSTRAINT competencia_e_primeiro_dia_do_mes
    CHECK (EXTRACT(DAY FROM competencia) = 1),

  -- documento coerente com o emissor
  CONSTRAINT documento_casa_com_emissor CHECK (
    (tipo_emissor = 'autonomo'    AND length(documento) = 11) OR
    (tipo_emissor = 'imobiliaria' AND length(documento) = 14)
  ),

  -- PJ sem o nome da imobiliaria nao entra
  CONSTRAINT imobiliaria_exige_nome CHECK (
    tipo_emissor <> 'imobiliaria' OR COALESCE(btrim(nome_imobiliaria), '') <> ''
  )
);

-- A INVARIANTE. Vale por qualquer caminho de escrita, nao so pelo formulario.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nf_corretor_competencia_unica
  ON public.notas_fiscais_corretor (corretor_id, competencia);

CREATE INDEX IF NOT EXISTS idx_nf_competencia
  ON public.notas_fiscais_corretor (competencia);

COMMENT ON TABLE public.notas_fiscais_corretor IS
  'Nota fiscal que o corretor emite contra a IM pela comissao. Uma por corretor por competencia (indice unico). O acompanhamento de quem nao enviou deriva de usuarios ativos MENOS esta tabela — nunca de pagamentos_prosoluto.';

COMMENT ON COLUMN public.notas_fiscais_corretor.competencia IS
  'Mes a que a nota se refere, sempre no dia 1. Uma nota nunca cobre mais de um mes.';

COMMENT ON COLUMN public.notas_fiscais_corretor.criado_por IS
  'Quem gravou. Diferente de corretor_id quando a controladoria envia em nome do corretor.';

CREATE OR REPLACE FUNCTION public.tg_notas_fiscais_corretor_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notas_fiscais_corretor_updated_at ON public.notas_fiscais_corretor;
CREATE TRIGGER trg_notas_fiscais_corretor_updated_at
  BEFORE UPDATE ON public.notas_fiscais_corretor
  FOR EACH ROW EXECUTE FUNCTION public.tg_notas_fiscais_corretor_updated_at();

-- =====================================================
-- 2. RLS DA TABELA (molde de solicitacoes — migration 004)
-- =====================================================
-- Nota carrega CNPJ, valor e tomador: um corretor nao le a do outro.

ALTER TABLE public.notas_fiscais_corretor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nf_select_dono_ou_admin" ON public.notas_fiscais_corretor;
CREATE POLICY "nf_select_dono_ou_admin"
ON public.notas_fiscais_corretor FOR SELECT
TO authenticated
USING (
  corretor_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.tipo = 'admin')
);

-- O corretor insere so pra si (e como ele mesmo). O admin insere por qualquer um,
-- mas sempre carimbando a si proprio em criado_por.
DROP POLICY IF EXISTS "nf_insert_dono_ou_admin" ON public.notas_fiscais_corretor;
CREATE POLICY "nf_insert_dono_ou_admin"
ON public.notas_fiscais_corretor FOR INSERT
TO authenticated
WITH CHECK (
  criado_por = auth.uid()
  AND (
    corretor_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.tipo = 'admin')
  )
);

-- v1 nao tem edicao nem exclusao pela aplicacao (ADR 0001): correcao passa pela
-- controladoria. Sem policy de UPDATE/DELETE, ninguem altera pelo cliente.

-- =====================================================
-- 3. BUCKET PRIVADO (ADR 0002)
-- =====================================================
-- Convencao de caminho: 'notas-fiscais/{usuarios.id}/{YYYY-MM}/{arquivo}'.
-- A pasta raiz e o id do dono — e disso que as policies dependem.

INSERT INTO storage.buckets (id, name, public)
VALUES ('notas-fiscais', 'notas-fiscais', false)
ON CONFLICT (id) DO NOTHING;

-- 3.1 ANTES DE TUDO: tirar o bucket novo do alcance do "Permitir tudo".
--
-- Medido em 2026-08-31: storage.objects tem 4 policies 'Permitir tudo 1ra9fyl_*'
-- com roles={public} e regra `true` — sem filtro de bucket e sem filtro de dono.
-- Policies sao SOMADAS (OR): enquanto elas existirem cobrindo este bucket,
-- qualquer policy escopada que a gente escreva abaixo e decorativa, e um corretor
-- leria a nota do outro.
--
-- Aqui elas sao apenas RE-ESCOPADAS para excluir 'notas-fiscais'. Isso e no-op
-- comprovado para todo o resto: o bucket 'notas-fiscais' esta sendo criado nesta
-- mesma migration, entao NENHUM consumidor existente depende dele. O buraco geral
-- (todos os outros buckets seguem cobertos por 'true') NAO e tocado aqui — e
-- problema proprio, maior que esta feature, e exige decisao separada.

DROP POLICY IF EXISTS "Permitir tudo 1ra9fyl_0" ON storage.objects;
CREATE POLICY "Permitir tudo 1ra9fyl_0"
ON storage.objects FOR SELECT TO public
USING (bucket_id <> 'notas-fiscais');

DROP POLICY IF EXISTS "Permitir tudo 1ra9fyl_1" ON storage.objects;
CREATE POLICY "Permitir tudo 1ra9fyl_1"
ON storage.objects FOR UPDATE TO public
USING (bucket_id <> 'notas-fiscais');

DROP POLICY IF EXISTS "Permitir tudo 1ra9fyl_2" ON storage.objects;
CREATE POLICY "Permitir tudo 1ra9fyl_2"
ON storage.objects FOR DELETE TO public
USING (bucket_id <> 'notas-fiscais');

DROP POLICY IF EXISTS "Permitir tudo 1ra9fyl_3" ON storage.objects;
CREATE POLICY "Permitir tudo 1ra9fyl_3"
ON storage.objects FOR INSERT TO public
WITH CHECK (bucket_id <> 'notas-fiscais');

-- 3.2 Agora sim, as policies de dono valem sozinhas neste bucket.
DROP POLICY IF EXISTS "nf_bucket_select_dono_ou_admin" ON storage.objects;
CREATE POLICY "nf_bucket_select_dono_ou_admin"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'notas-fiscais'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.tipo = 'admin')
  )
);

DROP POLICY IF EXISTS "nf_bucket_insert_dono_ou_admin" ON storage.objects;
CREATE POLICY "nf_bucket_insert_dono_ou_admin"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'notas-fiscais'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.tipo = 'admin')
  )
);

-- Sem policy de UPDATE/DELETE no bucket: nota enviada nao se apaga pelo cliente.
