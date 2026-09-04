# Tickets — papel Coordenador na conta do corretor

Spec: [2026-09-04-spec-papel-coordenador.md](2026-09-04-spec-papel-coordenador.md).
Ordem de execução: T1 → T2 → T3 → T4 (feitos). T5/T7 esperam só o OK de execução em produção — as decisões já vieram (04/09). T6 segue aberto.

---

## T1 — Testes dos helpers de papel (TDD, escritos ANTES do código)

Arquivo: `src/utils/comissaoCalculator.test.js`.

Casos, por helper:

`coordenadoraDoUsuario(userProfile, coordenadoras)`
- usuário com linha ativa → devolve a linha
- usuário sem linha → `null`
- linha com `ativo=false` → `null` (não vira papel)
- comparação de id tolerante a string × string (`String()` nos dois lados)
- `userProfile` nulo → `null`

`papeisDisponiveis(userProfile, coordenadoras)`
- sem linha → `['corretor']`
- com linha ativa → `['corretor', 'coordenacao']`

`vendasDaCoordenacao(vendas, coordenadora)`
- devolve só as com `coordenadora_id` da coordenadora
- **exclui as próprias** (`corretor_id === coordenadora.usuario_id`) — caso Jessica
- exclui `excluido=true` e `status='distrato'` (régua única, `isVendaAtiva`)
- coordenadora `null` → `[]`

`resumoCoordenacao({ vendas, pagamentos, coordenadora, cargos, coordenadoras, mes })`
- fatia paga/pendente = `comissao_gerada × taxa/percentual_comissao_total`
- snapshot `coordenadora_taxa=1` vence `percentual_padrao=0,5` (cenário 3)
- parcela `cancelado` não entra em nenhum número (cenário 5)
- carteira vazia → `vazio: true` e todos os números em 0, **sem lançar** (cenário 4)
- pagamento de venda fora do escopo é ignorado
- filtro por mês usa `dataEfetiva`
- macro neutro: nº de vendas, parcelas pagas/pendentes, % do pró-soluto recebido,
  vencidas em aberto — todos valores de **parcela**, nunca comissão de outro cargo

Regressão a travar:
- `percentualCorretorDaVenda` continua devolvendo 4 pra venda externa de cadastro
  interno (caso Pires, cenário 8) — o teste já existe, confirmar que segue verde.

**Pronto quando:** `npm run test:run` falha só nos testes novos (vermelho honesto).

---

## T2 — Helpers puros no `comissaoCalculator.js`

Implementar os quatro helpers até T1 ficar verde. Sem tocar em componente.

- `resumoCoordenacao` monta a fatia por `fatiaCargoDoPagamento(pag, venda, 'Coordenadora', cargos, coordenadoras)`
  — não reimplementar a conta.
- Devolver `{ vazio, nVendas, nParcelasPagas, nParcelasPendentes, pctRecebido,
  nVencidasAbertas, valorVencidoAberto, fatiaPaga, fatiaPendente, serieMensal }`.
- `vazio = nVendas === 0` — é o flag que a tela usa pro estado do Pires.

**Pronto quando:** `npm run test:run` verde e nenhum arquivo de `src/pages/` alterado.

---

## T3 — Carga de dados da coordenação no `CorretorDashboard`

- Ler `coordenadoras` ativas no mount e resolver `coordenadoraDoUsuario`.
- Só quando o papel Coordenação é selecionado, carregar vendas direcionadas e as parcelas
  delas — **paginado** com `fetchAllPaginated`, `.order('id')`, `.in('venda_id', …)`
  fatiado em lotes de 100 vendas e `{ concurrency: 4 }` (172 vendas da Carol passam de
  1000 parcelas com folga; sem isso o total sai truncado em silêncio).
- Carregar `cargos_empreendimento` (precisa do `percentual` do cargo Coordenadora).
- Erro de página → propagar, nunca `break` silencioso.

**Pronto quando:** os dados chegam completos e o resumo bate com o helper.

---

## T4 — Seletor de papel + painel de coordenação (UI)

- Seletor visível **só** quando `papeisDisponiveis` traz dois papéis (cenário 1).
- Default sempre "Corretor" — zero regressão pra quem não coordena.
- Painel de coordenação: dois cards de fatia (recebida / a receber) + os quatro cards de
  macro neutro, no mesmo layout do `BeneficiarioDashboard`.
- **Estado vazio (cenário 4)**: quando `vazio`, substituir os cards por uma mensagem
  explicando que ainda não há venda direcionada e que os números aparecem quando o Admin
  direcionar — nunca zeros mudos.
- Nenhuma conta dentro do JSX: a tela só consome `resumoCoordenacao`.

**Pronto quando:** build verde, lint verde, e as três contas conferidas em dev contra os
números do helper.

---

## T5 — Acesso da Carolina (PRODUÇÃO — só falta o OK de execução)

Decisões 1–3 já respondidas. Nada mais bloqueia; falta o "pode aplicar".

- **Pires** (`9b1f5c90…4349`): já tem login. Nada a fazer.
- **Jessica** (`e94de4d7…ab7e`): já tem login em `jessica@`. Mantido. Nada a fazer.
- **Carolina** (`4c04b405…3c0c`): criar acesso pelo botão 🔑 do Admin, informando
  `carolina@imincorporadora.com.br`. A edge grava o email no cadastro e cria a conta do
  Auth **com o mesmo id**. **Quem digita a senha é o Jonas, no próprio painel** — senha
  não passa por aqui. **Nunca criar pelo painel do Supabase**: geraria id novo e
  desligaria as 4 vendas dela.

Verificação depois: `scripts/_validar-acesso-usuario.mjs` com as credenciais dela —
confere que o perfil casa pelo id e que a carteira aparece.

---

## T6 — `coordenadora_taxa` na criação da venda

Hoje só o backfill escreve o snapshot; venda direcionada nova nasce NULL e cai no
fallback da taxa vigente da coordenadora. Com a decisão 3 o fallback dá o valor certo pro
Pires (0,50%), então isto deixou de ser urgente — mas snapshot > fallback quando a taxa
mudar de novo. Ao salvar venda com `coordenadora_id` no Admin, gravar
`coordenadora_taxa` com a taxa vigente da coordenadora daquela venda.

---

## T7 — Linha do Pires em `coordenadoras` — ⛔ APLICADO E DEPOIS REVERTIDO (04/09/2026)

**O Pires não é coordenador.** A premissa veio do enunciado da demanda ("está virando
coordenador agora") e o Jonas corrigiu no mesmo dia, ao ver o seletor aparecer na conta
dele. A linha `9169320a…44fa` foi removida.

O DELETE foi conferido antes: **zero vendas** apontavam para essa linha (controle
positivo na mesma consulta: a da Carol tem 172). Nenhuma venda perdeu vínculo, nenhuma
comissão mudou. Confirmado pelos helpers do app depois
([scripts/verificar-papel-coordenacao.mjs](../../scripts/verificar-papel-coordenacao.mjs)):
Pires voltou a `papeis=['corretor']`, e Carol e Jessica seguem idênticas ao centavo.

**Coordenação fica com duas pessoas: Carolina (0,50%) e Jessica (1,00%).** O Pires é
corretor, com carteira própria mista — 32 vendas internas e 13 externas.

---

## T8 — Cadastro duplicado do Pires (aberto, precisa de decisão)

A duplicata deixou de ser inerte: ao tentar ativar o acesso por ela, o sistema recusa com
*"email já usado por outro cadastro — consolidar antes de criar acesso"*. A recusa está
certa (dois logins fragmentariam a carteira), mas os dois cadastros aparecem na lista com
o mesmo nome, e não há como saber qual é qual pela tela.

| id | e-mail | tipo | ativo | origem | login | vendas | clientes |
|---|---|---|---|---|---|---|---|
| `9b1f5c90…4349` | piresmatheusdesouza@gmail.com | interno | sim | manual | **sim** | **46** | 0 |
| `a80c1aa4…3602` | MEUCNPJ@ACCOUNTTECH.COM.BR | externo | não | sienge | não | **0** | 0 |

O de baixo é o descartável: sem venda, sem cliente, sem login, já inativo. Opções:
apagar, ou renomear para algo como "(duplicado — não usar)" e manter para histórico.
Decisão do Jonas — não mexer sem OK.
