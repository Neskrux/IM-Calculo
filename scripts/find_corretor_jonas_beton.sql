-- =============================================================================
-- Achar o usuário corretor "Jonas" / Beton (ajuste o filtro se não aparecer)
-- Rode no SQL Editor e copie o `id` para colar em clone_venda_teste_desde_ac644.sql
-- =============================================================================

SELECT
  id,
  nome,
  email,
  tipo_corretor,
  ativo,
  origem
FROM public.usuarios
WHERE tipo = 'corretor'
  AND (
    nome ILIKE '%jonas%'
    OR email ILIKE '%jonas%'
    OR nome ILIKE '%beton%'
    OR email ILIKE '%beton%'
  )
ORDER BY
  CASE
    WHEN nome ILIKE '%jonas%' AND (nome ILIKE '%beton%' OR email ILIKE '%beton%') THEN 0
    WHEN nome ILIKE '%jonas%' OR email ILIKE '%jonas%' THEN 1
    ELSE 2
  END,
  nome;

-- Se vier vazio, alargue o filtro:
-- SELECT id, nome, email FROM public.usuarios WHERE tipo = 'corretor' ORDER BY nome;
