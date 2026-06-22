# Regra: UI Mobile / iOS Safari — modais, theme scoping e cache

Aprendizados que custaram caro (sessão 2026-06-22). Quem for mexer em modal, overlay
ou debugar "não atualizou em produção" no mobile lê isto **antes**.

---

## 1. Modal/overlay no mobile: NÃO renderizar dentro do scroller

A arquitetura de scroll é: `.dashboard-container { height:100dvh; overflow:hidden }` →
a janela não rola; quem rola é **`.content-section`** (o scroller).

**`position: fixed` aninhado dentro de um container com overflow-scroll buga no iOS Safari** —
o elemento "fixo" passa a se posicionar relativo ao scroller, não à viewport. Sintomas reais:
o modal **abre cortado / não completo** e **"quebra" ao rolar pra cima/baixo**.

- ❌ **NÃO** renderize o modal lá no fundo da árvore, dentro do `.map` que vive em `.content-section`.
- ✅ Renderize na **raiz do dashboard** (fora de `.content-section`), como faz o **modal de senha**
  (`CorretorDashboard.jsx`, bloco `{showSenhaModal && ...}`) — é o motivo de ele ser escrito lá no fim.
- ✅ Ou use **`createPortal(jsx, ...)`** (react-dom) pra escapar do scroller — **mas leia a regra 2**.

Causa raiz: ancestral com `transform`/`filter`/`will-change`/`contain` **ou** com `overflow` de
scroll redefine o conteiner de um `position:fixed`. No iOS o `overflow` sozinho já basta pra bugar.

## 2. Theme vars `--broker-*` são escopadas em `.corretor-shell`

`:root` define `--bg-card`, `--accent-primary`, etc. **Mas** `--broker-bg/surface/border/gold/text`
são definidas em **`.corretor-shell { ... }`** (ver `CorretorDashboard.css`).

Consequência: se você **portar o modal pra `document.body`** (regra 1), ele sai de dentro do
`.corretor-shell` e **perde o tema** (cores do `ParcelaCard` e do card quebram pra fallback).

- ✅ Se portar pra `body`, **envelope o conteúdo com `<div className="corretor-shell">`** pra reaplicar o escopo.
- ✅ Ou simplesmente **renderize na raiz do shell** (dentro de `.corretor-shell`, fora do scroller) —
  evita o problema de tema E o de fixed. É a opção mais simples e a que o app já usa.

## 3. Listas roláveis dentro do modal: `overscroll-behavior: contain`

Modal com lista grande (ex.: 50 parcelas) que rola internamente: sem isso, ao chegar no topo/fim
o scroll "vaza" pra página atrás (scroll-chaining) e dá pull-to-refresh acidental no iOS.

- ✅ `overscroll-behavior: contain;` no corpo rolável do modal (`.modal-body`/lista).
- ✅ Use **`dvh`** (não `vh`) pra altura de modal no mobile — `vh` no iOS inclui a área da toolbar
  dinâmica e o conteúdo passa por baixo dela (`max-height: 90dvh`).

## 4. Deploy e cache no iOS Safari — "não mudou nada em produção"

**`pull-to-refresh` no iOS NÃO re-baixa o bundle JS/CSS.** Recarrega a página mas reusa os assets
imutáveis cacheados (Vite gera `/assets/index-HASH.js` com cache longo). Resultado: o usuário jura
que "nada mudou" mesmo com o deploy no ar. **Não há service worker no projeto** — é cache HTTP puro.

**Antes de acreditar que o deploy falhou, prove qual código produção serve de verdade:**
```bash
HTML=$(curl -s -H 'Cache-Control: no-cache' "https://im-calculo.vercel.app/?cb=$RANDOM")
JS=$(echo "$HTML" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
CSS=$(echo "$HTML" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.css' | head -1)
curl -s "https://im-calculo.vercel.app$JS"  | grep -c "string-do-codigo-novo"   # >0 = prod novo
curl -s "https://im-calculo.vercel.app$CSS" | grep -oE "minha-classe\{[^}]*\}"   # confere o CSS
```
Se o bundle servido tem o código → **é cache do aparelho**, não deploy. Como o usuário fura o cache:
- Abrir `im-calculo.vercel.app/?novo` (qualquer query param) → força fetch fresco. **Mais rápido.**
- **Force-quit** do Safari (fechar o app no seletor), não só a aba. Recarregar a aba não basta.
- Aba **anônima** (nunca usa cache) — bom pra validar sem mexer no cache normal.
- `Ajustes → Safari → Limpar Histórico e Dados de Sites` (nuclear).

---

## Checklist ao criar/alterar modal no corretor/cliente mobile

1. Renderizado na raiz do shell (ou portal **com** `.corretor-shell` em volta)? — regra 1+2
2. `overscroll-behavior: contain` + `dvh` na lista rolável? — regra 3
3. Fecha no X **e** no overlay (`onClick` no overlay, `stopPropagation` no content)?
4. Testou no device com **cache furado** (`?novo` ou force-quit), não só pull-to-refresh? — regra 4
