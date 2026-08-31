# Spec: Nota fiscal do corretor — envio e acompanhamento

> **Fonte:** [docs/features/2026-08-31-nota-fiscal-corretor.md](../features/2026-08-31-nota-fiscal-corretor.md)
> (grelha + fatos medidos). Vocabulário: [CONTEXT.md](../../CONTEXT.md).
> Decisões duras: [ADR 0001](../adr/0001-uma-nota-por-competencia.md) · [ADR 0002](../adr/0002-bucket-privado-para-notas-fiscais.md).

## Problem Statement

A IM paga comissão a corretores sem ter, num só lugar, a resposta para "quem me mandou nota fiscal
este mês e quem não mandou". A coleta hoje é um JotForm fora do sistema: as notas chegam soltas, sem
vínculo com o corretor cadastrado, sem indicação de a que mês se referem, e sem nenhuma contraparte
que mostre quem faltou. O resultado documentado foi R$ 261.434,51 pagos a três imobiliárias sem uma
única nota emitida, e sete meses seguidos sem nota alguma no acervo — sem que ninguém percebesse
enquanto acontecia, porque não existia a lista.

Para a controladoria, a dor é ficar sabendo tarde. Para o corretor, é não ter onde entregar dentro do
sistema em que ele já vive, e ter que redigitar dados que a IM já tem sobre ele.

## Solution

O corretor entra no sistema, abre "Nota Fiscal", vê os meses dele numa lista e envia a nota do mês
corrente: o formulário já vem preenchido com o que a IM sabe (CPF/CNPJ, telefone, imobiliária), ele
completa o que falta, anexa o PDF e escreve uma observação se quiser. Uma nota por mês, e o mês é
explícito.

A controladoria abre a mesma feature com perfil de admin e vê o produto real: **a lista dos 72
corretores ativos na competência escolhida, separada entre quem enviou e quem não enviou**, com o
valor declarado ao lado da comissão do mês para conferência a olho. Ela também pode enviar a nota em
nome de qualquer corretor — é como ela testa, e é como resolve o corretor que não consegue.

Corrigir uma nota não é self-service: um botão leva ao WhatsApp da controladoria.

## User Stories

1. Como corretor, quero ver de cara se já mandei a nota deste mês, para não mandar duas vezes nem
   esquecer.
2. Como corretor, quero enviar a nota fiscal do mês pelo sistema em que já acompanho minhas
   comissões, para não depender de um link externo.
3. Como corretor, quero que o formulário já venha com meu CPF/CNPJ e telefone preenchidos, para não
   redigitar o que a IM já tem sobre mim.
4. Como corretor, quero declarar se estou emitindo como autônomo ou pela minha imobiliária, para que
   a nota saia com a identificação certa.
5. Como corretor de imobiliária, quero escrever o nome da imobiliária na hora, para não depender de
   um cadastro prévio que ninguém fez.
6. Como corretor, quero informar minha chave PIX no envio, para que o repasse caia na conta certa.
7. Como corretor, quero informar o valor da nota que emiti, para que a controladoria confira contra o
   que me deve.
8. Como corretor, quero anexar o PDF da nota, porque é ele o comprovante.
9. Como corretor, quero escrever uma observação embaixo da nota que estou enviando, para explicar
   algo específico daquela nota.
10. Como corretor, quero ver o histórico das notas que já mandei, mês a mês, para saber onde estou.
11. Como corretor, quero baixar de volta uma nota que enviei, para reconferir o que mandei.
12. Como corretor, quero ser impedido de enviar duas notas para o mesmo mês, para não bagunçar a
    conferência.
13. Como corretor, quero um caminho claro quando errei uma nota já enviada, para não ficar travado.
14. Como corretor, não quero digitar meu endereço, porque a IM já o tem no contrato.
15. Como corretor, não quero anexar o contrato da venda, porque a IM já o tem.
16. Como controladoria, quero ver a lista de quem não enviou nota na competência, porque essa lista é
    o controle.
17. Como controladoria, quero ver na mesma tela quem já enviou, para fechar a conta dos 72.
18. Como controladoria, quero escolher a competência que estou olhando, para revisar um mês fechado.
19. Como controladoria, quero ver o valor declarado na nota ao lado da comissão que o corretor tem no
    mês, para achar discrepância grosseira a olho.
20. Como controladoria, quero abrir o PDF da nota de qualquer corretor, para conferir o documento.
21. Como controladoria, quero saber se o emissor foi PF ou PJ e qual imobiliária foi declarada, para
    mapear as imobiliárias depois.
22. Como controladoria, quero enviar uma nota em nome de um corretor, para destravar quem não
    consegue e para testar a feature sem depender de terceiros.
23. Como controladoria, quero que fique registrado que fui eu quem enviou pelo corretor, para a
    trilha não mentir.
24. Como controladoria, quero exportar a lista da competência, para levar para fora do sistema.
25. Como controladoria, quero ver o total de notas recebidas e o total declarado na competência, para
    ter o número de capa.
26. Como IM, quero que a nota de um corretor não seja legível por outro corretor, porque a nota
    carrega CNPJ, valor e tomador.
27. Como IM, quero que a regra "uma nota por mês" viva no banco, para que ela valha por qualquer
    caminho de escrita, não só pelo formulário.
28. Como IM, quero que os dados que o corretor digitar por falta voltem para o cadastro dele, para
    que no mês seguinte já estejam preenchidos.
29. Como corretor no celular, quero enviar a nota do celular, porque é de onde eu uso o sistema.
30. Como controladoria, quero que a lista mostre corretor sem nenhuma venda também, porque a
    obrigação é de todos.

## Implementation Decisions

**Vocabulário.** Os termos `nota fiscal`, `competência`, `emissor`, `obrigado` e
`observação da nota` são os definidos em `CONTEXT.md` e devem aparecer com esse sentido em nomes de
tabela, coluna, função e rótulo de tela.

**Um módulo de domínio puro é o coração.** Todas as regras — validação de competência, escolha entre
CPF e CNPJ conforme o emissor, obrigatoriedade condicional do nome da imobiliária, validação do
arquivo, e a derivação de "quem enviou / quem não enviou" a partir da lista de corretores ativos e da
lista de notas — vivem num único módulo sem dependência de Supabase, React ou rede. É o mesmo formato
de `comissaoCalculator`: funções puras que os dashboards consomem.

**Modelo de dados.** Uma tabela nova de notas fiscais de corretor, com: o dono (referência a
`usuarios`), a competência, o tipo de emissor (`autonomo` / `imobiliaria`), o documento do emissor
(CPF ou CNPJ conforme o tipo), o nome da imobiliária declarado, telefone, chave PIX, valor declarado,
o caminho do arquivo no bucket, a observação, quem de fato criou o registro (o próprio corretor ou um
admin agindo por ele) e o carimbo de tempo.

- **Competência é um mês, não uma data.** Guardada como o primeiro dia do mês, com restrição que
  garante isso — assim `2026-08` é sempre `2026-08-01` e comparação de mês vira comparação de igualdade.
- **A invariante é um índice único** sobre (dono, competência). É ela, e não a tela, que garante
  "uma nota nunca cobre mais de um mês" por qualquer caminho de escrita.
- **RLS ligada na tabela desde o nascimento**, no molde de `solicitacoes` (a única tabela do projeto
  que já tem RLS): o corretor lê e insere apenas as próprias linhas; admin lê e insere todas.
- O denominador **não** sai de `pagamentos_prosoluto`. Sai de `usuarios` com `tipo = 'corretor'` e
  `ativo = true`. Nenhuma régua de distrato, baixa em massa ou parcela fantasma toca este número.

**Armazenamento.** Bucket próprio, privado, com policies de dono no molde da migration 024 (a pasta
raiz dentro do bucket é o id do usuário). Caminho por corretor e por competência, criado sob demanda —
não existe passo de "criar pasta". Leitura por URL assinada de vida curta; nunca URL pública. Admin lê
qualquer pasta. Ver ADR 0002 para por que este bucket diverge dos demais.

**Prefill e devolução ao cadastro.** O formulário lê os campos que já existem em `usuarios` e
pré-preenche. No envio, os campos que o corretor preencheu e que estavam vazios no cadastro são
gravados de volta em `usuarios`, no mesmo fluxo. Campos já preenchidos no cadastro não são
sobrescritos silenciosamente pelo formulário.

**Identidade vem da sessão.** Nome, e-mail e CRECI não são perguntados. Quando um admin envia por um
corretor, o dono da nota é o corretor e o criador é o admin — dois campos distintos, nunca um só.

**Correção não é self-service.** O botão monta um link de WhatsApp para +55 41 9166-7004 com uma
mensagem pré-preenchida identificando corretor e competência. A tela também exibe o número em texto,
para o caso de o link não abrir.

**Superfícies.** Uma aba nova no dashboard do corretor (envio e histórico próprio) e uma aba nova no
dashboard do admin (a lista da competência, que é o produto). Ambas seguem as regras de leitura
paginada e de modal mobile já documentadas em `.claude/rules/`.

## Testing Decisions

**O que é um bom teste aqui:** testa comportamento observável do domínio — dada uma lista de
corretores ativos e uma lista de notas, quem aparece como "não enviou"; dado um formulário com
emissor `imobiliaria` e nome vazio, a submissão é rejeitada — e nunca a forma interna (nome de
variável, ordem de chamada, estrutura do objeto de estado).

**A seam é uma só.** O módulo de domínio puro descrito acima. Ele é chamado tanto pela tela do
corretor quanto pela do admin, então cobri-lo cobre as duas. Preferimos essa seam a testar os
dashboards: `AdminDashboard` tem quase 14 mil linhas e testá-lo por fora exigiria montar Supabase.

**Prior art no repo:** `src/utils/comissaoCalculator.js` é exatamente esse formato de módulo puro
consumido pelos dashboards; `src/components/InputDataBR.test.jsx` e
`src/components/corretor/ParcelaCard.test.jsx` mostram o padrão de teste de componente com Vitest +
Testing Library, para quando um componente pequeno e isolado merecer teste próprio. Playwright existe
em `e2e/` e cobre layout, não regra de negócio.

**O que fica coberto por teste automatizado:** validação do formulário em todas as combinações de
emissor; normalização e validação de competência; a derivação da lista enviou/não-enviou, incluindo o
corretor sem venda alguma e o corretor inativo (que não deve aparecer); o cálculo do resumo da
competência; a montagem do link de WhatsApp.

**O que não fica, e como se verifica:** o índice único e as policies de RLS e de bucket não são
testáveis por unidade — verificam-se por consulta SQL após a aplicação da migração, com controle
positivo e negativo (tentar inserir a segunda nota do mesmo mês e exigir erro; ler a pasta de outro
corretor e exigir negativa).

## Out of Scope

Aprovação ou rejeição de nota (o v1 tem estado único: recebida) · conciliação automática entre valor
declarado e comissão devida · backfill das competências de 2025 · cobrança automática por e-mail ou
WhatsApp · emissão de nota pelo sistema · notas de beneficiário (Nohros, Beton, Ferretti) e de
coordenadora · fechar os buckets públicos preexistentes (`documentos`, `contratos`) · ligar RLS nas
tabelas antigas.

## Further Notes

**Correção de premissa registrada:** o `supabase-schema.sql` do repositório declara uma FK de
`vendas.corretor_id` para `usuarios`. Ela **não existe em produção** (medido em 2026-08-31). Como esta
feature vincula tudo por `usuarios.id`, isso não a afeta — mas qualquer código que confie naquele
arquivo como retrato do banco está confiando em documento vencido.

**Dívida vizinha, medida durante esta feature:** os buckets `documentos`, `contratos`,
`empreendimentos-fotos` e `usuarios-fotos` estão públicos. O CRECI que cada corretor enviou e os
contratos assinados são legíveis por quem tiver a URL. Fora do escopo aqui, mas registrado para virar
trabalho próprio.

**Prazo do baseline:** o JotForm declara dia 9 de cada mês como limite. O v1 não implementa prazo nem
bloqueio por data — a lista mostra o estado, e a cobrança é humana.
