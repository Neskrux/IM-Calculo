# Uma nota por corretor por competência, travada no banco

Uma nota fiscal nunca cobre mais de um mês. Como o acompanhamento de "quem não mandou" é lido por
competência, duas notas no mesmo mês tornariam a resposta ambígua — e o valor conferido, indefinível.
Decidimos travar **uma nota por (corretor, competência)** com índice único no banco, e não apenas
validar na tela: a regra é de negócio, e o formulário não é o único caminho de escrita (admin envia
pelo corretor, e amanhã pode haver importação).

## Consequências

Corrigir uma nota deixa de ser self-service. O corretor que errou fala com a controladoria pelo
WhatsApp (botão na tela); a controladoria decide o que fazer. Isso é deliberado: a feature nasceu de
um controle que falhou por falta de trilha, e um botão "editar" silencioso reintroduz exatamente o
buraco que se quer fechar. Se o volume de correções incomodar, a saída é dar à controladoria uma
ação registrada de substituição — nunca abrir edição livre para o corretor.
