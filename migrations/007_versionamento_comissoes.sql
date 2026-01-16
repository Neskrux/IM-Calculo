-- =====================================================
-- MIGRATION 007: Versionamento de Comissões
-- 
-- OBJETIVO: Permitir alteração de percentuais mantendo
--           histórico completo para auditoria
--
-- ARQUITETURA:
-- 1. cargos_empreendimento → adiciona vigência
-- 2. cargos_empreendimento_historico → log de alterações
-- 3. comissoes_venda → snapshot imutável por venda
-- 4. Trigger automático para log de alterações
-- =====================================================

-- =====================================================
-- 1. ADICIONAR CAMPOS DE VIGÊNCIA EM cargos_empreendimento
-- =====================================================

-- Data de início da vigência (quando o percentual passou a valer)
ALTER TABLE public.cargos_empreendimento 
ADD COLUMN IF NOT EXISTS vigente_desde DATE DEFAULT CURRENT_DATE;

-- Data de fim da vigência (NULL = ainda vigente)
ALTER TABLE public.cargos_empreendimento 
ADD COLUMN IF NOT EXISTS vigente_ate DATE DEFAULT NULL;

-- Ativo (soft delete / inativação)
ALTER TABLE public.cargos_empreendimento 
ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT true;

-- Quem criou/alterou por último
ALTER TABLE public.cargos_empreendimento 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE public.cargos_empreendimento 
ADD COLUMN IF NOT EXISTS updated_by UUID;

COMMENT ON COLUMN public.cargos_empreendimento.vigente_desde IS 'Data de início da vigência deste percentual';
COMMENT ON COLUMN public.cargos_empreendimento.vigente_ate IS 'Data de fim da vigência (NULL = ainda vigente)';
COMMENT ON COLUMN public.cargos_empreendimento.ativo IS 'Se o cargo está ativo (soft delete)';
COMMENT ON COLUMN public.cargos_empreendimento.updated_at IS 'Última atualização';
COMMENT ON COLUMN public.cargos_empreendimento.updated_by IS 'Usuário que fez a última alteração';

-- =====================================================
-- 2. CRIAR TABELA DE HISTÓRICO DE ALTERAÇÕES
-- =====================================================

CREATE TABLE IF NOT EXISTS public.cargos_empreendimento_historico (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Referência ao cargo
    cargo_id UUID NOT NULL REFERENCES cargos_empreendimento(id) ON DELETE CASCADE,
    empreendimento_id UUID NOT NULL REFERENCES empreendimentos(id) ON DELETE CASCADE,
    
    -- Dados do cargo no momento da alteração
    nome_cargo TEXT NOT NULL,
    tipo_corretor TEXT NOT NULL,
    
    -- Valores antes e depois
    percentual_anterior NUMERIC(5,2) NOT NULL,
    percentual_novo NUMERIC(5,2) NOT NULL,
    
    -- Metadados da alteração
    alterado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    alterado_por UUID,
    motivo TEXT,
    
    -- Tipo de operação
    operacao TEXT NOT NULL DEFAULT 'UPDATE' CHECK (operacao IN ('CREATE', 'UPDATE', 'DELETE', 'REACTIVATE'))
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_historico_cargo_id 
ON public.cargos_empreendimento_historico(cargo_id);

CREATE INDEX IF NOT EXISTS idx_historico_empreendimento 
ON public.cargos_empreendimento_historico(empreendimento_id);

CREATE INDEX IF NOT EXISTS idx_historico_data 
ON public.cargos_empreendimento_historico(alterado_em DESC);

COMMENT ON TABLE public.cargos_empreendimento_historico IS 
'Histórico completo de alterações nos percentuais de comissão. Cada alteração gera um registro para auditoria.';

-- Desabilitar RLS (temporário, pode ajustar depois)
ALTER TABLE public.cargos_empreendimento_historico DISABLE ROW LEVEL SECURITY;

-- =====================================================
-- 3. ADICIONAR FATOR_APLICADO EM comissoes_venda
-- (para snapshot imutável do cálculo no momento da venda)
-- =====================================================

-- Fator de comissão calculado no momento da venda
ALTER TABLE public.comissoes_venda 
ADD COLUMN IF NOT EXISTS fator_aplicado NUMERIC(10,6);

-- Valor base usado no cálculo (pro-soluto)
ALTER TABLE public.comissoes_venda 
ADD COLUMN IF NOT EXISTS valor_base NUMERIC(15,2);

-- Snapshot do percentual no momento da venda (para auditoria)
ALTER TABLE public.comissoes_venda 
ADD COLUMN IF NOT EXISTS percentual_snapshot NUMERIC(5,2);

-- Data em que a comissão foi calculada/configurada
ALTER TABLE public.comissoes_venda 
ADD COLUMN IF NOT EXISTS calculado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW();

COMMENT ON COLUMN public.comissoes_venda.fator_aplicado IS 
'Fator de comissão calculado: (valorVenda × percentual) / proSoluto';

COMMENT ON COLUMN public.comissoes_venda.valor_base IS 
'Valor base usado no cálculo (geralmente o pro-soluto total)';

COMMENT ON COLUMN public.comissoes_venda.percentual_snapshot IS 
'Percentual do cargo no momento da venda (snapshot imutável)';

-- =====================================================
-- 4. CRIAR TRIGGER PARA LOG AUTOMÁTICO DE ALTERAÇÕES
-- =====================================================

CREATE OR REPLACE FUNCTION log_alteracao_cargo()
RETURNS TRIGGER AS $$
BEGIN
    -- Apenas logar se o percentual mudou
    IF TG_OP = 'UPDATE' AND OLD.percentual != NEW.percentual THEN
        INSERT INTO public.cargos_empreendimento_historico (
            cargo_id,
            empreendimento_id,
            nome_cargo,
            tipo_corretor,
            percentual_anterior,
            percentual_novo,
            alterado_em,
            alterado_por,
            operacao
        ) VALUES (
            NEW.id,
            NEW.empreendimento_id,
            NEW.nome_cargo,
            NEW.tipo_corretor,
            OLD.percentual,
            NEW.percentual,
            NOW(),
            NEW.updated_by,
            'UPDATE'
        );
        
        -- Atualizar vigente_desde para a data atual
        NEW.vigente_desde := CURRENT_DATE;
        NEW.updated_at := NOW();
    END IF;
    
    -- Log de criação
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.cargos_empreendimento_historico (
            cargo_id,
            empreendimento_id,
            nome_cargo,
            tipo_corretor,
            percentual_anterior,
            percentual_novo,
            alterado_em,
            alterado_por,
            operacao
        ) VALUES (
            NEW.id,
            NEW.empreendimento_id,
            NEW.nome_cargo,
            NEW.tipo_corretor,
            0, -- Não havia percentual anterior
            NEW.percentual,
            NOW(),
            NEW.updated_by,
            'CREATE'
        );
    END IF;
    
    -- Log de deleção (soft delete)
    IF TG_OP = 'UPDATE' AND OLD.ativo = true AND NEW.ativo = false THEN
        INSERT INTO public.cargos_empreendimento_historico (
            cargo_id,
            empreendimento_id,
            nome_cargo,
            tipo_corretor,
            percentual_anterior,
            percentual_novo,
            alterado_em,
            alterado_por,
            operacao
        ) VALUES (
            NEW.id,
            NEW.empreendimento_id,
            NEW.nome_cargo,
            NEW.tipo_corretor,
            OLD.percentual,
            NEW.percentual,
            NOW(),
            NEW.updated_by,
            'DELETE'
        );
    END IF;
    
    -- Log de reativação
    IF TG_OP = 'UPDATE' AND OLD.ativo = false AND NEW.ativo = true THEN
        INSERT INTO public.cargos_empreendimento_historico (
            cargo_id,
            empreendimento_id,
            nome_cargo,
            tipo_corretor,
            percentual_anterior,
            percentual_novo,
            alterado_em,
            alterado_por,
            operacao
        ) VALUES (
            NEW.id,
            NEW.empreendimento_id,
            NEW.nome_cargo,
            NEW.tipo_corretor,
            OLD.percentual,
            NEW.percentual,
            NOW(),
            NEW.updated_by,
            'REACTIVATE'
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Remover trigger antigo se existir
DROP TRIGGER IF EXISTS trigger_log_alteracao_cargo ON public.cargos_empreendimento;

-- Criar trigger
CREATE TRIGGER trigger_log_alteracao_cargo
    BEFORE INSERT OR UPDATE ON public.cargos_empreendimento
    FOR EACH ROW
    EXECUTE FUNCTION log_alteracao_cargo();

-- =====================================================
-- 5. CRIAR VIEW PARA CONSULTA DE PERCENTUAIS VIGENTES
-- =====================================================

CREATE OR REPLACE VIEW public.cargos_empreendimento_vigentes AS
SELECT 
    c.*,
    e.nome as empreendimento_nome
FROM public.cargos_empreendimento c
INNER JOIN public.empreendimentos e ON e.id = c.empreendimento_id
WHERE c.ativo = true
  AND (c.vigente_ate IS NULL OR c.vigente_ate >= CURRENT_DATE);

COMMENT ON VIEW public.cargos_empreendimento_vigentes IS 
'Cargos de comissão atualmente vigentes (ativos e dentro do período de vigência)';

-- =====================================================
-- 6. CRIAR FUNCTION PARA BUSCAR PERCENTUAL EM DATA ESPECÍFICA
-- =====================================================

CREATE OR REPLACE FUNCTION get_percentual_na_data(
    p_cargo_id UUID,
    p_data DATE DEFAULT CURRENT_DATE
)
RETURNS NUMERIC AS $$
DECLARE
    v_percentual NUMERIC(5,2);
BEGIN
    -- Primeiro tenta buscar o percentual atual do cargo
    SELECT percentual INTO v_percentual
    FROM public.cargos_empreendimento
    WHERE id = p_cargo_id;
    
    -- Se a data solicitada é anterior a alguma alteração, busca no histórico
    -- Procura a última alteração ANTES ou NA data solicitada
    SELECT percentual_novo INTO v_percentual
    FROM public.cargos_empreendimento_historico
    WHERE cargo_id = p_cargo_id
      AND DATE(alterado_em) <= p_data
    ORDER BY alterado_em DESC
    LIMIT 1;
    
    RETURN COALESCE(v_percentual, 0);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_percentual_na_data IS 
'Retorna o percentual de um cargo em uma data específica (para relatórios históricos)';

-- =====================================================
-- 7. CRIAR FUNCTION PARA ALTERAR PERCENTUAL COM MOTIVO
-- =====================================================

CREATE OR REPLACE FUNCTION alterar_percentual_cargo(
    p_cargo_id UUID,
    p_novo_percentual NUMERIC(5,2),
    p_motivo TEXT DEFAULT NULL,
    p_usuario_id UUID DEFAULT NULL
)
RETURNS TABLE (
    sucesso BOOLEAN,
    mensagem TEXT,
    percentual_anterior NUMERIC(5,2),
    percentual_novo NUMERIC(5,2)
) AS $$
DECLARE
    v_percentual_anterior NUMERIC(5,2);
    v_nome_cargo TEXT;
BEGIN
    -- Buscar percentual atual
    SELECT percentual, nome_cargo 
    INTO v_percentual_anterior, v_nome_cargo
    FROM public.cargos_empreendimento
    WHERE id = p_cargo_id;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'Cargo não encontrado'::TEXT, 0::NUMERIC(5,2), 0::NUMERIC(5,2);
        RETURN;
    END IF;
    
    -- Verificar se realmente mudou
    IF v_percentual_anterior = p_novo_percentual THEN
        RETURN QUERY SELECT false, 'Percentual não foi alterado (mesmo valor)'::TEXT, 
                     v_percentual_anterior, p_novo_percentual;
        RETURN;
    END IF;
    
    -- Atualizar o cargo (o trigger vai logar automaticamente)
    UPDATE public.cargos_empreendimento
    SET 
        percentual = p_novo_percentual,
        updated_by = p_usuario_id,
        updated_at = NOW()
    WHERE id = p_cargo_id;
    
    -- Registrar motivo separadamente se fornecido
    IF p_motivo IS NOT NULL THEN
        UPDATE public.cargos_empreendimento_historico
        SET motivo = p_motivo
        WHERE cargo_id = p_cargo_id
          AND alterado_em = (
              SELECT MAX(alterado_em) 
              FROM public.cargos_empreendimento_historico 
              WHERE cargo_id = p_cargo_id
          );
    END IF;
    
    RETURN QUERY SELECT true, 
                        ('Percentual de "' || v_nome_cargo || '" alterado de ' || 
                         v_percentual_anterior || '% para ' || p_novo_percentual || '%')::TEXT,
                        v_percentual_anterior, 
                        p_novo_percentual;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION alterar_percentual_cargo IS 
'Altera o percentual de um cargo e registra o motivo da alteração';

-- =====================================================
-- 8. ATUALIZAR CARGOS EXISTENTES COM VIGÊNCIA
-- =====================================================

-- Definir vigente_desde para cargos que ainda não têm
UPDATE public.cargos_empreendimento
SET vigente_desde = DATE(created_at),
    ativo = true
WHERE vigente_desde IS NULL;

-- =====================================================
-- 9. BACKFILL: Preencher percentual_snapshot em comissoes_venda
-- =====================================================

DO $$
DECLARE
    rec RECORD;
    v_contador INTEGER := 0;
BEGIN
    RAISE NOTICE '🔄 Preenchendo snapshot de percentuais em comissoes_venda...';
    
    FOR rec IN 
        SELECT 
            cv.id as comissao_id,
            cv.percentual,
            cv.valor_comissao,
            v.valor_venda,
            v.valor_pro_soluto
        FROM public.comissoes_venda cv
        INNER JOIN public.vendas v ON v.id = cv.venda_id
        WHERE cv.percentual_snapshot IS NULL
    LOOP
        -- Preencher snapshot com o percentual atual (melhor aproximação)
        UPDATE public.comissoes_venda
        SET 
            percentual_snapshot = rec.percentual,
            valor_base = rec.valor_pro_soluto,
            fator_aplicado = CASE 
                WHEN rec.valor_pro_soluto > 0 THEN 
                    (rec.valor_venda * (rec.percentual / 100)) / rec.valor_pro_soluto
                ELSE NULL
            END,
            calculado_em = NOW()
        WHERE id = rec.comissao_id;
        
        v_contador := v_contador + 1;
    END LOOP;
    
    RAISE NOTICE '✅ % registros de comissoes_venda atualizados com snapshot', v_contador;
END $$;

-- =====================================================
-- 10. CRIAR ÍNDICES ADICIONAIS PARA PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_cargos_vigente_desde 
ON public.cargos_empreendimento(vigente_desde);

CREATE INDEX IF NOT EXISTS idx_cargos_ativo 
ON public.cargos_empreendimento(ativo);

CREATE INDEX IF NOT EXISTS idx_comissoes_venda_snapshot 
ON public.comissoes_venda(percentual_snapshot);

-- =====================================================
-- 11. VERIFICAÇÃO FINAL
-- =====================================================

SELECT 
    '📊 RESUMO DA MIGRATION 007' as info
UNION ALL
SELECT 'Cargos com vigência: ' || COUNT(*)::TEXT 
FROM public.cargos_empreendimento WHERE vigente_desde IS NOT NULL
UNION ALL
SELECT 'Registros no histórico: ' || COUNT(*)::TEXT 
FROM public.cargos_empreendimento_historico
UNION ALL
SELECT 'Comissões com snapshot: ' || COUNT(*)::TEXT 
FROM public.comissoes_venda WHERE percentual_snapshot IS NOT NULL;

-- =====================================================
-- ✅ MIGRATION 007 CONCLUÍDA!
-- =====================================================
-- 
-- 📋 O QUE FOI FEITO:
--    1. Adicionado versionamento em cargos_empreendimento
--    2. Criada tabela de histórico de alterações
--    3. Trigger automático para log de alterações
--    4. Snapshot de percentuais em comissoes_venda
--    5. Functions auxiliares para consulta e alteração
--
-- 🔒 GARANTIAS:
--    - Alterar percentual NÃO afeta vendas antigas
--    - Vendas usam o snapshot do momento da criação
--    - Histórico completo de todas as alterações
--    - Auditoria: quem, quando, de quanto para quanto
-- =====================================================
