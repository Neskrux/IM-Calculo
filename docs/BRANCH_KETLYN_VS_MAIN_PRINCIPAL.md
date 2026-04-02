# Branch `Ketlyn` × `main` do repositório principal (Neskrux)

Documento gerado para auditoria técnica: escopo da branch em relação a [`Neskrux/IM-Calculo`](https://github.com/Neskrux/IM-Calculo) (`upstream/main`), aderência às regras em [`.cursor/rules/`](../.cursor/rules/), **context engineering** dos dados persistidos e riscos de quebra com o que já existe na `main` principal.

---

## 1. Referência de comparação

| Item | Valor |
|------|--------|
| **Principal (upstream)** | `https://github.com/Neskrux/IM-Calculo` — branch `main` |
| **Fork de trabalho** | `https://github.com/araujokc99/IM-Calculo` |
| **Branch analisada** | `Ketlyn` |
| **Commits à frente de `upstream/main`** | `44e0037` → `6d61fd6` → `e5aa15c` |

Comando usado na análise: `git diff upstream/main...HEAD` (merge-base → HEAD).

---

## 2. Arquivos alterados (diff completo)

| Arquivo | Papel |
|---------|--------|
| `migrations/012_data_entrada_vendas.sql` | Coluna `vendas.data_entrada` (base de vencimentos) |
| `migrations/013_periodicidade_parcelas.sql` | Coluna `vendas.periodicidade_parcelas` (intervalo em meses) |
| `migrations/014_periodicidade_balao.sql` | Coluna `vendas.periodicidade_balao` |
| `migrations/015_distrato_e_soft_delete.sql` | `excluido`, `data_distrato`, `status` inclui `distrato`, índices |
| `migrations/016_renegociacoes.sql` | Tabela `renegociacoes` + histórico em JSONB |
| `src/pages/AdminDashboard.jsx` | UI + persistência Supabase para tudo acima |
| `src/styles/Dashboard.css` | Estilos (modais, renegociação, listagens, etc.) |

**Nota:** havia um arquivo acidental `tatus` (dump de `git status`) versionado na branch — removido do working tree como lixo; não inclua em PR.

Nenhum arquivo em `src/services/sienge/**` foi alterado nesta branch.

---

## 3. Funcionalidades e persistência no banco

### 3.1 Datas e periodicidade (`012`–`014`)

- **`data_entrada`**: data-base para cálculo de vencimentos de parcelas da entrada, sinal e balões (comentário na migration alinha intenção com o domínio “ato/assinatura”).
- **`periodicidade_parcelas`**: intervalo em meses entre parcelas quando a entrada é parcelada (`1`, `3`, `4`, `6`, `12`).
- **`periodicidade_balao`**: idem para balões (default `6` na migration).

**Onde persiste:** `UPDATE`/`INSERT` em `public.vendas` via `AdminDashboard.jsx` (formulário de venda).

**Compatibilidade:** colunas `IF NOT EXISTS` — vendas antigas ficam com `NULL`/default conforme migration; o código usa fallback `data_venda` quando `data_entrada` vazia, reduzindo regressão visual/cálculo.

---

### 3.2 Comissão integral (entrada ≥ 20% no ato)

**Regra de negócio:** [`.cursor/rules/comissao-integral-20.mdc`](../.cursor/rules/comissao-integral-20.mdc).

**Implementação na branch:** em `AdminDashboard.jsx` há comentário explícito citando o arquivo de regra e lógica:

- `percentualEntrada` = `(sinal + entrada) / valor_venda * 100`
- `entradaNoAto = !vendaForm.parcelou_entrada`
- `aplicarComissaoIntegral = percentualEntrada >= 20 && entradaNoAto`
- Caso positivo: um registro em `pagamentos_prosoluto` com `tipo: 'comissao_integral'`, `comissao_gerada` = total, `fator_integral` derivado da entrada quando aplicável.

**Alinhamento:** condiz com a tabela da regra (entrada parcelada ≥ 20% **não** gera integral).

---

### 3.3 Fator de comissão e parcelas

**Regra:** [`.cursor/rules/fator-comissao.mdc`](../.cursor/rules/fator-comissao.mdc) — comissão por parcela = `valorParcela × fatorCargo`, não percentual direto na parcela.

**Na branch:** geração de `pagamentos_prosoluto` usa `calcularComissaoPagamento(valor, fatorTotal)` com `fatorTotal` alinhado ao fluxo existente; comentários no dashboard referenciam `fator_comissao_aplicado` quando presente. **Renegociação:** novas parcelas usam `fator` de `venda.fator_comissao` e gravam `comissao_gerada` por linha — coerente com snapshot por pagamento.

**Pós-renegociação:** o código recalcula totais na tabela `vendas` (`comissao_total`, fatias por cargo) a partir da soma de `comissao_gerada` em `pagamentos_prosoluto`, proporcional aos percentuais atuais do empreendimento — alinhado à ideia de totais derivados dos pagamentos, com a ressalva de que usa **percentuais atuais** de cargos para redistribuir o novo total (ver riscos na §5).

---

### 3.4 Distrato e soft delete (`015`)

- **`excluido`:** exclusão lógica; listagem admin filtra `.or('excluido.eq.false,excluido.is.null')`.
- **`status = 'distrato'`** + **`data_distrato`:** constraint `vendas_status_check` ampliada na migration.

**Comissão em distrato (UI):** `calcularComissaoVendaDistrato` soma comissão de parcelas **pagas** ou com **vencimento ≤ data do distrato** — uso explícito de `pagamentos_prosoluto`, alinhado ao espírito de [`.cursor/rules/comissao-corretor.mdc`](../.cursor/rules/comissao-corretor.mdc) (não confiar só no status agregado da venda para “quanto já era devido” naquele corte).

---

### 3.5 Renegociações (`016` + UI)

**Tabela `renegociacoes`:**

| Campo | Função (context engineering) |
|--------|--------------------------------|
| `parcelas_originais` / `parcelas_novas` | JSONB — auditoria reprodutível do antes/depois |
| `motivo` | Texto livre obrigatório |
| `diferenca_valor` / `diferenca_comissao` | Deltas numéricos explícitos |
| `usuario_id` | FK `auth.users(id)` — quem executou (admin logado) |
| `data_renegociacao` | Timestamp do evento |

**Fluxo transacional (ordem):** snapshot → delete `pagamentos_prosoluto` selecionados → insert novos → insert `renegociacoes` → atualizar totais em `vendas`.

**Aderência Sienge:** [`.cursor/rules/sienge-sync.mdc`](../.cursor/rules/sienge-sync.mdc) não é violada — não há uso de Auth Admin para sync; `usuario_id` é registro de ação humana no painel, coerente com `auth.users` quando `usuarios.id` espelha o UUID do Auth (padrão deste projeto).

---

## 4. Context engineering — avaliação

| Aspecto | Avaliação |
|---------|-----------|
| **Rastreabilidade** | Forte: JSONB com parcelas antes/depois + motivo + deltas + usuário + data. |
| **Semântica de domínio** | `data_entrada`, periodicidades e `distrato` nomeiam intenção de negócio de forma clara para prompts e para humanos. |
| **Imutabilidade vs ajuste** | Renegociação **substitui** linhas de `pagamentos_prosoluto` (delete + insert); o histórico fica em `renegociacoes`, não em versionamento por linha de pagamento — aceitável se o requisito for “último estado + auditoria externa”. |
| **Documentação de schema** | `supabase-schema.sql` na raiz **não** foi atualizado neste diff; a verdade operacional são as **migrations 012–016** + aplicação manual no Supabase (como indicado em `015`). Para IAs e onboarding, vale sincronizar schema de referência ou apontar este doc + migrations. |

---

## 5. Riscos e pontos de atenção (main principal)

1. **Outros clientes (corretor/cliente)**  
   `CorretorDashboard.jsx` continua buscando `vendas` com `select('*')` **sem** filtrar `excluido`. Se RLS não ocultar linhas com `excluido = true`, o corretor pode ainda ver vendas “apagadas” logicamente. **Recomendação:** alinhar queries e/ou RLS com `excluido` (e política para `distrato` se necessário).

2. **Constraint de `status` na `main` real**  
   O repositório evoluiu por migrations; o `supabase-schema.sql` inicial ainda mostra `CHECK` antigo em alguns trechos. Garantir que **produção** aplique `015` antes de usar `distrato` — senão inserts/updates quebram.

3. **Renegociação e percentuais de cargos**  
   Após renegociar, a atualização de `comissao_diretor`, `comissao_corretor`, etc. na `vendas` usa `calcularComissoesDinamicas` com percentuais **atuais** do empreendimento. Isso pode divergir da regra de “snapshot imutável” de [fator-comissao.mdc](../.cursor/rules/fator-comissao.mdc) se os percentuais mudarem depois — para renegociação, o que permanece fonte de verdade por parcela é `comissao_gerada` em cada linha de `pagamentos_prosoluto`.

4. **`comissao_integral` e fatores por pagamento**  
   Registros integrais gravam `comissao_gerada`; verifique se relatórios/PDFs e `CorretorDashboard` tratam `tipo === 'comissao_integral'` como os demais pagamentos (o admin já rotula na UI).

5. **Artefatos de PR**  
   Confirmar que `tatus` (ou similares) não voltem no commit; manter apenas migrations + código + estilos.

---

## 6. Mapa rápido: regras `.cursor` × branch

| Regra | Aplicável? | Situação na branch |
|-------|------------|---------------------|
| `sienge-sync.mdc` | Escopo Sienge | Sem alterações nos serviços Sienge — **N/A**. |
| `fator-comissao.mdc` | Sim | Geração de parcelas e renegociação usam fator sobre valor da parcela; comentários citam fator aplicado. |
| `comissao-integral-20.mdc` | Sim | Implementado com `parcelou_entrada` + limiar 20%. |
| `comissao-corretor.mdc` | Sim (parcial) | Distrato no admin usa pagamentos; corretor ainda mistura fallbacks da venda em trechos legados — **não introduzido por esta branch**, mas o novo `excluido` exige alinhamento global. |

---

## 7. Checklist antes de merge no principal

- [ ] Rodar migrations `012`–`016` no projeto Supabase do Neskrux (ordem numérica).
- [ ] Revisar RLS: `renegociacoes`, colunas novas em `vendas`, e visibilidade de `excluido`/`distrato`.
- [ ] Testes manuais: criar venda com entrada parcelada trimestral + balões; comissão integral 20% no ato; distrato com data; renegociação com total fechando.
- [ ] Atualizar `supabase-schema.sql` ou documentação oficial do schema para refletir o estado pós-migrations.
- [ ] Garantir ausência de arquivos acidentais no PR.

---

*Documento derivado do estado do repositório local na branch `Ketlyn` frente a `upstream/main` (Neskrux). Reexecute `git log upstream/main..HEAD --oneline` e `git diff upstream/main...HEAD --stat` após novos commits para manter este arquivo atualizado.*
