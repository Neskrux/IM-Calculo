# Features futuras — Visão do Corretor (mapa pra fazer depois)

> Documento **separado** do backlog principal ([`visao-corretor-pontos.md`](./visao-corretor-pontos.md)).
> Aqui ficam features que valem a pena mas têm **escopo próprio** — mapear e construir depois, fora da rodada atual de coleta.
> **Nota do usuário (2026-06-09):** construir essas features **usando skills**.

---

## Feature A — Notificações pro corretor

**Origem:** Ponto 8 / Lacuna 3 do backlog principal (movida pra cá por ser feature à parte).

**Objetivo:** avisar o corretor de eventos relevantes sem ele precisar ficar conferindo o sistema.

**Eventos candidatos:**
- Comissão paga — parcela do cliente baixada (`income`) → comissão do corretor referente àquela parcela "liberada".
- Solicitação aprovada / reprovada (fluxo de Solicitações).
- Parcela vencida / próxima do vencimento.

**A decidir:**
- Canais: in-app (central/badge), e-mail, WhatsApp — quais?
- Quais eventos realmente importam pro corretor (não virar spam).
- Tempo real (Supabase realtime) × batch (cron diário).
- Opt-in/opt-out por canal.

**Status:** 🗺️ a mapear/spec depois.

---

## Feature B — Acesso ao PDF do contrato da venda / detalhe da unidade

**Origem:** Ponto 8 (menores) do backlog principal (movida pra cá).

**Objetivo:** o corretor abrir o **PDF do contrato** da venda e ver o **detalhe da unidade** direto na visão dele.

**A mapear:**
- De onde vem o PDF do contrato? (Sienge? storage? gerado on-the-fly?)
- Detalhe da unidade: quais campos exibir (bloco, área, tipologia, valor de tabela, etc.)?
- Permissão: corretor só acessa contratos/unidades das **vendas dele**.

**⚠️ Dependência de segurança:** se o PDF do contrato vier do bucket `documentos`, ele está **hoje exposto** (ver Ponto 5 do backlog: bucket público + RLS allow-all). **Servir via signed URL** e corrigir o storage **antes** de expor contratos na visão do corretor.

**Status:** 🗺️ a mapear/spec depois.

---

## Observações gerais
- Ambas as features dependem de decisões de produto, então ficam fora da rodada de **correção de bugs** (Pontos 1, 2, 3, 5 do backlog principal).
- Sugestão de ordem: resolver bugs + segurança (backlog principal) primeiro; features A/B depois, possivelmente cada uma com sua própria skill.
