# Parcelas órfãs — precisa de confirmação (Etapa B.6)

Após alinhar as duplicatas da B.5, sobraram **84 parcelas "órfãs"** — linhas no nosso banco que **não têm par no Sienge**. Dividimos em 3 grupos pelo nível de risco:

- **Grupo 1 — 23 pendentes fora do cronograma do Sienge** (4 contratos): são seguras de cancelar sem sua intervenção, mas quero listar pra transparência.
- **Grupo 2 — 1 balão do contrato 38:** o banco tem 1 balão que o Sienge não reconhece. Pode ser erro do gerador antigo. Precisa decisão.
- **Grupo 3 — contrato 144 inteiro sem par no Sienge (60 parcelas, incluindo 3 pagas):** **URGENTE.** O Sienge não tem nenhum registro financeiro desse contrato, mas nós temos 3 pagamentos confirmados. Provavelmente falta o contrato no Sienge ou ele foi reemitido com outro número.

---

## Grupo 1 — Parcelas geradas além do cronograma do Sienge (23 pendentes, podem cancelar)

O gerador antigo criou mais parcelas do que o Sienge tem no cronograma oficial. Como todas estão **pendentes** e fora do range do Sienge, são ruído — posso cancelar. Só te mostro pra você conferir que faz sentido.

### Contrato 195 — Sienge 287 — Unidade 1004 D
- **Cliente:** FERNANDA DOS SANTOS DE ALMEIDA — CPF 03249953008 — Tel (54)99158-1986
- **Corretor:** LEAL NEGOCIOS IMOBILIARIOS LTDA — 4799467820
- **Problema:** Sienge tem 46 parcelas PM; nosso banco tem **14 parcelas extras** (seqs 47 a 60), todas pendentes, vencimentos entre 2029-05 e 2030-06.
- **Ação sugerida:** cancelar as 14 extras (`status='cancelado'`).

### Contrato 243 — Sienge 340 — Unidade 905 B
- **Cliente:** CAROLINE SARAIVA DA SILVEIRA RODRIGUES — CPF 06023755925 — Tel (47)99727-9147
- **Corretor:** MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS — 1192003475
- **Problema:** Sienge tem 55 parcelas PM; banco tem 5 extras (seqs 56 a 60), pendentes em 2030.
- **Ação sugerida:** cancelar as 5 extras.

### Contrato 83 — Sienge 173 — Unidade 1805 A
- **Cliente:** CARLOS CRISTIANO COUTINHO SOARES — CPF 01098437039 — Tel (55)98118-8060
- **Corretor:** MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS — 1192003475
- **Problema:** Sienge tem 57 parcelas PM; banco tem 3 extras (seqs 58, 59, 60), pendentes em 2030.
- **Ação sugerida:** cancelar as 3 extras.

### Contrato 127 — Sienge 219 — Unidade 704 C
- **Cliente:** JOSAPHA AMORIM BRASIL — CPF 02321928204 — Tel (47)99629-7329
- **Corretor:** CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA — 4797071735
- **Problema:** Sienge tem 58 parcelas PM; banco tem 1 extra (seq 59), pendente em 2030-04.
- **Ação sugerida:** cancelar a extra.

**Resposta esperada deste grupo:** "Pode cancelar todas as 23 extras." (Se não concordar com algum, me avisa.)

---

## Grupo 2 — Balão do contrato 38 sem par no Sienge (1 caso)

### Contrato 38 — Sienge 80 — Unidade 905 A
- **Cliente:** TAYARA GUERRA DE BARROS — CPF 01562354124 — Tel (47)99964-9372
- **Corretor:** MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS — 1192003475
- **Valor venda:** R$ 345.733,70 — **valor pro-soluto lançado = R$ 345.733,70** (⚠️ igual ao valor da venda — suspeita de erro de cadastro na venda)
- **Problema:** banco tem 1 balão pendente de R$ **276.586,70** com vencimento **2030-12-01**. No Sienge essa venda tem outro balão (tipo B8, seq 8), mas não um balão seq 1. Provavelmente o gerador antigo criou esse balão incorretamente.
- **Precisa decidir:**
  1. **"Cancelar o balão"** — se você confirma que o cronograma real não tem esse balão.
  2. **"Conferir no Sienge"** — você verifica se o Sienge tem o balão e vê onde ele se encaixa.
  3. **"Corrigir o valor pro-soluto da venda"** — se o valor de R$ 345.733,70 é um erro de cadastro, a gente corrige.

---

## Grupo 3 — Contrato 144 SEM par no Sienge (60 parcelas, 3 pagas) — URGENTE

### Contrato 144 — Sienge 236 — Unidade 1007 C
- **Cliente:** CLAUDIO MARTIRE — CPF 95336362972 — Tel (47)99908-7492
- **Corretor:** (sem corretor vinculado no banco)
- **Valor venda:** R$ 384.110,14 — **pro-soluto R$ 69.838,21**
- **Problema crítico:** o **receivable-bill 261 desse contrato não existe no Sienge** (zero parcelas no bulk-data). Mas no nosso banco temos:
  - **3 pagamentos confirmados** (baixados):
    - Parcela 8 — prevista 2025-12-20, paga em **2026-01-19**, R$ 1.163,97
    - Parcela 9 — prevista 2026-01-20, paga em **2026-02-04**, R$ 1.163,97
    - Parcela 10 — prevista 2026-02-20, paga em **2026-02-23**, R$ 1.163,97
  - **57 parcelas pendentes** (seqs 1-7 e 11-60), totalizando R$ 66.346,30.

- **Hipóteses possíveis:**
  1. O contrato foi migrado/reemitido no Sienge com outro número de receivable-bill (precisa localizar o novo).
  2. O contrato foi **cancelado** no Sienge sem avisar o sistema local.
  3. O receivable-bill 261 **nunca foi criado no Sienge** — o financeiro do cliente está só no nosso sistema.

- **Precisa decidir com o financeiro:**
  1. **"Esse contrato foi cancelado, pode cancelar tudo no banco"** — mas os 3 pagamentos já baixados precisam ter um destino (estorno, transferência).
  2. **"Ele foi reemitido com outro bill_id, vou te passar o novo"** — religamos as parcelas ao novo bill.
  3. **"O contrato existe mesmo, vou verificar no Sienge por que o bulk não retorna"** — pode ser bug no bulk do Sienge ou contrato fora do escopo do endpoint.
  4. **"Esses 3 pagamentos são reais, vou criar/localizar no Sienge antes de a gente fazer qualquer coisa"**.

⚠️ **Enquanto não houver decisão, não vou mexer nesse contrato.** Os 3 pagamentos ficam preservados (trigger 017 bloqueia alteração).

---

## Resumo estatístico

| Grupo | Casos | Tipo | Ação |
|---|---|---|---|
| 1 — Parcelas extras além do Sienge | 23 pendentes em 4 contratos | parcela_entrada | Cancelar (sugestão aprovada tacitamente) |
| 2 — Balão divergente contrato 38 | 1 pendente (R$ 276.586) | balão | **Decisão** |
| 3 — Contrato 144 sem par no Sienge | 57 pendentes + **3 pagos** | parcela_entrada | **Decisão urgente com financeiro** |
| **Total** | **84** | | |

## O que fazer agora

Quando puder, me passa:

1. **Grupo 1:** um "ok, pode cancelar" ou "esse contrato aqui espera".
2. **Grupo 2 (contrato 38):** qual das 3 opções.
3. **Grupo 3 (contrato 144):** valida com o financeiro e me retorna a decisão. Este é o único caso que **bloqueia B.6 inteiro** até ter resposta.

Referência cruzada:
- Banco: `pagamentos_prosoluto` órfãos (ver `docs/analise-b6-orfaos.json`)
- Sienge: receivable-bills 268, 410, 293, 284, 272 (existem); 261 (não existe — esse é o problema)
