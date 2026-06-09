-- =============================================
-- Passo 3 CORRIGIDO: Inconsistência valor_pro_soluto
-- Compara valor_pro_soluto com a SOMA REAL: sinal + entrada (à vista ou parcelada) + balão
-- Só lista vendas onde a diferença passa de R$ 1,00 (ignora arredondamento).
-- Para tolerância diferente, altere o 1 no WHERE (ex.: 0.50 ou 2).
-- =============================================

WITH expected AS (
  SELECT
    id,
    valor_pro_soluto,
    COALESCE(valor_sinal, 0) AS val_sinal,
    CASE
      WHEN teve_entrada AND NOT COALESCE(parcelou_entrada, false) THEN COALESCE(valor_entrada, 0)
      WHEN teve_entrada AND COALESCE(parcelou_entrada, false) THEN (COALESCE(qtd_parcelas_entrada, 0) * COALESCE(valor_parcela_entrada, 0))
      ELSE 0
    END AS val_entrada,
    CASE WHEN teve_balao = 'sim' THEN (COALESCE(qtd_balao, 0) * COALESCE(valor_balao, 0)) ELSE 0 END AS val_balao
  FROM vendas
  WHERE valor_pro_soluto IS NOT NULL
),
calc AS (
  SELECT
    *,
    (val_sinal + val_entrada + val_balao) AS expected_pro_soluto,
    (valor_pro_soluto - (val_sinal + val_entrada + val_balao)) AS diff
  FROM expected
)
SELECT id, valor_pro_soluto, val_sinal, val_entrada, val_balao, expected_pro_soluto, diff
FROM calc
WHERE ABS(diff) > 1
ORDER BY ABS(diff) DESC;
