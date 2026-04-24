# Parcelas duplicadas — precisa de confirmação

Encontramos **34 situações** onde uma mesma parcela de pró-soluto aparece **duas vezes no sistema** pra mesma venda, e não dá pra resolver automaticamente — precisa do seu olhar antes da gente mexer, porque envolve pagamentos já lançados.

## O que é o problema

O gerador antigo de parcelas criou, pra algumas vendas, duas "séries" de pró-soluto idênticas ao invés de uma só. Quando o Sienge puxou os pagamentos, o sistema casou o mesmo pagamento real com **as duas** linhas — inflando a contagem de parcelas pagas.

Em algumas dessas vendas o **Sienge renegociou as parcelas** (empurrou as datas pra frente, ex.: parcela 1 que venceria 2025 agora vence 2026). O banco local ficou com:
- A série nova do Sienge (datas futuras, algumas já pagas, outras pendentes)
- A série antiga original (datas passadas, com **pagamentos que realmente aconteceram**)

Se a gente simplesmente apagar a série antiga, perde o registro desses pagamentos. Por isso precisa sua confirmação.

## O que precisamos de você

Pra cada um dos 34 casos abaixo, confirmar uma dessas 3 opções:

1. **"Pode cancelar a série antiga"** — o pagamento registrado na série antiga já foi contabilizado/estornado no Sienge na renegociação, então tirar do nosso sistema só alinha com a verdade.
2. **"Esse pagamento tem que ficar em outra parcela"** — o dinheiro entrou de verdade, mas o Sienge alocou em outra parcela. Vamos precisar transferir o registro.
3. **"Não sei, quero conferir no Sienge"** — a gente pausa e você confere antes.

---

## Os 34 casos

### Contrato 40 — Sienge 87 — Unidade 908 A
- **Cliente:** LEANDRO DE OLIVEIRA VICENTIN — CPF 18757055890 — Tel (47)98420-3075
- **Corretor:** CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA — 4797071735
- **Parcela 5 PM** — Sienge hoje diz vence 2026-06-20. Nosso banco tem uma linha **paga** com data prevista 2025-10-20 e pagamento em 2025-10-06. Decidir.
- **Parcela 7 PM** — Sienge hoje diz vence 2026-08-20. Banco tem paga com data prevista 2025-12-20 e pagamento em 2025-12-01. Decidir.

### Contrato 73 — Sienge 163 — Unidade 1603 A
- **Cliente:** DIOGO DA LUZ DOS SANTOS — CPF 09233207927 — Tel (47)99724-4138
- **Corretor:** MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS — 1192003475
- **Parcela 3 PM** — Sienge hoje: vence 2026-10-20 (pendente). Banco tem **2 linhas pagas** antigas: dp 2025-12-20 com pagto 2026-01-19 e dp 2025-12-20 com pagto 2025-08-20.
- **Parcela 5 PM** — Sienge hoje: vence 2026-12-20 (pendente). Banco tem linha paga dp 2026-02-20 pagto 2026-02-20.
- **Parcela 6 PM** — Sienge hoje: vence 2027-01-20. Banco tem paga dp 2026-03-20 pagto 2026-03-20 (e uma pendente idêntica em dp 2026-03-20).
- **Parcela 7 PM** — Sienge hoje: vence 2027-02-20 e já tem uma paga nossa. Mas banco tem **outra paga duplicada** com dp 2026-04-20 e pagto 2026-04-20.

### Contrato 76 — Sienge 166 — Unidade 1607 A
- **Cliente:** GHIZIERI JENNINFER FREITAS COSTA BOSZCZOWSKI — CPF 08401031907 — Tel (47)988623130
- **Corretor:** CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA — 4797071735
- **Parcela 5 PM** — Sienge hoje: vence 2026-05-20 (temos uma paga bate). Banco tem outra paga duplicada dp 2025-12-20 pagto 2026-01-19.

### Contrato 112 — Sienge 204 — Unidade 1204 B
- **Cliente:** SARA JANE DE OLIVEIRA BARBOSA — CPF 04304256009 — Tel (47)99245-8784
- **Corretor:** CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA — 4797071735
- Tem 2 parcelas (2 e 4) com pagamentos duplicados em datas idênticas — são duplicatas limpas. Pode cancelar a sobra, mas como estão pagas o sistema pediu sua confirmação antes.

### Contrato 154 — Sienge 246 — Unidade 1302 C
- **Cliente:** MARIA VITORIA DA SILVA FRANCISCO — CPF 11625933932 — Tel (43)99669-8714
- **Corretor:** CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA — 4797071735
- **Parcela 3 PM** — Sienge hoje: vence 2026-03-20 (cancelado lá). Banco tem paga dp 2025-12-20 pagto 2026-01-13.

### Contrato 163 — Sienge 255 — Unidade 1405 C
- **Cliente:** ANDREY LUIZ MESSIAS SANTOS — CPF 05319809522 — Tel (47)99282-8064
- **Corretor:** CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA — 4797071735
- **Caso grande:** 7 parcelas (1 a 7, exceto 5) onde o Sienge mudou as datas — a série antiga que temos registrada como paga está ~7 meses atrás do que o Sienge mostra. Provavelmente **renegociação total** das parcelas desse contrato. Precisa ver com o financeiro se os pagamentos antigos devem permanecer como auditoria ou se o Sienge tem outro destino pra eles.

### Contrato 164 — Sienge 256 — Unidade 1406 C
- **Cliente:** WANDERLEY ROSA GUIMARÃES JÚNIOR — CPF 05204505903 — Tel (47)99617-9440
- **Corretor:** CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA — 4797071735
- **Parcela 3 PM** — Sienge: 2026-05-20. Temos 2 pagas antigas (dp 2025-12-20, pagtos 2026-01-19 e 2025-12-18).
- **Parcela 4 PM** — Sienge: 2026-06-20 (temos uma paga). Outra paga duplicada dp 2026-01-20 pagto 2026-02-03.
- **Parcela 5 PM** — Sienge: 2026-07-20 (pendente). Temos paga dp 2026-02-20 pagto 2026-02-20.

### Contrato 177 — Sienge 269 — Unidade 609 D
- **Cliente:** DIEGO RAMOS — CPF 10099686961 — Tel (47)99629-9164
- **Corretor:** ALECXANDER SOUZA E SILVA — 47999580426
- **Caso grande (ligado ao prazo):** parcelas 3, 4 e 6 PM — Sienge mostra vencimentos em 2030, mas o banco tem pagas de 2025-09-10, 2025-10-06 e 2026-01-19 respectivamente (5 anos de diferença). Aqui o Sienge pode ter **estendido o contrato 5 anos** ou remapeado as parcelas. Precisa checar no Sienge.

### Contrato 183 — Sienge 275 — Unidade 803 D
- **Cliente:** SAMUEL MUELLER LEMOS — CPF 11319608906 — Tel (47) 99660-0856
- **Corretor:** RONAL RESMINI BALENA — 4830948119
- **Parcelas 1, 4 e 5 PM** — Sienge mostra vencimentos em 2027, banco tem pagas de 2025-10-10, 2026-01-12 e 2026-02-10. Mesma situação do 269: prazos foram esticados ~19 meses no Sienge.

### Contrato 246 — Sienge 346 — Unidade 508 A
- **Cliente:** MICHEL CHRISTIAN BORBA — CPF 09786118960 — Tel (47)99713-2318
- **Corretor:** CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA — 4797071735
- **Parcela 2 PM** — Sienge: 2026-05-10. Temos 2 pagas idênticas dp 2026-01-10 (pagtos 2026-02-02 e 2026-01-06). Duplicata de pagamento.
- **Parcela 3 PM** — Sienge: 2026-06-10 (temos paga). Outra paga duplicada dp 2026-02-10 pagto 2026-02-06.

### Contrato 249 — Sienge 351 — Unidade 506 A
- **Cliente:** LILIAM THAINE CARVALHO — CPF 11043972935 — Tel (47)99765-1106
- **Corretor:** CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA — 4797071735
- **Caso grande:** 8 parcelas (1 a 8) onde o Sienge também renegociou todo o cronograma. Banco tem pagas em datas antigas (desde 2025-09 até 2025-12), Sienge hoje mostra essas mesmas seqs com vencimento a partir de 2026-04. Similar ao contrato 255.

### Contrato 268 — Sienge 382 — Unidade 1305 A
- **Cliente:** (não vinculado no banco)
- **Corretor:** MATEUS GABRIEL DE OLIVEIRA — 47999033809
- **Parcela 1 PM** — Sienge: 2027-01-10 (pendente). Banco tem paga dp 2026-02-10 pagto 2026-02-03.

---

## Resumo estatístico

| Contrato | Qtd casos | Tipo predominante |
|---|---|---|
| 40 (Sienge 87) | 2 | Série defasada ~8 meses |
| 73 (Sienge 163) | 4 | Série defasada ~10 meses + duplicatas |
| 76 (Sienge 166) | 1 | Duplicata |
| 112 (Sienge 204) | 2 | Duplicata limpa (pagos idênticos) |
| 154 (Sienge 246) | 1 | Série defasada ~3 meses |
| 163 (Sienge 255) | 7 | **Renegociação total** |
| 164 (Sienge 256) | 3 | Série defasada ~5 meses + duplicata |
| 177 (Sienge 269) | 3 | **Prazo estendido ~5 anos** |
| 183 (Sienge 275) | 3 | **Prazo estendido ~19 meses** |
| 246 (Sienge 346) | 2 | Duplicata + série ~4 meses |
| 249 (Sienge 351) | 8 | **Renegociação total** |
| 268 (Sienge 382) | 1 | Série defasada ~11 meses |
| **Total** | **34** | |

## Já foi feito automaticamente (não precisa revisar)

- **64 linhas pendentes duplicadas** foram canceladas sem risco (ambas série estavam na data do Sienge, uma delas era só ruído).
- **55 grupos de duplicata** resolvidos sem sua intervenção.

## O que fazer agora

Quando puder, me passa decisão caso a caso (pode ser por contrato, não precisa parcela por parcela) de uma dessas:
- **"Todos desse contrato, pode cancelar série antiga"**
- **"Esses aqui (X, Y, Z) eu quero conferir antes"**
- **"Esse contrato eu sei que teve renegociação, manter só a série nova"**

Qualquer dúvida, a referência cruzada está em:
- Banco: `pagamentos_prosoluto` agrupado por venda
- Sienge: o receivable-bill de cada contrato (coluna "Sienge xxx" acima é o ID)
