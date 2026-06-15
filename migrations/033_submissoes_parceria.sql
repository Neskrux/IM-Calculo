-- =============================================
-- MIGRATION 033: submissoes_parceria
-- Registro local (lado IM-Calculo) de cada negociação de parceria submetida
-- pelo formulário público do Figueira → card no funil do RH.
-- Spec: docs/specs/2026-06-12-cadastro-publico-parceria-figueira-S1-spec.md (§5.3)
-- Decisões: HUB-CONEXAO.md §4 (D1–D6). Captura PÚBLICA (sem login).
-- =============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.submissoes_parceria (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- chaves de reconciliação futura (D6) — NÃO há corretor_cpf no form
    corretor_creci        TEXT NOT NULL,
    corretor_email        TEXT NOT NULL,         -- chave do corretor (v1)
    corretor_telefone     TEXT,
    corretor_nome         TEXT,
    cliente_cpf           TEXT NOT NULL,         -- chave do cliente
    cliente_nome          TEXT,

    -- escopo
    sienge_enterprise_id  INTEGER NOT NULL DEFAULT 2104,   -- Figueira

    -- ligação com o card criado no RH (mão única IM→RH)
    rh_card_id            TEXT,

    -- contato pra a mensagem de confirmação (v1 de "minhas negociações")
    contato               TEXT,

    -- idempotência (§8): mesmo payload reenviado não duplica card
    payload_hash          TEXT,

    -- resumo do que foi enviado (não-PII sensível; PII de doc fica no RH)
    resumo                JSONB,

    status                TEXT NOT NULL DEFAULT 'enviado',  -- enviado | erro
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- idempotência: um payload_hash só gera um card
CREATE UNIQUE INDEX IF NOT EXISTS idx_submissoes_parceria_payload_hash
    ON public.submissoes_parceria(payload_hash)
    WHERE payload_hash IS NOT NULL;

-- reconciliação por email do corretor (D6) e por CPF do cliente
CREATE INDEX IF NOT EXISTS idx_submissoes_parceria_corretor_email
    ON public.submissoes_parceria(lower(corretor_email));
CREATE INDEX IF NOT EXISTS idx_submissoes_parceria_cliente_cpf
    ON public.submissoes_parceria(cliente_cpf);

COMMENT ON TABLE public.submissoes_parceria IS
    'Registro local das negociações de parceria do Figueira submetidas via form público. O card vive no RH; aqui guardamos o vínculo (rh_card_id) + chaves de reconciliação (corretor_email, cliente_cpf). Captura pública, sem login. Ver spec S1 §5.';
