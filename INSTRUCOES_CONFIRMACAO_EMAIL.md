# Instruções: Desabilitar Confirmação de Email no Supabase

## Problema
O sistema está exigindo confirmação de email para fazer login, o que não é necessário para sistemas internos.

## Solução

### Opção 1: Desabilitar Confirmação de Email (Recomendado)

1. Acesse o painel do Supabase: https://supabase.com/dashboard
2. Selecione seu projeto
3. Vá em **Authentication** > **Settings**
4. Na seção **Email Auth**, encontre **"Confirm email"**
5. **Desabilite** a opção "Confirm email"
6. Salve as alterações

### Opção 2: Confirmar Email Manualmente (Via SQL)

Se você não quiser desabilitar a confirmação globalmente, pode confirmar emails manualmente:

```sql
-- Confirmar email de um usuário específico
UPDATE auth.users 
SET email_confirmed_at = NOW() 
WHERE email = 'email@exemplo.com';

-- Confirmar todos os emails não confirmados
UPDATE auth.users 
SET email_confirmed_at = NOW() 
WHERE email_confirmed_at IS NULL;
```

### Opção 3: Usar Admin API (Avançado)

Se você tiver acesso ao Service Role Key do Supabase, pode criar uma função para confirmar emails automaticamente.

## Após Aplicar a Solução

Após desabilitar a confirmação de email ou confirmar os emails manualmente, os usuários poderão fazer login normalmente sem precisar confirmar o email.

