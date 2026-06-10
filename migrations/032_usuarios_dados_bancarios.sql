-- Migration 032: Dados bancários / PIX do corretor
-- Criada em: 2026-06-09 (renumerada de 026 → 032 em 2026-06-10 após merge da main,
--   que já ocupa até 031_coordenadora_percentual_padrao via PR da reconciliação)
--
-- Contexto:
--   A visão do corretor não tinha onde informar COMO recebe o repasse de comissão.
--   A tabela `usuarios` não possuía nenhum campo bancário (auditoria 2026-06-09).
--   Estes campos são preenchidos pelo próprio corretor na aba "Meu Perfil".
--
-- Observação de segurança (débito conhecido):
--   `usuarios` hoje NÃO tem RLS. Estes dados ficam legíveis por qualquer sessão
--   autenticada que consulte a tabela. Endurecer RLS é item separado (ver Ponto 5
--   de docs/spec-driven/visao-corretor-pontos.md), fora do escopo desta migration.

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS banco          TEXT,
  ADD COLUMN IF NOT EXISTS agencia        TEXT,
  ADD COLUMN IF NOT EXISTS conta          TEXT,
  ADD COLUMN IF NOT EXISTS tipo_conta     TEXT CHECK (tipo_conta IN ('corrente','poupanca')),
  ADD COLUMN IF NOT EXISTS chave_pix      TEXT,
  ADD COLUMN IF NOT EXISTS tipo_chave_pix TEXT CHECK (tipo_chave_pix IN ('cpf','cnpj','email','celular','aleatoria'));

COMMENT ON COLUMN public.usuarios.banco          IS 'Nome ou código do banco para repasse de comissão';
COMMENT ON COLUMN public.usuarios.agencia        IS 'Agência bancária (sem dígito ou com, conforme informado)';
COMMENT ON COLUMN public.usuarios.conta          IS 'Número da conta (com dígito)';
COMMENT ON COLUMN public.usuarios.tipo_conta     IS 'Tipo de conta: corrente | poupanca';
COMMENT ON COLUMN public.usuarios.chave_pix      IS 'Valor da chave PIX';
COMMENT ON COLUMN public.usuarios.tipo_chave_pix IS 'Tipo da chave PIX: cpf | cnpj | email | celular | aleatoria';
