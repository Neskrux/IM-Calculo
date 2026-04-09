-- =============================================================================
-- Última venda (por created_at) de um empreendimento que tenha
-- pelo menos 1 parcela status = 'pago' E pelo menos 1 = 'pendente'
--
-- Empreendimento: 0d7d01f4-c398-4d9a-a280-13f44c957279
-- Rode no SQL Editor do Supabase.
-- =============================================================================

WITH agg AS (
  SELECT
    p.venda_id,
    COUNT(*) FILTER (WHERE p.status = 'pago')     AS qtd_pago,
    COUNT(*) FILTER (WHERE p.status = 'pendente') AS qtd_pendente,
    COUNT(*) AS qtd_parcelas
  FROM public.pagamentos_prosoluto p
  GROUP BY p.venda_id
  HAVING COUNT(*) FILTER (WHERE p.status = 'pago') > 0
     AND COUNT(*) FILTER (WHERE p.status = 'pendente') > 0
)
SELECT
  v.id              AS venda_id,
  v.created_at,
  v.data_venda,
  v.descricao,
  v.status          AS status_venda,
  agg.qtd_pago,
  agg.qtd_pendente,
  agg.qtd_parcelas
FROM public.vendas v
JOIN agg ON agg.venda_id = v.id
WHERE v.empreendimento_id = '0d7d01f4-c398-4d9a-a280-13f44c957279'::uuid
ORDER BY v.created_at DESC NULLS LAST
LIMIT 5;

-- A primeira linha = venda mais recente (created_at) que atende ao mix pago+pendente.

-- Se a migration 015 já rodou e quiser ignorar vendas soft-deletadas, acrescente:
--   AND (v.excluido IS DISTINCT FROM TRUE)
