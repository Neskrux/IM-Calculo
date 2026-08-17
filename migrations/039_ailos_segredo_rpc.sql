-- 039: RPC pra edge function ailos-boletos ler credenciais do Vault.
-- SECURITY DEFINER + revogado de anon/authenticated: só service_role (edge) chama.
-- Segredos esperados (criar via SQL Editor, 1x):
--   SELECT vault.create_secret('<consumer key>',    'AILOS_CONSUMER_KEY');
--   SELECT vault.create_secret('<consumer secret>', 'AILOS_CONSUMER_SECRET');
CREATE OR REPLACE FUNCTION public.ailos_segredo(nome text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = vault, public
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = nome LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.ailos_segredo(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ailos_segredo(text) TO service_role;
