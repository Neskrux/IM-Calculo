-- Fix RLS para empreendimento_fotos
-- Execute este SQL se estiver recebendo erro "new row violates row-level security policy"

-- 1. Remover políticas antigas (se existirem)
DROP POLICY IF EXISTS "Fotos são públicas para leitura" ON public.empreendimento_fotos;
DROP POLICY IF EXISTS "Usuários autenticados podem inserir fotos" ON public.empreendimento_fotos;
DROP POLICY IF EXISTS "Usuários autenticados podem atualizar fotos" ON public.empreendimento_fotos;
DROP POLICY IF EXISTS "Usuários autenticados podem deletar fotos" ON public.empreendimento_fotos;

-- 2. Criar políticas mais permissivas (temporárias para teste)
-- Política: Todos podem ler fotos (público)
CREATE POLICY "Fotos são públicas para leitura"
  ON public.empreendimento_fotos
  FOR SELECT
  USING (true);

-- Política: Todos podem inserir (para facilitar desenvolvimento)
-- ⚠️ Em produção, você pode querer restringir isso
CREATE POLICY "Permitir inserir fotos"
  ON public.empreendimento_fotos
  FOR INSERT
  WITH CHECK (true);

-- Política: Todos podem atualizar
CREATE POLICY "Permitir atualizar fotos"
  ON public.empreendimento_fotos
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Política: Todos podem deletar
CREATE POLICY "Permitir deletar fotos"
  ON public.empreendimento_fotos
  FOR DELETE
  USING (true);

-- Verificar
SELECT '✅ Políticas RLS atualizadas com sucesso!' as status;
