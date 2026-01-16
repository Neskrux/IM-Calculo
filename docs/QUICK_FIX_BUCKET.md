# 🚨 Erro: Bucket not found - Solução Rápida

## Problema
```
StorageApiError: Bucket not found
```

## Solução (2 minutos)

### 1. Acesse o Supabase Dashboard
- Vá em: https://supabase.com/dashboard
- Selecione seu projeto

### 2. Crie o Bucket
- Menu lateral → **Storage**
- Clique em **"New bucket"**
- **Nome**: `empreendimentos-fotos` (exatamente assim, sem espaços)
- ✅ **Marque "Public bucket"**
- Clique em **"Create bucket"**

### 3. Teste Novamente
- Volte para o sistema
- Tente fazer upload de uma foto
- Deve funcionar! ✅

---

## Verificação Rápida

Execute este SQL no Supabase SQL Editor para verificar se o bucket existe:

```sql
-- Verificar buckets (via API, não SQL direto)
-- Mas você pode verificar visualmente no Dashboard → Storage
```

**Ou simplesmente:**
- Vá em Storage no Dashboard
- Se você ver `empreendimentos-fotos` na lista = ✅ Criado
- Se não ver = ❌ Precisa criar

---

## Se ainda não funcionar

1. Verifique se o nome está **exatamente** `empreendimentos-fotos`
2. Verifique se está marcado como **Public**
3. Verifique as políticas RLS (veja `CONFIGURACAO_STORAGE_FOTOS.md`)
