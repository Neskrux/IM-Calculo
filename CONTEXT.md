# CONTEXT — glossário do IM-Calculo

Vocabulário canônico do domínio. **Só glossário** — sem decisão de implementação, sem schema,
sem caminho de arquivo. Decisões vivem em `docs/adr/`; regras operacionais em `.claude/rules/`.

---

## Comissão

**Fator de comissão** — o número que converte pró-soluto em comissão:
`(valor da venda × percentual) / valor do pró-soluto`. Existe porque a comissão é calculada
sobre o valor da venda mas paga sobre o pró-soluto. Nunca se aplica percentual direto na parcela.

**Comissão total** — a fatia de todos os cargos somados numa parcela (7% externo / 6,5% interno).
**Fatia do cargo** — a parte de um cargo só, proporcional ao percentual dele. "Comissão do corretor"
significa a fatia do cargo Corretor, nunca a comissão total.

**Cargo** — papel que recebe uma fatia de cada venda: Corretor, Diretor, Coordenadora, e as
entidades Nohros, Beton e Ferretti.

**Beneficiário** — quem recebe fatia por cargo sem ser corretor de venda nenhuma.

**Corretor interno / externo** — atributo da **venda**, não da pessoa. O mesmo corretor pode ter
vendas dos dois tipos, e cada venda paga pela taxa do tipo dela.

---

## Contrato e seus términos

**Distrato** — o contrato é cancelado. O cliente sai.

**Aditivo (reparcelamento)** — o contrato continua vivo, a grade de parcelas é refeita.

**Cessão** — troca do cliente num contrato que continua vivo. O cedente sai, o cessionário assume.

**Reemissão** — contrato antigo é substituído por um novo, com id novo. Não é nenhum dos três acima.

**Baixa em massa** — quando um contrato é distratado ou aditado, o sistema de origem marca como
pagas parcelas que nunca viraram dinheiro. Somar essas baixas infla o recebido.

---

## Nota fiscal do corretor

**Nota fiscal** — o documento fiscal que o corretor emite contra a IM pela comissão. É o
comprovante que autoriza o repasse.

**Competência** — o mês a que uma nota se refere. **Uma nota pertence a exatamente uma
competência**; nenhuma nota cobre dois meses. É a invariante central do envio de notas.

**Emissor** — quem emite a nota. Ou o corretor como pessoa física (autônomo, identificado por CPF),
ou a imobiliária dele como pessoa jurídica (identificada por CNPJ, com o nome da imobiliária
declarado no envio). O emissor pode mudar de um mês para outro; a nota registra qual foi.

**Recebedor** — quem recebe o dinheiro do repasse, identificado pela chave PIX. **Não é
necessariamente o emissor.** É comum o corretor emitir a nota pelo CNPJ da imobiliária e receber na
chave do CNPJ próprio. Cobrar que a chave PIX case com o documento do emissor é regra falsa: foi
herdada do texto de ajuda do formulário antigo e corrigida pela controladoria em 31/08/2026.

**Obrigado** — quem deve uma nota numa competência. Todo corretor ativo, em todo mês.

**Enviou / Não enviou** — a nota da competência existe, ou não existe. É a régua do acompanhamento.
Não é um juízo sobre o valor da nota.

**Observação da nota** — texto livre que acompanha uma nota específica, escrito por quem enviou.
Pertence àquela nota, nunca ao corretor nem ao mês.
