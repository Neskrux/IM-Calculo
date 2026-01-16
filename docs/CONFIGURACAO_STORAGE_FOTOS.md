# 📸 Configuração do Storage para Fotos de Empreendimentos

## ⚠️ IMPORTANTE: Criar o Bucket Primeiro!

**O bucket `empreendimentos-fotos` precisa ser criado antes de fazer upload de fotos!**

## 🎯 Passo 1: Criar o Bucket no Supabase

1. Acesse o **Supabase Dashboard** → https://supabase.com/dashboard
2. Selecione seu projeto
3. Vá em **Storage** (menu lateral esquerdo)
4. Clique no botão **"New bucket"** (canto superior direito)
5. Configure o bucket:
   - **Name**: `empreendimentos-fotos` ⚠️ **EXATO** (sem espaços, sem maiúsculas)
   - **Public bucket**: ✅ **MARQUE ESTA OPÇÃO** (para acesso público às fotos)
   - **File size limit**: `5242880` (5MB em bytes)
   - **Allowed MIME types**: `image/jpeg,image/png,image/webp` (opcional, mas recomendado)

6. Clique em **"Create bucket"**

✅ **Pronto!** Agora você pode fazer upload de fotos.

---

## 🔒 Passo 2: Configurar Políticas de Acesso (RLS)

No Supabase Dashboard, vá em **Storage** → **Policies** → `empreendimentos-fotos`

### Política 1: Leitura Pública
```sql
-- Nome: "Permitir leitura pública"
-- Operação: SELECT
-- Target roles: anon, authenticated

true
```

### Política 2: Upload Autenticado
```sql
-- Nome: "Permitir upload autenticado"
-- Operação: INSERT
-- Target roles: authenticated

auth.role() = 'authenticated'
```

### Política 3: Deletar Autenticado
```sql
-- Nome: "Permitir deletar autenticado"
-- Operação: DELETE
-- Target roles: authenticated

auth.role() = 'authenticated'
```

---

## 📋 Passo 3: Executar a Migration

Execute a migration `005_empreendimento_fotos.sql` no Supabase SQL Editor:

```sql
-- Cole o conteúdo completo de migrations/005_empreendimento_fotos.sql
```

---

## ✅ Passo 4: Verificar

1. Acesse a aba **Empreendimentos** no sistema
2. Clique no botão de **câmera** (📷) em um empreendimento
3. Teste fazer upload de uma foto
4. Verifique se a foto aparece na galeria

---

## 🎨 Estrutura de Pastas no Storage

As fotos serão organizadas assim:

```
empreendimentos-fotos/
  ├── empreendimento-{uuid-1}/
  │   ├── 1705123456789-foto1.jpg
  │   ├── 1705123456790-foto2.jpg
  │   └── 1705123456791-planta.png
  ├── empreendimento-{uuid-2}/
  │   └── ...
```

---

## 🚀 Próximos Passos

- [ ] Criar componente de carrossel para home
- [ ] Adicionar otimização de imagens (resize)
- [ ] Implementar drag & drop para ordenação
- [ ] Adicionar categorias de fotos (fachada, interior, planta)

---

## ⚠️ Notas Importantes

1. **Tamanho máximo**: 5MB por foto
2. **Formatos aceitos**: JPG, PNG, WEBP
3. **Acesso público**: As fotos são públicas (URLs públicas)
4. **Backup**: Considere fazer backup periódico do bucket
