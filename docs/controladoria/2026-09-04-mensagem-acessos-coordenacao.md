# Mensagem para a controladoria — acessos e teste da visão de Coordenação

> Enviar **depois** do deploy (a redefinição de senha e o painel de coordenação estão
> nesta branch, ainda não em produção). Spec: [../specs/2026-09-04-spec-papel-coordenador.md](../specs/2026-09-04-spec-papel-coordenador.md).

---

Oi! Entrou uma novidade no sistema e queria te pedir para você conferir antes de
qualquer pessoa receber o acesso.

## O que mudou

A Carolina, a Jessica e o Matheus Pires são corretores e também coordenam vendas de
outras pessoas. Até agora o sistema só mostrava para eles as vendas que eles mesmos
fizeram. Agora, quando eles entram, aparece um botão no topo da tela inicial com duas
opções:

- **Corretor** — as vendas deles, exatamente como já era. Nada mudou aqui.
- **Coordenação** — as vendas que foram direcionadas a eles para coordenar.

Na opção Coordenação eles veem quanto já receberam e quanto ainda vão receber pela
coordenação, além do resumo dessas vendas: quantas são, quantas parcelas já foram
pagas, quanto do pró-soluto já entrou e quantas parcelas estão vencidas em aberto.

Duas coisas importantes: eles **não** veem a comissão de outras pessoas, só a parte
deles como coordenador. E a venda que a própria pessoa vendeu não aparece na
Coordenação, só na aba Corretor, para não contar duas vezes.

Esse botão só aparece para quem coordena. Os outros corretores continuam vendo a tela
igual à de sempre.

## O que eu preciso que você faça

São três pessoas. Você define a senha das três, entra em cada uma para conferir, e só
depois manda a senha para cada pessoa.

### Passo 1 — Carolina (ela ainda não tem login)

1. Entre no sistema com o seu acesso de administrador.
2. No menu da esquerda, clique em **Corretores**.
3. Procure por **Carolina de Oliveira dos Santos Rita** e clique para editar.
4. No campo de e-mail, apague o que estiver lá e escreva: `carolina@imincorporadora.com.br`
5. Mais abaixo, marque a caixinha **Ativar acesso ao sistema**.
6. Vai aparecer um campo de senha. Escreva uma senha de no mínimo 6 caracteres e
   **anote em algum lugar** — você vai usar ela no Passo 4.
7. Clique em **Salvar**.

### Passo 2 — Jessica

1. Ainda em **Corretores**, procure por **Jessica Regina Cararo** e clique para editar.
2. Como ela já tem login, aparece o campo **Redefinir senha**.
3. Escreva uma senha nova, anote, e clique no botão **Redefinir senha**.
4. A senha antiga deixa de valer na hora.

### Passo 3 — Matheus Pires

Igual ao Passo 2. Procure por **MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS**, use o
campo **Redefinir senha**, escreva uma senha nova, anote e clique em
**Redefinir senha**.

### Passo 4 — Testar as três

Agora saia do seu acesso e entre uma vez com cada uma delas, usando o e-mail e a senha
que você anotou.

- **Carolina** — e-mail `carolina@imincorporadora.com.br`
- **Jessica** — e-mail `jessica@imincorporadora.com.br`
- **Matheus Pires** — e-mail `piresmatheusdesouza@gmail.com`

Em cada uma, confira o seguinte:

1. O botão com **Corretor** e **Coordenação** aparece no topo da tela inicial.
2. Clicando em **Coordenação**, os números carregam.
3. Clicando de volta em **Corretor**, as vendas da pessoa aparecem como antes.

O que esperar em cada uma:

| Pessoa | O que deve aparecer em Coordenação |
|---|---|
| Carolina | 162 vendas direcionadas, com valores |
| Jessica | 10 vendas direcionadas, com valores |
| Matheus Pires | Uma mensagem dizendo que ainda não há venda direcionada a ele |

**A mensagem do Matheus está certa, não é erro.** Ele está começando como coordenador
agora e ainda não recebeu nenhuma venda para coordenar. Quando você direcionar a
primeira venda para ele, os números aparecem sozinhos.

### Passo 5 — Entregar as senhas

Só depois de conferir as três, mande para cada pessoa o e-mail e a senha dela. Peça que
ela troque a senha logo no primeiro acesso, assim: entrar no sistema, clicar em
**Meu Perfil** no menu da esquerda, e depois em **Alterar Senha**.

Isso é importante porque a senha passou por você. Enquanto a pessoa não trocar, o
acesso não é só dela.

## Se algo não sair como o esperado

Me avise dizendo em qual passo parou e o que apareceu na tela. Se alguma mensagem
vermelha aparecer, me manda o texto dela que eu resolvo.
