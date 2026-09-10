# Mensagens — Jessica e administrador do sistema (10/09/2026)

> Números conferidos contra produção em 10/09 pelos helpers do app
> ([scripts/verificar-papel-coordenacao.mjs](../../scripts/verificar-papel-coordenacao.mjs)).

---

## 1. Para a Jessica

Oi Jessica! Seu acesso ao sistema da IM já está ativo, mas o registro mostra que você
ainda não entrou nenhuma vez. Queria confirmar se a senha chegou até você.

O endereço é **im-calculo.vercel.app** e seu login é **jessica@imincorporadora.com.br**.
Se você não tem a senha ou não lembra, me avisa que eu gero uma nova na hora.

Quando entrar, vai ver um botão no topo da tela inicial com duas opções:

- **Corretor** — as vendas feitas por você.
- **Coordenação** — as vendas que foram direcionadas a você para coordenar.

Em **Coordenação** você vai encontrar hoje 10 vendas, com R$ 7.206,70 já recebidos e
R$ 24.460,98 ainda a receber. Ao trocar para essa opção, as outras telas acompanham:
Vendas, Pagamentos, Clientes e Relatórios passam a falar dessas vendas que você coordena.

Duas coisas que já aviso para você não estranhar:

Em **Corretor** não vai aparecer nenhuma venda ativa. Isso está certo, não é falha: a
única venda no seu nome foi distratada, e contrato distratado sai dessas telas.

Sua taxa de coordenação é de **1%**. É diferente da usada pelas demais coordenadoras e já
está aplicada nos valores acima.

Assim que entrar, troque a senha: **Meu Perfil**, no menu da esquerda, depois
**Alterar Senha**. Qualquer coisa fora do esperado, me chama.

---

## 2. Para o administrador do sistema

> Destinatário: `admin@imincorporadora.com.br` (último acesso 08/09). Há um segundo admin,
> `josecuti@imincorporadora.com.br`, sem acesso desde 10/08.

Passando o status da visão de Coordenação, que entrou no ar em 04/09.

**Situação dos três acessos**

| pessoa | login | último acesso |
|---|---|---|
| Carolina de Oliveira dos Santos Rita | carolina@imincorporadora.com.br | 04/09, entrou |
| Matheus de S. Pires | piresmatheusdesouza@gmail.com | 04/09, entrou |
| Jessica Regina Cararo | jessica@imincorporadora.com.br | **nunca entrou** |

A conta da Jessica existe desde 05/08 e nunca foi usada. Se a senha foi entregue, ela não
acessou; se não foi, dá para gerar outra pela tela. Vale confirmar com ela.

**O que mudou na tela**

Carolina e Jessica passaram a ter um seletor de papel no topo: **Corretor** e
**Coordenação**. Trocar o papel troca a tela inteira, não só os cards, então Vendas,
Pagamentos, Clientes e Relatórios passam a falar das vendas coordenadas. O relatório em
PDF sai com a comissão de coordenação, não a de corretor. O Matheus é corretor e não tem
esse seletor.

**Números de hoje**

| | vendas | recebida | a receber |
|---|---:|---:|---:|
| Carolina, coordenação | 159 | R$ 100.328,17 | R$ 391.536,67 |
| Carolina, carteira própria | 3 | R$ 5.889,77 | R$ 33.168,40 |
| Jessica, coordenação | 10 | R$ 7.206,70 | R$ 24.460,98 |

**Por que os números da Carolina caíram desde 04/09**

A unidade **1006 C** foi distratada em **09/09**. Contrato distratado sai das telas do
corretor, e esse entrava nos dois lugares dela, na carteira própria e na coordenação. A
comissão já paga continua no histórico e no relatório de administrador, apenas não aparece
mais no painel dela. Não é erro.

**Duas correções de cálculo que entraram junto**

As vendas externas de quem tem cadastro interno estavam sendo calculadas a 2,5% em vez de
4%. Afetava Matheus Pires e Enzo Tormes, e o valor dos dois subiu. Nenhum valor diminuiu.

As vendas próprias da Carolina estavam saindo a 0,5%, que é a taxa de coordenação, em vez
da taxa de corretora. Corrigido: agora o percentual sai do tipo de cada venda.

Em ambos os casos o relatório de administrador já mostrava o número certo. Quem estava
errado era o painel da pessoa.

**Como redefinir senha**

Em **Corretores**, abra o cadastro e use o campo **Redefinir senha**. Peça sempre que a
pessoa troque no primeiro acesso, em Meu Perfil.

Se um número não bater com o seu relatório, me diga a pessoa e o período que eu confiro.
