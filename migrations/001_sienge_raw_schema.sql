-- =============================================
-- MIGRATION: Schema sienge_raw
-- Camada RAW para ingestão 100% dos dados do Sienge
-- Sem regras, sem FK, sem Auth - apenas JSON bruto
-- =============================================

-- Criar schema dedicado para dados RAW
CREATE SCHEMA IF NOT EXISTS sienge_raw;

-- =============================================
-- TABELA: runs
-- Registra cada execução de sincronização
-- =============================================
CREATE TABLE IF NOT EXISTS sienge_raw.runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ NULL,
    status TEXT NOT NULL DEFAULT 'RUNNING', -- RUNNING | OK | PARTIAL | ERROR
    params JSONB NOT NULL DEFAULT '{}'::jsonb,
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    error JSONB NULL
);

COMMENT ON TABLE sienge_raw.runs IS 'Registra cada execução de sincronização com Sienge';
COMMENT ON COLUMN sienge_raw.runs.status IS 'RUNNING=em andamento, OK=sucesso total, PARTIAL=sucesso parcial, ERROR=falha';
COMMENT ON COLUMN sienge_raw.runs.params IS 'Parâmetros usados na execução (enterpriseId, endpoints, etc)';
COMMENT ON COLUMN sienge_raw.runs.metrics IS 'Métricas da execução (total, criados, atualizados, erros)';

-- =============================================
-- TABELA: objects
-- Armazena JSON bruto de cada objeto do Sienge
-- =============================================
CREATE TABLE IF NOT EXISTS sienge_raw.objects (
    entity TEXT NOT NULL,           -- 'creditors' | 'customers' | 'sales-contracts'
    sienge_id TEXT NOT NULL,        -- ID do registro no Sienge
    enterprise_id TEXT NULL,        -- Quando existir (para filtros)
    payload JSONB NOT NULL,         -- JSON completo do Sienge
    payload_hash TEXT NOT NULL,     -- Hash MD5 para detectar mudanças
    source_url TEXT NULL,           -- URL da requisição que trouxe o dado
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    run_id UUID NULL REFERENCES sienge_raw.runs(id),
    PRIMARY KEY (entity, sienge_id)
);

COMMENT ON TABLE sienge_raw.objects IS 'JSON bruto de cada objeto sincronizado do Sienge';
COMMENT ON COLUMN sienge_raw.objects.entity IS 'Tipo do objeto: creditors, customers, sales-contracts';
COMMENT ON COLUMN sienge_raw.objects.payload IS 'JSON completo retornado pela API do Sienge';
COMMENT ON COLUMN sienge_raw.objects.payload_hash IS 'MD5 do payload para detectar mudanças sem comparar JSON inteiro';

-- =============================================
-- ÍNDICES para performance
-- =============================================
CREATE INDEX IF NOT EXISTS idx_raw_entity ON sienge_raw.objects(entity);
CREATE INDEX IF NOT EXISTS idx_raw_synced_at ON sienge_raw.objects(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_enterprise ON sienge_raw.objects(enterprise_id) WHERE enterprise_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_run ON sienge_raw.objects(run_id) WHERE run_id IS NOT NULL;

-- Índice GIN para buscas dentro do JSON
CREATE INDEX IF NOT EXISTS idx_raw_payload_gin ON sienge_raw.objects USING GIN (payload);

-- =============================================
-- FUNÇÃO: Calcular hash do payload
-- =============================================
CREATE OR REPLACE FUNCTION sienge_raw.calc_payload_hash(p_payload JSONB)
RETURNS TEXT AS $$
BEGIN
    RETURN MD5(p_payload::TEXT);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =============================================
-- FUNÇÃO: Upsert de objeto RAW
-- Retorna: 'inserted', 'updated', 'unchanged'
-- =============================================
CREATE OR REPLACE FUNCTION sienge_raw.upsert_object(
    p_entity TEXT,
    p_sienge_id TEXT,
    p_payload JSONB,
    p_enterprise_id TEXT DEFAULT NULL,
    p_source_url TEXT DEFAULT NULL,
    p_run_id UUID DEFAULT NULL
)
RETURNS TEXT AS $$
DECLARE
    v_hash TEXT;
    v_existing_hash TEXT;
    v_result TEXT;
BEGIN
    -- Calcular hash do novo payload
    v_hash := sienge_raw.calc_payload_hash(p_payload);
    
    -- Verificar se já existe e pegar hash atual
    SELECT payload_hash INTO v_existing_hash
    FROM sienge_raw.objects
    WHERE entity = p_entity AND sienge_id = p_sienge_id;
    
    IF v_existing_hash IS NULL THEN
        -- Não existe, inserir
        INSERT INTO sienge_raw.objects (entity, sienge_id, enterprise_id, payload, payload_hash, source_url, run_id, synced_at)
        VALUES (p_entity, p_sienge_id, p_enterprise_id, p_payload, v_hash, p_source_url, p_run_id, NOW());
        v_result := 'inserted';
    ELSIF v_existing_hash != v_hash THEN
        -- Existe mas mudou, atualizar
        UPDATE sienge_raw.objects
        SET payload = p_payload,
            payload_hash = v_hash,
            enterprise_id = COALESCE(p_enterprise_id, enterprise_id),
            source_url = COALESCE(p_source_url, source_url),
            run_id = p_run_id,
            synced_at = NOW()
        WHERE entity = p_entity AND sienge_id = p_sienge_id;
        v_result := 'updated';
    ELSE
        -- Existe e não mudou, apenas atualizar synced_at
        UPDATE sienge_raw.objects
        SET synced_at = NOW(),
            run_id = p_run_id
        WHERE entity = p_entity AND sienge_id = p_sienge_id;
        v_result := 'unchanged';
    END IF;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- VIEWS úteis para análise
-- =============================================

-- View: Resumo por entidade
CREATE OR REPLACE VIEW sienge_raw.summary AS
SELECT 
    entity,
    COUNT(*) as total,
    COUNT(DISTINCT enterprise_id) as enterprises,
    MIN(synced_at) as first_sync,
    MAX(synced_at) as last_sync
FROM sienge_raw.objects
GROUP BY entity;

-- View: Últimas execuções
CREATE OR REPLACE VIEW sienge_raw.recent_runs AS
SELECT 
    id,
    started_at,
    finished_at,
    status,
    params->>'entities' as entities,
    metrics->>'total' as total,
    metrics->>'inserted' as inserted,
    metrics->>'updated' as updated,
    metrics->>'errors' as errors,
    EXTRACT(EPOCH FROM (finished_at - started_at))::INTEGER as duration_seconds
FROM sienge_raw.runs
ORDER BY started_at DESC
LIMIT 20;

-- =============================================
-- GRANT para acesso via API (anon/authenticated)
-- =============================================
GRANT USAGE ON SCHEMA sienge_raw TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA sienge_raw TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sienge_raw TO authenticated;

-- Para service_role (backend)
GRANT ALL ON SCHEMA sienge_raw TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA sienge_raw TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA sienge_raw TO service_role;
