# Doc: Nota fiscal do corretor — envio e acompanhamento de quem mandou

> **Origem:** grelha com o Jonas em 2026-08-31. Baseline: o JotForm
> `form.jotform.com/251416366216050` ("Formulário de Pagamento da Nota Fiscal"), hoje o único canal
> de coleta. Este doc alimenta a spec; a spec alimenta os tickets.

---

## 1. Por que isso existe

O produto não é o upload. **O produto é o relatório de quem não mandou.**

Uma investigação paralela documentou **R$ 261.434,51 pagos em 8 transferências a três imobiliárias
sem uma única nota fiscal emitida**, e um intervalo inteiro — 01/07/2025 a 31/01/2026 — sem nenhuma
nota no acervo. O dado que decide o desenho: **quando a nota passou a ser exigida, o valor pago caiu
97% nos dois maiores casos.** A exigência é o controle; o formulário é só o meio de exercê-la.

Por isso a régua do sistema é **presença**, não valor: a pergunta que a tela responde é "quem não
mandou nota este mês", não "a nota está certa". Conferir valor segue sendo trabalho humano da
controladoria — mas agora com a lista na frente.

---

## 2. O caso de teste do JotForm (medido, não deduzido)

Inspeção do formulário publicado em 2026-08-31 (leitura do DOM; **nada foi submetido**):

| # | Campo | Tipo | Obrigatório | Nota |
|---|---|---|---|---|
| 1 | Nome completo Corretor | text | Sim | |
| 2 | Venda feita através | radio | Sim | "Sou corretor de uma imobiliária" / "Sou corretor autônomo" |
| 3 | Informe o nome da Imobiliária | text | Sim | **condicional** — só aparece na opção "de uma imobiliária" |
| 4 | CPF ou CNPJ | text | Sim | |
| 5 | Telefone | tel | Sim | |
| 6 | E-mail | email | Sim | |
| 7 | Informe o valor da NF | number | Sim | |
| 8 | Pix para o pagamento | text | Sim | "deverá bater com CPF ou CNPJ cadastrado" |
| 9 | Endereço | text x5 | Sim | rua, complemento, cidade, estado, CEP |
| 10 | Anexe aqui o contrato da venda | file | Sim | |
| 11 | Anexe aqui a nota fiscal | file | Sim | |
| 12 | Observações adicionais | textarea | Não | |

Prazo declarado no formulário: **dia 9 de cada mês**.

**Dois achados que mudam o desenho:**

1. **O JotForm nunca pergunta a que mês a nota se refere.** A invariante "uma nota não cobre mais de
   um mês" é, no baseline, incontrolável — o campo não existe. É a lacuna mais importante que o
   sistema fecha.
2. O campo 3 já é o comportamento pedido na grelha: **a imobiliária é declarada na hora, em texto
   livre, e só quando aplicável.** Não é cadastro; é dado bruto que a controladoria mapeia depois.

---

## 3. Fatos medidos em produção (controle positivo e negativo)

Consultas de leitura no projeto `jdkkusrxullttyeakwib`, 2026-08-31:

| Pergunta | Resposta | Por que a leitura vale |
|---|---|---|
| O bucket `documentos` é público? | **Sim** (`public = true`). `contratos`, `empreendimentos-fotos` e `usuarios-fotos` também. | Controle negativo: `boletos` retorna `public = false` na mesma consulta — a coluna sabe dizer "não". |
| Existe FK `vendas.corretor_id` para `usuarios`? | **Não existe.** | Controle positivo: a consulta enxerga FKs de `vendas` para `usuarios` (`vendas_excluido_por_fkey`); `corretor_id` não está lá. O `supabase-schema.sql` do repo diz que existe — **o arquivo está desatualizado**. |
| RLS está ligado? | `usuarios`, `vendas`, `pagamentos_prosoluto`, `venda_documentos`, `boletos`: **off**. | Controle positivo: `solicitacoes` retorna `true`. |
| Quantos corretores ativos? | **72** (mais 1 inativo). | |
| Que dados já temos internamente? | CPF 36/72 · CNPJ 41/72 · CRECI 36/72 · telefone 53/72 · **PIX 0/72**. `usuarios` já tem `cpf`, `cnpj`, `creci`, `imobiliaria`, `nome_fantasia`, `telefone`, `celular`, `email`, `chave_pix`, `endereco_completo`. | |

Consequência direta do último: **a maior parte dos campos do JotForm já está no banco.** O corretor
não deve redigitar o que já sabemos — e o que ele digitar por falta deve voltar gravado no cadastro,
para que no mês seguinte já esteja lá. PIX é o único campo que ninguém tem hoje: será sempre digitado
no primeiro envio.

---

## 4. Decisões da grelha

| # | Decisão |
|---|---|
| **D1** | **O obrigado é o corretor** (`usuarios.id`), não a imobiliária. Nenhuma entidade nova. |
| **D2** | **O emissor pode ser PF ou PJ**, escolhido a cada envio. Corretor de imobiliária declara o nome dela em **texto livre, na hora**. Isso não vira cadastro: vira dado bruto para a controladoria mapear no mês seguinte. |
| **D3** | **O denominador é "todos os corretores ativos", todo mês.** Não se deriva de comissão paga. A feature não valida nada — ela cobra. *(Efeito colateral bom: distrato, baixa em massa e as 164 pendentes-fantasma não tocam este número, porque ele não vem de `pagamentos_prosoluto`.)* |
| **D4** | **Competência é o mês corrente.** Nota enviada em agosto é da competência agosto. O relatório de agosto mostra as notas de agosto. Sem defasagem M+1. |
| **D5** | **Uma nota por corretor por competência.** Travado por índice único no banco, não só na tela. Ver [ADR 0001](../adr/0001-uma-nota-por-competencia.md). |
| **D6** | **Várias notas por corretor ao longo do tempo** — uma por mês. O corretor vê o próprio histórico. |
| **D7** | **Observação individual por nota**, embaixo de cada uma. Pertence à nota, não ao corretor nem ao mês. |
| **D8** | **Alteração não é self-service.** Botão que abre o WhatsApp da controladoria (**+55 41 9166-7004**). Se o link direto não funcionar no dispositivo, a tela orienta a falar com o time interno da IM. |
| **D9** | **Sem endereço.** Vem do contrato; não se pede de novo. |
| **D10** | **Prefill do que já temos em `usuarios`;** o que faltar o corretor preenche, e o preenchido **volta gravado no cadastro**. Identidade (quem enviou, CRECI) vem da sessão — não se pergunta quem ele é. |
| **D11** | **O admin envia nota por qualquer corretor.** É assim que a controladoria testa, e é útil depois: ela já tem acesso a tudo. |
| **D12** | **Sem fluxo de aprovação no v1.** Estado único: recebida. Não há tempo de testar aprovação neste mês. |
| **D13** | **Daqui para frente.** Começa na competência de agosto/2026. Sem backfill do vão de 2025. |
| **D14** | **Bucket privado.** Ver [ADR 0002](../adr/0002-bucket-privado-para-notas-fiscais.md) — o caminho rápido e o seguro são o mesmo caminho. |

---

## 5. O que muda em relação ao JotForm

| Campo do JotForm | Destino |
|---|---|
| Nome completo | **Sai do formulário** — vem da sessão. |
| Venda feita através (PF/PJ) | **Fica.** Define se pede CPF ou CNPJ. |
| Nome da imobiliária | **Fica**, condicional, texto livre (D2). |
| CPF ou CNPJ | **Fica**, pré-preenchido quando já temos (D10). |
| Telefone | **Fica**, pré-preenchido (53/72 já temos). |
| E-mail | **Sai** — vem da sessão. |
| Valor da NF | **Fica.** Declarado; exibido ao lado da comissão do mês, sem bloquear. |
| PIX | **Fica.** Ninguém tem no cadastro hoje; o primeiro envio popula. |
| Endereço | **Removido** (D9). |
| Contrato da venda | **Removido** — o sistema já tem os contratos. |
| **Competência** | **Novo e obrigatório.** É a invariante (D4, D5). |
| Nota fiscal (arquivo) | **Fica.** Obrigatório. |
| Observações | **Fica**, por nota (D7). |

---

## 6. Riscos assumidos com os olhos abertos

- **Valor da nota não é conferido pelo sistema.** Uma nota de R$ 100 para uma comissão de R$ 40.000
  entra como "enviada". Mitigação de v1: mostrar lado a lado o valor declarado e a comissão do mês,
  para o olho humano. Bloquear por valor geraria falso vermelho e não cabe neste mês.
- **O denominador ignora quem não teve comissão no mês.** É intencional (D3): todos devem, todo mês.
  Um corretor sem venda alguma aparece em vermelho. Se isso incomodar, o ajuste é de régua de
  exibição, não de modelo.
- **Sem aprovação, "recebida" é só "existe um arquivo".** Um PDF em branco conta como enviado.
  Aceito para o v1 (D12).
- **RLS segue desligado nas tabelas centrais.** O bucket privado protege o arquivo e a tabela nova
  nasce com RLS própria; o resto do sistema não muda aqui.

---

## 7. Fora de escopo

Aprovação/rejeição de nota · conciliação automática valor da nota x comissão · backfill do vão de
2025 · cobrança automática (e-mail/WhatsApp de lembrete) · emissão de nota pelo sistema · nota de
beneficiário (Nohros/Beton/Ferretti) e de coordenadora · fechar o bucket `documentos` público.
