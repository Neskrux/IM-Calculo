-- 040: snapshot da taxa da coordenadora POR VENDA
-- Ver .claude/rules/fator-comissao.md + docs/specs/2026-08-20-spec-relatorio-coordenadoras.md
--
-- Por quê: a taxa da coordenadora mudou no tempo (contratos antes de 15/07/2025 = 1,0%;
-- a partir de 15/07/2025 = 0,5% — regra aprovada pela gestão, já aplicada no repasse
-- mensal via scripts/repasse-mensal-coordenadora.mjs). A tabela coordenadoras guarda só
-- a taxa VIGENTE (percentual_padrao) — usá-la em relatório de mês antigo reescreve
-- história (Carol pré-cutover sairia pela metade).
--
-- Mesma filosofia do fator_comissao_aplicado: o snapshot na venda é a verdade histórica;
-- a taxa vigente vale só como fallback quando o snapshot é NULL (venda legada não
-- backfillada ou coordenadora nova sem cutover).

ALTER TABLE vendas ADD COLUMN IF NOT EXISTS coordenadora_taxa numeric;

COMMENT ON COLUMN vendas.coordenadora_taxa IS
  'Snapshot da taxa (%) do cargo Coordenadora pra ESTA venda. Backfill: data_venda < 2025-07-15 => 1.0, senao 0.5 (scripts/backfill-coordenadora-taxa.mjs). NULL => relatorio cai em coordenadoras.percentual_padrao.';
