-- 034: Link do portal de garantia (Solumn) por empreendimento
--
-- Cada empreendimento tem seu portal de garantia próprio no Solumn. O cliente
-- acessa pela aba Garantia do portal do cliente (ClienteDashboard).
-- Fonte dos links: gestão IM, 2026-07-23.
--
-- Nota: LOTUS ficou sem link (não fornecido).

ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS garantia_url TEXT;

COMMENT ON COLUMN empreendimentos.garantia_url IS
  'URL do portal de garantia (Solumn) exibido ao cliente na aba Garantia';

UPDATE empreendimentos SET garantia_url = 'https://solumn.com.br/garantia/1fad9023-426c-447b-9a84-b65cfcebe4a3'
WHERE id = '50b32337-e87f-46aa-b634-524547be35a6'; -- ÁUREA SKY GARDEN

UPDATE empreendimentos SET garantia_url = 'https://solumn.com.br/garantia/2b1db83a-cce3-4d72-8444-ae7a3d8e4f98'
WHERE id = '0d7d01f4-c398-4d9a-a280-13f44c957279'; -- FIGUEIRA GARCIA

UPDATE empreendimentos SET garantia_url = 'https://solumn.com.br/garantia/a85cf2a3-0609-4664-bae6-87cd05a7b55d'
WHERE id = '683bf33f-c15c-4aad-b199-0e837ecb8eed'; -- LAGUNA SKY GARDEN

UPDATE empreendimentos SET garantia_url = 'https://solumn.com.br/garantia/dd38462e-8063-4bfd-8c17-663305956d31'
WHERE id = '3682cf7d-3381-4d21-bfd3-bc2630de34a9'; -- RESIDENCIAL GIRASSOL

UPDATE empreendimentos SET garantia_url = 'https://solumn.com.br/garantia/14ff29e6-e2d6-4a5c-8124-848f32a0ad92'
WHERE id = '57b0a9c6-c67d-41a9-bf9c-2788f80edcd6'; -- RIVER SKY GARDEN

UPDATE empreendimentos SET garantia_url = 'https://solumn.com.br/garantia/9a14b568-2862-4ce0-af72-c21ee920a4cb'
WHERE id = 'f7af6781-e40b-4aee-87c4-699192c1a991'; -- SINTROPIA SKY GARDEN
