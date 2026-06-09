-- ============================================================================
-- 031_coordenadora_percentual_padrao.sql  (2026-06-09)
-- Taxa NEGOCIAVEL por coordenadora + vinculo usuario da Carol.
--
-- CONTEXTO: a taxa do cargo 'Coordenadora' (padrao 0,50% externo em
-- cargos_empreendimento) varia POR NEGOCIACAO por coordenadora. Jessica=1,00%,
-- Carol=0,50% (padrao). Verificado empiricamente: a fatia da Jessica =
-- comissao_gerada x (1,0/7) ~ R$539 (maio/2026) vs R$535,63 do PDF oficial Sienge
-- (residuo R$3,40 = selecao por cronograma de repasse vs data de pagamento).
--
-- DESIGN: `percentual_padrao` em coordenadoras. O override (no relatorio) muda SO
-- a PROPORCAO da fatia (comissao_gerada x rate/7), mantendo percentualTotal=7; NAO
-- e snapshot e NAO toca valor financeiro de linha 'pago' (nenhuma regra de
-- imutabilidade acionada). usuario_id da Carol preenchido aqui: necessario pra
-- excluir as vendas PROPRIAS dela (corretor_id=Carol) do relatorio de coordenadora
-- (regra de negocio: coordenadora nao reporta venda que ela mesma vendeu).
-- ver .claude/rules/fator-comissao.md (composicao externa = 7%, Coordenadora 0,5%)
-- ============================================================================

ALTER TABLE coordenadoras
  ADD COLUMN IF NOT EXISTS percentual_padrao numeric(5,2) NOT NULL DEFAULT 0.50;

COMMENT ON COLUMN coordenadoras.percentual_padrao IS
  'Taxa negociada da coordenadora (cargo Coordenadora, externo). Padrao 0,50%. '
  'Override no relatorio substitui cargo.percentual da Coordenadora; percentualTotal '
  'permanece 7 (fatia = comissao_gerada x rate/7). NAO e snapshot. Jessica=1,00 Carol=0,50.';

-- Jessica = 1,00% (negociado)
UPDATE coordenadoras SET percentual_padrao = 1.00, updated_at = now()
  WHERE id = 'e608974b-0ccf-4afb-bfe2-dacd07087f3f';

-- Carol = 0,50% (padrao explicito, auditavel)
UPDATE coordenadoras SET percentual_padrao = 0.50, updated_at = now()
  WHERE id = '58fad267-ff52-469e-b2e4-8ad55a87f374';

-- Carol e' tambem corretora (Carolina de Oliveira dos Santos Rita): linkar usuario_id
-- pra excluir as 3 vendas-proprias dela do relatorio de coordenadora dela.
UPDATE coordenadoras SET usuario_id = '4c04b405-d75b-4638-9dab-c149e563bc0c', updated_at = now()
  WHERE id = '58fad267-ff52-469e-b2e4-8ad55a87f374' AND usuario_id IS NULL;
