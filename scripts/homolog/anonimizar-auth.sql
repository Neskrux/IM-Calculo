-- Anonimizacao da camada de AUTENTICACAO em HOMOLOGACAO. NUNCA rodar em producao.
--
-- POR QUE ESTE ARQUIVO EXISTE
-- `supabase db dump --data-only` exclui os schemas internos na dump de SCHEMA,
-- mas NAO na de DADOS: a lista de --exclude-schema do data-only nao tem `auth`
-- nem `storage` (so as tabelas de migration deles). Ou seja, o clone traz
-- `auth.users` INTEIRO — 60 logins com hash de senha e e-mail reais de colegas —
-- e `storage.objects` com centenas de linhas apontando pra arquivos que nao
-- existem no bucket do homolog.
--
-- O anonimizar.sql (irmao deste) so cuida do schema `public`. Este cuida do resto.
--
-- O QUE FAZ
--   1. troca TODA senha por uma unica senha de homologacao (:senha)
--   2. troca TODO e-mail por um @homolog.local derivado do nome — assim nenhum
--      e-mail do homolog (confirmacao, recuperacao de senha) alcanca uma caixa
--      de entrada real, e ainda da pra saber de quem e o login so de olhar
--   3. zera as colunas de token: o GoTrue le essas colunas como string Go
--      nao-nullable e, com NULL, o login quebra com o generico
--      "Database error querying schema"
--   4. limpa storage.objects — os arquivos nao vieram no clone (so as linhas),
--      entao sobrariam 404s, e os nomes de arquivo carregam nome de cliente
--
-- O QUE PRESERVA DE PROPOSITO
--   Os IDs. `usuarios.id` E a identidade do perfil (12 FKs apontam pra ela) e o
--   login resolve o perfil por `usuarios.id = auth.uid()`. Trocar id aqui
--   quebraria o vinculo de toda a carteira.
--   Os buckets (storage.buckets) — precisam existir pra tela de upload abrir.
--
-- USO (depois do anonimizar.sql, que mascara os nomes de cliente):
--   psql "$HOMOLOG_DB_URL" -v ON_ERROR_STOP=1 -v senha='<senha-de-homolog>' \
--     -f scripts/homolog/anonimizar-auth.sql

begin;

-- Mesma guarda do anonimizar.sql: so roda onde a marca de homologacao existe.
do $$
begin
  if to_regclass('public._homolog_marker') is null then
    raise exception 'Sem _homolog_marker — este banco NAO e homologacao. Abortado.';
  end if;
end $$;

-- E-mail derivado do nome, pra continuar reconhecivel na hora de logar:
-- "MATHEUS DE S. PIRES NEGOCIOS" -> matheus-de-s-pires-negocios+a1b2@homolog.local
-- O sufixo curto de hash evita colisao entre homonimos.
create or replace function pg_temp.email_homolog(p_id uuid, p_nome text) returns text as $fn$
  select left(
           regexp_replace(
             regexp_replace(lower(coalesce(nullif(btrim(p_nome), ''), 'usuario')),
                            '[^a-z0-9]+', '-', 'g'),
             '(^-|-$)', '', 'g'),
           28)
         || '+' || left(md5(p_id::text), 4) || '@homolog.local'
$fn$ language sql immutable;

update auth.users u set
  encrypted_password = extensions.crypt(:'senha', extensions.gen_salt('bf')),
  email = pg_temp.email_homolog(u.id, coalesce(
            (select p.nome           from public.usuarios p where p.id = u.id),
            (select c.nome_completo  from public.clientes c where c.user_id = u.id),
            'usuario')),
  email_confirmed_at = coalesce(u.email_confirmed_at, now()),
  phone = null, phone_confirmed_at = null,
  -- as 8 colunas que o GoTrue exige nao-NULL (ver cabecalho)
  confirmation_token = '', recovery_token = '', email_change_token_new = '',
  email_change = '', email_change_token_current = '', phone_change = '',
  phone_change_token = '', reauthentication_token = '';

-- a identidade guarda uma copia do e-mail; sem isto o login por e-mail diverge
update auth.identities i set
  identity_data = jsonb_set(coalesce(i.identity_data, '{}'::jsonb),
                            '{email}', to_jsonb(u.email))
from auth.users u where u.id = i.user_id;

-- sessoes/refresh tokens de producao nao tem serventia aqui e so confundem
delete from auth.refresh_tokens;
delete from auth.sessions;

-- linhas sem arquivo por tras: 404 garantido e nome de cliente no path
delete from storage.objects;

commit;

-- Conferencia (roda fora da transacao, so pra imprimir):
select count(*) as logins_reprocessados,
       count(*) filter (where email like '%@homolog.local') as com_email_mascarado,
       count(*) filter (where email not like '%@homolog.local') as AINDA_COM_EMAIL_REAL
from auth.users;
