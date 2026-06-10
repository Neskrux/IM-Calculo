---
status: MAPA DE DECISÕES — o "porquê" de cada escolha
data: 2026-06-01
branch: sync/reconciliacao (worktree IM-reconciliacao)
proposito: registrar CADA decisão da reconciliação, a alternativa rejeitada, e por que esta venceu,
           lida por DUAS lentes — North Star (o objetivo do produto) e Context Engineering (o método).
ver_tambem: 2026-06-01-north-star-reconciliacao.md · 2026-06-01-passo2-residuo-medido.md
---

# Mapa de decisões — North Star × Context Engineering

## As duas lentes (o critério de toda escolha)

**🌟 North Star** — *o banco local é espelho fiel do Sienge e o corretor/admin confia 100% no número, sozinho.*
Pergunta que cada decisão responde: **"isso aproxima o número da verdade do Sienge e da confiança do usuário?"**

**🧩 Context Engineering** — *o trabalho tem que ser legível, seguro, reversível e retomável; uma fonte de
verdade, sem caminhos-fantasma, idempotente, decisões registradas onde serão achadas.*
Pergunta: **"isso deixa o sistema mais simples de entender e mais difícil de quebrar — hoje e pra quem vier depois?"**

> Princípio que une as duas: **medir antes de agir, reusar antes de reinventar, registrar antes de esquecer.**

---

## Mapa-mestre das decisões

| # | Decisão | Alternativa rejeitada | 🌟 North Star | 🧩 Context Engineering |
|---|---|---|---|---|
| 1 | **Definir 1 north star + 3 baldes + through-line** | Atacar micro-camadas ad hoc | Dá um destino único a tudo; termômetro mensurável (inadimplência) | Dissolve a confusão de "micro-camadas"; torna o trabalho priorizável e legível |
| 2 | **Distrato via ponte `status='distrato'` no sync** | `isVendaAtiva` bruto excluindo `situacao=3` em toda UI | Reflete o estado real do Sienge; preserva R$684k pago; "vermelho" de graça | Reusa a máquina de UI já testada; 1 campo como fonte de verdade; tolera reversão |
| 3 | **Gerador Opção B (skip-only, não-destrutivo)** | Reusar `propagarCronogramaCirurgico` (deleta pendentes) | Estanca duplicata nova sem risco de apagar parcela real do Sienge | Idempotente (2× = no-op); separa "gerar" de "reconciliar"; menor surpresa |
| 4 | **Deletar o cluster de sync legado** | Editá-lo p/ distrato, ou deixá-lo | Uma única via de ingestão = mirror com 1 porta bem definida | Mata implementação-fantasma (o pior pecado de contexto); build como oráculo de "morto" |
| 5 | **Medir resíduo com o reconciliador testado (dry-run)** | Escrever matcher novo | Número bate com o que o cron enxerga (sem drift detector×aplicador) | Reuso > reinvenção; uma fonte de verdade pra lógica de match |
| 6 | **Manter R$684k de comissão paga nos totais** | Tirar distrato dos totais | Não apagar dinheiro real = base da confiança | Respeita invariante (pago é verdade financeira imutável — trigger 017) |
| 7 | **Buscar 1 bulk fresco** | Snapshot velho de 23/04 · ou REST por-venda | Mirror reflete o Sienge de HOJE | Ferramenta certa (bulk grátis vs REST que estoura quota 100/dia) |
| 8 | **Resíduo → rodada-b (fila), não auto-cancelar** | Script cancela as 54 pagas sozinho | Não quebrar confiança apagando pago em silêncio | Human-in-loop só no não-mecânico; aplicador idempotente; decisão registrada |
| 9 | **Trabalhar em branch isolada, sem push/deploy, DB intocado** | Mexer no main / aplicar direto | Não desestabiliza o mirror vivo antes da hora | Isolamento, reversibilidade, escrita em prod **gated** |
| 10 | **b9 e b10 separadas** | Uma fila só | — | Regra rodadas-b: não amontoar tipos de problema (legibilidade pra quem decide) |
| 11 | **Commitar como `netojonas`, não como Bruno** | Usar a identidade do repo | — | Autoria honesta = auditabilidade de quem fez o quê |
| 12 | **Documentar a foto a cada passo** | Confiar na memória da conversa | Os docs SÃO o through-line até o objetivo | Spec-driven; contexto retomável; "não perder a foto" |

---

## As 4 decisões que mais definiram o rumo (detalhe)

### Decisão 2 — Distrato: ponte no sync, não filtro bruto
- **O que se quase fez:** um helper `isVendaAtiva` que excluía `situacao_contrato='3'` de toda soma/contagem.
- **Por que era pior:** filtrava o distrato **das somas de comissão também** → apagaria os **R$684k pagos** (viola fase5/trigger). E não entregava o "vermelho" pedido.
- **🌟** O sync passar a gravar `status='distrato'` faz o banco **espelhar** o que o Sienge já diz (`situacao=3`), em vez de a UI inventar um filtro paralelo.
- **🧩** Reusa `calcularComissaoVendaDistrato` + rótulo vermelho que **já existiam mas nunca rodavam**. `isVendaAtiva` ficou só pra **contagem**, nunca pra soma — invariante explicitado no código.

### Decisão 4 — Deletar o legado em vez de remendar
- **Gatilho:** eu ia editar `syncVendasV2.js`/`syncUtils.js` pra tratar distrato — até descobrir que **ninguém os importa** (só o `SincronizarSienge.jsx`, que também é órfão).
- **🌟** Duas implementações de sync = dois jeitos de o mirror divergir do Sienge. Uma só porta (edge) = um só ponto pra garantir a verdade.
- **🧩** Implementação-fantasma é a armadilha clássica de contexto: ela quase me fez aplicar a correção **no lugar errado**. O `build verde` após deletar 19 arquivos foi a **prova** de que era morto. Menos superfície = menos engano futuro.

### Decisão 5 — Medir com o reconciliador testado, não com matcher novo
- **🌟** Se eu escrevesse um detector próprio, o número que eu reporto (R$21k) poderia **divergir** do que o cron aplica — e a desconfiança nasce exatamente do "dois números diferentes".
- **🧩** Mesma fonte de verdade pra detecção e aplicação. (Foi também o que **expôs** o detector heurístico antigo inflando ~R$27k → o número ancorado real é R$21.194,06.)

### Decisão 8 — Resíduo pra fila, e a fila pode ser decidida "aqui"
- **Camada 1 (spec):** apagar linha **paga** é delicado → rodada-b registra pra humano, não tenta sozinho.
- **Camada 2 (refino de hoje):** como o **repasse ainda não sai do nosso sistema**, os fantasmas **nunca moveram dinheiro real** → a decisão pode ser tomada **aqui**, sem controladoria. A rodada-b deixa de ser "gate burocrático" e vira **o formato de registro** da decisão.
- **🌟** Limpar agora, **antes** de o repasse depender do banco, é o momento ideal — o número fica certo quando ligarmos o repasse pelo sistema (o objetivo final).
- **🧩** O `aplicar-rodada-b.mjs` executa **só o autorizado**, idempotente, respeitando triggers (Excluir Baixa p/ pago) — a decisão fica versionada em `respostas.json` + `execucao.json`.

---

## Achados de Context Engineering (dívidas que o método expôs)

- **Cron passo ① preso ao passado:** `gerar-plano-correcao-data-prevista` lê arquivo **congelado** de 13/05 (99 vendas). Escopo fincado no passado → o método (mapear a árvore da Action) **revelou** a dívida. Fix: fundir no passo ② (universo completo).
- **Detector heurístico inflava:** a chave `(tipo,numero_parcela)` colidia → "R$27k". A âncora real `(bill_id,installment_id)` deu **R$21.194,06**. Lição: **ancorar > heurística**.
- **Bug de paginação no gerador b9:** `.range()` sem `.order()` pulava/duplicava linhas → número errado pra gestora. Pego porque **três somas tinham que bater** (linhas = por-caso = query direta). Lição: **verificação cruzada** antes de mostrar número a humano.

---

## Como usar este doc

Quem for **alterar** algo na reconciliação: leia a linha do mapa-mestre correspondente **antes** — se sua mudança
contraria a justificativa das duas lentes, provavelmente está reintroduzindo um problema que já resolvemos
de propósito. Se for tomar uma decisão nova, **adicione uma linha aqui** com a alternativa rejeitada e o porquê
nas duas lentes. É assim que o contexto não se perde.
