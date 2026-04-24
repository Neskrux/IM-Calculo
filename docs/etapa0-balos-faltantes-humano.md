# Balões que o Sienge tem e o banco nunca gerou (Etapa 0.3 — faltantes reais)

Depois de reverter 281 parcelas que a Etapa B.5 cancelou erroneamente, sobraram **7 balões** que o Sienge tem como pendentes mas que nunca existiram no nosso banco (nem como cancelados). São casos onde o gerador antigo de parcelas não criou todos os balões do contrato.

Todos são **pendentes no Sienge** (nenhum pago) — então não há risco de perder registro financeiro. Só precisamos decidir se geramos essas parcelas no banco pra refletir o cronograma do Sienge, ou deixamos como estão (banco fica "incompleto" mas o repasse de comissão na prática vai usar o que o Sienge mostrar).

## Contratos afetados

### Contrato 38 — Sienge 80 — Unidade 905 A
- **Cliente:** TAYARA GUERRA DE BARROS — CPF 01562354124 — Tel (47)99964-9372
- **Corretor:** MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS — 1192003475
- **Obs:** `valor_pro_soluto = R$ 345.733,70` = `valor_venda` (⚠️ provável erro de cadastro — já sinalizado na B.6)
- **Balão faltante:** B8 (seq 8) — vence 2030-12-01, R$ 276.586,70

### Contrato 55 — Sienge 145 — Unidade 1103 A
- **Cliente:** BIANCA LINHARES DA SILVA — CPF 09612071918 — Tel (47)996467414
- **Corretor:** Betina De Camargo Marcos — 47999227227
- **Balões faltantes:** B2 (2027-12-10) e B4 (2029-12-10) — R$ 5.000 cada

### Contrato 167 — Sienge 259 — Unidade 403 D
- **Cliente:** ADRIELE FERNANDA DE SÁ DANIEL — CPF 09692520994 — Tel (47)99787-4805
- **Corretor:** RODOLFO GABRIEL NEGOCIOS IMOBILIARIOS LTDA — 4796831011
- **Balões faltantes:** B4 (2028-12-10) e B5 (2029-12-10) — R$ 5.000 cada

### Contrato 244 — Sienge 341 — Unidade 503 B
- **Cliente:** CAROLINE PEREIRA GONSALVES — CPF 03333165090 — Tel (47)98812-4896
- **Corretor:** DENIS ALEXANDRE MOREIRA MAGNI PINTO — 4733114400
- **Balões faltantes:** B3 (2028-12-10) e B5 (2030-12-10) — R$ 5.000 cada

## Ação sugerida

Criar as 7 parcelas de balão no banco com `status='pendente'` e `data_prevista = dueDate do Sienge`, calculando `comissao_gerada` e snapshots pelos percentuais atuais do empreendimento.

Fica pra rodar **depois** das decisões das etapas B.5 e B.6, porque são casos pontuais e o mesmo fluxo de revisão humana vai cobrir. Sem urgência — o valor total é R$ 306.586,70 em parcelas que só vencem de 2027 a 2030.
