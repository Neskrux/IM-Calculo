# SPEC: Preservação de `pagamentos_prosoluto` auditados (baixas)

**Tipo:** especificação de produto + comportamento do sistema (spec-driven development)  
**Público:** engenharia, controladoria, operações  
**Problema tratado:** histórias H1–H8 — edição de venda que hoje recria toda a grade de pagamentos e **apaga** linhas já **`pago`**, invalidando auditoria.

**Escopo explícito:** fluxo de **edição de venda / pagamentos no app** e **regras no PostgreSQL**. **Sincronização Sienge** fica **fora do escopo** desta versão da spec.

---

## 1. Contexto

### 1.1 Comportamento atual (não desejado)

Ao **salvar** uma venda em **edição**, o fluxo executa exclusão de **todos** os registros de `pagamentos_prosoluto` vinculados à venda e em seguida insere uma grade nova, em geral com parcelas **`pendente`**. Isso ocorre **independentemente** de haver parcelas já baixadas (`status = 'pago'`) com `data_pagamento` e demais dados de auditoria.

**Referência de código:** `handleSaveVenda` em `src/pages/AdminDashboard.jsx` — ramo “edição detectada: deletando e recriando pagamentos”.

### 1.2 Histórias mapeadas (origem do requisito)

| ID | Resumo | Gatilho | Dano hoje |
|----|--------|---------|-----------|
| H1 | Correção pequena (descrição, bloco, contrato) após baixas | Salvar edição | Grade inteira recriada; `pago` perdido |
| H2 | Preencher `data_entrada` em legado já baixado | Salvar edição | Idem |
| H3 | Mudar `periodicidade_parcelas` / `periodicidade_balao` | Salvar edição | Idem |
| H4 | Override de datas com grade já baixada | Salvar edição | Idem |
| H5 | Mudar `parcelou_entrada` ou valores entrada/sinal | Salvar edição | Idem |
| H6 | Salvar “sem querer” / hábito | Salvar edição | Idem |
| H7 | Mix pago + pendente; expectativa controladoria | Salvar edição | Contradiz “baixado = intocável” |
| H8 | Pós-migration: `data_entrada` em massa | Salvar por venda | Risco destrutivo em lote |

**Nota:** o fluxo de **renegociação** já restringe a seleção a parcelas **não pagas** na UI; esta spec trata do **Salvar** do modal de **edição de venda**, que não possui a mesma salvaguarda.

---

## 2. Decisões consolidadas (A–G)

Estas decisões fecham o desenho alinhado ao DDL real de `pagamentos_prosoluto` / `vendas`, às **migrations da branch Ketlyn** (`012`–`016` e relacionadas) e ao uso pela controladoria.

### A — Alcance do schema alvo

A spec aplica-se ao modelo que combina:

- O que **já existe** nas tabelas `vendas` e `pagamentos_prosoluto` em produção (colunas como no DDL vigente); **e**
- O que a **branch Ketlyn** adiciona via migrations, em particular: `data_entrada`, `periodicidade_parcelas`, `periodicidade_balao`, `excluido`, `data_distrato`, extensão de `status` da venda (`distrato`), tabela `renegociacoes`.

**Requisito:** em cada ambiente, as migrations Ketlyn necessárias devem estar **aplicadas** antes de se esperar o comportamento completo de datas/periodicidade descrito aqui.

### B — Colunas imutáveis em linha com `status = 'pago'` (fluxo normal)

Nas linhas **`pagamentos_prosoluto`** com **`status = 'pago'`**, as seguintes colunas **não** podem ser alteradas pelo fluxo normal de “Salvar venda” / propagação automática:

| Coluna | Motivo |
|--------|--------|
| `tipo` | Classificação da parcela vinculada à auditoria |
| `status` | Deve permanecer `pago` |
| `comissao_gerada` | Valor de comissão reconhecido na linha |
| `fator_comissao_aplicado` | Snapshot do fator usado |
| `percentual_comissao_total` | Snapshot percentual |
| `created_at` | Carimbo de criação do registro |

**Recomendação forte de produto:** tratar também **`data_pagamento`** e **`valor`** como **imutáveis** após baixa, por serem núcleo da prova de pagamento. Só um **fluxo excepcional** (fora desta spec) poderia permitir correção, com trilha própria.

**Colunas candidatas a atualização** quando a venda muda (ex.: Ketlyn — base de datas, periodicidade, overrides), **sem** violar o bloco acima:

- Principalmente **`data_prevista`** (alinhamento de cronograma para uso da controladoria).
- **`numero_parcela`** apenas se o negócio aceitar renumeração sem quebrar relatórios externos.

### C — Garantia no PostgreSQL

Implementar mecanismo no banco (trigger e/ou política) que:

1. **Impeça `DELETE`** em `pagamentos_prosoluto` onde **`status = 'pago'`**.
2. **Impeça `UPDATE`** que altere **`status`** de **`pago`** para **`pendente`** (e qualquer transição que desfaça baixa no fluxo padrão).

*Detalhes de RLS por papel podem complementar; o mínimo acordado é a proteção acima nas linhas baixadas.*

### D — `DELETE` não é obrigatório

**Não** é necessário apagar **todas** as linhas da venda para aplicar mudanças.

- Linhas **`pago`:** manter o mesmo **`id`**; aplicar apenas **`UPDATE`** nas colunas permitidas (§B).
- Linhas **`pendente`:** podem ser removidas e recriadas, ou atualizadas por diff — desde que as linhas **`pago`** nunca entrem em `DELETE` em massa por `venda_id`.
- Alteração **somente cadastral** na `vendas` (§4.1): apenas `UPDATE` em `vendas`, sem tocar em `pagamentos_prosoluto`.

### E — Propagação `vendas` → `pagamentos_prosoluto`

Quando a edição da venda implica **novo cronograma teórico** (ex.: `data_entrada`, periodicidades, overrides refletidos no app):

1. **Recalcular** a grade “desejada” (mesma lógica mental do motor atual, sem apagar `pago`).
2. Para cada linha existente com **`status = 'pago'`:** aplicar **`UPDATE`** somente nos campos **não listados como imutáveis** em §B (tipicamente **`data_prevista`**).
3. Para linhas **`pendente`:** permitir substituição controlada (delete + insert ou equivalente) **somente** dessas linhas.
4. **Nunca** executar `DELETE` em linhas **`pago`**.

### F — Cabeçalho `vendas` vs soma das parcelas (relatórios)

Existem **duas** fontes relacionadas ao total de comissão da venda:

- **Cabeçalho:** `vendas.comissao_total`, `comissao_corretor`, etc.
- **Linhas:** soma de `pagamentos_prosoluto.comissao_gerada` (e uso em telas/relatórios).

**Atualizar só `data_prevista`** em parcelas (inclusive `pago`) **não altera** `comissao_gerada` nem `valor` → em geral **não** gera divergência entre relatório que usa cabeçalho e o que soma parcelas.

**Divergência aparece quando** algum fluxo muda **comissão** nas linhas (renegociação, recriação de pendentes, bugs) **e** não atualiza os campos `comissao_*` na **`vendas`**, ou o contrário. **Regra de implementação:** sempre que a **soma** das `comissao_gerada` **mudar**, recalcular e persistir os totais na **`vendas`** de forma consistente com o código existente (ex.: após renegociação).

### G — Mudança estrutural incompatível

Quando a alteração na venda **não puder** ser aplicada **sem** violar §B ou **sem** destruir o encaixe entre linhas `pago` e a nova estrutura (ex.: troca **comissão integral** ↔ grade parcelada que exigiria apagar linha `pago`):

- **Bloquear** o salvamento.
- Exibir mensagem solicitando **print** (evidência) e **descrição** do que precisa mudar, para tratamento manual / ticket / fluxo futuro aprovado.

---

## 3. Objetivos e não-objetivos

### 3.1 Objetivos (must)

1. **Imutabilidade do selo de baixa:** campos definidos em §B permanecem intactos em linhas `pago` no fluxo normal; **`status`** permanece `pago`.
2. **Preservação de identidade:** `id` das linhas `pago` **permanece**; **não** há `DELETE` dessas linhas.
3. **Propagação útil para controladoria:** mudanças de datas na venda (Ketlyn) refletem em **`data_prevista`** (e o permitido em §B) **sem** apagar baixas.
4. **Edições cadastrais:** apenas `UPDATE` em `vendas`, sem recriar pagamentos (§4.1).
5. **Banco como última linha de defesa:** §C aplicado em migration.
6. **Estrutura incompatível:** §G.

### 3.2 Não-objetivos (nesta versão)

- Sincronização **Sienge** / `src/services/sienge/**` — **fora de escopo**; revisão futura quando o produto priorizar.
- UI final de cada tela de erro (exceto exigência de mensagem com print + descrição em §G).
- Alterar fórmulas de comissão em `.cursor/rules` além do necessário para cumprir §B–§E.

---

## 4. Definições

| Termo | Significado |
|--------|-------------|
| **Parcela auditada / baixada** | `pagamentos_prosoluto` com `status = 'pago'` (tipicamente com `data_pagamento`). |
| **Parcela pendente** | `status != 'pago'` (tipicamente `pendente`). |
| **Edição cadastral** | Mudança apenas em campos da venda que **não** exigem alterar a grade financeira (lista §5.1). |
| **Edição de cronograma** | Mudança em datas base, periodicidade ou overrides que alteram vencimentos, mas pode ser resolvida com §E. |
| **Mudança estrutural incompatível** | Alteração que não pode ser aplicada sem violar §B ou sem remover linhas `pago` — §G. |
| **Venda com baixa** | Existe ao menos um `pagamentos_prosoluto` com `status = 'pago'` para o `venda_id`. |

---

## 5. Requisitos funcionais

### RF-0 — Migration de proteção no banco (§C)

Criar migration SQL com trigger(s) e/ou políticas que cumpram §C. Falha de escrita que viole a regra deve retornar erro explícito.

### RF-1 — Detecção de venda com baixa

Antes de qualquer `DELETE` em `pagamentos_prosoluto` filtrado por `venda_id`, o aplicativo deve assumir que linhas `pago` **não** entram nesse delete (e o banco deve bloquear se alguém tentar).

### RF-2 — Caminho “somente cadastro”

Se a alteração for **exclusivamente** sobre campos **cadastrais** (§5.1) **e** a venda tem parcelas `pago`:

- Apenas `UPDATE` em `vendas`.
- **Não** `DELETE` / **não** recriar grade.

#### 5.1 Campos **cadastrais** (não disparam sozinhos recriação de grade)

- `descricao`, `bloco`, `andar`, `unidade`, `contrato_url`, `contrato_nome`
- Demais campos puramente descritivos que **não** entram no motor de pagamentos

*Manter lista sincronizada com o código (constante única).*

#### 5.2 Campos que **alimentam** cronograma / valores da grade

Inclui (evolutivo com schema): valores e flags de sinal/entrada/balão/permuta, `data_venda`, `data_entrada`, periodicidades, overrides, `valor_pro_soluto`, `tipo_corretor`, vínculos que hoje disparam regeneração no `handleSaveVenda`, etc.

### RF-3 — Propagação cirúrgica (§D + §E)

Com venda **com** baixa:

- **Proibido:** `DELETE FROM pagamentos_prosoluto WHERE venda_id = ?` sem excluir **apenas** linhas `pendente` (ou equivalente seguro).
- **Obrigatório:** para cada linha `pago`, apenas `UPDATE` nas colunas permitidas em §B; preservar imutáveis.
- **Pendentes:** regenerar ou ajustar sem afetar `pago`.

### RF-4 — Mudança estrutural (§G)

Se a alteração for classificada como **incompatível** com linhas `pago` existentes:

- Bloquear salvamento.
- Mensagem pedindo **print** e **descrição** do que se pretende alterar.

### RF-5 — Consistência cabeçalho vs parcelas (§F)

Quando qualquer fluxo alterar `comissao_gerada` (ou equivalente que mude a soma das comissões nas linhas), atualizar `comissao_*` e `comissao_total` na **`vendas`** de forma consistente. Mudança **somente** de `data_prevista` **não** exige, por si, recálculo de comissão no cabeçalho.

### RF-6 — Renegociação

Manter a regra atual: na UI, renegociar **somente** parcelas **não** `pago`. Não remover esta salvaguarda.

### RF-7 — Transações

Operações que alteram `vendas` e `pagamentos_prosoluto` juntas devem ser **atômicas** quando a plataforma permitir.

---

## 6. Critérios de aceite (testáveis)

### A1 — H1 / cadastro com baixas

**Dado** venda com ao menos um `pago`  
**Quando** altera apenas campos §5.1 e salva  
**Então** linhas `pago` inalteradas (ids, §B, `data_pagamento`)  
**E** `vendas` atualizada.

### A2 — H6 — Sem mudança de grade

**Dado** idem A1  
**Quando** nenhum campo §5.2 muda  
**Então** zero `DELETE` em pagamentos dessa venda.

### A3 — H2 / H4 — Datas (Ketlyn) com baixas

**Dado** venda com parcelas `pago` e `data_entrada`/overrides alterados de forma **compatível** com §E  
**Quando** salva  
**Então** linhas `pago` permanecem com mesmos `id`, §B intacto, `status = 'pago'`  
**E** `data_prevista` atualizada conforme novo cronograma onde aplicável  
**E** nenhum `DELETE` em linhas `pago`.

### A4 — H3 / H5 — Bloqueio estrutural ou propagação segura

**Dado** venda com `pago`  
**Quando** alteração §5.2 que seja **incompatível** (§G)  
**Então** salvamento bloqueado com pedido de print + descrição  
**E** nenhuma alteração parcial que apague `pago`.

*Se a alteração §5.2 for compatível com §E (só ajuste de datas em pendentes + update `data_prevista` em `pago`), aplicar RF-3 e não bloquear.*

### A5 — H7 — Mix pago + pendente

**Dado** `pago` e `pendente` na mesma venda  
**Quando** salvar com propagação permitida  
**Então** `pago` intocado salvo updates permitidos em §B; pendentes podem ser substituídos.

### A6 — H8 — Lote

**Dado** várias vendas legadas  
**Quando** cada save segue as mesmas regras A3–A5  
**Então** nenhuma venda com `pago` perde baixa por delete em massa.

### A7 — Banco (§C)

**Dado** tentativa de `DELETE` ou downgrade de `status` em linha `pago` via SQL ou API  
**Então** operação **rejeitada** pelo banco.

### A8 — Venda sem baixa

**Dado** nenhum `pago` para a venda  
**Quando** salva edição que regenera grade  
**Então** pode manter comportamento atual de recriação total **ou** evoluir para diff só pendentes (documentar escolha).

---

## 7. Roadmap sugerido de implementação

| Fase | Escopo |
|------|--------|
| **MVP** | RF-0 (migration §C); RF-1–RF-3 no app (`handleSaveVenda` + helpers); RF-4; RF-5 onde já hoje há mudança de comissão em linhas; A1–A7 |
| **Fase 2** | Refinar matching venda→linhas para todos os casos §5.2; testes de regressão em PDFs/relatórios |
| **Fase 3** | Fluxo administrativo excepcional (correção de `valor`/`data_pagamento` em `pago` com auditoria) — fora do salvar padrão |

---

## 8. Rastreabilidade história → requisito

| História | RF principal | Aceite |
|----------|--------------|--------|
| H1 | RF-2, §5.1 | A1, A2 |
| H2 | RF-3, §E | A3 |
| H3 | RF-3 ou RF-4 | A4, A5 |
| H4 | RF-3, §E | A3 |
| H5 | RF-3 ou RF-4 | A4 |
| H6 | RF-2 | A2 |
| H7 | RF-3, RF-6 | A5 |
| H8 | RF-3, RF-4 | A6 |

---

## 9. Documentos relacionados

- `docs/BRANCH_KETLYN_VS_MAIN_PRINCIPAL.md` — escopo da branch e migrations
- `migrations/012_*.sql` … `016_*.sql` — schema Ketlyn referenciado em §A
- `.cursor/rules/fator-comissao.mdc`, `comissao-corretor.mdc`, `comissao-integral-20.mdc`

---

*Versão 2 — incorpora decisões A–G; Sienge fora de escopo. Revisar após mudanças em `pagamentos_prosoluto`, `vendas` ou no motor de edição de venda.*
