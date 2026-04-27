# Venda duplicada — bloco A unidade 1804 (Etapa B.2)

## O caso

Cliente **GIOVANE DOS SANTOS** (CPF 03063230952, tel (47)99180-0266) tem **duas vendas** distintas no banco para a mesma unidade 1804 A. Cada venda tem 61 pagamentos, 1 pago em 2026-02-20 — exatamente o mesmo valor (R$ 1.267,19), mesma parcela #9 — sugerindo que **uma das duas é duplicata** e o pagamento foi lançado em ambas por engano.

| Venda | Criada | Corretor | Status |
|-------|--------|----------|--------|
| `ac644733-d731-44e5-8573-99b9231e90a8` | 17/03/2026 | **MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS** (real) | 61 pags, 1 pago |
| `9d279176-e4de-4e3f-8ec2-9aa4b6c7f62a` | 09/04/2026 | **jonas beton** (`jonas@teste.com`, **usuário de teste**) | 61 pags, 1 pago |

## Hipótese

Venda original = `ac644733` (corretor Matheus, criada 17/03). Duplicata = `9d279176`, criada 09/04 com o usuário de teste — provavelmente teste de fluxo que ficou no banco. O pagamento de R$ 1.267,19 em 20/02 foi lançado em ambas — o real está na original; o da duplicata é "fantasma" que precisa ser estornado.

## ⚠️ Bloqueio spec

A regra `.claude/rules/sincronizacao-sienge.md` proíbe `excluido=TRUE` em vendas com pagamentos `status='pago'`. Não posso marcar a duplicata como excluída automaticamente. Precisa decisão da gestora **e** estorno do pagamento fantasma antes.

## Opções

1. **"É duplicata de teste, pode estornar e excluir"** — operador faz "Excluir Baixa" no pagamento `c779389c-20fc-4dd8-a733-36c78b0a339b` (status pago→pendente + data_pagamento→NULL via trigger 020), e em seguida marca venda `9d279176` como `excluido=true`.

2. **"Os dois pagamentos são reais (cliente pagou em duplicidade)"** — caso real raro; deixa como está.

3. **"Investiga manualmente no Sienge antes"** — buscar o `paymentId` real no Sienge pra confirmar qual dos dois é o lançamento oficial.

## Resposta esperada
"Opção 1 confirmada" → operador executa o passo a passo via UI (Excluir Baixa + marca excluido) ou via SQL controlado.

Referência: [docs/B2-execucao.json](docs/B2-execucao.json) — relatório com detalhes técnicos.
