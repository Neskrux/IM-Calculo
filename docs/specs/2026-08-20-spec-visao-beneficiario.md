# Spec: Visão do beneficiário (Nohros e afins — genérica por cargo)

> Demanda do card "Login Matheus Pires e pessoal da Nohros" (parte 2, 20/08/2026):
> *"a nohros deve ter uma visão totalmente diferente dos corretores"* — métricas macro
> e relatórios com base em cada beneficiário.

## Decisões de negócio (20/08, aprovadas)

1. **O que o beneficiário vê**: a **fatia do próprio cargo** + **macro neutro**
   (nº de vendas ativas, parcelas pagas, % do pró-soluto recebido, vencidas em aberto).
   **Nunca** a fatia dos outros cargos.
2. **Desenho genérico por cargo**: um tipo de acesso `beneficiario` ligado a
   `usuarios.cargo_beneficiario` (nome do cargo em `cargos_empreendimento`).
   Nohros é o 1º usuário; Beton/Ferretti entram sem código novo.

## Comportamento (BDD)

**Cenário 1 — fatia do cargo pelo tipo da venda**
- Dado um usuário `beneficiario` com cargo "Nohros"
- Então cada parcela contribui `comissao_gerada × (pct_Nohros / pct_total)`,
  com `pct_Nohros` do TIPO da venda (externo 0,5 / interno 1,25)
  e `pct_total` do snapshot da parcela (`percentual_comissao_total`)

**Cenário 2 — macro neutro**
- O painel mostra nº de vendas ativas, parcelas pagas/pendentes, % recebido e
  vencidas em aberto (valores de PARCELA) — sem nenhum valor de outro cargo

**Cenário 3 — relatório PDF**
- Botão "Gerar relatório PDF" emite a lista de parcelas pagas do período com a
  fatia do cargo por linha e o total (fonte única: `fatiaCargoDoPagamento`)

**Cenário 4 — cancelada nunca infla**
- Parcela `cancelado` não entra em nenhum número (fatia = 0)

## Peças

| peça | arquivo |
|---|---|
| Tipo + cargo do beneficiário | `migrations/041_usuarios_beneficiario.sql` |
| Fatia por cargo (testada) | `src/utils/comissaoCalculator.js` (`fatiaCargoDoPagamento`) |
| Painel | `src/pages/BeneficiarioDashboard.jsx` |
| PDF | `src/utils/relatorioBeneficiarioPDF.js` |
| Rotas `/beneficiario` | `src/App.jsx` |

## Regras respeitadas

- Totais SEMPRE de `pagamentos_prosoluto` (visualizacao-totais.md).
- Listas paginadas com `fetchAllPaginated` + `.order('id')` e `.in()` fatiado por lote
  (leitura-de-listas-e-refetch.md — o escopo passa de 14k parcelas).
- Cargo Coordenadora reusa a taxa snapshotada por venda (spec relatório coordenadoras).

## Fora de escopo (registrado)

- **RLS**: o acesso beneficiário nasce no mesmo regime dos corretores (RLS off,
  escopo por UI). O gate de segurança é do stream RLS (`feat/rls-fase0`) — quando
  ligar, `beneficiario` precisa de policy própria (leitura de vendas/pagamentos do
  empreendimento, sem PII de cliente).
- Criação do login da Nohros: via botão 🔑 do Admin (edge `admin-corretor-acesso`),
  nunca senha em texto plano por fora.

---

## v2 — mesmo formato da Coordenação (2026-09-25)

> Pedido do Jonas: *"a visão dos beneficiários está ruim; deve ser parecida com a da
> coordenadora"*. A v1 era uma página branca solta (título e valores da série mensal
> quase invisíveis sobre o tema escuro global), sem navegação e sem como ver quais
> vendas e parcelas formam o número.

**O que muda:** a tela passa a usar a moldura do papel Coordenação (barra lateral, faixa
de números, título por aba, menu no celular) com 4 abas:

| aba | conteúdo |
|---|---|
| Dashboard | o **mesmo** painel da Coordenação (`PainelCoordenacao`, só com rótulos do cargo) + filtro de empreendimento quando há mais de um |
| Vendas | um card por venda: unidade, empreendimento, interna/externa, situação (% recebido), pró-soluto, fatia do cargo com a taxa (`Nohros (1,25%)`); filtros de busca, situação, tipo e empreendimento; "Ver parcelas" abre a venda em Pagamentos |
| Pagamentos | parcelas agrupadas por venda (tabela inline, sem modal — `ui-mobile-ios.md`); filtros de status, tipo de parcela, empreendimento e datas; resumo a receber / recebida / total |
| Relatórios | filtros (empreendimento, status, mês ou intervalo de datas) + "O que vai no relatório" (o mesmo recorte do PDF) + PDF no padrão IM (cabeçalho preto/dourado, resumo, detalhamento por parcela com a taxa do cargo, rodapé paginado) |

**Quem vê o quê (inalterado — só ficou explícito):**

| aparece | nunca aparece |
|---|---|
| fatia do próprio cargo (paga / a receber / por venda / por parcela) | fatia de outro cargo, comissão total (`comissao_gerada`) |
| valores, datas e status de PARCELA; % recebido | nome de cliente, corretor, valor de venda (VGV) |
| unidade, empreendimento, venda interna/externa, taxa do cargo | aba Clientes, Empreendimentos, Perfil, Nota fiscal |

Escopo de vendas inalterado: ativas dos empreendimentos onde o cargo existe; distrato,
excluída e "limbo" (situação 3 / data de distrato gravada) fora — agora em
`vendasDoBeneficiario`.

**Cenário 5 — o % do cargo é o do empreendimento DA VENDA.** A v1 pegava a primeira
linha de `cargos_empreendimento` com aquele nome e tipo, de qualquer empreendimento.
Hoje não muda número nenhum (só a Figueira tem venda), mas erraria no dia em que outro
empreendimento tiver o mesmo cargo com % diferente. Corrigido em `pctCargoDaVenda` /
`fatiaCargoDoPagamento` (teste em `visaoBeneficiario.test.js`).

**Peças novas (puras, testadas em `src/utils/visaoBeneficiario.test.js`):**
`pctCargoDaVenda`, `resumoFatiaCargo` (núcleo do painel — `resumoCoordenacao` passou a
delegar a ele, testes da coordenação intactos), `vendasDoBeneficiario`,
`resumoPorVendaDoCargo`, `recorteRelatorioCargo` (o MESMO recorte na aba Pagamentos, no
resumo de Relatórios e no PDF — tela e PDF não divergem).

**Decisões que ficaram para o Jonas:**
1. O PDF sai por padrão com **parcelas pagas** (como a v1); dá pra trocar para Todos/Pendentes.
2. Valor de venda (VGV) **não** aparece — seguiu a lista de macro neutro da decisão de 20/08.
