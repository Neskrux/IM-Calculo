# Spec: rastreio de relatórios e divergência descoberta depois do envio

> **Origem:** pedido do owner em 06/08/2026. Formaliza a feature que o
> [BDD de 03/07](2026-07-03-BDD-geracao-relatorios.md) já listava como
> *"Mudança de caso → reenviar corrigido — ❌ construir"*, e que nunca saiu do papel.

---

## 1. O problema, com o caso real que o provou

Em **04/08/2026** o corretor Carlos Bruno puxou o relatório de julho e viu a unidade 710 A repetida
dezenas de vezes. Era baixa em massa de um distrato que o banco não sabia que existia: **R$ 12.665,94**
de comissão fantasma na fatia dele.

O relatório do **Matheus Pires** tinha o mesmo defeito (404 A, R$ 11.199,22) — e **ele não reclamou**,
porque não abriu. Os dois foram curados em 04/08.

Três perguntas que hoje **não têm resposta no sistema**:

1. **Quem já puxou relatório de julho?** (quem viu o número errado)
2. **Quais desses relatórios ficaram desatualizados** depois de uma cura em produção?
3. **Qual o delta** — quanto o número mudou entre o que foi visto e o que é verdade hoje?

Sem isso, a descoberta depende de o corretor reclamar. Foi assim nos dois casos: um reclamou, o outro não.

---

## 2. O que registrar

### 2.1 Evento de geração

Toda geração de relatório (corretor no próprio dashboard **e** controladoria no Admin) grava uma linha:

```jsonc
{
  "id": "uuid",
  "gerado_em": "timestamptz",
  "gerado_por": "uuid do usuário que clicou",
  "para_corretor_id": "uuid",          // controladoria gera por outro; corretor gera pra si
  "origem": "corretor_dashboard | admin_pdf",
  "periodo_inicio": "date",
  "periodo_fim": "date",
  "filtro_cargo": "Corretor | Total | ...",
  "total_comissao": "numeric",          // o número que a pessoa VIU
  "total_parcelas": "int",
  "parcela_ids": ["uuid", "..."],       // ⚠️ a chave de tudo — ver 2.2
  "hash_conteudo": "sha256 das linhas"  // detecta mudança sem diff linha a linha
}
```

### 2.2 Por que `parcela_ids` é o coração da feature

É o que transforma "relatório antigo" em **"relatório afetado por esta cura específica"**.

Sem a lista, só dá pra dizer "algo mudou no mês". Com ela, a pergunta vira uma interseção:

> as 55 parcelas que acabei de cancelar aparecem em quais relatórios já emitidos?

No caso do Carlos Bruno a resposta seria imediata: *relatório de 04/08, 55 das 110 canceladas estavam
nele, delta −R$ 12.665,94*.

### 2.3 Recomputar sob demanda, nunca guardar "o certo"

O sistema **não** guarda uma segunda versão do relatório. Guarda o que foi visto (`total_comissao`,
`hash_conteudo`, `parcela_ids`) e recomputa o valor atual quando perguntado. Assim o delta é sempre
contra a verdade de agora, sem cache pra envelhecer.

---

## 3. Como detectar divergência

Um relatório está **desatualizado** quando qualquer parcela do `parcela_ids` teve, depois do `gerado_em`:

| mudança | efeito típico |
|---|---|
| `status` pago → cancelado | cura de distrato / duplicata → **valor cai** |
| `status` pendente → pago | baixa nova entrou → valor sobe (se estiver no período) |
| `comissao_gerada` alterada | correção de fator |
| `data_pagamento` alterada | pode **sair ou entrar** do filtro de período |
| venda vira `status='distrato'` | a venda inteira sai do relatório |

Como `pagamentos_prosoluto` tem `updated_at`, a detecção é uma query — não precisa de trigger nem de
tabela de auditoria nova:

```sql
-- relatórios cujo conteúdo mudou depois de gerados
select r.id, r.para_corretor_id, r.gerado_em, r.total_comissao as visto,
       count(*) filter (where p.updated_at > r.gerado_em) as parcelas_alteradas
from relatorios_gerados r
join pagamentos_prosoluto p on p.id = any(r.parcela_ids)
group by r.id having count(*) filter (where p.updated_at > r.gerado_em) > 0;
```

---

## 4. Onde isso aparece (a parte que o owner pediu)

### 4.1 Aba/filtro no Admin — "Relatórios a reenviar"

Lista, por corretor e mês:

| corretor | período | gerado em | valor visto | valor hoje | delta | parcelas alteradas |
|---|---|---|---|---|---|---|
| Carlos Bruno | jul/2026 | 04/08 14:40 | R$ 21.013,76 | R$ 8.347,70 | **−R$ 12.666,06** | 55 |

Ações: **marcar como reenviado** · **ver o que mudou** (as parcelas e o motivo do cancelamento).

Isso é o que permite a controladoria resolver sozinha — hoje ela depende de alguém cruzar isso na mão.

### 4.2 Badge no corretor

Se o último relatório que ele puxou está desatualizado: *"os números deste período mudaram desde a sua
última consulta"*. Evita que ele cobre com um PDF velho na mão.

### 4.3 Métrica que o BDD já pedia

*"registra quanto valor errado já saiu"* — soma dos deltas negativos de relatórios emitidos e ainda não
reenviados. É o termômetro honesto de exposição.

---

## 5. Por que isso vale mais lá na frente

O fluxo roda **~60 meses até 2030**. Cada cura em produção (distrato, aditivo, fator, drift de data)
potencialmente invalida relatório já entregue. Hoje o custo de descobrir isso é uma reclamação de
corretor; com o rastreio, é uma linha numa lista.

E resolve a contradição registrada em [fator-comissao.md](../../.claude/rules/fator-comissao.md), que
afirma *"nenhum relatório foi repassado aos corretores pelo sistema"* — foi, e com fantasma. Com o
registro, essa afirmação deixa de ser memória e vira dado.

---

## 6. Escopo mínimo (o que dá pra fazer primeiro)

1. **Tabela + gravação no clique.** Sem UI nenhuma. A partir do dia 1 já existe histórico — e histórico
   não se cria retroativamente.
2. Query de divergência rodando no cron, como o detector de distrato-stale: read-only, sai no log.
3. Aba no Admin.
4. Badge no corretor.

O passo 1 é barato e é o que **não dá pra recuperar depois**. Todo dia sem ele é um dia de histórico
perdido.

---

## 7. Ressalva de RLS

`relatorios_gerados` guarda quem viu o quê. Nasce com RLS ligada e policy por `corretor_id` — corretor vê
só os próprios; admin vê todos. Não repetir o padrão das tabelas atuais (RLS desligada com GRANT pra
`anon`), senão a tabela de auditoria vira a mais exposta do banco.
