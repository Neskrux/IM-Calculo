-- 038: Estado de autenticação da API de Cobrança Ailos (segundo banco de boletos)
--
-- A Ailos usa dois níveis de credencial (WSO2 APIM, sem mTLS):
--   1. Token do CLIENT (OAuth2 client_credentials, Consumer Key/Secret) — expira em ~1h,
--      renovável a qualquer momento. Header: Authorization: Bearer <token>.
--   2. Autorização do COOPERADO — fluxo interativo: o cooperado loga na tela da Ailos
--      (cooperativa + conta + senha de API) e a Ailos manda {state, code} pro nosso
--      callback (edge function ailos-boletos/callback). O code (JWT) vai no header
--      x-ailos-authentication: Bearer <code> e é renovável via
--      /identity/api/v1/autenticacao/token/refresh SEM nova interação.
--
-- Esta tabela guarda esse estado por ambiente. O worker/edge functions leem e
-- atualizam. 1 linha por ambiente ('homolog' | 'producao').
--
-- Boletos emitidos pela Ailos entram na MESMA tabela boletos com banco='ailos'
-- (a 035 já previu multi-banco: índice único é (banco, nosso_numero)).

CREATE TABLE IF NOT EXISTS ailos_tokens (
  id TEXT PRIMARY KEY CHECK (id IN ('homolog', 'producao')),

  -- nível 1: client
  access_token TEXT,
  access_token_expira_em TIMESTAMPTZ,

  -- nível 2: cooperado (x-ailos-authentication)
  cooperado_code TEXT,
  cooperado_code_atualizado_em TIMESTAMPTZ,

  -- fluxo de autorização em andamento (anti-CSRF: callback só aceita state esperado)
  state_pendente TEXT,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ailos_tokens (id) VALUES ('homolog'), ('producao')
ON CONFLICT (id) DO NOTHING;
