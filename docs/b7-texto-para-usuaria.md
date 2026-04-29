# Pontas soltas pós-validação financeira — precisa de confirmação (Etapa B.7)

Após a validação dos R$ 8,6M com o financeiro, a auditoria automática achou **30 casos** que precisam da sua decisão (descartei 4 casos óbvios de teste — `jonas beton`/`jonas@teste.com` — vou cancelar sem perguntar).

Dividi em **4 grupos** por nível de risco e tipo de decisão:

- **Grupo 1 — 11 vendas sem pro-soluto (PU/PA/Permuta):** confirmadas no Sienge. Só queria seu OK pra deixar como "venda quitada/permuta".
- **Grupo 2 — 1 venda duplicada (1804 A):** evidência clara de duplicata por usuário de teste, mas tem pagamento baixado. Precisa decisão antes de excluir.
- **Grupo 3 — Contrato 138 com 8 datas duplicadas:** cronograma do banco tem repetição. Precisa olhar Sienge pra decidir.
- **Grupo 4 — 13 vendas sem corretor:** Sienge não expõe corretor pela API. Você preenche planilha.

---

## Grupo 1 — 11 vendas sem pro-soluto (confirmadas no Sienge)

Validação: payload Sienge `paymentConditions[]` **não tem** condição `PM` (Parcelas Mensais) em nenhuma das 11. São vendas legitimamente à vista, anuais ou via permuta. **Por isso não geram cronograma de pro-soluto**.

### 1A — 8 vendas do GONÇALVES DE MENDONÇA PARTICIPAÇÕES LTDA (corretor: Watson Slonski)

Todas R$ 500.000, contratos sequenciais, mesmo cliente. Diferença é só o tipo de pagamento Sienge:

| Contrato | Sienge | Tipo Sienge |
|----------|--------|-------------|
| 275 | 393 | PARCELA UNICA (à vista) |
| 276 | 394 | PARCELAS ANUAIS |
| 277 | 395 | PARCELA UNICA |
| 278 | 396 | PARCELAS ANUAIS |
| 279 | 397 | PARCELA UNICA |
| 280 | 398 | PARCELA UNICA |
| 281 | 399 | PARCELA UNICA |
| 282 | 400 | PARCELA UNICA |

**Ação sugerida:** "Pode deixar como está — vendas quitadas / parceladas anualmente, sem cronograma mensal."
**Pendência:** todas estão **sem cliente vinculado** no cadastro local — só tem o nome no banco. Se quiser, complemento depois.

### 1B — 3 vendas FERRETTI CONSULTORIA (PERMUTA)

| Contrato | Sienge | Unidade Sienge | Valor |
|----------|--------|----------------|-------|
| 300 | 433 | 1008 D | R$ 499.437,96 |
| 301 | 434 | 908 D | R$ 494.493,06 |
| 302 | 435 | 1208 A | R$ 509.476,67 |

**Total:** R$ 1.503.407,69 em permutas. Sem corretor e sem cliente vinculados no local.

**Decisão:**
1. **"Permuta interna, mantém sem corretor/cliente"** — fica como está, fora do fluxo de comissão.
2. **"Falta cadastrar — vou complementar"** — me passa nome do corretor (ou se é interno).

---

## Grupo 2 — Venda duplicada do bloco A unidade 1804 (1 caso)

### Cliente: GIOVANE DOS SANTOS — CPF 03063230952 — Tel (47)99180-0266

Existem **duas vendas** distintas pra a mesma unidade do mesmo cliente, **com pagamento baixado idêntico em ambas** (R$ 1.267,19 em 2026-02-20, parcela #9):

| Venda | Criada | Corretor |
|-------|--------|----------|
| `ac644733...` | 17/03/2026 | **MATHEUS DE S. PIRES** (real) |
| `9d279176...` | 09/04/2026 | **jonas beton** (`jonas@teste.com` — usuário de teste) |

**Hipótese forte:** a duplicata é teste. Mas o sistema não me deixa excluir uma venda que tem pagamento baixado (proteção de auditoria).

**Decisão:**
1. **"Confirma: estornar a baixa do pagamento fantasma `c779389c...` e excluir a venda `9d279176...`"** — recomendado.
2. **"Os dois pagamentos são reais (cliente pagou em duplicidade)"** — caso raro mas possível.
3. **"Investiga manualmente no Sienge antes"** — verificar qual paymentId é o oficial.

---

## Grupo 3 — Contrato 138 com 8 datas duplicadas

### Contrato 138 — Sienge 230 — Unidade 906 C
- **Cliente:** JOÃO PEDRO MARASCA — CPF 09762700916 — Tel (47) 99670-3160
- **Pro-soluto:** R$ 78.199,66 = exatamente 58 parcelas de R$ 1.348,27

**Problema:** parcelas 21–28 têm a **mesma `data_prevista`** que 13–20 (abr/27 a nov/27). Sequência das outras (29–58) está limpa. Bug do gerador antigo.

**Hipóteses (sem cronograma Sienge live não dá pra decidir):**

1. **Hipótese A — São 50 parcelas reais:** as 8 duplicadas são lixo. Ação: cancelar parcelas 21–28 + ajustar `valor_pro_soluto` pra R$ 67.413,50.
2. **Hipótese B — São 58 parcelas reais:** datas 21–28 deveriam estender depois da 58. Ação: deslocar datas pra jun/30..jan/31. Pro-soluto fica como está.
3. **"Vou olhar no Sienge"** — confirmar quantidade real de parcelas.

⚠️ **Enquanto não decidir:** financeiro do cliente continua coerente (pro-soluto bate com 58 parcelas), só visual fica esquisito (datas repetidas no cronograma).

---

## Grupo 4 — 13 vendas sem corretor (precisam preenchimento manual)

A API do Sienge **não expõe** o corretor dessas vendas (testei 9 endpoints diferentes — todos 404 ou 403, e `linkedCommissions` retorna `null` no payload). Não tem como mapear automático.

| # | Contrato | Sienge | Unidade | Cliente | Data Contrato | Valor |
|---|----------|--------|---------|---------|---------------|-------|
| 1 | 35 | 75 | 902 A | RICARDO JOSÉ GIRARD | 2025-05-22 | R$ 390.993,15 |
| 2 | 37 | 79 | 904 A | BRYAN LUCAS MACCALLI | 2025-06-04 | R$ 418.341,97 |
| 3 | 71 | 161 | 1506 A | LUCAS PORTO MARTINS | 2025-06-16 | R$ 310.250,00 |
| 4 | 84 | 174 | 1806 A | ALEX WILLIAN BERNARDES | 2025-05-09 | R$ 388.744,70 |
| 5 | 86 | 176 | 403 B | MILENA PAULA NASCIMENTO SANTOS | 2025-06-02 | R$ 310.442,00 |
| 6 | 121 | 213 | 503 C | ANTONIO DOS SANTOS ESTEVÃO | 2025-05-22 | R$ 313.546,14 |
| 7 | 144 | 236 | 1007 C | CLAUDIO MARTIRE | 2025-05-16 | R$ 384.110,14 ⚠️ ver b6 grupo 3 |
| 8 | 202 | 294 | 1201 D | ANNE MAYARA BRANCO VIEIRA | 2025-05-06 | R$ 356.209,78 |
| 9 | 273 | 390 | 1008 C | CLAUDIO MARTIRE | 2025-05-16 | R$ 384.110,14 |
| 10 | 287 | 411 | 603 B | CAYO KAMENAC RAMOS DA SILVA | 2026-02-09 | R$ 426.900,16 |
| 11 | 300 | 433 | 1008 D | FERRETTI (permuta — ver Grupo 1B) | 2026-03-24 | R$ 499.437,96 |
| 12 | 301 | 434 | 908 D | FERRETTI (permuta — ver Grupo 1B) | 2026-03-23 | R$ 494.493,06 |
| 13 | 302 | 435 | 1208 A | FERRETTI (permuta — ver Grupo 1B) | 2026-03-24 | R$ 509.476,67 |

**Resposta esperada:** uma planilha (CSV ou texto) no formato:

```
sienge_contract_id, nome_corretor
75, [nome do corretor]
79, ...
```

Se algum não tem corretor mesmo (caso permuta interna): escreve `SEM_CORRETOR`. Aplico todas as respostas com origem `manual` — protegido contra sobrescrita por sync futuro.

---

## Resumo

| Grupo | Casos | Ação |
|---|---|---|
| 1A — Vendas Gonçalves de Mendonça (PU/PA) | 8 | Confirmar status (sugestão aprovada tacitamente) |
| 1B — Permutas Ferretti | 3 | **Decidir** se tem corretor/cliente |
| 2 — Duplicata 1804 A | 1 | **Decidir** estorno + exclusão |
| 3 — Contrato 138 datas duplicadas | 1 | **Decidir** com Sienge ou aguardar |
| 4 — Sem corretor (planilha) | 13 | **Preencher** corretores |
| **Total** | **30** | |

## O que fazer agora

Quando puder, me responde:

1. **Grupo 1A:** um "ok, pode deixar como está" ou alguma exceção.
2. **Grupo 1B (3 permutas Ferretti):** opção 1 ou 2.
3. **Grupo 2 (1804 A duplicata):** opção 1, 2 ou 3.
4. **Grupo 3 (contrato 138):** A, B ou "vou olhar no Sienge".
5. **Grupo 4 (planilha de corretores):** lista preenchida.

**Nota:** os 5 balões de teste (jonas beton/jonas cliente, K 002) já vou cancelar sem perguntar. Os outros 35 balões sem data prevista (5 vendas locais reais) precisam de planilha sua com `numero_parcela, data_prevista` — mas isso é menor, posso mandar separado depois se quiser.

Referência: [docs/b7-revisao-humana.json](docs/b7-revisao-humana.json)
