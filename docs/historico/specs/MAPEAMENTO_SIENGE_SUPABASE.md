# 📊 Mapeamento Sienge API → Supabase

## Visão Geral

Este documento detalha o mapeamento **campo a campo** entre a API do Sienge e as tabelas do Supabase.

---

## 1. CORRETORES (`/creditors` → `usuarios`)

### Filtro aplicado
- `broker === "S"` (apenas corretores, não todos os credores)

### Mapeamento de Campos

| Campo Sienge API | Tipo | Campo Supabase | Tipo | Observações |
|-----------------|------|----------------|------|-------------|
| `id` | number | `sienge_broker_id` | TEXT | **Chave de sincronização** |
| `name` | string | `nome` | TEXT | Nome principal |
| `tradeName` | string | `nome_fantasia` | TEXT | Nome fantasia |
| `cpf` | string/object | `cpf` | TEXT | Pode vir como `{value: "..."}` |
| `cnpj` | string/object | `cnpj` | TEXT | Pode vir como `{value: "..."}` |
| `phones[].number` | string | `telefone` | TEXT | Primeiro telefone (main=true) |
| `phones[].ddd` | string | (concatenado) | - | DDD + número |
| `otherContactMethods[].address` | string | `email` | TEXT | Onde `type=1` ou `type=2` ou contém `@` |
| `address.streetName` | string | `endereco` | TEXT | Endereço formatado completo |
| `address.number` | string | (concatenado) | - | |
| `address.complement` | string | (concatenado) | - | |
| `address.neighborhood` | string | (concatenado) | - | |
| `address.cityName` | string | (concatenado) | - | |
| `address.state` | string | (concatenado) | - | |
| `address.zipCode` | string | (concatenado) | - | |
| `active` | boolean | `ativo` | BOOLEAN | Default: true |
| - | - | `tipo` | TEXT | Fixo: `'corretor'` |
| - | - | `tipo_corretor` | TEXT | Default: `'externo'` |
| - | - | `origem` | TEXT | Fixo: `'sienge'` |
| - | - | `email` | TEXT | Se não tiver: `corretor.{id}@sync.local` |

### Exemplo de Payload Sienge

```json
{
  "id": 12345,
  "name": "João Silva Corretor",
  "tradeName": "JS Imóveis",
  "cpf": "***********",
  "cnpj": null,
  "broker": "S",
  "active": true,
  "phones": [
    { "ddd": "11", "number": "999999999", "main": true }
  ],
  "otherContactMethods": [
    { "type": 1, "address": "joao@email.com" }
  ],
  "address": {
    "streetName": "Rua Exemplo",
    "number": "123",
    "neighborhood": "Centro",
    "cityName": "São Paulo",
    "state": "SP",
    "zipCode": "01234567"
  }
}
```

---

## 2. CLIENTES (`/customers` → `clientes`)

### Mapeamento de Campos

| Campo Sienge API | Tipo | Campo Supabase | Tipo | Observações |
|-----------------|------|----------------|------|-------------|
| `id` | number | `sienge_customer_id` | TEXT | **Chave de sincronização** |
| `name` | string | `nome_completo` | TEXT | Nome principal |
| `cpf` | string/object | `cpf` | TEXT | Pode vir como `{value: "..."}` |
| `cnpj` | string/object | `cnpj` | TEXT | Pode vir como `{value: "..."}` |
| `email` | string | `email` | TEXT | Email principal |
| `phones[].number` | string | `telefone` | TEXT | Primeiro telefone (main=true) |
| `addresses[].streetName` | string | `endereco` | TEXT | Endereço formatado |
| `addresses[].zipCode` | string | `cep` | TEXT | CEP |
| `birthDate` | string | `data_nascimento` | DATE | Formato: yyyy-MM-dd |
| `numberIdentityCard` | string | `rg` | TEXT | Número do RG |
| `profession` | string | `profissao` | TEXT | Profissão |
| `sex` | string | `sexo` | TEXT | M/F |
| `civilStatus` | string | `estado_civil` | TEXT | |
| `fatherName` | string | `nome_pai` | TEXT | |
| `motherName` | string | `nome_mae` | TEXT | |
| `nationality` | string | `nacionalidade` | TEXT | |
| `personType` | string | `tipo_pessoa` | TEXT | Física/Jurídica |
| `modifiedAt` | string | `sienge_updated_at` | TIMESTAMPTZ | Última atualização no Sienge |

### Campos NÃO mapeados (disponíveis no RAW)

- `spouse` (cônjuge) → pode ir para `complementadores_renda`
- `familyIncome` (renda familiar)
- `workInfo` (informações de trabalho)
- `bankAccounts` (contas bancárias)

### Exemplo de Payload Sienge

```json
{
  "id": 67890,
  "name": "Maria Santos",
  "cpf": "***********",
  "email": "maria@email.com",
  "birthDate": "1985-03-15",
  "numberIdentityCard": "1234567",
  "profession": "Engenheira",
  "sex": "F",
  "civilStatus": "Casada",
  "phones": [
    { "number": "11988887777", "main": true }
  ],
  "addresses": [
    {
      "streetName": "Av. Principal",
      "number": "456",
      "neighborhood": "Jardins",
      "city": "São Paulo",
      "state": "SP",
      "zipCode": "04567890",
      "mail": true
    }
  ],
  "spouse": {
    "name": "José Santos",
    "cpf": "***********"
  },
  "modifiedAt": "2024-01-15T10:30:00Z"
}
```

---

## 3. VENDAS/CONTRATOS (`/sales-contracts` → `vendas`)

### Mapeamento de Campos

| Campo Sienge API | Tipo | Campo Supabase | Tipo | Observações |
|-----------------|------|----------------|------|-------------|
| `id` | number | `sienge_contract_id` | TEXT | **Chave de sincronização** |
| `number` | string | `numero_contrato` | TEXT | Número do contrato |
| `value` | number | `valor_venda` | DECIMAL | Valor da venda |
| `totalSellingValue` | number | `valor_venda_total` | DECIMAL | Valor total |
| `contractDate` | string | `data_venda` | DATE | Data do contrato |
| `issueDate` | string | `data_emissao` | DATE | Data de emissão |
| `expectedDeliveryDate` | string | `data_entrega_prevista` | DATE | Previsão de entrega |
| `situation` | string | `situacao_contrato` | TEXT | 0/1/2/3 |
| `cancellationDate` | string | `data_cancelamento` | DATE | Se cancelado |
| `cancellationReason` | string | `motivo_cancelamento` | TEXT | Motivo |
| `enterpriseId` | number | `empreendimento_id` | UUID | Via lookup |
| `enterpriseName` | string | (criar empreendimento) | - | |
| `salesContractCustomers[0].id` | number | `cliente_id` | UUID | Via `sienge_customer_id` |
| `salesContractCustomers[0].name` | string | (referência) | - | |
| `salesContractUnits[0].id` | number | `sienge_unit_id` | TEXT | ID da unidade |
| `salesContractUnits[0].name` | string | `unidade` | TEXT | Nome da unidade |
| `brokers[0].id` | number | `corretor_id` | UUID | Via `sienge_broker_id` |
| `brokers[0].main` | boolean | (determina principal) | - | |
| `paymentConditions[]` | array | (calculado) | - | Ver abaixo |

### Cálculos derivados de `paymentConditions`

| Cálculo | Campo Supabase | Lógica |
|---------|----------------|--------|
| Total de parcelas | `qtd_parcelas` | `SUM(installmentsNumber)` |
| Valor pro-soluto | `valor_pro_soluto` | `SUM(totalValue)` onde tipo é Ato/Entrada/Balão/Sinal |

### Situação do Contrato

| Código | Descrição | Status Supabase |
|--------|-----------|-----------------|
| 0 | Solicitado | `pendente` |
| 1 | Autorizado | `pendente` |
| 2 | Emitido | `pago` |
| 3 | Cancelado | `pendente` |

### Exemplo de Payload Sienge

```json
{
  "id": 11111,
  "number": "CT-2024-001",
  "value": 500000.00,
  "totalSellingValue": 500000.00,
  "contractDate": "2024-01-15",
  "issueDate": "2024-01-20",
  "situation": "2",
  "enterpriseId": 2104,
  "enterpriseName": "FIGUEIRA GARCIA",
  "salesContractCustomers": [
    { "id": 67890, "name": "Maria Santos", "main": true }
  ],
  "salesContractUnits": [
    { "id": 999, "name": "Apto 101 - Torre A", "main": true }
  ],
  "brokers": [
    { "id": 12345, "main": true }
  ],
  "paymentConditions": [
    {
      "conditionTypeId": "AT",
      "conditionTypeName": "Ato",
      "installmentsNumber": 1,
      "totalValue": 50000.00
    },
    {
      "conditionTypeId": "PM",
      "conditionTypeName": "Parcelas Mensais",
      "installmentsNumber": 120,
      "totalValue": 450000.00
    }
  ]
}
```

---

## 4. EMPREENDIMENTOS (`/enterprises` → `empreendimentos`)

### Mapeamento de Campos

| Campo Sienge API | Tipo | Campo Supabase | Tipo | Observações |
|-----------------|------|----------------|------|-------------|
| `id` | number | `sienge_enterprise_id` | TEXT | **Chave de sincronização** |
| `name` | string | `nome` | TEXT | Nome do empreendimento |
| - | - | `ativo` | BOOLEAN | Default: true |

---

## 5. Campos de Sincronização (Chaves)

Todas as tabelas têm campos `sienge_*` para rastreabilidade:

| Tabela | Campo | Descrição |
|--------|-------|-----------|
| `usuarios` | `sienge_broker_id` | ID do corretor no Sienge |
| `clientes` | `sienge_customer_id` | ID do cliente no Sienge |
| `vendas` | `sienge_contract_id` | ID do contrato no Sienge |
| `vendas` | `sienge_broker_id` | Referência ao corretor |
| `vendas` | `sienge_unit_id` | Referência à unidade |
| `vendas` | `sienge_customer_id` | Referência ao cliente |
| `empreendimentos` | `sienge_enterprise_id` | ID do empreendimento |

---

## 6. Fluxo de Sincronização

### Ordem correta (dependências)

```
1. Ingestão RAW (sienge_raw.objects)
   ├── /creditors → entity='creditors'
   ├── /customers → entity='customers'
   └── /sales-contracts → entity='sales-contracts'

2. Sync Corretores (RAW → usuarios)
   └── Cria corretores SEM Auth

3. Sync Clientes (RAW → clientes)
   └── Cria clientes SEM user_id

4. Sync Vendas (RAW → vendas)
   ├── Resolve corretor_id via sienge_broker_id
   ├── Resolve cliente_id via sienge_customer_id
   ├── Cria empreendimento se não existir
   └── Cria placeholders se necessário
```

### Regras de Fallback

| Situação | Ação |
|----------|------|
| Corretor não existe | Cria placeholder com email fake |
| Cliente não existe | Deixa `cliente_id = NULL` ou cria placeholder |
| Empreendimento não existe | Cria automaticamente |

---

## 7. Dados RAW (sienge_raw.objects)

O schema `sienge_raw` armazena o JSON completo de cada objeto:

```sql
SELECT 
  entity,
  sienge_id,
  payload->>'name' as nome,
  payload->>'cpf' as cpf,
  synced_at
FROM sienge_raw.objects
WHERE entity = 'customers'
LIMIT 10;
```

### Vantagens do RAW

1. **Nunca perde dados** - mesmo que o mapeamento falhe
2. **Auditoria completa** - histórico de todas as sincronizações
3. **Reprocessamento** - pode refazer sync sem chamar API novamente
4. **Debug** - payload original disponível para análise

---

## 8. Validação de Mapeamento

### Query para verificar cobertura

```sql
-- Corretores: RAW vs Supabase
SELECT 
  (SELECT COUNT(*) FROM sienge_raw.objects WHERE entity = 'creditors') as raw_total,
  (SELECT COUNT(*) FROM usuarios WHERE sienge_broker_id IS NOT NULL) as supabase_total;

-- Clientes: RAW vs Supabase
SELECT 
  (SELECT COUNT(*) FROM sienge_raw.objects WHERE entity = 'customers') as raw_total,
  (SELECT COUNT(*) FROM clientes WHERE sienge_customer_id IS NOT NULL) as supabase_total;

-- Vendas: RAW vs Supabase
SELECT 
  (SELECT COUNT(*) FROM sienge_raw.objects WHERE entity = 'sales-contracts') as raw_total,
  (SELECT COUNT(*) FROM vendas WHERE sienge_contract_id IS NOT NULL) as supabase_total;
```

### Query para encontrar não sincronizados

```sql
-- Contratos no RAW que não estão em vendas
SELECT 
  o.sienge_id,
  o.payload->>'number' as numero,
  o.payload->>'value' as valor
FROM sienge_raw.objects o
WHERE o.entity = 'sales-contracts'
  AND NOT EXISTS (
    SELECT 1 FROM vendas v 
    WHERE v.sienge_contract_id = o.sienge_id
  );
```

---

## 9. Casos Especiais

### CPF/CNPJ como objeto

A API do Sienge pode retornar CPF/CNPJ como string ou objeto:

```javascript
// String
"cpf": "***********"

// Objeto
"cpf": { "value": "12345678901" }
```

O código trata ambos os casos:

```javascript
const extractCpf = (cpf) => {
  if (!cpf) return null
  if (typeof cpf === 'string') return cpf.replace(/\D/g, '')
  if (typeof cpf === 'object' && cpf.value) return String(cpf.value).replace(/\D/g, '')
  return null
}
```

### Múltiplos telefones

A API retorna array de telefones. Usamos o `main: true` ou o primeiro:

```javascript
const extractTelefone = (phones) => {
  if (!phones || !Array.isArray(phones)) return null
  const principal = phones.find(p => p.main === true) || phones[0]
  return principal?.number || null
}
```

### Múltiplos endereços

Usamos o endereço de correspondência (`mail: true`) ou o primeiro:

```javascript
const endereco = addresses.find(a => a.mail === true) || addresses[0]
```
