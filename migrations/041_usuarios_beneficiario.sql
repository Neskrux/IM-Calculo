-- 041: tipo de acesso BENEFICIÁRIO (visão por cargo — Nohros, Beton, Ferretti, ...)
-- Ver docs/specs/2026-08-20-spec-visao-beneficiario.md
--
-- Beneficiário = entidade que recebe fatia de comissão por CARGO em cada venda
-- (cargos_empreendimento), sem ser corretor de venda nenhuma. A visão dele é
-- genérica por cargo: fatia do próprio cargo + métricas macro neutras (nunca a
-- fatia dos outros cargos). Nohros é o 1º usuário; Beton/Ferretti entram só
-- trocando cargo_beneficiario, sem código novo.

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tipo_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_tipo_check
  CHECK (tipo = ANY (ARRAY['admin'::text, 'corretor'::text, 'cliente'::text, 'beneficiario'::text]));

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cargo_beneficiario text;

COMMENT ON COLUMN usuarios.cargo_beneficiario IS
  'Nome do cargo em cargos_empreendimento cuja fatia este usuario enxerga (ex.: Nohros). Obrigatorio quando tipo=beneficiario.';
