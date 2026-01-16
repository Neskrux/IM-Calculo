# 🚀 Sincronização Sienge V2 - Instruções

## Resumo Executivo

> **O que mudou?**
> - Busco 3 endpoints oficiais do Sienge e persisto **100% no Supabase (RAW)**
> - Sincronizo core tables com **upsert por Sienge ID**
> - **NÃO crio usuários no Supabase Auth** em lote (evita rate limit 429)
> - Entrego **≥80% de acerto** vs Sienge; o restante é inconsistência de origem

---

## 📋 Passo a Passo

### 1. Executar Migrations no Supabase

No **SQL Editor** do Supabase, execute na ordem:

```sql
-- 1. Schema RAW
-- Cole o conteúdo de: migrations/001_sienge_raw_schema.sql

-- 2. Usuarios sem Auth
-- Cole o conteúdo de: migrations/002_usuarios_sem_auth_dependency.sql
```

### 2. Verificar Variáveis de Ambiente

No arquivo `.env`:

```env
VITE_SUPABASE_URL=sua_url
VITE_SUPABASE_ANON_KEY=sua_chave

VITE_SIENGE_BASE_URL=https://api.sienge.com.br
VITE_SIENGE_SUBDOMAIN=imincorporadora
VITE_SIENGE_USERNAME=seu_usuario
VITE_SIENGE_PASSWORD=sua_senha
VITE_SIENGE_ENTERPRISE_ID=2104
```

### 3. Usar o Componente V2

No `AdminDashboard.jsx`, substitua:

```jsx
// Antes
import SincronizarSienge from '../components/SincronizarSienge'

// Depois
import SincronizarSiengeV2 from '../components/SincronizarSiengeV2'
```

### 4. Executar Sincronização

1. Acesse o painel Admin
2. Vá em "Sincronização Sienge V2"
3. Selecione o modo:
   - **Completo**: RAW + Core (recomendado)
   - **Apenas RAW**: Só ingestão
   - **Apenas Core**: Só sync (usa RAW existente)
   - **Dry Run**: Simulação
4. Clique em "Executar Sincronização"

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                      API SIENGE                              │
│  /creditors  │  /customers  │  /sales-contracts             │
└──────┬───────────────┬───────────────┬──────────────────────┘
       │               │               │
       ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────┐
│              CAMADA 1: sienge_raw.objects                    │
│  entity='creditors' │ entity='customers' │ entity='sales-*' │
│  payload = JSON completo do Sienge                          │
│  ✅ 100% dos dados entram aqui (nunca perde)                │
└──────┬───────────────┬───────────────┬──────────────────────┘
       │               │               │
       ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────┐
│              CAMADA 2: Core Tables                           │
│  usuarios (corretores) │ clientes │ vendas                  │
│  ✅ Upsert por sienge_*_id                                  │
│  ✅ SEM Supabase Auth (sem rate limit)                      │
│  ✅ Placeholders para dependências faltantes                │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│              CAMADA 3: Pagamentos Pro-Soluto                 │
│  paymentConditions → pagamentos_prosoluto                   │
│  ✅ AT (Ato) = Sinal                                        │
│  ✅ PM (Parcelas Mensais) = Entrada parcelada               │
│  ✅ BA (Balão) = Balões anuais                              │
│  ✅ Cada parcela com comissao_gerada = valor * fator        │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 Arquivos Criados

### Migrations
- `migrations/001_sienge_raw_schema.sql` - Schema RAW
- `migrations/002_usuarios_sem_auth_dependency.sql` - Usuarios sem Auth

### Serviços
- `src/services/sienge/rawIngestion.js` - Ingestão RAW
- `src/services/sienge/syncCorretoresV2.js` - Sync corretores (SEM Auth)
- `src/services/sienge/syncClientesV2.js` - Sync clientes
- `src/services/sienge/syncVendasV2.js` - Sync vendas
- `src/services/sienge/syncOrchestrator.js` - Orquestrador
- `src/services/sienge/indexV2.js` - Exportações

### Componentes
- `src/components/SincronizarSiengeV2.jsx` - UI atualizada

### Documentação
- `docs/MAPEAMENTO_SIENGE_SUPABASE.md` - Mapeamento campo a campo
- `docs/SYNC_V2_INSTRUCOES.md` - Este arquivo
- `.cursor/rules/sienge-sync.mdc` - Regras para Cursor

---

## 🔑 Regras Importantes

### 1. NUNCA usar Supabase Auth em sync

```javascript
// ❌ PROIBIDO
await supabase.auth.admin.createUser({ email, password })

// ✅ CORRETO
await supabase.from('usuarios').insert({ nome, email, tipo: 'corretor' })
```

### 2. Sempre RAW-first

```javascript
// Passo 1: Ingerir RAW (100% dos dados)
await ingestAll()

// Passo 2: Sync para Core + Pagamentos
await syncCorretoresFromRaw()
await syncClientesFromRaw()
await syncVendasFromRaw({ criarPagamentos: true }) // Cria pagamentos_prosoluto
```

### 3. Ordem de sincronização

```
1. Corretores (não tem dependências)
2. Clientes (não tem dependências)
3. Vendas + Pagamentos (depende de corretores e clientes)
```

### 4. Mapeamento paymentConditions → Pro-Soluto

```
Sienge                    →  Supabase
─────────────────────────────────────────
AT (Ato)                  →  sinal (teve_sinal=true, valor_sinal)
PM (Parcelas Mensais)     →  entrada parcelada (parcelou_entrada=true)
BA (Balão)                →  balão (teve_balao='sim', qtd_balao)
CA (Crédito Associativo)  →  IGNORADO (não é pro-soluto)
```

Cada condição pro-soluto gera registros em `pagamentos_prosoluto` com:
- `tipo` (sinal, entrada, parcela_entrada, balao)
- `numero_parcela` (para parcelas)
- `valor`
- `data_prevista`
- `comissao_gerada = valor * fator_comissao`

---

## 📊 Validação de Resultados

### Query: Cobertura de sincronização

```sql
-- Comparar RAW vs Core
SELECT 
  'Corretores' as tipo,
  (SELECT COUNT(*) FROM sienge_raw.objects WHERE entity = 'creditors') as raw,
  (SELECT COUNT(*) FROM usuarios WHERE sienge_broker_id IS NOT NULL) as core
UNION ALL
SELECT 
  'Clientes',
  (SELECT COUNT(*) FROM sienge_raw.objects WHERE entity = 'customers'),
  (SELECT COUNT(*) FROM clientes WHERE sienge_customer_id IS NOT NULL)
UNION ALL
SELECT 
  'Vendas',
  (SELECT COUNT(*) FROM sienge_raw.objects WHERE entity = 'sales-contracts'),
  (SELECT COUNT(*) FROM vendas WHERE sienge_contract_id IS NOT NULL);
```

### Query: Vendas não sincronizadas

```sql
SELECT 
  o.sienge_id,
  o.payload->>'number' as numero,
  o.payload->>'value' as valor,
  o.payload->'brokers'->0->>'id' as corretor_sienge_id
FROM sienge_raw.objects o
WHERE o.entity = 'sales-contracts'
  AND NOT EXISTS (
    SELECT 1 FROM vendas v 
    WHERE v.sienge_contract_id = o.sienge_id
  );
```

### Query: Pagamentos pro-soluto por venda

```sql
SELECT 
  v.numero_contrato,
  v.valor_venda,
  v.valor_pro_soluto,
  v.fator_comissao,
  COUNT(p.id) as qtd_pagamentos,
  SUM(p.valor) as total_pagamentos,
  SUM(p.comissao_gerada) as total_comissao
FROM vendas v
LEFT JOIN pagamentos_prosoluto p ON p.venda_id = v.id
WHERE v.sienge_contract_id IS NOT NULL
GROUP BY v.id, v.numero_contrato, v.valor_venda, v.valor_pro_soluto, v.fator_comissao
ORDER BY v.data_venda DESC
LIMIT 20;
```

### Query: Validar comissões calculadas

```sql
SELECT 
  p.tipo,
  COUNT(*) as quantidade,
  SUM(p.valor) as valor_total,
  SUM(p.comissao_gerada) as comissao_total,
  AVG(p.comissao_gerada / NULLIF(p.valor, 0) * 100) as percentual_medio
FROM pagamentos_prosoluto p
JOIN vendas v ON v.id = p.venda_id
WHERE v.sienge_contract_id IS NOT NULL
GROUP BY p.tipo
ORDER BY p.tipo;
```

---

## ⚠️ Casos de Falha Esperados

| Caso | Causa | Solução |
|------|-------|---------|
| Venda sem corretor | Contrato no Sienge não tem `brokers[]` | Verificar no Sienge |
| Venda sem cliente | Contrato no Sienge não tem `salesContractCustomers[]` | Verificar no Sienge |
| Corretor sem email | Sienge não tem email cadastrado | Email fake gerado |
| Dados inconsistentes | Problema na origem (Sienge) | Corrigir no Sienge |

---

## 🎯 Meta de Cobertura

- **Corretores**: 100% (todos os `broker="S"`)
- **Clientes**: 100% (todos do enterpriseId)
- **Vendas**: ≥80% (depende de corretor existir)
- **Pagamentos**: 100% das vendas sincronizadas devem ter pagamentos

Se vendas < 80%, verificar:
1. Corretores foram sincronizados primeiro?
2. Contratos no Sienge têm `brokers[]` preenchido?
3. Há erros no log de sincronização?

Se pagamentos = 0 ou muito baixos, verificar:
1. Contratos no Sienge têm `paymentConditions[]` preenchido?
2. As condições são do tipo esperado (AT, PM, BA)?
3. Verificar JSON no RAW: `SELECT payload->'paymentConditions' FROM sienge_raw.objects WHERE sienge_id = 'X'`

---

## 🔄 Próximos Passos (Pente Fino)

Após validar que ≥80% das vendas estão sincronizadas:

1. **Identificar vendas faltantes** - Query acima
2. **Analisar causas** - Corretor faltando? Cliente faltando?
3. **Corrigir na origem** - Ajustar no Sienge se necessário
4. **Re-sincronizar** - Executar sync novamente

---

## 📞 Suporte

Se encontrar problemas:
1. Verifique os logs no componente
2. Consulte o RAW: `SELECT * FROM sienge_raw.objects WHERE sienge_id = 'X'`
3. Verifique o mapeamento em `docs/MAPEAMENTO_SIENGE_SUPABASE.md`
