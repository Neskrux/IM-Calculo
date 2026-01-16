# 🔗 Integração Sienge - Documentação Técnica

## 📋 Função do `VITE_SIENGE_ENTERPRISE_ID`

O `enterpriseId` é o **ID do empreendimento** no Sienge. Ele serve para:

1. **Filtrar contratos de venda** por empreendimento específico
   - Quando você busca `/sales-contracts?enterpriseId=12089`, retorna apenas contratos desse empreendimento
   - Sem o filtro, retorna contratos de TODOS os empreendimentos

2. **Filtrar clientes** vinculados a um empreendimento
   - `/customers?enterpriseId=12089` retorna clientes que têm relação com esse empreendimento

3. **Filtrar unidades** de um empreendimento
   - `/units?enterpriseId=12089` retorna unidades desse empreendimento

**Por que é importante:**
- Se você trabalha com múltiplos empreendimentos, precisa filtrar
- Se trabalha com apenas 1 empreendimento, pode usar sempre o mesmo ID
- Economiza requisições (não busca dados desnecessários)

---

## 🗺️ Mapeamento API → Banco de Dados

### CLIENTES (`/customers` → `clientes`)

| Campo API Sienge | Tipo API | Campo Banco Supabase | Tipo Banco | Observações |
|-----------------|----------|---------------------|------------|-------------|
| `id` | number | `sienge_customer_id` | TEXT | **Chave de sincronização** |
| `name` | string | `nome_completo` | TEXT | Nome principal |
| `cpf` | string | `cpf` | TEXT | CPF sem máscara |
| `cnpj` | string | `cnpj` | TEXT | Se for PJ (adicionar campo) |
| `email` | string | `email` | TEXT | Email principal |
| `birthDate` | string (yyyy-MM-dd) | `data_nascimento` | DATE | Data de nascimento |
| `numberIdentityCard` | string | `rg` | TEXT | Número do RG |
| `profession` | string | `profissao` | TEXT | Profissão |
| `phones[0].number` | string | `telefone` | TEXT | Primeiro telefone (main) |
| `addresses[0]` | object | `endereco` | TEXT | Endereço completo formatado |
| `addresses[0].zipCode` | string | `cep` | TEXT | CEP (adicionar campo) |
| `spouse.name` | string | → `complementadores_renda.nome` | TEXT | Cônjuge |
| `spouse.cpf` | string | → `complementadores_renda.cpf` | TEXT | CPF do cônjuge |
| `spouse.email` | string | → `complementadores_renda.email` | TEXT | Email do cônjuge |
| `spouse.profession` | string | → `complementadores_renda.profissao` | TEXT | Profissão do cônjuge |
| `createdAt` | string | `created_at` | TIMESTAMPTZ | Data de criação no Sienge |
| `modifiedAt` | string | `sienge_updated_at` | TIMESTAMPTZ | Última atualização no Sienge |

**Campos adicionais que precisamos adicionar:**
- `sienge_customer_id` (TEXT UNIQUE) - ID do Sienge
- `cnpj` (TEXT) - Para clientes PJ
- `cep` (TEXT) - CEP do endereço
- `sienge_updated_at` (TIMESTAMPTZ) - Última atualização no Sienge

---

### CONTRATOS DE VENDA (`/sales-contracts` → `vendas`)

| Campo API Sienge | Tipo API | Campo Banco Supabase | Tipo Banco | Observações |
|-----------------|----------|---------------------|------------|-------------|
| `id` | number | `sienge_contract_id` | TEXT | **Chave de sincronização** |
| `enterpriseId` | number | `empreendimento_id` | UUID | Via `sienge_enterprise_id` |
| `enterpriseName` | string | → Buscar `empreendimentos` | TEXT | Nome do empreendimento |
| `number` | string | `numero_contrato` | TEXT | Número do contrato (adicionar) |
| `contractDate` | string | `data_venda` | DATE | Data do contrato |
| `issueDate` | string | `data_emissao` | DATE | Data de emissão (adicionar) |
| `value` | number | `valor_venda` | DECIMAL(15,2) | Valor total da venda |
| `totalSellingValue` | number | `valor_venda_total` | DECIMAL(15,2) | Valor total de venda (adicionar) |
| `situation` | string | `situacao_contrato` | TEXT | 0=Solicitado, 1=Autorizado, 2=Emitido, 3=Cancelado |
| `salesContractCustomers[0].id` | number | `cliente_id` | UUID | Via `sienge_customer_id` |
| `salesContractCustomers[0].name` | string | → Buscar cliente | TEXT | Nome do cliente |
| `salesContractUnits[0].id` | number | `unidade_id` | UUID | Via `sienge_unit_id` |
| `salesContractUnits[0].name` | string | `unidade` | TEXT | Nome/código da unidade |
| `brokers[0].id` | number | `corretor_id` | UUID | Via `sienge_broker_id` |
| `brokers[0].main` | boolean | → Determinar corretor principal | BOOLEAN | Se é corretor principal |
| `paymentConditions[]` | array | → Calcular pro-soluto | - | **ARRAY** de condições de pagamento |
| `paymentConditions[].installmentsNumber` | number | `qtd_parcelas` | INTEGER | Soma de todas as parcelas |
| `paymentConditions[].totalValue` | number | `valor_pro_soluto` | DECIMAL(15,2) | Soma de todos os valores |
| `paymentConditions[].conditionTypeName` | string | - | TEXT | Tipo: "Ato", "Parcelas Mensais", "BALÃO ANUAL", etc. |
| `cancellationDate` | string | `data_cancelamento` | DATE | Se cancelado (adicionar) |
| `cancellationReason` | string | `motivo_cancelamento` | TEXT | Motivo do cancelamento (adicionar) |
| `modifiedAfter` / `modifiedBefore` | string | `sienge_updated_at` | TIMESTAMPTZ | Última atualização |

**Campos adicionais que precisamos adicionar:**
- `sienge_contract_id` (TEXT UNIQUE) - ID do contrato no Sienge
- `numero_contrato` (TEXT) - Número do contrato
- `data_emissao` (DATE) - Data de emissão
- `valor_venda_total` (DECIMAL) - Valor total de venda
- `situacao_contrato` (TEXT) - Situação do contrato
- `sienge_broker_id` (TEXT) - ID do corretor no Sienge
- `sienge_unit_id` (TEXT) - ID da unidade no Sienge
- `qtd_parcelas` (INTEGER) - Quantidade de parcelas
- `data_cancelamento` (DATE) - Data de cancelamento
- `motivo_cancelamento` (TEXT) - Motivo do cancelamento
- `sienge_updated_at` (TIMESTAMPTZ) - Última atualização no Sienge

---

### CORRETORES (extraído de `brokers` no contrato → `usuarios`)

| Campo API Sienge | Tipo API | Campo Banco Supabase | Tipo Banco | Observações |
|-----------------|----------|---------------------|------------|-------------|
| `brokers[0].id` | number | `sienge_broker_id` | TEXT | **Chave de sincronização** |
| `brokers[0].main` | boolean | → Determinar corretor principal | BOOLEAN | Se é o corretor principal |

**Nota:** O Sienge não tem endpoint específico de corretores. Eles vêm dentro do contrato de venda no campo `brokers[]`.

**Campos adicionais que precisamos adicionar:**
- `sienge_broker_id` (TEXT) - ID do corretor no Sienge

---

### EMPREENDIMENTOS (`/enterprises` → `empreendimentos`)

| Campo API Sienge | Tipo API | Campo Banco Supabase | Tipo Banco | Observações |
|-----------------|----------|---------------------|------------|-------------|
| `id` | number | `sienge_enterprise_id` | TEXT | **Chave de sincronização** |
| `name` | string | `nome` | TEXT | Nome do empreendimento |

**Campos adicionais que precisamos adicionar:**
- `sienge_enterprise_id` (TEXT UNIQUE) - ID do empreendimento no Sienge

---

### UNIDADES (`/units` → precisa criar tabela ou campo)

| Campo API Sienge | Tipo API | Campo Banco Supabase | Tipo Banco | Observações |
|-----------------|----------|---------------------|------------|-------------|
| `id` | number | `sienge_unit_id` | TEXT | ID da unidade no Sienge |
| `name` | string | `unidade` | TEXT | Nome/código da unidade |

**Nota:** Unidades já estão na tabela `vendas` como `unidade`, `bloco`, `andar`. Podemos adicionar `sienge_unit_id` na tabela `vendas`.

---

## 🔄 Estratégia de Sincronização

### 1. Clientes
- Buscar por `sienge_customer_id` (chave única)
- Se não existir, criar novo
- Se existir, atualizar dados
- Sincronizar cônjuge em `complementadores_renda`

### 2. Vendas/Contratos
- Buscar por `sienge_contract_id` (chave única)
- Se não existir, criar nova venda
- Se existir, atualizar dados
- Vincular cliente via `sienge_customer_id`
- Vincular corretor via `sienge_broker_id` (extrair do `brokers[]`)

### 3. Corretores
- Extrair do campo `brokers[]` dos contratos
- Buscar por `sienge_broker_id`
- Se não existir, criar novo corretor
- Se existir, atualizar `sienge_broker_id` se estiver vazio

### 4. Empreendimentos
- Buscar por `sienge_enterprise_id`
- Se não existir, criar novo
- Se existir, atualizar nome se necessário

---

## 📊 Resposta da API - Estrutura Real

### `/customers` Response:
```json
{
  "resultSetMetadata": {
    "count": 100,
    "offset": 0,
    "limit": 100
  },
  "results": [
    {
      "id": 12345,
      "name": "João Silva",
      "cpf": "12345678901",
      "email": "joao@email.com",
      "birthDate": "1990-01-15",
      "numberIdentityCard": "1234567",
      "profession": "Engenheiro",
      "phones": [
        {
          "number": "11999999999",
          "main": true,
          "type": "Celular"
        }
      ],
      "addresses": [
        {
          "streetName": "Rua Exemplo",
          "number": "123",
          "neighborhood": "Centro",
          "city": "São Paulo",
          "state": "SP",
          "zipCode": "01234567"
        }
      ],
      "spouse": {
        "name": "Maria Silva",
        "cpf": "98765432100",
        "email": "maria@email.com"
      },
      "createdAt": "2024-01-01T10:00:00Z",
      "modifiedAt": "2024-01-15T14:30:00Z"
    }
  ]
}
```

### `/sales-contracts` Response:
```json
{
  "resultSetMetadata": {
    "count": 50,
    "offset": 0,
    "limit": 100
  },
  "results": [
    {
      "id": 67890,
      "enterpriseId": 12089,
      "enterpriseName": "FIGUEIRA GARCIA",
      "number": "CT-2024-001",
      "contractDate": "2024-01-15",
      "issueDate": "2024-01-20",
      "value": 500000.00,
      "totalSellingValue": 500000.00,
      "situation": "2",
      "salesContractCustomers": [
        {
          "id": 12345,
          "name": "João Silva",
          "main": true
        }
      ],
      "salesContractUnits": [
        {
          "id": 999,
          "name": "Apto 101",
          "main": true
        }
      ],
      "brokers": [
        {
          "id": 111,
          "main": true
        }
      ],
      "paymentConditions": [
        {
          "conditionTypeName": "Ato",
          "installmentsNumber": 1,
          "totalValue": 50000.00
        },
        {
          "conditionTypeName": "Parcelas Mensais",
          "installmentsNumber": 120,
          "totalValue": 450000.00
        }
      ]
    }
  ]
}
```

---

## ⚠️ Pontos de Atenção

1. **Paginação**: APIs retornam `resultSetMetadata` com `count`, `offset`, `limit`
2. **Arrays**: `phones[]`, `addresses[]`, `brokers[]`, `salesContractCustomers[]`, `salesContractUnits[]`, `paymentConditions[]` - sempre tratar como arrays
3. **paymentConditions**: É um **ARRAY** de condições de pagamento. Para calcular pro-soluto, somar `totalValue` de todas as condições
4. **Datas**: Formato `yyyy-MM-dd` ou ISO 8601
5. **IDs**: Sempre converter para TEXT no banco (pode ser número grande)
6. **Valores**: Sempre usar DECIMAL(15,2) para valores monetários
7. **Situação do contrato**: 0=Solicitado, 1=Autorizado, 2=Emitido, 3=Cancelado

---

## 🎯 Próximos Passos

1. ✅ Criar migrations para adicionar campos `sienge_*`
2. ✅ Criar mapeamento de dados (API → Banco)
3. ✅ Implementar sincronização incremental (só o que mudou)
4. ✅ Criar componente de sincronização no AdminDashboard

