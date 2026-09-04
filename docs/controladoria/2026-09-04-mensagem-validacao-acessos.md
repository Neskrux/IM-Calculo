# Mensagem para a controladoria — validação dos 3 acessos

> Versão enxuta, só a parte de validar. Enviar depois do deploy do PR de correções.

---

Oi! Antes de qualquer pessoa receber a senha, preciso que você entre nas três contas e
confira. Anote o que vir em cada item, mesmo quando estiver certo.

## Antes de começar

Abra o sistema por **im-calculo.vercel.app/?novo**. O `/?novo` no final força o navegador
a buscar a versão mais recente. Sem isso ele pode te mostrar a tela antiga e a conferência
não vale.

## Atenção ao escolher o Matheus na lista

Havia dois cadastros com o mesmo nome e o duplicado foi apagado. Agora só existe um, com
o e-mail **piresmatheusdesouza@gmail.com**. Se por algum motivo aparecerem dois de novo,
pare e me avise antes de mexer.

## O que validar em cada conta

### 1. Carolina — `carolina@imincorporadora.com.br`

Deve aparecer um botão no topo com **Corretor** e **Coordenação**.

Clique em **Coordenação** e confira:

| item | valor esperado |
|---|---|
| Vendas direcionadas | 162 |
| Comissão de coordenação recebida | R$ 100.637,76 |
| Comissão de coordenação a receber | R$ 398.140,52 |

⚠️ O ponto mais importante aqui: os números precisam **carregar e aparecer**. Se ficar
parado em "Carregando as vendas direcionadas a você" por mais de um minuto, me avise na
hora. Era exatamente esse o problema que acabou de ser corrigido, e preciso saber se
sobrou algum resto.

Depois volte em **Corretor** e confirme que aparecem as 4 vendas dela.

### 2. Jessica — `jessica@imincorporadora.com.br`

Mesmo botão **Corretor / Coordenação**.

Em **Coordenação**:

| item | valor esperado |
|---|---|
| Vendas direcionadas | 10 |
| Comissão de coordenação recebida | R$ 7.206,70 |
| Comissão de coordenação a receber | R$ 24.460,98 |

A Jessica tem taxa de coordenação de **1,00%**, diferente da Carolina, que é 0,50%. Os
valores acima já consideram isso. Se aparecer algo em torno da metade disso, me avise —
seria sinal de que a taxa dela não está sendo aplicada.

Em **Corretor**, a carteira própria dela está praticamente vazia: a única venda no nome
dela foi distratada, então é normal não aparecer venda ativa.

### 3. Matheus Pires — `piresmatheusdesouza@gmail.com`

Aqui o teste é o contrário: **o botão de Coordenação NÃO pode aparecer.** Ele é corretor,
não coordenador. Se aparecer, me avise.

Confira também a correção de cálculo dele. Nas vendas externas o sistema mostrava uma
comissão menor do que a devida, e agora mostra o valor certo, o mesmo que sempre apareceu
no seu relatório de administrador.

Para conferir: no menu dele, entre em **Relatórios**, filtre por **status Pago** e o
período **01/08/2026 a 31/08/2026**. O total de comissão precisa dar **R$ 4.704,87**.

Se ainda aparecer **R$ 4.352,55**, é a tela antiga em cache: abra de novo com o
`/?novo` no final do endereço.

## Depois de conferir

Se as três estiverem como descrito acima, mande para cada pessoa o e-mail e a senha dela,
e peça que troque a senha logo no primeiro acesso: **Meu Perfil** no menu da esquerda, e
depois **Alterar Senha**. Isso importa porque a senha passou por você; enquanto a pessoa
não trocar, o acesso não é só dela.

Se algum número não bater ou alguma tela não carregar, me diga em qual das três contas foi
e o que apareceu, e eu resolvo antes de liberar.
