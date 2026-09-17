# 02: Relatório "quem não mandou" na competência (o produto)

**What to build:** a controladoria abre o dashboard de admin, escolhe uma competência e vê os 72
corretores ativos separados entre quem enviou nota e quem não enviou, com o valor declarado ao lado
da comissão do corretor no mês. Enquanto ninguém tiver enviado nada, a lista mostra os 72 em
"não enviou" — que é a verdade de hoje, e é o ponto do relatório.

Esta é a primeira coisa a existir na tela, antes do upload: o upload é o meio, a lista é o controle.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Aba nova no dashboard do admin, com seletor de competência (padrão: mês corrente).
- [ ] Duas seções na competência escolhida: "não enviaram" e "enviaram", cada uma com a contagem.
- [ ] A soma das duas seções é sempre o total de corretores ativos.
- [ ] Corretor inativo não aparece em nenhuma das duas.
- [ ] Corretor sem venda alguma aparece em "não enviaram".
- [ ] Para quem enviou: valor declarado, tipo de emissor, imobiliária declarada quando houver, data
      do envio, e acesso ao PDF por URL assinada de vida curta.
- [ ] Ao lado do valor declarado, a comissão do corretor na competência, derivada de
      `pagamentos_prosoluto` pelos helpers canônicos — nunca de snapshot em `vendas`.
- [ ] Leitura de listas paginada conforme a regra de leitura do projeto (o corte silencioso em 1000
      linhas não pode truncar a contagem).
- [ ] Nenhuma nota de um corretor é legível por outro corretor a partir desta tela.
