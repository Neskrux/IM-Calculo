# Spec — IM Cálculo prova o que emitiu (registro de relatórios + histórico de parcela)

**Status:** aprovada pelo Jonas (2026-11-09). Implementada na branch `claude/registro-relatorios-652f27`. Migration 043 provada em homologação (begin/rollback, 15/15) — **não aplicada em produção**.
**Card no Planner:** "IM Cálculo: relatório de comissões com valores diferentes no mesmo corretor".

## Problema
Dois relatórios "iguais" deram valores diferentes, e um corretor contestou o valor sem que
desse para provar quem estava certo. Hoje: não há bucket de relatórios, não há tabela de
auditoria, e `pagamentos_prosoluto` guarda só o estado atual.

Meta: **toda reclamação se resolve abrindo o registro da emissão + o histórico da parcela.**

## 1. Registro de emissão — migration 043

Tabela `relatorios_emitidos` (append-only):

| coluna | conteúdo |
|---|---|
| `id` uuid, `emitido_em` timestamptz default now() | quando |
| `emitido_por` uuid = `auth.uid()` (default, não vem do cliente) | quem |
| `origem` text check in (`admin`,`corretor`,`admin_ver_pdf_corretor`) | qual tela |
| `corretor_id` uuid null | de quem é o relatório (chave da RLS) |
| `filtros` jsonb | `relatorioFiltros` inteiro: corretor, venda, empreendimento, cargo, coordenadora, papel, status, período, `incluirDistratos` |
| `total`, `pago`, `pendente` numeric | os totais **impressos** no PDF |
| `parcelas` jsonb | `[{id, valor, comissao, status}]` — a comissão já na fatia do cargo filtrado |
| `qtd_parcelas` int, `pdf_path` text, `pdf_sha256` text | prova do arquivo |
| `versao_app` text | hash do build (`import.meta.env`) |

- Sem UPDATE/DELETE: trigger bloqueia (é registro de prova).
- **Bucket privado `relatorios`**, caminho `{corretor_id ou 'geral'}/{id}.pdf`. Leitura só por signed URL.
- **RLS (tabela e `storage.objects` do bucket):** admin vê tudo; corretor só `corretor_id = auth.uid()`;
  INSERT só com `emitido_por = auth.uid()`. ⚠️ As policies `Permitir tudo` antigas em `storage.objects`
  (roles=public, regra `true`) anulam qualquer policy escopada — a 043 **exclui o bucket `relatorios`**
  delas, como a 042 fez com `notas-fiscais`. Sem isso o requisito "corretor só vê os dele" é falso.
- Coleção dos dados: refatorar o cálculo de `gerarRelatorioPDF` e `relatorioCorretorPDF` para devolver
  `{doc, totais, parcelas}` — o registro grava **os mesmos números que foram impressos**, não um recálculo.
- Fluxo: gerar PDF → upload → insert → `doc.save`. Se o registro falhar, o download **não acontece** e a
  tela mostra o erro (relatório sem prova é o problema que estamos resolvendo). Preview ("Ver PDF" da aba
  de ajuste visual) **não** registra — não sai da tela.
- **UI admin:** aba/lista "Relatórios emitidos" (quem, quando, corretor, cargo, empreendimento, período,
  total/pago/pendente), filtro por corretor, botão "Abrir PDF" (signed URL) e "Ver parcelas".

## 2. Histórico de parcela — mesma migration 043

Tabela `pagamentos_prosoluto_historico` + trigger `AFTER UPDATE OR DELETE` em `pagamentos_prosoluto`,
gravando **só quando muda** algum de: `status`, `valor`, `comissao_gerada`, `data_pagamento`.

Colunas: `pagamento_id`, `venda_id`, `operacao`, `antes` jsonb, `depois` jsonb (só os 4 campos),
`mudado_em`, `mudado_por` (`auth.uid()`, null se service_role), `origem` (`usuario` se há `auth.uid()`;
`sync` se service_role/edge/cron; opcional `set_config('app.origem','reconciliador',true)` para os scripts).

- Trigger `SECURITY DEFINER`, não bloqueia nada, não altera a linha. Convive com 017/018/020/026.
- INSERT não é logado (a linha nasce com o estado inicial; volume do sync).
- Volume: o sync só emite UPDATE quando muda (medido: 4 atualizados/run) → crescimento pequeno.
- RLS: admin lê tudo; corretor lê o histórico das parcelas das vendas dele.
- **Sem backfill:** o histórico começa no deploy. O que passou antes não dá para reconstituir.
- UI: botão "Histórico" na parcela (Admin) — lista antes → depois, quem, quando.

## 3. Filtros à vista antes de gerar

Na aba Relatórios do Admin, acima do botão "Gerar PDF": faixa com **Cargo** e **Empreendimento**
destacados (e corretor/período/status/distratos em linha menor) + botão **"Limpar filtros"** que volta ao
estado inicial (`cargoId='Corretor'`, resto vazio). Os mesmos filtros vão impressos no cabeçalho do PDF —
o arquivo diz sozinho como foi tirado. Causa provável do caso real: cargo "Total" × "Corretor".

## Como provar antes de produção
1. Migration rodada em homologação `ibscxvkgrdyzlgtgbbuz` dentro de `begin … rollback`, com testes:
   insert como corretor A vê o dele / não vê o do B; UPDATE de status gera 1 linha de histórico;
   UPDATE sem mudança nos 4 campos não gera; UPDATE/DELETE em `relatorios_emitidos` falha.
2. Helpers puros (montar o registro a partir do resultado do PDF) com teste unitário; suíte inteira verde.
3. Produção: **nunca `apply_migration`**. Você aplica pelo SQL Editor depois do PR aprovado.

## Fora do escopo
Assinatura digital do PDF; reconstituir relatórios já emitidos; log de INSERT de parcela.

## Decisões tomadas (padrão da spec, sem resposta contrária)
1. Registro falhou → **o download é bloqueado** e a tela mostra o erro.
2. A lista "Relatórios emitidos" fica **só no Admin** nesta versão (a RLS já deixa o corretor ler os dele, se um dia quiser mostrar).
3. O histórico da parcela é aberto **a partir do relatório emitido** (Parcelas → Histórico), que é o fluxo da contestação.
