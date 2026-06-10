-- ============================================================================
-- 030_coordenadoras.sql  (2026-06-09)
-- Tabela de coordenadoras + vinculo venda -> coordenadora.
--
-- CONTEXTO DE NEGOCIO:
--   "Coordenadora" e um cargo EXCLUSIVO de venda EXTERNA — em cargos_empreendimento
--   o cargo 'Coordenadora' (0,50%) so existe pra tipo_corretor='externo'; venda
--   interna NAO tem coordenadora. Cada venda externa e direcionada a UMA
--   coordenadora, e o relatorio por cargo 'Coordenadora' deve poder filtrar por ela
--   (2o seletor no relatorio). Modelo extensivel: hoje Carol + Jessica, amanha N.
--   ver .claude/rules/fator-comissao.md (composicao de cargos externo)
--
-- DESIGN:
--   - Tabela propria `coordenadoras` (nao reusa usuarios — coordenadora nem sempre
--     e usuaria do sistema; usuario_id e link OPCIONAL pra quando for).
--   - vendas.coordenadora_id (FK, nullable). NULL = venda interna ou ainda nao
--     atribuida. ON DELETE SET NULL pra nunca apagar venda por causa de coordenadora.
--   - SEM CHECK rigido "externo => coordenadora NOT NULL": quebraria o sync (que
--     insere a venda antes da atribuicao) e as 273 externas pre-existentes. A regra
--     "obrigatoria quando externo" e aplicada no FORMULARIO de venda (camada de UI),
--     nao no banco. Documentada no COMMENT da coluna.
--   - Aditivo e reversivel (DROP COLUMN / DROP TABLE) — zero risco ao dado existente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS coordenadoras (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  ativo       boolean NOT NULL DEFAULT true,
  email       text,
  telefone    text,
  usuario_id  uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  observacao  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE coordenadoras IS
  'Coordenadoras de vendas externas (cargo Coordenadora 0,5% — externo). Vinculo em vendas.coordenadora_id. Extensivel.';

-- nome unico entre as ATIVAS (case-insensitive) — evita duplicar "Carol"/"carol"
CREATE UNIQUE INDEX IF NOT EXISTS coordenadoras_nome_ativa_uniq
  ON coordenadoras (lower(nome)) WHERE ativo;

ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS coordenadora_id uuid REFERENCES coordenadoras(id) ON DELETE SET NULL;

COMMENT ON COLUMN vendas.coordenadora_id IS
  'Coordenadora responsavel pela venda. OBRIGATORIA quando tipo_corretor=''externo'' (regra aplicada no formulario de venda; sem CHECK rigido pra nao quebrar o sync que insere a venda antes da atribuicao). NULL em venda interna.';

CREATE INDEX IF NOT EXISTS vendas_coordenadora_id_idx
  ON vendas (coordenadora_id) WHERE coordenadora_id IS NOT NULL;
