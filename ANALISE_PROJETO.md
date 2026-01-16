# 📊 Análise Completa do Projeto IM-Calculo

## 🏗️ Arquitetura Geral

### Stack Tecnológica
- **Frontend**: React 18 + Vite
- **Backend**: Supabase (PostgreSQL + Auth + Storage)
- **Roteamento**: React Router DOM v7
- **Bibliotecas**: 
  - `@supabase/supabase-js` - Cliente Supabase
  - `xlsx` - Importação de planilhas Excel
  - `jspdf` + `jspdf-autotable` - Geração de PDFs
  - `lucide-react` - Ícones

### Estrutura do Projeto
```
src/
├── components/          # Componentes reutilizáveis
│   ├── ImportarClientes.jsx
│   ├── ImportarVendas.jsx
│   ├── CadastrarCorretores.jsx
│   └── Ticker.jsx
├── pages/              # Páginas principais
│   ├── AdminDashboard.jsx
│   ├── CorretorDashboard.jsx
│   ├── ClienteDashboard.jsx
│   ├── HomeDashboard.jsx
│   └── Login.jsx
├── contexts/           # Context API
│   └── AuthContext.jsx
├── lib/                # Configurações
│   └── supabase.js
└── styles/             # CSS por componente
```

---

## 🗄️ Estrutura do Banco de Dados

### Tabelas Principais

#### 1. **usuarios** (Perfis de Usuários)
```sql
- id (UUID, PK, FK -> auth.users)
- email (TEXT, UNIQUE)
- nome (TEXT)
- tipo (ENUM: 'admin', 'corretor', 'cliente')
- tipo_corretor (ENUM: 'interno', 'externo') - apenas para corretores
- empreendimento_id (UUID, FK -> empreendimentos)
- cargo_id (UUID, FK -> cargos_empreendimento)
- percentual_corretor (DECIMAL) - para corretores autônomos
- telefone, ativo, created_at, updated_at
```

**Relacionamento**: 
- Um usuário = um registro em `auth.users` (Supabase Auth)
- Um usuário pode ser admin, corretor ou cliente
- Corretores podem estar vinculados a um empreendimento ou serem autônomos

#### 2. **empreendimentos** (Empreendimentos Imobiliários)
```sql
- id (UUID, PK)
- nome (TEXT)
- descricao (TEXT)
- comissao_total_externo (DECIMAL, default 7.0)
- comissao_total_interno (DECIMAL, default 6.0)
- ativo (BOOLEAN)
```

**Função**: Define empreendimentos e seus percentuais totais de comissão

#### 3. **cargos_empreendimento** (Cargos e Percentuais por Empreendimento)
```sql
- id (UUID, PK)
- empreendimento_id (UUID, FK)
- tipo_corretor (ENUM: 'externo', 'interno')
- nome_cargo (TEXT) - ex: "Diretor", "Corretor Externo", "Nohros Imobiliária"
- percentual (DECIMAL) - ex: 0.5, 1.0, 4.0
- ordem (INTEGER)
```

**Função**: Define como a comissão total é distribuída entre diferentes cargos/beneficiários

**Exemplo de Distribuição**:
- **Externo (7%)**: Diretor 0.5%, Nohros Imobiliária 0.5%, Nohros Gestão 1%, WSC 0.5%, Corretor 4%, Coordenadora 0.5%
- **Interno (6.5%)**: Diretor 0.5%, Nohros Imobiliária 1.25%, Nohros Gestão 1%, WSC 1.25%, Corretor 2.5%

#### 4. **vendas** (Vendas Registradas)
```sql
- id (UUID, PK)
- corretor_id (UUID, FK -> usuarios)
- empreendimento_id (UUID, FK -> empreendimentos) - NULL para corretores autônomos
- cliente_id (UUID, FK -> clientes)
- valor_venda (DECIMAL)
- tipo_corretor (ENUM: 'interno', 'externo')
- data_venda (DATE)
- descricao (TEXT)
- status (ENUM: 'pendente', 'pago')
- unidade, bloco, andar (TEXT) - informações do imóvel

-- Campos Pro-Soluto
- teve_sinal (BOOLEAN)
- valor_sinal (DECIMAL)
- teve_entrada (BOOLEAN)
- valor_entrada (DECIMAL)
- parcelou_entrada (BOOLEAN)
- qtd_parcelas_entrada (INTEGER)
- valor_parcela_entrada (DECIMAL)
- teve_balao (ENUM: 'nao', 'sim', 'pendente')
- qtd_balao (INTEGER)
- valor_balao (DECIMAL)
- teve_permuta (BOOLEAN)
- tipo_permuta (TEXT)
- valor_permuta (DECIMAL)

-- Cálculos
- valor_pro_soluto (DECIMAL) - sinal + entrada + balões
- fator_comissao (DECIMAL) - percentual total / 100
- comissao_total (DECIMAL) - comissão total calculada
- comissao_corretor (DECIMAL) - comissão específica do corretor

-- Documentos
- contrato_url (TEXT) - URL do arquivo no Storage
- contrato_nome (TEXT)
```

**Função**: Armazena todas as vendas com seus detalhes e cálculos de comissão

#### 5. **pagamentos_prosoluto** (Pagamentos Pro-Soluto)
```sql
- id (UUID, PK)
- venda_id (UUID, FK -> vendas)
- tipo (ENUM: 'sinal', 'entrada', 'parcela_entrada', 'balao')
- numero_parcela (INTEGER) - para parcelas e balões
- valor (DECIMAL) - valor do pagamento
- data_prevista (DATE)
- data_pagamento (DATE) - preenchido quando pago
- status (ENUM: 'pendente', 'pago', 'atrasado')
- comissao_gerada (DECIMAL) - comissão calculada para este pagamento
- valor_comissao_pago (DECIMAL) - valor personalizado quando confirmado
- valor_ja_pago (DECIMAL) - para ajustes de pagamentos parciais
```

**Função**: Controla os pagamentos parcelados do Pro-Soluto e as comissões geradas por cada pagamento

**Lógica**:
- Cada parcela gera uma comissão proporcional: `valor_parcela * fator_comissao`
- Exemplo: Se fator = 0.07 (7%) e parcela = R$ 1.000, comissão = R$ 70

#### 6. **comissoes_venda** (Comissões por Cargo)
```sql
- id (UUID, PK)
- venda_id (UUID, FK -> vendas)
- cargo_id (UUID, FK -> cargos_empreendimento)
- nome_cargo (TEXT)
- percentual (DECIMAL)
- valor_comissao (DECIMAL)
- valor_pago (DECIMAL)
```

**Função**: Armazena o detalhamento de comissões por cargo/beneficiário para cada venda

#### 7. **clientes** (Clientes)
```sql
- id (UUID, PK)
- nome_completo (TEXT)
- cpf, rg, telefone, email
- endereco, cep
- profissao, empresa_trabalho
- renda_mensal (DECIMAL)
- user_id (UUID, FK -> auth.users) - para acesso ao sistema
- possui_3_anos_fgts, beneficiado_subsidio_fgts (BOOLEAN)
- tem_complemento_renda (BOOLEAN)
- Documentos (URLs do Storage): rg_frente_url, rg_verso_url, cpf_url, etc.
```

#### 8. **complementadores_renda** (Cônjuges/Complementadores)
```sql
- id (UUID, PK)
- cliente_id (UUID, FK -> clientes)
- nome, cpf, rg, telefone, email
- profissao, empresa_trabalho
- valor_complemento (DECIMAL)
```

---

## 🔐 Sistema de Autenticação e Autorização

### Como Funciona SEM RLS (Row Level Security)

**Status Atual**: As políticas RLS estão **definidas no schema**, mas muitas tabelas têm RLS **DESABILITADO**:
- `empreendimentos` - RLS DISABLED
- `cargos_empreendimento` - RLS DISABLED
- `comissoes_venda` - RLS DISABLED
- `pagamentos_prosoluto` - RLS DISABLED
- `clientes` - RLS DISABLED
- `complementadores_renda` - RLS DISABLED

**Tabelas com RLS HABILITADO**:
- `usuarios` - RLS ENABLED (mas pode não estar funcionando corretamente)
- `vendas` - RLS ENABLED (mas pode não estar funcionando corretamente)

### Fluxo de Autenticação

1. **Login** (`src/pages/Login.jsx`):
   - Usuário faz login via `supabase.auth.signInWithPassword()`
   - Supabase retorna `session` com `access_token`

2. **Carregamento de Perfil** (`src/contexts/AuthContext.jsx`):
   - Após login, busca perfil na tabela `usuarios` usando `user.id`
   - Usa **fetch direto** à REST API do Supabase (bypass do cliente)
   - Query: `GET /rest/v1/usuarios?id=eq.{userId}`
   - Headers: `Authorization: Bearer {access_token}`

3. **Autorização no Frontend**:
   - `AuthContext` fornece `userProfile` com `tipo` (admin/corretor/cliente)
   - Componente `ProtectedRoute` verifica o tipo e redireciona:
     - Admin → `/admin`
     - Corretor → `/corretor`
     - Cliente → `/cliente`

4. **Queries ao Banco**:
   - Todas as queries usam o cliente Supabase: `supabase.from('tabela').select()`
   - Como RLS está desabilitado na maioria das tabelas, **qualquer usuário autenticado pode acessar todos os dados**
   - A segurança depende **apenas do frontend** (não é segura!)

### Problemas de Segurança Atuais

⚠️ **CRÍTICO**: Sem RLS funcionando corretamente:
- Qualquer corretor autenticado pode ver todas as vendas
- Qualquer corretor pode modificar dados de outros corretores
- Clientes podem acessar dados de outros clientes
- Apenas o frontend impede acesso indevido (facilmente burlável)

---

## 🔄 Fluxo de Dados Frontend ↔ Backend

### 1. Inicialização do Dashboard

**AdminDashboard** (`src/pages/AdminDashboard.jsx`):
```javascript
const fetchData = async () => {
  // Busca paralela de todos os dados
  const [corretores, vendas, empreendimentos] = await Promise.all([
    supabase.from('usuarios').select('*').eq('tipo', 'corretor'),
    supabase.from('vendas').select('*'),
    supabase.from('empreendimentos').select('*')
  ])
  
  // Busca cargos
  const cargos = await supabase.from('cargos_empreendimento').select('*')
  
  // Busca pagamentos em lotes (limite 1000)
  let pagamentos = []
  let page = 0
  while (hasMore) {
    const pageData = await supabase
      .from('pagamentos_prosoluto')
      .select('*')
      .range(page * 1000, (page + 1) * 1000 - 1)
    // ...
  }
}
```

**CorretorDashboard** (`src/pages/CorretorDashboard.jsx`):
```javascript
const fetchVendas = async () => {
  // Busca apenas vendas do corretor logado
  const vendas = await supabase
    .from('vendas')
    .select('*')
    .eq('corretor_id', user.id)  // Filtro no frontend!
    .order('data_venda', { ascending: false })
}
```

### 2. Criação de Venda

**Fluxo**:
1. Admin preenche formulário de venda
2. Sistema calcula comissões dinamicamente:
   ```javascript
   const calcularComissoesDinamicas = (valorVenda, empreendimentoId, tipoCorretor) => {
     // Busca empreendimento e seus cargos
     const emp = empreendimentos.find(e => e.id === empreendimentoId)
     const cargosDoTipo = emp.cargos?.filter(c => c.tipo_corretor === tipoCorretor)
     
     // Calcula comissão por cargo
     const comissoesPorCargo = cargosDoTipo.map(cargo => ({
       cargo_id: cargo.id,
       nome_cargo: cargo.nome_cargo,
       percentual: parseFloat(cargo.percentual),
       valor: (valorVenda * parseFloat(cargo.percentual)) / 100
     }))
     
     return { cargos: comissoesPorCargo, total, percentualTotal }
   }
   ```
3. Salva venda no banco:
   ```javascript
   await supabase.from('vendas').insert([vendaData])
   ```
4. Se necessário, gera pagamentos pro-soluto:
   ```javascript
   const gerarPagamentosVenda = async (venda) => {
     // Calcula fator de comissão
     const fatorComissao = comissoesDinamicas.percentualTotal / 100
     
     // Cria pagamentos (sinal, parcelas, balões)
     novosPagamentos.push({
       venda_id: venda.id,
       tipo: 'sinal',
       valor: valorSinal,
       comissao_gerada: valorSinal * fatorComissao
     })
     
     await supabase.from('pagamentos_prosoluto').insert(novosPagamentos)
   }
   ```

### 3. Importação em Massa

**ImportarVendas** (`src/components/ImportarVendas.jsx`):
1. Lê arquivo Excel usando `xlsx`
2. Valida e normaliza dados (datas, valores, nomes)
3. Busca corretores, empreendimentos e clientes por nome (fuzzy matching)
4. Para cada linha:
   - Calcula comissões dinamicamente
   - Cria venda
   - Gera pagamentos pro-soluto
   - Insere tudo no banco

**ImportarClientes** (`src/components/ImportarClientes.jsx`):
1. Lê arquivo Excel
2. Normaliza CPFs, telefones, emails
3. Busca cliente existente por CPF ou email
4. Se não existir, cria novo cliente
5. Cria complementadores de renda (cônjuges) se houver

### 4. Confirmação de Pagamento

**Fluxo**:
1. Admin marca pagamento como "pago"
2. Sistema permite personalizar valor da comissão
3. Atualiza `pagamentos_prosoluto`:
   ```javascript
   await supabase
     .from('pagamentos_prosoluto')
     .update({
       status: 'pago',
       data_pagamento: dataPagamento,
       valor_comissao_pago: valorPersonalizado || comissao_gerada
     })
     .eq('id', pagamentoId)
   ```

---

## 💰 Sistema de Cálculo de Comissões

### Tipos de Corretores

#### 1. **Corretor Vinculado a Empreendimento**
- Usa cargos configurados no empreendimento
- Comissão calculada dinamicamente baseada nos cargos
- Exemplo: Se empreendimento tem 7% total, distribui entre Diretor, Nohros, WSC, Corretor, etc.

#### 2. **Corretor Autônomo**
- Não vinculado a empreendimento
- Usa `percentual_corretor` do próprio usuário
- Comissão = `valor_venda * (percentual_corretor / 100)`

### Cálculo de Comissões por Pagamento

**Fórmula**:
```
fator_comissao = percentual_total_comissao / 100
comissao_parcela = valor_parcela * fator_comissao
```

**Exemplo**:
- Venda: R$ 500.000
- Comissão total: 7% (R$ 35.000)
- Fator: 0.07
- Parcela de R$ 10.000 → Comissão: R$ 10.000 × 0.07 = R$ 700

### Distribuição por Cargo

Quando uma parcela é paga, a comissão é distribuída proporcionalmente:
```javascript
const calcularComissaoPorCargoPagamento = (pagamento) => {
  const venda = vendas.find(v => v.id === pagamento.venda_id)
  const fatorComissao = venda.fator_comissao || 0
  
  // Busca cargos do empreendimento
  const cargos = empreendimento.cargos.filter(c => 
    c.tipo_corretor === venda.tipo_corretor
  )
  
  // Calcula comissão por cargo
  return cargos.map(cargo => ({
    nome_cargo: cargo.nome_cargo,
    percentual: cargo.percentual,
    valor: pagamento.valor * (cargo.percentual / 100)
  }))
}
```

---

## 📊 Relacionamentos entre Tabelas

```
auth.users (Supabase Auth)
    ↓ (1:1)
usuarios
    ↓ (1:N)
vendas ←──┐
    │     │
    ↓     │
empreendimentos ──→ cargos_empreendimento
    │                    │
    └────────────────────┘
         ↓
    comissoes_venda
         ↑
    vendas
         ↓
pagamentos_prosoluto

clientes ←── complementadores_renda
    ↓
vendas (cliente_id)
```

---

## 🔍 Pontos de Atenção

### 1. **Segurança**
- ⚠️ RLS desabilitado na maioria das tabelas
- ⚠️ Autorização apenas no frontend
- ⚠️ Qualquer usuário autenticado pode acessar todos os dados

### 2. **Performance**
- Busca de pagamentos em lotes (limite 1000)
- Múltiplas queries paralelas no `fetchData`
- Cache de pagamentos no CorretorDashboard

### 3. **Integridade de Dados**
- Validações no frontend (CPF, email, datas)
- Triggers no banco para `updated_at`
- Foreign keys com `ON DELETE CASCADE`

### 4. **Funcionalidades**
- ✅ Importação em massa (Excel)
- ✅ Cálculo dinâmico de comissões
- ✅ Sistema Pro-Soluto (parcelas)
- ✅ Upload de documentos (Storage)
- ✅ Geração de PDFs
- ✅ Filtros e buscas avançadas

---

## 🚀 Como o Sistema Funciona Atualmente

### Sem RLS Funcionando:

1. **Autenticação**: Funciona via Supabase Auth
2. **Autorização**: Apenas no frontend (não segura)
3. **Acesso aos Dados**: 
   - Qualquer usuário autenticado pode fazer queries em qualquer tabela
   - Filtros aplicados apenas no frontend (ex: `.eq('corretor_id', user.id)`)
   - Um corretor pode modificar a query e ver todas as vendas

4. **Operações**:
   - ✅ CRUD completo funcionando
   - ✅ Cálculos de comissão funcionando
   - ✅ Importação em massa funcionando
   - ✅ Geração de pagamentos funcionando
   - ⚠️ Segurança comprometida

### Recomendações:

1. **Habilitar e testar RLS** em todas as tabelas
2. **Implementar políticas corretas** para cada tipo de usuário
3. **Adicionar validações no backend** (Edge Functions ou Database Functions)
4. **Auditar queries** para garantir que filtros estão sendo aplicados

---

## 📝 Conclusão

O sistema está **funcionalmente completo** e operando, mas com **vulnerabilidades de segurança críticas** devido ao RLS desabilitado. A arquitetura é sólida, o código está bem estruturado, e as funcionalidades principais estão implementadas. O principal ponto de atenção é a segurança dos dados, que atualmente depende apenas do frontend.

