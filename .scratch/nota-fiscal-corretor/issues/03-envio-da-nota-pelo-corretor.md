# 03: Envio da nota pelo corretor, com prefill e devolução ao cadastro

**What to build:** o corretor entra no sistema, abre "Nota Fiscal", vê o mês corrente, preenche um
formulário que já vem com o que a IM sabe sobre ele, anexa o PDF, escreve uma observação se quiser e
envia. A nota passa a aparecer no relatório da competência (ticket 02) imediatamente.

O que ele digitou e que faltava no cadastro fica gravado no cadastro dele — no mês seguinte já vem
preenchido.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Aba nova no dashboard do corretor com o formulário de envio da competência corrente.
- [ ] Nome, e-mail e CRECI não são perguntados — vêm da sessão.
- [ ] Endereço não é perguntado e o contrato da venda não é anexado.
- [ ] Escolha do emissor: autônomo (pede CPF) ou imobiliária (pede CNPJ e o nome da imobiliária em
      texto livre). O campo do nome só aparece na opção imobiliária.
- [ ] Campos pré-preenchidos a partir do cadastro quando existirem: documento, telefone, imobiliária,
      chave PIX.
- [ ] Campos obrigatórios: emissor, documento correspondente, telefone, PIX, valor declarado, arquivo
      da nota, competência. Observação é opcional.
- [ ] O arquivo vai para a pasta do próprio corretor no bucket privado; o corretor não escolhe o
      caminho.
- [ ] Ao enviar, os campos que o corretor preencheu e que estavam vazios no cadastro são gravados em
      `usuarios` na mesma operação. Campo já preenchido no cadastro não é sobrescrito.
- [ ] Tentar enviar uma segunda nota para a mesma competência é recusado, com mensagem que explica a
      regra e aponta o caminho de correção.
- [ ] Funciona no celular: o modal/formulário segue as regras de UI mobile do projeto.
- [ ] Erro de upload ou de gravação não deixa registro órfão nem arquivo órfão.
