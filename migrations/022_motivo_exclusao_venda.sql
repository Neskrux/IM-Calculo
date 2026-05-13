-- Migration 022 — exigir motivo de exclusao em vendas
--
-- Contexto: em 2026-05-11 uma venda real (FIGUEIRA GARCIA unidade 1603 C, 3
-- parcelas pagas) foi marcada como excluido=true por engano — gestora achou
-- que era duplicata, mas investigacao mostrou venda unica. Sem motivo
-- registrado, foi preciso reverter via script. Esta migration evita repeticao
-- exigindo motivo escrito + autor + timestamp toda vez que excluido=true.
--
-- Sem violacao da spec sincronizacao-sienge.md: vendas com pagamentos pagos
-- jah nao deveriam ser excluiveis pelo principio "se tem pago, abortar".
-- A UI agora pede motivo, mas o front ainda deve recusar exclusao quando ha
-- pagamentos pagos (regra de negocio separada — entra na proxima migration
-- se quisermos reforcar no DB).
--
-- Colunas:
--   motivo_exclusao  texto livre (min 10 chars depois de trim)
--   excluido_por     usuarios.id de quem marcou excluido=true
--   excluido_em      timestamp da operacao
--
-- CHECK: se excluido=true, motivo_exclusao deve ter >= 10 chars.
-- Vendas restauradas (excluido=false) mantem os campos como historico da
-- ultima exclusao — proxima exclusao sobrescreve.
--
-- Reversivel: ALTER TABLE vendas DROP COLUMN motivo_exclusao, DROP COLUMN
--             excluido_por, DROP COLUMN excluido_em;
--             ALTER TABLE vendas DROP CONSTRAINT vendas_motivo_exclusao_obrigatorio;

ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS motivo_exclusao text,
  ADD COLUMN IF NOT EXISTS excluido_por uuid REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS excluido_em timestamptz;

ALTER TABLE vendas
  DROP CONSTRAINT IF EXISTS vendas_motivo_exclusao_obrigatorio;

ALTER TABLE vendas
  ADD CONSTRAINT vendas_motivo_exclusao_obrigatorio
  CHECK (
    excluido IS NOT TRUE
    OR (motivo_exclusao IS NOT NULL AND length(btrim(motivo_exclusao)) >= 10)
  );

COMMENT ON COLUMN vendas.motivo_exclusao IS
  'Motivo livre da exclusao (obrigatorio quando excluido=true, min 10 chars). Mantido como historico apos restauracao.';
COMMENT ON COLUMN vendas.excluido_por IS
  'usuarios.id de quem marcou excluido=true (preenchido pelo front no momento da operacao).';
COMMENT ON COLUMN vendas.excluido_em IS
  'timestamp da exclusao (preenchido pelo front com NOW() do servidor).';
