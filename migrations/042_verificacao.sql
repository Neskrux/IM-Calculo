-- Verificação da migration 042 — rodar DEPOIS de aplicar.
-- Cada bloco tem controle POSITIVO e NEGATIVO: uma leitura que só sabe dizer
-- "sim" não prova nada. 401/404 também não provam ausência.

-- 1. BUCKET privado
-- Positivo: a consulta enxerga buckets públicos (documentos/contratos = true).
-- Negativo: boletos já era false, então a coluna sabe dizer "não".
-- Esperado: notas-fiscais = false.
SELECT id, public FROM storage.buckets
WHERE id IN ('notas-fiscais', 'boletos', 'documentos') ORDER BY id;

-- 2. ÍNDICE ÚNICO existe
-- Positivo: a consulta lista outros índices da tabela.
-- Esperado: idx_nf_corretor_competencia_unica com UNIQUE.
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'notas_fiscais_corretor' ORDER BY indexname;

-- 3. A INVARIANTE morde de verdade (controle negativo ativo)
-- Esperado: o 1º INSERT passa, o 2º levanta unique_violation.
-- Trocar :corretor por um id real de corretor ativo. Roda em transação e desfaz.
/*
BEGIN;
  INSERT INTO notas_fiscais_corretor
    (corretor_id, competencia, tipo_emissor, documento, telefone, chave_pix,
     valor_declarado, arquivo_path, criado_por)
  VALUES (:corretor, '2026-08-01', 'autonomo', '52998224725', '41999999999',
          '52998224725', 100, 'x/2026-08/nota.pdf', :corretor);

  -- deve FALHAR com "duplicate key value violates unique constraint"
  INSERT INTO notas_fiscais_corretor
    (corretor_id, competencia, tipo_emissor, documento, telefone, chave_pix,
     valor_declarado, arquivo_path, criado_por)
  VALUES (:corretor, '2026-08-15', 'autonomo', '52998224725', '41999999999',
          '52998224725', 200, 'x/2026-08/nota2.pdf', :corretor);
ROLLBACK;
*/

-- 4. Competência fora do dia 1 é recusada (a CHECK morde)
-- Esperado: erro competencia_e_primeiro_dia_do_mes.
/*
BEGIN;
  INSERT INTO notas_fiscais_corretor
    (corretor_id, competencia, tipo_emissor, documento, telefone, chave_pix,
     valor_declarado, arquivo_path, criado_por)
  VALUES (:corretor, '2026-08-15', 'autonomo', '52998224725', '41999999999',
          '52998224725', 100, 'x/2026-08/n.pdf', :corretor);
ROLLBACK;
*/

-- 5. RLS ligada na tabela
-- Positivo: solicitacoes já é true. Negativo: vendas é false.
-- Esperado: notas_fiscais_corretor = true.
SELECT relname, relrowsecurity FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname IN ('notas_fiscais_corretor', 'solicitacoes', 'vendas') ORDER BY relname;

-- 6. Policies criadas (tabela e bucket)
SELECT tablename, policyname, cmd FROM pg_policies
WHERE (schemaname = 'public'  AND tablename = 'notas_fiscais_corretor')
   OR (schemaname = 'storage' AND policyname LIKE 'nf_bucket%')
ORDER BY tablename, policyname;

-- 7. Isolamento entre corretores — o teste que importa.
-- Só prova de verdade logado como corretor (JWT do corretor A) tentando ler a
-- nota do corretor B. Esperado: 0 linhas, sem erro. Rodar pelo app, não aqui:
-- service_role ignora RLS e daria falso "passou".
