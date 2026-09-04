# Tickets — papel Coordenador na conta do corretor

Spec: [2026-09-04-spec-papel-coordenador.md](2026-09-04-spec-papel-coordenador.md).
Ordem de execução: T1 → T2 → T3 → T4. T5/T6/T7 são gated pelo Jonas.

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

## T5 — Acessos das três pessoas (PRODUÇÃO — gated)

Não executar sem OK explícito do Jonas. Depende das decisões 1 e 2 da spec.

- **Pires** (`9b1f5c90…4349`): já tem login. Nada a criar.
- **Jessica** (`e94de4d7…ab7e`): já tem login em `jessica@`. Se o Jonas quiser
  `jessicacararo@`, é troca de email do cadastro + do Auth, **mantendo o mesmo id**.
- **Carolina** (`4c04b405…3c0c`): criar acesso pelo botão 🔑 do Admin passando
  `carolina@imincorporadora.com.br` — a edge recusa o placeholder `@sync.local`, então o
  email real é obrigatório no payload. **Nunca criar pelo painel do Supabase** (gera id
  novo e desliga as 4 vendas dela).

Verificação: rodar `scripts/_validar-acesso-usuario.mjs` com as credenciais de cada uma e
conferir que o perfil casa e a carteira aparece.

---

## T6 — `coordenadora_taxa` na criação da venda (gated pela decisão 3)

Hoje nada escreve o snapshot na criação — venda direcionada nova nasce NULL e cai no
fallback da taxa vigente. Ao salvar venda com `coordenadora_id` no Admin, gravar
`coordenadora_taxa`. Qual valor (cutover × `percentual_padrao` da coordenadora) depende da
decisão 3 da spec. Não implementar antes da resposta.

---

## T7 — Linha do Pires em `coordenadoras` (PRODUÇÃO — gated pela decisão 3)

`INSERT` com `nome`, `usuario_id = 9b1f5c90…4349`, `percentual_padrao` a definir,
`ativo = true`. Enquanto não existir, o Pires não vê o seletor — e é o comportamento
correto (cenário 1), não um bug.
