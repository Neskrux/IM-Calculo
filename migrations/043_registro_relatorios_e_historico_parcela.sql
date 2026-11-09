-- Migration 043: o IM Calculo prova o que emitiu
-- Criada em: 2026-11-09
-- Spec: docs/specs/2026-11-09-spec-registro-relatorios.md
--
-- 1. relatorios_emitidos  — registro append-only de toda emissao de relatorio (admin e corretor)
-- 2. bucket privado 'relatorios' — o PDF emitido, lido so por signed URL
-- 3. pagamentos_prosoluto_historico + trigger — antes/depois de status, valor,
--    comissao_gerada e data_pagamento, quem mudou e quando
--
-- NAO aplicar com apply_migration. Producao: SQL Editor, depois do PR aprovado.
-- Provada em homologacao (ibscxvkgrdyzlgtgbbuz) dentro de begin ... rollback.

-- =====================================================
-- 1. REGISTRO DE EMISSAO
-- =====================================================

CREATE TABLE IF NOT EXISTS public.relatorios_emitidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emitido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- quem gerou: sempre o usuario da sessao, nunca o que o cliente mandar (policy de INSERT confere)
  emitido_por UUID NOT NULL DEFAULT auth.uid() REFERENCES public.usuarios(id),
  origem TEXT NOT NULL CHECK (origem IN ('admin', 'corretor', 'admin_ver_pdf_corretor')),
  -- de quem e o relatorio (chave da RLS). NULL = relatorio geral do admin.
  corretor_id UUID REFERENCES public.usuarios(id),
  filtros JSONB NOT NULL,
  total NUMERIC(15, 2) NOT NULL,
  pago NUMERIC(15, 2) NOT NULL,
  pendente NUMERIC(15, 2) NOT NULL,
  -- [{id, venda_id, valor, comissao, status}] — os numeros IMPRESSOS no PDF
  parcelas JSONB NOT NULL,
  qtd_parcelas INT NOT NULL,
  pdf_path TEXT NOT NULL,
  pdf_sha256 TEXT NOT NULL,
  versao_app TEXT
);

CREATE INDEX IF NOT EXISTS idx_relatorios_emitidos_corretor
  ON public.relatorios_emitidos (corretor_id, emitido_em DESC);
CREATE INDEX IF NOT EXISTS idx_relatorios_emitidos_emitido_em
  ON public.relatorios_emitidos (emitido_em DESC);

COMMENT ON TABLE public.relatorios_emitidos IS
  'Prova de emissao: filtros, totais e parcelas exatamente como sairam no PDF. Append-only (trigger bloqueia UPDATE/DELETE, inclusive service_role).';

-- Registro de prova nao se edita nem se apaga — por nenhum caminho.
CREATE OR REPLACE FUNCTION public.tg_relatorios_emitidos_imutavel()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'relatorios_emitidos e append-only: % bloqueado', TG_OP
    USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_relatorios_emitidos_imutavel ON public.relatorios_emitidos;
CREATE TRIGGER trg_relatorios_emitidos_imutavel
  BEFORE UPDATE OR DELETE ON public.relatorios_emitidos
  FOR EACH ROW EXECUTE FUNCTION public.tg_relatorios_emitidos_imutavel();

ALTER TABLE public.relatorios_emitidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rel_select_dono_ou_admin" ON public.relatorios_emitidos;
CREATE POLICY "rel_select_dono_ou_admin"
ON public.relatorios_emitidos FOR SELECT
TO authenticated
USING (
  corretor_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.tipo = 'admin')
);

-- Corretor registra so o proprio relatorio; admin registra qualquer um. Sempre como si mesmo.
DROP POLICY IF EXISTS "rel_insert_dono_ou_admin" ON public.relatorios_emitidos;
CREATE POLICY "rel_insert_dono_ou_admin"
ON public.relatorios_emitidos FOR INSERT
TO authenticated
WITH CHECK (
  emitido_por = auth.uid()
  AND (
    corretor_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.tipo = 'admin')
  )
);

-- =====================================================
-- 2. BUCKET PRIVADO 'relatorios'
-- =====================================================
-- Caminho: '{corretor_id | geral}/{relatorio_id}.pdf'. A pasta raiz e o dono.

INSERT INTO storage.buckets (id, name, public)
VALUES ('relatorios', 'relatorios', false)
ON CONFLICT (id) DO NOTHING;

-- 2.1 Tirar 'relatorios' do alcance das policies "Permitir tudo" (roles=public, sem filtro de dono).
-- Policies somam (OR): sem isso a policy de dono abaixo seria decorativa.
-- ALTER (nao DROP/CREATE): so mexe onde a policy existe — em homologacao ela nao existe.
-- Bucket novo => nenhum consumidor depende dele => no-op para o resto.
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT policyname, cmd FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN ('Permitir tudo 1ra9fyl_0','Permitir tudo 1ra9fyl_1',
                         'Permitir tudo 1ra9fyl_2','Permitir tudo 1ra9fyl_3')
  LOOP
    IF p.cmd = 'INSERT' THEN
      EXECUTE format('ALTER POLICY %I ON storage.objects WITH CHECK (bucket_id NOT IN (''notas-fiscais'',''relatorios''))', p.policyname);
    ELSE
      EXECUTE format('ALTER POLICY %I ON storage.objects USING (bucket_id NOT IN (''notas-fiscais'',''relatorios''))', p.policyname);
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS "rel_bucket_select_dono_ou_admin" ON storage.objects;
CREATE POLICY "rel_bucket_select_dono_ou_admin"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'relatorios'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.tipo = 'admin')
  )
);

DROP POLICY IF EXISTS "rel_bucket_insert_dono_ou_admin" ON storage.objects;
CREATE POLICY "rel_bucket_insert_dono_ou_admin"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'relatorios'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.tipo = 'admin')
  )
);
-- Sem UPDATE/DELETE no bucket: PDF emitido nao se troca nem se apaga pelo cliente.

-- =====================================================
-- 3. HISTORICO DE PARCELA
-- =====================================================

CREATE TABLE IF NOT EXISTS public.pagamentos_prosoluto_historico (
  id BIGSERIAL PRIMARY KEY,
  pagamento_id UUID NOT NULL,          -- sem FK: o historico sobrevive ao DELETE da parcela
  venda_id UUID,
  operacao TEXT NOT NULL CHECK (operacao IN ('UPDATE', 'DELETE')),
  antes JSONB NOT NULL,
  depois JSONB,                        -- NULL em DELETE
  mudado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mudado_por UUID,                     -- auth.uid(); NULL quando sync/service_role
  origem TEXT NOT NULL                 -- 'usuario' | 'sync' | valor de app.origem (ex.: 'reconciliador')
);

CREATE INDEX IF NOT EXISTS idx_pp_hist_pagamento
  ON public.pagamentos_prosoluto_historico (pagamento_id, mudado_em DESC);
CREATE INDEX IF NOT EXISTS idx_pp_hist_venda
  ON public.pagamentos_prosoluto_historico (venda_id);

COMMENT ON TABLE public.pagamentos_prosoluto_historico IS
  'Antes/depois de status, valor, comissao_gerada e data_pagamento de cada parcela. Comeca no deploy da 043 (sem backfill).';

CREATE OR REPLACE FUNCTION public.tg_pagamentos_prosoluto_historico()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_antes JSONB;
  v_depois JSONB;
  v_uid UUID := auth.uid();
  v_origem TEXT := NULLIF(current_setting('app.origem', true), '');
BEGIN
  v_antes := jsonb_build_object(
    'status', OLD.status, 'valor', OLD.valor,
    'comissao_gerada', OLD.comissao_gerada, 'data_pagamento', OLD.data_pagamento);

  IF TG_OP = 'UPDATE' THEN
    v_depois := jsonb_build_object(
      'status', NEW.status, 'valor', NEW.valor,
      'comissao_gerada', NEW.comissao_gerada, 'data_pagamento', NEW.data_pagamento);
    IF v_antes = v_depois THEN
      RETURN NEW;  -- nada dos 4 campos mudou: nao loga
    END IF;
  END IF;

  INSERT INTO public.pagamentos_prosoluto_historico
    (pagamento_id, venda_id, operacao, antes, depois, mudado_por, origem)
  VALUES
    (OLD.id, OLD.venda_id, TG_OP, v_antes, v_depois, v_uid,
     COALESCE(v_origem, CASE WHEN v_uid IS NULL THEN 'sync' ELSE 'usuario' END));

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pagamentos_prosoluto_historico ON public.pagamentos_prosoluto;
CREATE TRIGGER trg_pagamentos_prosoluto_historico
  AFTER UPDATE OR DELETE ON public.pagamentos_prosoluto
  FOR EACH ROW EXECUTE FUNCTION public.tg_pagamentos_prosoluto_historico();

ALTER TABLE public.pagamentos_prosoluto_historico ENABLE ROW LEVEL SECURITY;

-- Admin le tudo; corretor le o historico das parcelas das vendas dele.
-- Sem policy de INSERT/UPDATE/DELETE: so o trigger (SECURITY DEFINER) escreve.
DROP POLICY IF EXISTS "pp_hist_select_dono_ou_admin" ON public.pagamentos_prosoluto_historico;
CREATE POLICY "pp_hist_select_dono_ou_admin"
ON public.pagamentos_prosoluto_historico FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.tipo = 'admin')
  OR EXISTS (SELECT 1 FROM public.vendas v WHERE v.id = venda_id AND v.corretor_id = auth.uid())
);
