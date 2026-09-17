# Mensagem para a controladoria — acessos e teste da visão de Coordenação

> Já em produção (PR #97 e #99, merge em 04/09/2026). Spec: [../specs/2026-09-04-spec-papel-coordenador.md](../specs/2026-09-04-spec-papel-coordenador.md).

---

Oi! Entrou uma novidade no sistema e queria te pedir para você conferir antes de
qualquer pessoa receber o acesso.

## O que mudou

A Carolina e a Jessica são corretoras e também coordenam vendas de outras pessoas. Até
agora o sistema só mostrava para elas as vendas que elas mesmas fizeram. Agora, quando
elas entram, aparece um botão no topo da tela inicial com duas opções:

- **Corretor** — as vendas delas, exatamente como já era. Nada mudou aqui.
- **Coordenação** — as vendas que foram direcionadas a elas para coordenar.

Na opção Coordenação elas veem quanto já receberam e quanto ainda vão receber pela
coordenação, além do resumo dessas vendas: quantas são, quantas parcelas já foram pagas,
quanto do pró-soluto já entrou e quantas parcelas estão vencidas em aberto.

Duas coisas importantes: elas **não** veem a comissão de outras pessoas, só a parte
delas como coordenadora. E a venda que a própria pessoa vendeu não aparece na
Coordenação, só na aba Corretor, para não contar duas vezes.

Esse botão só aparece para quem coordena. **O Matheus Pires é corretor e não tem esse
botão** — a conta dele é a de sempre. Os outros corretores também continuam vendo a tela
igual à de antes.

Junto com isso saiu uma correção de cálculo que afeta **duas** pessoas: Matheus Pires e
Enzo Tormes. Os dois têm cadastro como corretor interno mas fizeram algumas vendas
externas, e nessas vendas o sistema estava mostrando uma comissão menor do que a devida.
Agora mostra o valor certo, que é o mesmo que sempre apareceu no relatório do
administrador. **O valor deles sobe, nenhum valor diminui.**

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

Igual ao Passo 2. Procure por **MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS**, use o campo
**Redefinir senha**, escreva uma senha nova, anote e clique em **Redefinir senha**.

⚠️ Vão aparecer **dois** cadastros com esse mesmo nome na lista. Use o que tem o e-mail
`piresmatheusdesouza@gmail.com` — é o que tem as vendas dele. O outro está desativado e
sem venda nenhuma; se você tentar ativar acesso por ele, o sistema recusa, e a recusa
está certa.

### Passo 4 — Testar as três

Agora saia do seu acesso e entre uma vez com cada uma delas, usando o e-mail e a senha
que você anotou.

- **Carolina** — e-mail `carolina@imincorporadora.com.br`
- **Jessica** — e-mail `jessica@imincorporadora.com.br`
- **Matheus Pires** — e-mail `piresmatheusdesouza@gmail.com`

O que esperar em cada uma:

| Pessoa | O que deve aparecer |
|---|---|
| Carolina | O botão Corretor / Coordenação. Em Coordenação, 162 vendas direcionadas com valores |
| Jessica | O botão Corretor / Coordenação. Em Coordenação, 10 vendas direcionadas com valores |
| Matheus Pires | **Sem** o botão de Coordenação. A tela normal de corretor, com as vendas dele |

Em Coordenação, os números precisam **carregar e aparecer**. Se ficar parado em
"Carregando as vendas direcionadas a você" por mais de um minuto, me avise — isso é
justamente o que foi corrigido e eu quero saber se ficou algum resto.

### Passo 5 — Entregar as senhas

Só depois de conferir as três, mande para cada pessoa o e-mail e a senha dela. Peça que
ela troque a senha logo no primeiro acesso, assim: entrar no sistema, clicar em
**Meu Perfil** no menu da esquerda, e depois em **Alterar Senha**.

Isso é importante porque a senha passou por você. Enquanto a pessoa não trocar, o
acesso não é só dela.

## Se algo não sair como o esperado

Me avise dizendo em qual passo parou e o que apareceu na tela. Se alguma mensagem
vermelha aparecer, me manda o texto dela que eu resolvo.
