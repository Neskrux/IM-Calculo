#!/usr/bin/env bash
# Clona o banco de PRODUCAO (Calculo IM) para HOMOLOGACAO, com dados anonimizados.
#
# Por que CLI e nao MCP: o schema tem triggers de imutabilidade de linha paga
# (migrations 017/018), functions, RLS e constraints. Introspeccao por query nao
# reproduz isso fiel — pg_dump reproduz.
#
# Uso:
#   export PROD_DB_URL='postgresql://postgres.jdkkusrxullttyeakwib:<SENHA>@aws-0-us-east-1.pooler.supabase.com:5432/postgres'
#   export HOMOLOG_DB_URL='postgresql://postgres.ibscxvkgrdyzlgtgbbuz:<SENHA>@aws-0-us-east-1.pooler.supabase.com:5432/postgres'
#   bash scripts/homolog/clonar-para-homologacao.sh
#
# As senhas ficam so no seu shell — nao commitar, nao colar em chat.
# Connection string: painel Supabase > Project Settings > Database > Connection string (URI).

set -euo pipefail

: "${PROD_DB_URL:?defina PROD_DB_URL}"
: "${HOMOLOG_DB_URL:?defina HOMOLOG_DB_URL}"

OUT=docs/homolog
mkdir -p "$OUT"

# Tabelas de backup nao vao pra homologacao (18k+ linhas de lixo historico).
EXCLUDE=(
  --exclude-table 'public.backup_*'
)

echo "=== 1/4 dump do SCHEMA (estrutura, triggers, functions, policies)"
npx supabase db dump --db-url "$PROD_DB_URL" -f "$OUT/schema.sql"

echo "=== 2/4 dump dos DADOS"
npx supabase db dump --db-url "$PROD_DB_URL" --data-only "${EXCLUDE[@]}" -f "$OUT/dados.sql"

echo "=== 3/4 restaurar em HOMOLOGACAO"
psql "$HOMOLOG_DB_URL" -v ON_ERROR_STOP=1 -f "$OUT/schema.sql"
psql "$HOMOLOG_DB_URL" -v ON_ERROR_STOP=1 -f "$OUT/dados.sql"

echo "=== 4/4 anonimizar PII (roda SO no homolog)"
# marca de homologacao: o anonimizar.sql se recusa a rodar sem ela (producao nunca tem).
psql "$HOMOLOG_DB_URL" -v ON_ERROR_STOP=1 -c \
  "create table if not exists public._homolog_marker (criado_em timestamptz default now());"
psql "$HOMOLOG_DB_URL" -v ON_ERROR_STOP=1 -f scripts/homolog/anonimizar.sql

echo
echo "OK. Homologacao pronta. Confira o guard-rail:"
psql "$HOMOLOG_DB_URL" -c "select count(*) filter (where cpf is not null) cpfs_restantes from clientes;"
