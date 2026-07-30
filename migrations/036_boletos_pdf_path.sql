-- 036: PDF oficial do boleto armazenado no Storage (bucket privado 'boletos')
--
-- Por quê: o runtime das edge functions não tem o certificado mTLS pra buscar
-- a segunda via na API de produção do Sicoob. O worker local (com o e-CNPJ)
-- baixa o PDF oficial e envia via POST /sicoob-boletos/armazenar-pdf
-- (autenticado por BOLETOS_WORKER_SECRET); a ação segunda_via serve do
-- Storage primeiro. Aplicada em 2026-07-30 (223 PDFs do 1º lote armazenados).

ALTER TABLE boletos ADD COLUMN IF NOT EXISTS pdf_path TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('boletos', 'boletos', false)
ON CONFLICT (id) DO NOTHING;
