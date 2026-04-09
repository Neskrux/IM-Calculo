-- =============================================================================
-- Inspecionar uma venda e parcelas antes de clonar / testar (017, etc.)
--
-- Venda base (mix pago + pendente, empreendimento 0d7d01f4… — lista mais recente):
--   ac644733-d731-44e5-8573-99b9231e90a8 — Unidade 1804 | Torre: A | 1 pago + 60 pendentes
--
-- Uso: substitua o UUID em todos os WHERE se for outra venda.
-- Rode cada bloco no SQL Editor do Supabase (não use \set — é só psql).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Cabeçalho da venda (linha completa — confira UNIQUEs: sienge_contract_id, etc.)
-- -----------------------------------------------------------------------------
SELECT *
FROM public.vendas
WHERE id = 'ac644733-d731-44e5-8573-99b9231e90a8'::uuid;

-- -----------------------------------------------------------------------------
-- 2) Resumo rápido (menos ruído para olho humano)
-- -----------------------------------------------------------------------------
SELECT
  id,
  descricao,
  status,
  excluido,
  data_distrato,
  valor_venda,
  valor_pro_soluto,
  comissao_total,
  corretor_id,
  cliente_id,
  empreendimento_id,
  sienge_contract_id,
  numero_contrato,
  data_venda,
  data_entrada,
  created_at
FROM public.vendas
WHERE id = 'ac644733-d731-44e5-8573-99b9231e90a8'::uuid;

-- -----------------------------------------------------------------------------
-- 3) Parcelas pro-soluto (todas as colunas — espelha o que o clone precisa copiar)
-- -----------------------------------------------------------------------------
SELECT *
FROM public.pagamentos_prosoluto
WHERE venda_id = 'ac644733-d731-44e5-8573-99b9231e90a8'::uuid
ORDER BY tipo, COALESCE(numero_parcela, 0), created_at;

-- -----------------------------------------------------------------------------
-- 4) Contagem por status (útil para testes 017 / mix pago+pendente)
-- -----------------------------------------------------------------------------
SELECT status, COUNT(*) AS qtd
FROM public.pagamentos_prosoluto
WHERE venda_id = 'ac644733-d731-44e5-8573-99b9231e90a8'::uuid
GROUP BY status
ORDER BY qtd DESC;

-- -----------------------------------------------------------------------------
-- 5) Opcional: comissões por cargo ligadas à venda (se existir tabela)
-- -----------------------------------------------------------------------------
SELECT *
FROM public.comissoes_venda
WHERE venda_id = 'ac644733-d731-44e5-8573-99b9231e90a8'::uuid;
