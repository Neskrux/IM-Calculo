# 🏢 Nohros Imobiliária - Sistema de Comissões

Sistema de cálculo e gestão de comissões para corretores de imóveis.

## 📋 Funcionalidades

### Para Administradores:
- ✅ Visualizar todas as vendas e comissões
- ✅ Cadastrar novas vendas
- ✅ Editar e excluir vendas existentes
- ✅ Ver lista de corretores e seus ganhos
- ✅ Relatórios de distribuição de comissões
- ✅ Filtrar por tipo de corretor (interno/externo)

### Para Corretores:
- ✅ Visualizar suas vendas
- ✅ Ver comissão a receber
- ✅ Acompanhar status de pagamento
- ✅ Filtrar vendas por período

## 📊 Tabela de Comissões

### Corretor EXTERNO (Total: 7%)
| Beneficiário | Percentual |
|--------------|------------|
| Diretor | 0,5% |
| Nohros Imobiliária | 0,5% |
| Nohros Gestão (Ferreti) | 1% |
| WSC (Beton) | 0,5% |
| Corretor Externo | 4% |
| Coordenadora | 0,5% |

### Corretor INTERNO (Total: 6,5%)
| Beneficiário | Percentual |
|--------------|------------|
| Diretor | 0,5% |
| Nohros Imobiliária | 1,25% |
| Nohros Gestão (Ferreti) | 1% |
| WSC (Beton) | 1,25% |
| Corretor Interno | 2,5% |

## 🚀 Configuração

### 1. Configurar Supabase

1. Acesse [supabase.com](https://supabase.com) e crie um projeto
2. Vá em **SQL Editor** e execute o conteúdo do arquivo `supabase-schema.sql`
3. Copie a **URL do projeto** e a **anon key** (em Settings > API)

### 2. Configurar Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
VITE_SUPABASE_URL=sua_url_do_supabase
VITE_SUPABASE_ANON_KEY=sua_chave_anonima
```

### 3. Criar Usuários no Supabase

1. No Supabase, vá em **Authentication > Users**
2. Clique em **Add User** e crie um usuário admin
3. Após criar, copie o UUID do usuário
4. Execute no SQL Editor:

```sql
INSERT INTO usuarios (id, email, nome, tipo)
VALUES ('UUID_COPIADO', 'admin@suaempresa.com', 'Administrador', 'admin');
```

5. Repita o processo para criar corretores:

```sql
INSERT INTO usuarios (id, email, nome, tipo, tipo_corretor)
VALUES ('UUID_DO_CORRETOR', 'corretor@email.com', 'Nome do Corretor', 'corretor', 'externo');
```

### 4. Instalar e Executar

```bash
# Instalar dependências
npm install

# Executar em desenvolvimento
npm run dev

# Build para produção
npm run build
```

## 🛠 Tecnologias Utilizadas

- **React 18** - Framework frontend
- **Vite** - Build tool
- **Supabase** - Backend (Auth + Database)
- **React Router** - Roteamento
- **Lucide React** - Ícones

## 📱 Responsivo

O sistema é totalmente responsivo e funciona em:
- 💻 Desktop
- 📱 Tablet
- 📱 Mobile

## 🎨 Design

- Tema escuro elegante com detalhes em dourado
- Interface profissional para imobiliária
- Animações suaves
- Componentes modernos

## 📞 Suporte

Em caso de dúvidas, entre em contato com o desenvolvedor.
