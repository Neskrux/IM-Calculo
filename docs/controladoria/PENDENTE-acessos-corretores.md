# Fila de acessos de corretor — parada aguardando pagamento do Resend

**Situação em 31/07/2026:** conta do Resend sem pagamento — nenhum email sai. Tudo abaixo
está pronto pra rodar no dia em que o pagamento for confirmado. Fonte: lista da
controladoria (Thaisy) + banco de produção (`Calculo IM`) + export de enviados do Resend.

## Roteiro do dia D (nesta ordem)

1. **Confirmar que o Resend voltou** — mande um teste pra você mesmo antes de disparar em lote.
2. **Tirar `augusto@mayimoveis.com.br` da lista de supressão** (painel Resend → Suppressions).
   Sem isso, os envios pra ele continuam sendo descartados sem sair.
3. **Rodar** [scripts/acessos/01-corrigir-emails.sql](../../scripts/acessos/01-corrigir-emails.sql) —
   corrige Eder e Eduardo. **Antes** de qualquer disparo pros dois.
4. **Criar o acesso** de Eder e Eduardo pela tela de cadastro de corretores (eles ainda não
   têm conta em `auth.users`), já com o email corrigido.
5. **Disparar a redefinição** pros 15 da fila abaixo.
6. Marcar aqui quem logou depois de ~3 dias e cobrar o resto.

## Fila de reenvio — 15 pessoas

Critério: tem conta, mas `last_sign_in_at` vazio (nunca entrou).

| # | Nome | Email | Observação |
|---|---|---|---|
| 1 | Augusto Cesar | augusto@mayimoveis.com.br | **bounce + supressão** — passo 2 antes |
| 2 | Adriana Emílio | adrianaemilioempreendimentos@gmail.com | |
| 3 | Alysson de Borba | alyssondeborbacorretor@gmail.com | |
| 4 | Betina Camargo | contato@betinacamargocorretora.com.br | |
| 5 | Bruno Diogo | bruno.diogo.p@hotmail.com | |
| 6 | Denis Magni | denismagni@gmail.com | |
| 7 | Francisco Neckel | francisconeckel@gmail.com | |
| 8 | Jorgeana Benites | jorgeananeves@icloud.com | |
| 9 | Josemeiri Dal Aqua | ativaconitajai@gmail.com | |
| 10 | Lauricio Festa | lauriciofesta@yahoo.com.br | na lista veio com espaço no meio; este é o certo |
| 11 | Mateus Gabriel | imoveisterraemar@gmail.com | |
| 12 | Paulo S. Chaves Jr | paulochaves1977@gmail.com | |
| 13 | Rodolfo Gabriel | rodolfo7gabriel@gmail.com | |
| 14 | Eder Slaviero | ederslavierocorretor@gmail.com | **só depois** do passo 3 e 4 |
| 15 | Eduardo Rolão Moro | eduardomoro623@gmail.com | **só depois** do passo 3 e 4 |

## Já resolvidos — não disparar (8)

Já logaram pelo menos uma vez: Carlos Bruno (09/07), Enzo Tormes (27/07), Erica Faerber (08/05),
Jeziel Oliveira (09/07), Luiz Carlos Corazza (13/07), Matheus Pires (28/01), Paulo Rigoni (08/06),
Rodrigo Viapiana (09/07).

## Achados que ficam pendentes (fora desta fila)

- **`tem_acesso_sistema` não é trava de acesso.** Carlos Bruno está com a flag `false` e
  mesmo assim logou normal em 09/07. Ou a flag é decorativa, ou o gate não a consulta.
  Investigar antes de confiar nela pra bloquear alguém.
- **Bounce do `mayimoveis.com.br`** — descobrir se foi caixa cheia, filtro do domínio ou
  endereço morto. Se o domínio recusar de novo, pedir um email pessoal ao Augusto.
- **Não estão na lista da controladoria e seguem sem acesso:** Carolina Rita (a coordenadora
  Carol, com email placeholder `corretor.129@sync.local`) e Jessica Cararo. Se elas forem
  receber o relatório de coordenadora pela tela, precisam de email real e acesso.
