# 🚀 Setup da Integração Sienge - Guia Completo

## ✅ O que foi criado

### 1. Estrutura de Pastas
```
src/
├── lib/
│   └── sienge.js                    # Configuração da API
├── services/
│   └── sienge/
│       ├── siengeClient.js          # Cliente HTTP da API
│       ├── syncUtils.js             # Utilitários de mapeamento
│       ├── syncClientes.js          # Sincronização de clientes
│       ├── syncVendas.js            # Sincronização de vendas
│       ├── syncCorretores.js        # Sincronização de corretores
│       └── index.js                 # Exportações
├── components/
│   └── SincronizarSienge.jsx        # Componente React
└── styles/
    └── SincronizarSienge.css        # Estilos do componente
```

### 2. Migration do Banco de Dados
```
migrations/
└── add_sienge_fields.sql            # Campos sienge_* nas tabelas
```

### 3. Documentação
```
SIENGE_INTEGRACAO.md                 # Mapeamento completo API → Banco
SIENGE_SETUP.md                      # Este arquivo
```

---

## 📋 Próximos Passos

### 1. Executar a Migration

No Supabase SQL Editor, execute:

```sql
-- Copie e cole o conteúdo de migrations/add_sienge_fields.sql
```

Ou execute diretamente:
```bash
# Se tiver psql configurado
psql -h seu-host -U postgres -d seu-db -f migrations/add_sienge_fields.sql
```

### 2. Configurar Variáveis de Ambiente

No arquivo `.env` (raiz do projeto), adicione:

```env
VITE_SIENGE_BASE_URL=https://api.sienge.com.br
VITE_SIENGE_SUBDOMAIN=imincorporadora
VITE_SIENGE_USERNAME=seu_username_aqui
VITE_SIENGE_PASSWORD=seu_password_aqui
VITE_SIENGE_ENTERPRISE_ID=12089
```

**⚠️ IMPORTANTE:** Não commite o `.env` no git! Ele já deve estar no `.gitignore`.

### 3. Adicionar Componente no AdminDashboard

No arquivo `src/pages/AdminDashboard.jsx`, adicione:

```javascript
// No topo, junto com os outros imports
import SincronizarSienge from '../components/SincronizarSienge'

// Na lista de tabs, adicione:
{/* ... outras tabs ... */}
{activeTab === 'sienge' && (
  <SincronizarSienge />
)}
```

E no menu lateral, adicione um item para a tab 'sienge'.

### 4. Testar em Modo Dry-Run

1. Acesse o AdminDashboard
2. Vá na tab "Sincronizar Sienge"
3. **Deixe o checkbox "Modo TESTE" marcado**
4. Clique em "Sincronizar Tudo"
5. Verifique os logs e estatísticas
6. **Nenhum dado será salvo** (modo teste)

### 5. Executar Sincronização Real

Após validar no modo teste:

1. **Desmarque** o checkbox "Modo TESTE"
2. Clique em "Sincronizar Tudo" novamente
3. Aguarde a conclusão
4. Verifique os dados no banco

---

## 🔍 Como Funciona

### Mapeamento de Dados

A sincronização mapeia exatamente os campos da API para o banco:

- **Clientes**: `/customers` → `clientes`
  - `id` → `sienge_customer_id`
  - `name` → `nome_completo`
  - `cpf` → `cpf`
  - `spouse` → `complementadores_renda`

- **Vendas**: `/sales-contracts` → `vendas`
  - `id` → `sienge_contract_id`
  - `value` → `valor_venda`
  - `contractDate` → `data_venda`
  - `brokers[0].id` → `sienge_broker_id`

- **Corretores**: Extraídos de `brokers[]` nos contratos
  - `brokers[0].id` → `sienge_broker_id` em `usuarios`

### Estratégia de Sincronização

1. **Idempotência**: Usa `sienge_*_id` como chave única
2. **Upsert**: Se existe, atualiza; se não, cria
3. **Incremental**: Pode filtrar por `modifiedAfter` (futuro)
4. **Paginação**: Processa em lotes de 100-200 registros

---

## ⚙️ Configurações Avançadas

### Sincronização Incremental

Para sincronizar apenas o que mudou desde a última vez:

```javascript
// Em syncClientes ou syncVendas
const ultimaSync = localStorage.getItem('sienge_last_sync')
const modifiedAfter = ultimaSync || null

await syncClientes({
  modifiedAfter,
  dryRun: false
})

// Salvar data da última sincronização
localStorage.setItem('sienge_last_sync', new Date().toISOString().split('T')[0])
```

### Filtrar por Empreendimento

O `enterpriseId` já está configurado nas variáveis de ambiente e é usado automaticamente.

Para sincronizar outro empreendimento:

```javascript
await syncVendas({
  enterpriseId: 99999, // ID diferente
  dryRun: false
})
```

---

## 🐛 Troubleshooting

### Erro: "Credenciais Sienge não configuradas"
- Verifique se as variáveis de ambiente estão no `.env`
- Reinicie o servidor de desenvolvimento após alterar `.env`

### Erro: "404 Not Found" na API
- Verifique se o `subdomain` está correto
- Confirme que os recursos estão liberados no Sienge
- Teste a URL manualmente no navegador (com autenticação)

### Erro: "Campo não existe" no banco
- Execute a migration `add_sienge_fields.sql`
- Verifique se todas as colunas foram criadas

### Dados duplicados
- Verifique se os índices `UNIQUE` foram criados
- Use `sienge_*_id` como chave de sincronização (já implementado)

---

## 📊 Monitoramento

### Logs no Console
Todos os erros e avisos são logados no console do navegador (F12).

### Estatísticas
O componente mostra:
- Total processado
- Criados
- Atualizados
- Erros

### Verificação no Banco
```sql
-- Verificar clientes sincronizados
SELECT COUNT(*) FROM clientes WHERE sienge_customer_id IS NOT NULL;

-- Verificar vendas sincronizadas
SELECT COUNT(*) FROM vendas WHERE sienge_contract_id IS NOT NULL;

-- Verificar corretores sincronizados
SELECT COUNT(*) FROM usuarios WHERE sienge_broker_id IS NOT NULL;
```

---

## 🎯 Próximas Melhorias (Futuro)

1. **Webhooks**: Sincronização automática quando dados mudam no Sienge
2. **Agendamento**: Sincronização automática em horários específicos
3. **Conflitos**: Resolver divergências entre Sienge e Supabase
4. **Relatórios**: Dashboard de sincronização
5. **Notificações**: Alertas quando há erros na sincronização

---

## 📞 Suporte

Em caso de dúvidas:
1. Verifique os logs no componente
2. Verifique o console do navegador (F12)
3. Verifique a documentação em `SIENGE_INTEGRACAO.md`

---

**✅ Tudo pronto para testar!**

