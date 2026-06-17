# Estratégia Mobile — Corretor (Rodada 1)

> **Gerado em:** 2026-06-16 · **Método:** análise multi-agente (8 agentes, 1 advogado por direção + síntese spec-driven, status 2026 na web, varredura real do repo).
> **Premissa de tempo:** pareando com IA, **codar é rápido**; o **gargalo é validar em device físico** (não acelera com IA). Toda estimativa separa os dois.
> **A decisão de direção é do owner.** Este doc entrega as 7 direções *neutras*, os requisitos reais, o framework SE→ENTÃO e as fases. Não crava vencedor.

---

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
