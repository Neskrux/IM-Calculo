# Bucket de notas fiscais nasce privado, contra o padrão da casa

Todos os buckets existentes do projeto são públicos, com uma exceção (`boletos`). Medido em
produção em 2026-08-31: `contratos`, `documentos`, `empreendimentos-fotos` e `usuarios-fotos` estão
com `public = true`; qualquer pessoa com a URL lê o objeto, sem sessão. O bucket de notas fiscais
nasce **privado**, com leitura por URL assinada e escrita restrita à pasta do próprio dono.

O pedido em conversa foi "o que for mais rápido, está tudo público mesmo". A decisão de ir privado
não custa tempo: é o mesmo `INSERT` de bucket mais quatro policies copiadas da migration 024, que já
existe e já funciona. Como o caminho rápido e o caminho seguro são o mesmo caminho, escolhemos o que
não coloca CNPJ, valor e tomador de nota fiscal atrás de uma URL adivinhável.

## Consequências

O `documentos` seguir público é dívida **pré-existente e fora do escopo desta feature** — mas fica
registrada aqui porque foi medida durante ela: hoje o CRECI enviado por cada corretor e os contratos
assinados no bucket `contratos` são legíveis por quem tiver a URL. Fechar isso é trabalho próprio, com
migração dos consumidores de `getPublicUrl` para URL assinada.
