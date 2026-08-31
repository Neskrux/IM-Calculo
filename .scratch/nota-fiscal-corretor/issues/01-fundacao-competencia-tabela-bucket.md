# 01: Fundação — competência, tabela de notas, bucket privado e módulo de domínio

**What to build:** a espinha da feature. Depois deste ticket é possível gravar uma nota fiscal de um
corretor numa competência, guardar o PDF num lugar que só o dono e o admin leem, e perguntar em
código "quem não enviou nota neste mês" — mesmo que ainda não exista tela nenhuma.

Inclui a invariante central: o banco recusa a segunda nota do mesmo corretor na mesma competência.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Existe um módulo de domínio puro, sem Supabase/React/rede, exportando as regras: normalizar e
      validar competência, validar um envio (emissor autônomo exige CPF; emissor imobiliária exige
      CNPJ e nome da imobiliária; valor maior que zero; arquivo presente e de tipo aceito), derivar a
      lista "enviou / não enviou" a partir de corretores ativos + notas, e montar o link de WhatsApp
      de correção.
- [ ] O módulo tem testes cobrindo cada regra acima, incluindo: corretor inativo não entra na lista;
      corretor sem venda alguma entra; competência inválida é rejeitada; nome da imobiliária vazio
      com emissor imobiliária é rejeitado.
- [ ] Existe migração criando a tabela de notas fiscais de corretor com dono, competência, tipo de
      emissor, documento do emissor, nome da imobiliária, telefone, chave PIX, valor declarado,
      caminho do arquivo, observação, criador e carimbo de tempo.
- [ ] A competência é sempre o primeiro dia do mês, garantido por restrição no banco.
- [ ] Índice único sobre (dono, competência) — a segunda nota do mesmo mês falha no banco, não só na
      tela.
- [ ] RLS ligada na tabela: corretor lê e insere só as próprias linhas; admin lê e insere todas.
- [ ] Migração cria o bucket de notas fiscais com `public = false` e policies de dono no molde da
      migration 024, mais leitura de admin.
- [ ] A migração está preparada e **não aplicada** — aplicar em produção depende de OK explícito.
- [ ] Roteiro de verificação pós-aplicação escrito, com controle positivo e negativo para: o índice
      único (inserir a segunda nota e exigir erro), a RLS (ler linha de outro corretor e exigir
      vazio) e o bucket (conferir `public = false` na mesma consulta que mostra um bucket público).
