-- =============================================
-- CORREÇÃO DAS POLÍTICAS RLS - REMOVER LOOP
-- Execute este script no SQL Editor do Supabase
-- =============================================

-- IMPORTANTE: Faça backup antes de executar!

-- 1. Remover políticas antigas que causam loop
DROP POLICY IF EXISTS "Admin pode ver todos usuarios" ON usuarios;
DROP POLICY IF EXISTS "Usuario pode ver proprio perfil" ON usuarios;
DROP POLICY IF EXISTS "Admin pode inserir usuarios" ON usuarios;
DROP POLICY IF EXISTS "Admin pode atualizar usuarios" ON usuarios;

-- 2. Criar nova política: Usuário SEMPRE pode ver seu próprio perfil
-- Esta política deve vir PRIMEIRO e não depende de verificar admin
CREATE POLICY "Usuario pode ver proprio perfil" ON usuarios
    FOR SELECT
    USING (auth.uid() = id);

-- 3. Criar política para admin ver todos (incluindo próprio perfil)
-- Esta política só funciona DEPOIS que o usuário já viu seu próprio perfil
CREATE POLICY "Admin pode ver todos usuarios" ON usuarios
    FOR SELECT
    USING (
        -- Pode ver próprio perfil (já coberto pela política acima, mas incluído para clareza)
        auth.uid() = id 
        OR 
        -- OU pode ver todos se for admin (mas só funciona se já conseguiu ver próprio perfil)
        EXISTS (
            SELECT 1 FROM usuarios u 
            WHERE u.id = auth.uid() 
            AND u.tipo = 'admin'
        )
    );

-- 4. Admin pode inserir (verifica se é admin)
CREATE POLICY "Admin pode inserir usuarios" ON usuarios
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM usuarios u 
            WHERE u.id = auth.uid() 
            AND u.tipo = 'admin'
        )
    );

-- 5. Admin pode atualizar (pode atualizar próprio perfil OU se for admin)
CREATE POLICY "Admin pode atualizar usuarios" ON usuarios
    FOR UPDATE
    USING (
        auth.uid() = id 
        OR 
        EXISTS (
            SELECT 1 FROM usuarios u 
            WHERE u.id = auth.uid() 
            AND u.tipo = 'admin'
        )
    );

-- =============================================
-- VERIFICAÇÃO
-- =============================================
-- Após executar, teste fazendo login novamente
-- O perfil deve carregar em menos de 2 segundos

