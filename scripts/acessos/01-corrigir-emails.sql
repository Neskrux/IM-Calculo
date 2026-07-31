-- Correcao de email de corretor antes do reenvio de acesso.
-- Rodar em PRODUCAO, no SQL Editor do painel (projeto Calculo IM).
-- Fonte: lista da controladoria (Thaisy, 31/07/2026).
--
-- POR QUE: os dois vieram do sync com o email antigo do Sienge. Um deles esta
-- com o email de OUTRA PESSOA — disparar redefinicao antes de corrigir mandaria
-- o link de acesso a conta dele pra um terceiro.

-- ============================================================
-- 1. CONFERIR ANTES (rode sozinho primeiro e leia o resultado)
-- ============================================================
select id, nome, email, tem_acesso_sistema, ativo
from usuarios
where id in ('801b5c32-3a2d-4d5b-8573-7f9469b5c414',   -- EDER SLAVIERO
             '3ae21c8e-faf6-41e3-be81-27d83b00d2ee');  -- EDUARDO ROLAO MORO

-- Esperado ANTES:
--   EDER SLAVIERO        | EDER@SLAVIEROIMOVEIS.COM.BR  | acesso=false
--   EDUARDO ROLAO MORO   | JESSICA_MANNES@HOTMAIL.COM   | acesso=false   <-- email de terceiro

-- ============================================================
-- 2. APLICAR
-- ============================================================
begin;

update usuarios
   set email = 'ederslavierocorretor@gmail.com',
       tem_acesso_sistema = true,
       updated_at = now()
 where id = '801b5c32-3a2d-4d5b-8573-7f9469b5c414'
   and email = 'EDER@SLAVIEROIMOVEIS.COM.BR';   -- guarda: so troca se ainda for o antigo

update usuarios
   set email = 'eduardomoro623@gmail.com',
       tem_acesso_sistema = true,
       updated_at = now()
 where id = '3ae21c8e-faf6-41e3-be81-27d83b00d2ee'
   and email = 'JESSICA_MANNES@HOTMAIL.COM';

-- Confira que deu 1 linha em cada UPDATE antes de confirmar.
commit;
-- (se algo estranho: rollback;)

-- ============================================================
-- 3. CONFERIR DEPOIS
-- ============================================================
select id, nome, email, tem_acesso_sistema from usuarios
where id in ('801b5c32-3a2d-4d5b-8573-7f9469b5c414','3ae21c8e-faf6-41e3-be81-27d83b00d2ee');

-- ATENCAO: isto corrige a tabela `usuarios`. A conta de login vive em auth.users
-- e NAO e alterada por este script — nenhum dos dois tem conta la ainda. Ao criar
-- o acesso pela tela de cadastro de corretores, use o email JA CORRIGIDO.
