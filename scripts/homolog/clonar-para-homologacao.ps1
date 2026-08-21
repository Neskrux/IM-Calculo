# Clona o banco de PRODUCAO (Calculo IM) para HOMOLOGACAO, com dados anonimizados.
# Versao PowerShell do clonar-para-homologacao.sh.
#
# Uso:
#   cd C:\Users\Jonas\trabalho\projetos\IM-Calculo
#   $env:PROD_DB_URL    = 'postgresql://postgres:SENHA@db.jdkkusrxullttyeakwib.supabase.co:5432/postgres'
#   $env:HOMOLOG_DB_URL = 'postgresql://postgres:SENHA@db.ibscxvkgrdyzlgtgbbuz.supabase.co:5432/postgres'
#   .\scripts\homolog\clonar-para-homologacao.ps1
#
# As senhas ficam so na sessao do shell — nao commitar, nao colar em chat.

$ErrorActionPreference = 'Stop'

if (-not $env:PROD_DB_URL)    { throw 'Defina $env:PROD_DB_URL' }
if (-not $env:HOMOLOG_DB_URL) { throw 'Defina $env:HOMOLOG_DB_URL' }

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  Write-Host 'psql nao encontrado. Instale o cliente PostgreSQL:' -ForegroundColor Yellow
  Write-Host '  winget install -e --id PostgreSQL.PostgreSQL.17'
  Write-Host 'Depois FECHE e reabra o terminal (o instalador mexe no PATH) e rode de novo.'
  throw 'psql ausente'
}

$out = 'docs/homolog'
New-Item -ItemType Directory -Force -Path $out | Out-Null

Write-Host '=== 1/4 dump do SCHEMA (estrutura, triggers, functions, policies)' -ForegroundColor Cyan
npx supabase db dump --db-url $env:PROD_DB_URL -f "$out/schema.sql"
if ($LASTEXITCODE -ne 0) { throw 'falha no dump do schema' }

Write-Host '=== 2/4 dump dos DADOS' -ForegroundColor Cyan
npx supabase db dump --db-url $env:PROD_DB_URL --data-only --exclude-table 'public.backup_*' -f "$out/dados.sql"
if ($LASTEXITCODE -ne 0) { throw 'falha no dump dos dados' }

Write-Host '=== 3/4 restaurar em HOMOLOGACAO' -ForegroundColor Cyan
psql $env:HOMOLOG_DB_URL -v ON_ERROR_STOP=1 -f "$out/schema.sql"
if ($LASTEXITCODE -ne 0) { throw 'falha ao restaurar schema' }
psql $env:HOMOLOG_DB_URL -v ON_ERROR_STOP=1 -f "$out/dados.sql"
if ($LASTEXITCODE -ne 0) { throw 'falha ao restaurar dados' }

Write-Host '=== 4/4 anonimizar PII (roda SO no homolog)' -ForegroundColor Cyan
# marca de homologacao: o anonimizar.sql se recusa a rodar sem ela (producao nunca tem).
psql $env:HOMOLOG_DB_URL -v ON_ERROR_STOP=1 -c 'create table if not exists public._homolog_marker (criado_em timestamptz default now());'
if ($LASTEXITCODE -ne 0) { throw 'falha ao criar marca de homologacao' }
psql $env:HOMOLOG_DB_URL -v ON_ERROR_STOP=1 -f 'scripts/homolog/anonimizar.sql'
if ($LASTEXITCODE -ne 0) { throw 'falha na anonimizacao' }

Write-Host ''
Write-Host 'OK. Homologacao pronta. Guard-rail (deve vir 0 nome real):' -ForegroundColor Green
psql $env:HOMOLOG_DB_URL -c "select count(*) filter (where nome_completo not like 'CLIENTE TESTE%') nomes_reais_restantes from clientes;"
