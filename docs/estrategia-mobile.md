# Estratégia Mobile — Corretor (Rodada 1) · SPEC VIVA

> **Gerado em:** 2026-06-16 · **Atualizado em:** 2026-06-16 (vira spec viva, decisão travada).
> **Método:** análise multi-agente (8 agentes neutros) → decisão do owner → spec-driven com BDD e2e.
> **Premissa de tempo:** pareando com IA, **codar é rápido**; o **gargalo é validar em device físico** (não acelera com IA).
> **Status:** ✅ direção **decidida** (ver abaixo). A análise neutra das 7 direções foi preservada no **Apêndice A** (não perder histórico).

---

## ✅ Decisão travada (2026-06-16)

**Base = Opção 1 (Refino in-place: `@container` + token único)** · **+ table→cards pontual** (só Pagamentos/Relatórios) · **+ Radix por baixo dos modais** (onda 2, quando o comportamento doer).

**Por que essa releitura (e não a recomendação original do doc, que era Opção 2):**
- As dores reais observadas hoje — **login rodapé** e **card de parcela apertado** — são de **layout que quebra/aperta**, não de "reestruturar info densa". Isso é exatamente o território da **Opção 1**.
- "Harmonizar o card de parcela" card-a-card = **gambiarra**. Fazer **`@container` de uma vez** = cada card responde à **própria largura** e **todos** ficam harmoniosos numa passada — jeito **sistemático**, **zero dep nova**, **menor risco**, sem tocar breakpoint global.
- Opção 1 ainda conserta a **incoerência visual** (os 5 `:root` divergentes → "cada tela um cinza diferente").
- A **única** coisa que `@container` não resolve é a `<table data-table>` (tabela é tabela) → para ISSO, e só isso, uma conversão **pontual** tabela→cards (fatia da Opção 2, **não** a árvore inteira). Evita o contra da Opção 2: **duas árvores de UI**.
- **Radix** (Opção 5) entra por baixo dos modais quando ESC/scroll-lock/foco virar dor — barato, não mexe em visual.

**Restrição inviolável:** não regredir o **admin desktop** (`Dashboard.css` é compartilhado). **Premissa visual:** o look atual do corretor "está lindo" — consolidação de token é **aditiva** (alias→canônico = valores atuais do corretor), **nunca** um re-tema.

---

## 🗺️ O que mudou hoje (mapeamento que fundamenta a decisão)

**Já entregue e que segue por cima de qualquer direção (NÃO é gambiarra):**
- **Filtros reusáveis:** `src/utils/searchUtils.js` (`normalizar`/`soDigitos`/`casaBusca`/`filtrarBusca`) + `src/components/Autocomplete.jsx`. Resolvem as 2 dores históricas de busca: **acento** ("jo"→"João") e **CPF/telefone com ou sem máscara**. Já aplicados no corretor (Clientes/Vendas/Pagamentos/Nova Venda) e iniciados no admin.
- **cap-1000 do PostgREST** resolvido (`fetchAllPaginated`) — totais não truncam mais.

**Achados-âncora do repo (varredura real, linhas conferidas):**
- **Embrião mobile já existe** — não nasce do zero: `corretor-shell` (`CorretorDashboard.jsx:1560`), `mobile-broker-nav` (bottom-nav, `:4146`), `broker-mobile-home-panel` (`:1716`), `mobileNavItems`/`mobileQuickActions` (`:1542`/`:1550`).
- **Tabela densa:** `<table className="data-table">` em `CorretorDashboard.jsx:3188` (Meus Pagamentos / Relatórios) — ilegível no polegar.
- **Breakpoint:** JS bifurca em **1024px** (`window.innerWidth > 1024` em `:1516`; `<= 1024` em `:1537`). Layout mobile assume ~768. **Reconciliar.**
- **5 blocos `:root` divergentes:** `src/App.css:8`, `src/styles/Dashboard.css:8`, `src/styles/Login.css:8`, `src/styles/EmpreendimentosPage.css:5`, `src/styles/CorretorDashboard.css:5`. O corretor importa **3** deles (Dashboard + CorretorDashboard + EmpreendimentosPage) → colidem.
- **Card de parcela** (caso-piloto): `.corretor-parcela-row` + filhos em `src/styles/CorretorDashboard.css` (~3422; media mobile ~3725).
- **Test stack:** Vitest 2.1.6 + Testing Library + jsdom (`npm test`); 1 teste real (`src/utils/supabaseQuery.test.js`). **jsdom não tem motor de layout.**

---

## 🧪 Camada de testes (decisão do owner: **Playwright + Vitest**)

Playwright é **dev-only** — NUNCA entra no runtime financeiro.
- **Vitest (comportamento/invariante):** o que jsdom cobre — totais via `somarComissao` (nunca snapshot stale), `cancelado` fora do total, normalização de busca (acento/CPF).
- **Playwright (e2e BDD, layout real):** viewport mobile emulado — tabela→cards, ausência de scroll horizontal 360–768px, bottom-nav fixa (alvos ≥44px), `@container` refluindo o card de parcela, scroll-lock de modal.

### Cenários BDD (Dado/Quando/Então) — fonte da verdade dos testes

```gherkin
Funcionalidade: Visão mobile do corretor — listas legíveis no polegar

  Cenário: Meus Pagamentos não usa tabela espremida no celular
    Dado que estou logado como corretor com parcelas
    E que estou num viewport de 390x844 (iPhone)
    Quando abro a aba "Receber" (pagamentos)
    Então cada parcela aparece como card (valor, vencimento, status)
    E não há rolagem horizontal na página
    E não existe <table> visível na área de conteúdo

  Cenário: Card de parcela reflui pela própria largura (@container)
    Dado a aba "Vendas" aberta com o detalhe de uma venda
    Quando o container do card tem largura estreita (360px)
    Então tipo/data/valor/comissão/status empilham sem overflow
    E quando o container é largo (>=520px) eles voltam pra linha única

  Cenário: Os 3 números em <=2 toques e batendo com as parcelas
    Dado a aba "Início" do corretor
    Então vejo "a receber", "pago" e "pendente"
    E "pago" == soma de somarComissao(parcelas pagas)
    E "pendente" == soma de somarComissao(parcelas pendentes)
    E parcelas canceladas NÃO entram em nenhum dos três

  Cenário: Bottom-nav fixa e tocável
    Dado qualquer aba do corretor no mobile
    Então a mobile-broker-nav está fixa no rodapé
    E cada item tem alvo de toque >= 44px
    E a aba ativa está visualmente destacada

  Cenário: Modal usável no toque (onda Radix)
    Dado um modal do corretor aberto no mobile
    Quando pressiono ESC
    Então o modal fecha
    E enquanto aberto o fundo NÃO rola (scroll-lock)
```

---

## 🔁 PIVÔ (2026-06-16, pós-feedback do owner): geometria → informação

O owner comparou o card novo (só `@container`) vs o legado e foi direto: **não fez milagre, não vi uso real**, e — como corretor — **não dá pra entender o que é meu pagamento vs o da venda**. Diagnóstico aceito:

- O problema **não era geometria** (colunas apertadas), era **semântica/hierarquia**: o card mostrava `R$ 1.962,39` (valor que o cliente paga à IM) como número grande/branco e a **comissão do corretor** (`R$ 392,48`) como número pequeno, dourado e **sem rótulo**. Prioridade invertida + zero rótulo = confusão.
- `@container`/CSS é só o **transporte**. O que dá "uso real" é **qual informação, com qual rótulo, em qual hierarquia**.

**Decisão (owner): card comissão-first + aplicar em Pagamentos e Vendas.**

**Feito:**
- Novo componente único **`src/components/corretor/ParcelaCard.jsx`** (+ `.css`) — comissão-first: lidera com **"Minha comissão"** (rotulada, dourada, herói); status no topo; **valor da parcela** vira rodapé rotulado discreto ("valor da parcela R$ …"); "pago em" vs "vence" conforme status.
- **Unifica os 2 cards divergentes** que existiam: Vendas (`.corretor-parcela-row`, sem rótulo) e Pagamentos (`.parcela-row`) → ambos agora usam `ParcelaCard`. Coerência + fim da duplicação (3 call-sites).
- Testes: render (Vitest/Testing-Library, 6) + contrato de layout comissão-first (Playwright, 2). Build verde.
- CSS morto do `@container` antigo removido; `.corretor-parcela-row`/`.parcela-row` ficam como legado inerte (este último é compartilhado no `Dashboard.css`, **não** deletar).

**Lição:** começar pela **informação** (o que o corretor precisa entender) antes da técnica de layout. O `@container` segue válido como ferramenta, mas é secundário.

**Pendente (mesma direção):** header dos grupos (Vendas `grupo-resumo`) liderar com comissão rotulada; os **3 números do topo**; depois Radix (modais).

## 🔗 Vendas × Pagamentos: resumo × detalhe + cruzamento (2026-06-16)

Depois da unificação do card, **Vendas e Pagamentos ficaram redundantes** (mesma lista de parcelas). Espelhando a lógica do admin (Vendas = *registro/negócio*; Pagamentos = *acompanhamento*), o owner decidiu **diferenciar por altitude + cruzar**:

- **Vendas = resumo do negócio.** Removido o `venda-pagamentos-detalhes` (toggle Contrato/Calendário + parcelas). O card de venda fica só com o resumo (título, empreendimento/unidade, data, status, **Valor da Venda**, **Sua Comissão**). O antigo "Ver mais" virou **"Ver recebimentos"** → pula pra aba Pagamentos **já expandindo** aquela venda (`setPagamentoVendaExpandida` + navega).
- **Pagamentos = detalhe das parcelas.** É o lar do detalhe (cards comissão-first + "ver mais"). Cada grupo de venda ganhou **"Ver venda"** → volta pra aba Vendas **destacando/rolando** até o card (`vendaDestaque`, outline dourado que some em 3s).
- **Sidebar + bottom-nav:** ordem agora **Dashboard → Pagamentos (Receber) → Vendas → …** (pagamentos é o foco do corretor).
- **Limpeza:** removido o código morto que sobrou (`fetchPagamentosVenda`, `agruparPagamentosPorTipo`, `getGrupoLabel`, `toggleVendaExpandida`, estados `vendaExpandida`/`pagamentosVenda`). `toggleGrupoExpandido`/`isGrupoExpandido` seguem (usados no "ver mais" de Pagamentos).

Resultado: *Vendas responde "o que vendi e quanto no total"; Pagamentos responde "quando cai, parcela a parcela"* — sem redundância, com ida-e-volta entre as duas.

## ❄️ Decisão de escopo durante o mobile (2026-06-16)

- **"Solicitar Registro de Venda" E "Cadastrar Cliente" CONGELADAS.** Decisão do owner: esses fluxos serão **substituídos pela integração com o formulário público** (rodada de FEATURE futura, fora do escopo do polimento mobile). Em vez de polir algo condenado, **congelamos**: flags `REGISTRO_VENDA_CONGELADO` / `REGISTRO_CLIENTE_CONGELADO` (`=true`) em [CorretorDashboard.jsx](../src/pages/CorretorDashboard.jsx) escondem os botões e travam as modais; o cabeçalho "Registrar Nova Solicitação" some quando não há nenhuma ação ativa. Código mantido intacto → reativar/substituir = trocar pra `false`. Como não sobrou nada pra criar, a aba **Solicitações** foi **removida da sidebar** (`SOLICITACOES_OCULTA`, derivada das duas flags — volta sozinha se alguma criação reativar); rota/conteúdo preservados.
- **Princípio reforçado:** "mobile 100%" = **cobertura + polimento** das telas alcançáveis, **não** redesenho de fluxo. Integração form-público↔solicitação é feature, vem **depois** de entregar o mobile.
- **Dropdown de empreendimento** (na solicitação, hoje congelada) já filtrado só pra **Figueira** (único ativo).

## 📐 Plano de implementação (passos) — estado

- **Passo 1 — Fundação:**
  - **Token merge global → DEFERIDO** (decisão de risco). Motivo: `App.css` nem é importado por `main.jsx` (só `index.css`), e o valor "vencedor" de tokens conflitantes (`--im-bg-card`, `--im-bg-hover`, `--im-info`) depende da ordem de import — reescrever os `:root` arrisca o admin (CSS compartilhado) com ganho visual baixo e **difícil de validar no headless**. Em vez de merge global, a coerência do corretor sai **escopada sob `.corretor-shell`** quando necessário (admin intocado por construção).
  - **Breakpoint:** o `1024` em JS (`:1516/:1537`) é **comportamento de sidebar** (auto-abrir), ortogonal ao layout (CSS usa `768`/`480`). Não é bug; o `@container` reduz a dependência de breakpoint de viewport. Canon de layout documentado: **768/480** (viewport) + `@container` (componente).
- **Passo 2 — `@container`:** ✅ **piloto feito + testado** — `.parcelas-list` virou container (`container-type: inline-size; container-name: parcelas`) e o card de parcela `.corretor-parcela-row` reflui em 3 linhas limpas abaixo de 480px de **largura do container** (não da viewport). Regra `@media` antiga do card removida. **Próxima onda:** estender a stats-grid (3 números) e cards de venda/cliente.
- **Passo 3 — table→cards:** `<table data-table>` (`:3188`) vira lista de cards no mobile; desktop preservado; totais sempre de `somarComissao`. **Pendente** (mudança estrutural de JSX — validar com owner).
- **Passo 4 — testes:** ✅ **feito** — Vitest 21 testes (`searchUtils` 13 + invariante de totais 8) + Playwright 3 testes de contrato `@container` lendo o CSS real. Scripts: `npm run test:run` / `npm run test:e2e`.
- **Passo 5 — Radix:** `@radix-ui/react-dialog` nos Dialog/Sheet do corretor (ESC/focus-trap/scroll-lock/portal), CSS atual via `className`. **Pendente** (onda 2).

**Guarda-corpos:** mudança de token aditiva/reversível + smoke admin obrigatório; nada de commit sem o owner pedir; trabalho e spec nesta branch (não na main).

---

# Apêndice A — Análise neutra das 7 direções (preservada do doc original)

> Mantida íntegra para histórico. A decisão acima saiu daqui.

## 🎯 Objetivo

Deixar a experiência do **corretor no celular** ótima (consumir comissões/parcelas no polegar), **sem regredir o admin desktop**, preparando **reúso barato pro cliente final (fase 2)**.

## 🔭 Escopo desta rodada

- **DENTRO:** só o fluxo do **corretor** — `CorretorDashboard.jsx` (~4k linhas, 582 classNames, 17 inline styles) + a casca mobile `corretor-shell` que **já existe**.
- **FORA (restrição inviolável):** **admin/controladoria** — já funciona bem no desktop. *Não quebrar* o admin é regra; **validar** o admin não é objetivo. ⚠️ O risco vem do `Dashboard.css` ser **compartilhado** (CorretorDashboard importa Dashboard.css + CorretorDashboard.css + EmpreendimentosPage.css).
- **FASE 2 (futuro, barato):** **cliente final** — herda os padrões validados do corretor.
- **Validação da rodada:** corretor mobile ótimo (iOS Safari + Android Chrome — owner no Windows, sem Mac) + **smoke leve** de não-regressão do admin desktop.

## 🔍 Achados do repo que mudam o jogo

1. **Já existe um embrião de app mobile do corretor:** `corretor-shell`, `mobile-broker-nav` (bottom-nav), `broker-mobile-home-panel`, `mobileNavItems`/`mobileQuickActions` já no JSX — e o commit recente `feat(corretor): refina experiencia mobile` (`0275ce1`). Ou seja, **você já vinha por esse caminho**.
2. **A dor concreta:** as abas **Meus Pagamentos / Relatórios** ainda renderizam `<table class="data-table">` (linha 3094) — tabela densa de pro-soluto **ilegível no polegar** (scroll horizontal/zoom). Vendas e Clientes já são cards.
3. **Modais sem comportamento:** **zero** `ESC`/`focus-trap`/`scroll-lock`/`role=dialog` nos 5 modais do corretor (grep confirmou) — hoje é `<div onClick>` + `stopPropagation`. No celular o fundo rola atrás do modal.
4. **Breakpoint inconsistente:** o JS bifurca em **1024px** (linhas 1442/1463), mas o layout mobile assume ~768. **Tem que reconciliar** antes de qualquer trabalho.
5. **Tokens divergentes:** 4-5 blocos `:root` com valores que **não batem** (`--im-bg-card`, `--im-shadow`, `--im-info`) → "cada tela tem um cinza ligeiramente diferente".

## 📋 Requisitos do corretor no celular (derivados do uso real)

1. **Ver 3 números em ≤2 toques:** a receber / pago / pendente (já vêm de `somarComissao` sobre `pagamentos_prosoluto` — **nunca** de snapshot stale; qualquer direção deve preservar isso).
2. **Listas legíveis no polegar, não tabela espremida:** cada parcela como card (valor, vencimento, status pago/pendente/**cancelado** distinto — sem reintroduzir o bug de cancelado inflar total).
3. **Navegação por polegar:** bottom-nav fixa, alvos ≥44px, tab ativa visível.
4. **Layout que não quebra entre 380-768px.**
5. **Modais usáveis no toque:** ESC, scroll-lock, foco preso; form "Nova Venda" longo lida bem com teclado iOS.
6. **Gerar/compartilhar PDF funcionando** (`jsPDF.save` — ok na web; só quebra em WebView nativo).
7. **Coerência visual entre seções.**
8. **Sessão financeira não cair** (não servir valor de cache nem deslogar fantasma).

---

## As 7 direções (eixos distintos)

| # | Direção | Eixo distintivo | Nota (corretor) | Codar | Validar |
|---|---------|-----------------|:---:|---|---|
| 1 | **Refino in-place** (tokens únicos + `@container`) | **Zero entropia nova** — não adiciona nada ao stack | **8** | 1,5-3d | 0,5-1d |
| 2 | **Vistas Mobile Dedicadas** (render condicional JS) | **Ramificação deliberada** — árvore de UI mobile própria | **8** | 3-5d | 1,5-2,5d |
| 3 | **Tailwind v4** (re-tooling) | Troca a **ferramenta** de estilo | 6 | 2-4d | 2-3d |
| 4 | **Mantine v9** (lib de componentes) | **Importa** componentes prontos | **8** | 3-6d | 2-4d |
| 5 | **Radix** (headless) | **Comportamento/a11y** de overlays, não pixels | 7 | 0,5-1d | 0,5-1d |
| 6 | **PWA** (`vite-plugin-pwa`) | **Moldura/empacotamento**, ortogonal ao render | 7 | 2-4h | 1-2d |
| 7 | **Capacitor 8** (wrapper nativo) | Muda de **plataforma** (sai da web) | 5 | 2-4d (Android) | 0,5-1d + review iOS |

### 1 · Refino in-place — CSS próprio evoluído (token único + `@container` + utilitários) · nota 8
- **Eixo:** a única direção que **não adiciona nada** (sem lib/toolchain/dep) — só corrige a entropia que já existe. Troca `@media` (responde à viewport) por `@container` (responde à largura do próprio componente) nos blocos do corretor.
- **Faz:** (1) consolida os 4-5 `:root` num token canônico; (2) `@container` em stats-grid/cards/`.data-table` sob `corretor-shell`; (3) utilitários `.u-stack`/`.u-cluster`/`.u-hide-narrow`.
- **✅ Prós:** zero risco de dep/EOL; financeiro blindado (CSS não toca dado); `@container` Baseline ~96% (iOS 16+); assenta sobre a casca já feita; diff reversível em git.
- **⚠️ Contras:** consolidar token toca `Dashboard.css` **compartilhado** → mitigar com mudanças **só aditivas** (alias→canônico) + smoke admin obrigatório; escolher o valor canônico **muda pixels**; **não** resolve a tabela densa.
- **Reúso cliente:** **alto** (cliente já compartilha Dashboard.css — replica o padrão 1:1).
- **Escolha se:** a dor é **layout que quebra/aperta** e você quer **zero compromisso** com ferramenta nova.

### 2 · Vistas Mobile Dedicadas — mobile-first do corretor, separado do desktop · nota 8
- **Eixo:** **ramificação deliberada** — abaixo de ~768px renderiza uma árvore de componentes **própria** (lista no lugar de tabela, bottom-nav, cards pro polegar) decidida em JS (`matchMedia`), não só CSS sobre o mesmo DOM. Pode **omitir** colunas/seções inteiras.
- **Faz:** formaliza o embrião que já existe (`corretor-shell`, `mobileNavItems`, `broker-mobile-*`): promove `display:none`-por-media-query → **render condicional** via `useIsMobile()`. Completa o que falta: **Pagamentos e Relatórios viram cards** em vez de `<table data-table>`.
- **✅ Prós:** **mais isolada do admin** (branch mobile sob `corretor-shell`, não toca breakpoint global nem Dashboard.css); resolve a tabela ilegível (que CSS sozinho não resolve); **melhor reúso pro cliente (60-70% de graça)** — os cards de parcela/lista são quase os mesmos que o cliente vê.
- **⚠️ Contras:** **duas árvores de UI** (risco de drift desktop×mobile num arquivo de 4k linhas) → disciplina de extrair pra `src/components/corretor-mobile/*`; teste duplicado dentro do corretor; cuidar do flash (ler `innerWidth` no 1º render).
- **Reúso cliente:** **o mais alto** — o trabalho do corretor *vira* o front do cliente.
- **Escolha se:** a dor #1 é **consumir info densa** (tabela ilegível) **e** a fase 2 do cliente é prioridade.

### 3 · Tailwind v4 (CSS-first) — re-tooling de estilo · nota 6
- **Eixo:** única que troca a **ferramenta**. Responsivo vira `sm:`/`md:`/`lg:` no JSX; `--im-*` viram `@theme`; purge mata CSS morto.
- **✅ Prós:** estável 2026 (JS puro, sem PostCSS/TS); mata a inconsistência de breakpoint **por construção**; identidade visual ~1:1 (`@theme`).
- **⚠️ Contras:** **fura o escopo "só corretor"** — o corretor pendura layout em **108 classes compartilhadas** com o admin no Dashboard.css; migrar força tocar o admin **ou** vira híbrido permanente. 2ª fonte de estilo durante a transição; JSX vira sopa de classes. **Compromisso de longo prazo** (adotar Tailwind como padrão).
- **Escolha se:** topa **adotar Tailwind como ferramenta-padrão** do projeto **e** decidir agora o destino das 108 classes. Senão, o ganho mobile sai mais barato em CSS puro.

### 4 · Mantine v9 — biblioteca de componentes prontos · nota 8
- **Eixo:** única que **importa** componentes de terceiros (Drawer/AppShell/Tabs/Table/Modal/NumberFormatter pt-BR) em vez de reescrever CSS. (**Rejeitei daisyUI:** exige instalar Tailwind no legado **e** suas classes `btn`/`card`/`modal` são globais → colidem com 158 regras nas folhas do corretor → ameaça o admin. Mantine isola via `@layer`.)
- **✅ Prós:** casa exato (React 19.2); **CSS scoped em `@layer` = admin intacto por construção**; a11y/foco de fábrica; **reúso pro cliente altíssimo** (montar os mesmos componentes).
- **⚠️ Contras:** adiciona **JS de runtime** no caminho financeiro (formatação bonita pode **mascarar número errado** — cablar valor vivo na mão); 2 paradigmas de estilo na transição; bundle maior no 4G; curva de API.
- **Escolha se:** o gargalo é **construir componentes mobile bons rápido** (não "arrumar o CSS") **e** a fase 2 justifica o runtime extra.

### 5 · Radix UI — camada de comportamento headless · nota 7
- **Eixo:** **comportamento e a11y** de overlays — **não** layout, não cor. O CSS próprio fica idêntico (vestido via `className`); muda o miolo invisível que o código **não tem**: focus-trap, ESC, scroll-lock, portal, `aria-modal`, retorno de foco.
- **✅ Prós:** fecha buraco **verificado** (0 ESC/focus-trap/scroll-lock); portal mata o bug de "modal cortado por overflow de ancestral"; migração por modal; **barato** (0,5-1d).
- **⚠️ Contras:** **não melhora nada visual** (conserta o invisível); Select/Tabs exigiriam reescrever marcação → manter escopo **só Dialog+Sheet**; form Nova Venda + teclado iOS é o que mais consome validação.
- **Reúso cliente:** muito alto (Dialog/Sheet são agnósticos de papel).
- **Escolha se:** a dor é **comportamento de modal** — idealmente como **camada por baixo** de 1, 2 ou 4, não sozinha.

### 6 · PWA (`vite-plugin-pwa`) — envelope instalável · nota 7
- **Eixo:** **ortogonal ao render** — empacotamento (manifest + service worker + ícones), não toca JSX/CSS. **Roda em paralelo** a qualquer outra direção.
- **✅ Prós:** instalável na home + tela cheia + 2º load instantâneo; clean slate (zero SW hoje, `index.html` já tem 3/4 das metatags); sem bloqueio Windows→iOS; **dado financeiro protegido por config** (denylist `NetworkOnly` em `*.supabase.co` — nunca de cache); **reúso fase 2 quase grátis** (SW é do app inteiro).
- **⚠️ Contras:** **não resolve layout** (sozinha = app instalável que continua quebrando); **SW stale é perigoso em financeiro** → exige `autoUpdate`+`skipWaiting`+`clientsClaim` + **teste de ciclo de update real**; iOS trata PWA como 2ª classe.
- **Escolha se:** a dor é "parecer app na home / reabrir instantâneo" — **sempre como frente paralela**, nunca a única.

### 7 · Capacitor 8 — wrapper nativo (loja) · nota 5
- **Eixo:** única que muda de **plataforma** — binário de loja, ícone na home, **push nativo, biometria, secure-storage**.
- **✅ Prós:** reúso quase total (mesmo bundle no WebView); resolve sessão financeira de vez (`@capacitor/preferences`); **Android 100% no Windows** sem App Review bloqueante.
- **⚠️ Contras:** 🚫 **iOS = hard-block** (Xcode 26 num Mac; owner no Windows) + App Review pode barrar "site embrulhado" (4.2); **3 patches obrigatórios** (`BrowserRouter`→`HashRouter`; sessão Supabase localStorage→Preferences; `jsPDF.save`→Filesystem/Share — senão "baixar PDF" **falha silencioso**); some o deploy-Vercel-na-hora; sinal de abandono do Capacitor no ecossistema.
- **Escolha se:** push/biometria são **requisito de produto** **e** o público é majoritariamente **Android**. Senão, é canhão pra matar mosca (resolve plataforma, não CSS).

---

## 🧭 Framework de decisão (SE → ENTÃO)

- **SE** a dor é **layout que quebra entre 380-768px** e quer **zero ferramenta nova** → **Opção 1** (Refino in-place).
- **SE** a dor #1 é **tabela/info densa ilegível no polegar** **e** a fase 2 do cliente é prioridade → **Opção 2** (Vistas Dedicadas) — única cujo trabalho vira o front do cliente.
- **SE** topa **adotar Tailwind como padrão** e decidir as 108 classes compartilhadas → **Opção 3**. Senão, não.
- **SE** o gargalo é **construir componentes mobile rápido** (não arrumar CSS) → **Opção 4** (Mantine).
- **SE** a dor é **comportamento de modal** (fundo rola, sem ESC) → **Opção 5** (Radix), por baixo de 1/2/4.
- **SE** a dor é **"parecer app instalado"** → **Opção 6** (PWA), sempre paralela.
- **SE** push/biometria são **requisito** e público **Android** → **Opção 7** (Capacitor). Senão, fora.
- **SE** baixa tolerância a regredir o admin → favorecer as **isoladas por construção** (2, 4, 5, 6) sobre as que tocam Dashboard.css compartilhado (1, 3).

## ✅ Recomendação derivada (você decide — isto sai dos critérios, não do meu gosto)

Dos critérios **2 + 5 + 8** + escopo (corretor já / admin intocável / fase 2 barata): **Opção 2 (Vistas Dedicadas)** com **Opção 5 (Radix Dialog/Sheet) como camada por baixo**, e a **parte `@container` da Opção 1** como complemento barato de coerência visual (sem mexer no token compartilhado).
- **Por quê (explícito):** (2) só render condicional resolve a `<table data-table>` ilegível e os 3 números — e é a única que vira o front do cliente; (8) é a mais isolada do admin (não toca breakpoint global nem Dashboard.css); (5) Radix fecha o buraco de comportamento que nenhuma direção de layout cobre, por ~0,5-1d.
- **Mas é decisão sua:** se a dor real for "parecer app" → PWA (6) sobe; se for push/biometria → (7); se você **não topa manter duas árvores de UI** → **Opção 1 pura** é mais enxuta.

---

## ❓ Decisões abertas (responder pra fechar o spec)

1. **Qual é a dor #1 SENTIDA do corretor no celular?** layout aperta · tabela ilegível · modal se comporta mal · "não parece app". *(Isto decide o eixo.)*
2. Aceita **uma dependência nova** (Mantine/Radix/Tailwind/PWA) ou **zero lib** (→ só Opção 1)?
3. Tolera **duas árvores de UI** (desktop+mobile)? Aceitável → viabiliza Opção 2; inaceitável → favorece 1.
4. Se token consolidado: **qual valor é o canônico** quando os `:root` divergem? (muda pixels que talvez você já ache ok)
5. **Breakpoint canônico:** 1024px (código atual) vs 768px (brief) — unificar antes.
6. **Push/biometria** são requisito desta fase ou futura?
7. Público do corretor é majoritariamente **Android ou iOS**?
8. Se Tailwind: topa decidir **agora** o destino das 108 classes compartilhadas com o admin?
9. Definição de "pronto" sem Mac: **Safari mobile no iPhone real basta**, ou exige app instalado?

## 🗺️ Próximos passos (fases)

- **Fase 0 — Fechar o spec (sem código):** responder as decisões abertas (principalmente a #1). Unificar o breakpoint (1024 vs 768). Congelar a lista dos 5 modais e das telas com `<table data-table>`. → *saída: direção escolhida + critério de pronto.*
- **Fase 1 — Baseline + guarda-corpo do admin (~0,5d):** screenshots do admin desktop ANTES; blindar os 3 números (`somarComissao`) com teste leve.
- **Fase 2 — Implementar a direção escolhida** (escopo corretor). *Se for a recomendação 2+5: ~3,5-6d, em ondas — primeiro `<table>`→cards, depois bottom-nav/home via render condicional, depois Radix nos 5 modais.*
- **Fase 3 — Validação humana em device** (o gargalo): iPhone Safari + Android Chrome nos tabs do corretor; 3 totais não-stale; listas legíveis; modais (ESC/scroll-lock/teclado iOS); PDF.
- **Fase 4 — Smoke do admin desktop (~30 min, inegociável):** comparar com os screenshots da Fase 1.
- **Fase 5 — Documentar + preparar reúso fase 2 (~0,5d):** registrar tokens/componentes/padrões num doc (em branch) pro ClienteDashboard herdar; nota em CLAUDE.md.

---

## Notas finais

- **A dor #1 (decisão aberta #1) é a chave** — me diga o que mais incomoda no corretor mobile hoje e o framework SE→ENTÃO aponta a direção.
- **AdminDashboard** (desktop) está fora; é restrição de não-regressão, não objetivo.
- **Mobile ≠ backend** — decisões ortogonais.
