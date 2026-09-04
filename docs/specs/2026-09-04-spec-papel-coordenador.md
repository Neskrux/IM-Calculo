# Spec: papel Coordenador na conta do corretor (Pires, Carolina, Jessica)

> **Demanda (04/09/2026):** dar acesso a Matheus Pires, Carolina e Jessica.
>
> ⚠️ **Correção no mesmo dia:** o enunciado dizia que o Pires estava virando coordenador.
> **Ele não é** — é corretor, e só. Quem acumula os dois papéis é **Carolina e Jessica**:
> corretoras com carteira própria e coordenadoras de vendas direcionadas. A visão de
> coordenação é o **macro dessas vendas** + a fatia do cargo Coordenadora. A linha que
> chegou a ser criada para o Pires foi revertida (ver T7 dos tickets).
>
> O cenário de **carteira de coordenação vazia** continua valendo como comportamento
> exigido: uma coordenadora nova entra sem venda direcionada, e a tela precisa dizer
> isso em vez de mostrar R$ 0,00 mudo.

## 0. Estado verificado em produção (04/09/2026, read-only)

Levantado antes de desenhar. Controle negativo aplicado (email inexistente → `[]`).

| Pessoa | `usuarios.id` | cadastro | login | linha em `coordenadoras` | carteira própria | vendas direcionadas |
|---|---|---|---|---|---|---|
| MATHEUS DE S. PIRES | `9b1f5c90…4349` | `corretor` / **interno** / 2,5% | **já tem** (`piresmatheusdesouza@gmail.com`) | **não existe** | 46 (32 internas + 13 **externas**) | **0** |
| Carolina de Oliveira dos Santos Rita | `4c04b405…3c0c` | `corretor` / externo | **não tem** (email é placeholder `corretor.129@sync.local`) | "Carol", 0,50% | 4 | **172** (4 próprias excluídas) |
| Jessica Regina Cararo | `e94de4d7…ab7e` | `corretor` / externo | **já tem** (`jessica@imincorporadora.com.br`) | "Jessica", 1,00% | 1 (distratada) | **12** (1 própria excluída) |

Outros fatos que mudam o desenho:

- Existe um **segundo cadastro do Pires** (`a80c1aa4…3602`, `MEUCNPJ@ACCOUNTTECH.COM.BR`,
  `ativo=false`) com **0 vendas**. É a duplicata inerte; **o id vivo é `9b1f5c90`**.
- O cargo **Coordenadora existe só para `tipo_corretor='externo'`**, 0,50%, num único
  empreendimento (Figueira). Venda interna não tem coordenadora.
- **Todas as 184 vendas direcionadas já têm `vendas.coordenadora_taxa` preenchida** —
  o fallback pela taxa vigente hoje não é exercido por nenhuma venda existente.
- **Nada escreve `coordenadora_taxa` na criação da venda** — só o backfill
  (`scripts/backfill-coordenadora-taxa.mjs`). Venda direcionada nova nasce com snapshot
  NULL. Ver ticket T6.
- Os emails do card não são os do cadastro: `carolina@imincorporadora.com.br` **não existe**
  em `usuarios`; a Jessica está cadastrada como `jessica@`, não `jessicacararo@`. Ver §6.

## 1. A pergunta de desenho: quarto tipo de acesso, `beneficiario`, ou papel?

**Resposta: papel dentro da conta de corretor. Nem tipo novo, nem `beneficiario`.**

Por que **não** um quarto `usuarios.tipo`:

- `tipo` é **coluna única** e decide a rota (`App.jsx` manda `beneficiario` pra `/beneficiario`).
  Marcar os três de coordenador **apagaria a carteira própria deles** — e a saída seria a
  segunda conta, que é exatamente o erro proibido pela restrição 1.

Por que **não** `beneficiario` com `cargo_beneficiario='Coordenadora'`:

- O beneficiário é genérico **por cargo**, e o escopo dele é **o empreendimento inteiro**
  (`BeneficiarioDashboard` carrega todas as vendas ativas dos empreendimentos onde o cargo
  existe). Isso é certo pra Nohros/Beton/Ferretti, que recebem em **toda** venda.
- Coordenação **não é por cargo, é por pessoa**: a fatia da Carol sai de 172 vendas
  específicas, a da Jessica de 12. O nome do cargo não distingue as duas — a Carol veria as
  vendas da Jessica. O que separa é `vendas.coordenadora_id`, que `cargo_beneficiario` não
  carrega.
- E continuaria esbarrando no `tipo` único acima.

O que **se reusa** do beneficiário é o motor, não o tipo de acesso: `fatiaCargoDoPagamento`
já resolve o cargo Coordenadora com a taxa por venda. A spec do beneficiário segue válida e
intocada.

**O vínculo pessoa→coordenação já existe no schema**: `coordenadoras.usuario_id` (migration
030, preenchido na 031 pra Carol). O papel se liga por ele. **Zero migration.**

## 2. Decisão

`usuarios.tipo` continua `'corretor'` para os três. Quem tem linha **ativa** em
`coordenadoras` com `usuario_id = user.id` ganha um **seletor de papel** no próprio
CorretorDashboard — mesma mecânica do toggle que o `AdminDashboard` já usa no relatório.

| papel | escopo das vendas | número principal |
|---|---|---|
| **Corretor** (default) | `corretor_id = eu` (comportamento atual, zero regressão) | fatia do cargo Corretor |
| **Coordenação** | `coordenadora_id = minha` **menos** as que eu vendi | fatia do cargo **Coordenadora** + macro neutro |

**Trocar de papel troca a BASE DA TELA INTEIRA** (decisão do Jonas, 04/09, depois de ver a
primeira versão): não é só um painel no Dashboard. Minhas Vendas, Meus Pagamentos, Meus
Clientes e Relatórios passam a falar das vendas **direcionadas**, e o PDF sai com a fatia
do cargo Coordenadora. *"Se não, não faz sentido"* — uma coordenadora precisa da visão
geral do que coordena, não só das quatro vendas que ela mesma fez.

Implementação: `vendas` e `meusPagamentos` deixaram de ser estado e viraram **derivados**
do papel. Os ~90 pontos de leitura que já usavam esses nomes continuam funcionando sem
alteração; o estado cru mora em `vendasProprias`/`pagamentosProprios`, que só os fetchers
da carteira própria escrevem. O PDF do corretor ganhou o parâmetro `calcComissao` — sem
ele, o relatório da coordenação sairia com a fatia de **corretor** das vendas de outras
pessoas, o que é número errado **e** vazamento.

Excluir a venda própria do papel de coordenação é regra de negócio já vigente
(migration 031 e spec das coordenadoras): coordenadora não reporta venda que ela mesma
vendeu. Sem isso a Jessica contaria a mesma venda nos dois papéis.

## 3. Comportamento (BDD)

**Cenário 1 — quem vê o seletor**
- Dado um corretor **sem** linha ativa em `coordenadoras`
- Então nenhum seletor de papel aparece e a tela é exatamente a de hoje

**Cenário 2 — papel Coordenação**
- Dado que a Carolina troca o papel para "Coordenação"
- Então a tela passa a mostrar as vendas direcionadas a ela, **sem** as 4 que ela vendeu
- E o número principal é `comissao_gerada × (taxa_coordenadora / percentual_comissao_total)`

**Cenário 3 — taxa histórica manda**
- Dada uma venda direcionada com `coordenadora_taxa = 1,0` (contrato pré-cutover 15/07/2025)
- Então a fatia usa 1,0 mesmo que `coordenadoras.percentual_padrao` valha 0,5 hoje
- E a taxa vigente só entra quando o snapshot é NULL

**Cenário 4 — carteira de coordenação vazia (Pires)**
- Dado um coordenador com zero vendas direcionadas
- Então a tela mostra "Nenhuma venda direcionada a você ainda" com uma frase explicando
  que os números aparecem quando o Admin direcionar vendas
- E **não** mostra R$ 0,00 mudo, nem erro, nem tela em branco

**Cenário 5 — cancelada nunca infla**
- Parcela `cancelado` não entra em nenhum número da coordenação (fatia = 0)

**Cenário 6 — distratada fora**
- Venda distratada não entra na coordenação, pela mesma régua única das telas do corretor
  (`isVendaAtiva`, spec 2026-08-28)

**Cenário 7 — o papel não vaza**
- No papel Coordenação nenhum número da fatia do cargo **Corretor** de outra pessoa é
  exibido; e no papel Corretor nada da coordenação aparece

**Cenário 8 — multi-tipo do Pires segue intacto**
- As 13 vendas externas dele continuam pagando fatia de corretor pela taxa do tipo **da
  venda** (4%), não pela do cadastro (2,5%) — `percentualCorretorDaVenda`, já testado

## 4. Peças

| peça | arquivo | novo? |
|---|---|---|
| `coordenadoraDoUsuario`, `papeisDisponiveis`, `vendasDaCoordenacao`, `resumoCoordenacao` | `src/utils/comissaoCalculator.js` | **novo (puro, testado)** |
| Testes | `src/utils/comissaoCalculator.test.js` | novo |
| Seletor de papel + painel de coordenação | `src/pages/CorretorDashboard.jsx` | altera |
| Fatia por cargo | `fatiaCargoDoPagamento` | reusa |
| Taxa por venda | `taxaCoordenadoraDaVenda` | reusa |
| Vínculo pessoa→coordenação | `coordenadoras.usuario_id` (migr. 030/031) | reusa |
| Criação de login | edge `admin-corretor-acesso` (botão 🔑) | reusa |

**Toda regra de negócio nasce em helper puro** — o componente só monta a tela com o que o
helper devolveu. Nada de conta dentro de JSX.

## 5. Regras respeitadas

- Totais **sempre** de `pagamentos_prosoluto` (`visualizacao-totais.md`). A taxa decide só a
  **proporção** da fatia, nunca recalcula comissão.
- Snapshot > vigente (`fator-comissao.md`).
- Listas paginadas com `fetchAllPaginated` + `.order('id')` e `.in()` fatiado por lote
  (`leitura-de-listas-e-refetch.md`) — a coordenação da Carol são 172 vendas, milhares de
  parcelas.
- Régua única das telas do corretor: `isVendaAtiva` (spec 2026-08-28).
- `usuarios.id` é a identidade; login só pela edge, nunca pelo painel do Supabase.

## 6. Decisões tomadas (Jonas, 04/09/2026)

1. **Jessica — mantém `jessica@imincorporadora.com.br`.** Ela já tem login nesse email;
   nada a fazer. `jessicacararo@` não entra.
2. **Carolina — é a "Carolina de Oliveira dos Santos Rita"** (id `4c04b405…3c0c`), e o
   email interno dela é `carolina@imincorporadora.com.br`. O acesso nasce com esse email,
   **reusando o id existente** (o botão 🔑 do Admin passa o email real; a edge recusaria o
   placeholder `@sync.local`). A outra Caroline do banco (`CAROLINE CRISTINA PERES SUDRE`)
   não tem relação com a coordenação.
3. ~~**Pires — 0,50%, o mesmo da Carol.**~~ **Revertido no mesmo dia: o Pires não é
   coordenador** (correção do Jonas). A coordenação fica com Carolina (0,50%) e Jessica
   (1,00%, exceção negociada). Ver T7 dos tickets.
4. **Cadastro duplicado do Pires** (`a80c1aa4`, inativo, 0 vendas): fica como está. É
   inerte — nenhuma venda aponta pra ele.

### O que essas decisões implicam

- A taxa da coordenação do Pires só vira número quando houver venda direcionada. Como
  toda venda direcionada nova nasce **sem** `coordenadora_taxa` (nada escreve o snapshot
  na criação), a fatia dele cai no fallback da taxa vigente — que agora é 0,50%, o valor
  certo. O ticket T6 deixa de ser urgente, mas segue valendo: snapshot é mais seguro que
  fallback quando a taxa mudar de novo.
- O cargo Coordenadora só existe pra `tipo_corretor='externo'` (migration 030). O Pires é
  **interno como corretor**, o que não o impede de coordenar — mas venda **interna**
  direcionada a ele não teria cargo Coordenadora na tabela de cargos. Vale conferir com a
  controladoria que as vendas destinadas a ele serão externas.

## 7. Fora de escopo (registrado)

- **RLS**: o papel nasce no mesmo regime dos corretores (RLS off, escopo por UI). Quando o
  `feat/rls-fase0` ligar, coordenação precisa de policy própria: ler vendas e parcelas onde
  `coordenadora_id` pertence a uma linha de `coordenadoras` com `usuario_id = auth.uid()`,
  sem PII do cliente além do que o corretor já vê.
- **PDF de coordenação**: o `relatorioBeneficiarioPDF` já emite fatia por cargo. Fica pra
  uma segunda passada, depois que a tela estiver no ar.
- ~~Rótulo "Sua Comissão (X%)" ... só o rótulo.~~ **Estava errado — era o dinheiro.**
  O enriquecimento colava o percentual do cadastro em cada venda, e como
  `percentualCorretorDaVenda` trata `venda.percentual_corretor` como snapshot, a regra
  multi-tipo era anulada: venda externa de cadastro interno pagava 2,5%. Medido no Pires
  (agosto/2026, pagas): R$ 4.352,55 na tela dele contra R$ 4.704,87 no Admin, que estava
  certo. **Corrigido** pelo helper `fatiaCorretorDaVenda`.
- Escrever `coordenadora_taxa` na criação da venda (ticket T6) — depende da decisão 3.
