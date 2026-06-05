# `docs/` — mapa e regras de organização

> Limpeza 2026-06-05: de **92 MB / 204 arquivos** → **4 MB / 144 arquivos**.
> Dumps RAW regeneráveis foram descartados (e bloqueados no `.gitignore`); histórico preservado em `historico/`.

## Onde fica o quê

| Pasta | Propósito | Regra |
|---|---|---|
| **`contexto/`** | Conhecimento **vivo** — para onde estamos indo | Só docs canônicos atuais. Versão velha → `historico/contexto-superado/` |
| **`controladoria/`** | Relatórios **oficiais do Sienge** + planilhas enviadas | Fonte de verdade externa. Nunca descartar. |
| **`rodadas/`** | Rodadas "b" **abertas** (aguardando gestora) | Fechou? → `historico/rodadas-fechadas/` |
| **`historico/`** | Tudo aplicado/fechado/superado, **sem dumps** | Valor de auditoria. Não está no caminho do dia a dia. |

## Os 4 documentos vivos (`contexto/`)

1. **`2026-06-01-north-star-reconciliacao.md`** — North Star #1: banco = espelho fiel do Sienge (os 3 baldes).
2. **`2026-06-05-north-star-2-tres-termos-DEFINITIVO.md`** — North Star #2: distrato, aditivo, cessão (dado real conferido).
3. **`2026-06-05-mapa-3-termos.json`** — mapa nominal máquina-legível dos 3 termos (insumo da aplicação).
4. **`2026-06-01-documento-mestre-reconciliacao.md`** — índice mestre da reconciliação.

## Estrutura de `historico/`

```
historico/
  contexto-superado/   docs de narrativa substituídos por versão nova
  rodadas-fechadas/    b5, b6, b7, b8 (aplicadas)
  aplicacoes/          logs *-aplicado (o que foi escrito em produção)
  auditorias/          .md de decisão + json de auditoria (sem dumps)
  specs/               specs técnicas antigas (várias viraram .claude/rules)
  archive/             arquivo morto pré-existente
```

## Regra de ouro

- **Dump RAW do bulk Sienge** (universo, income-raw, fase0/fase5) → **não versionar**. Regenera sob demanda; já bloqueado no `.gitignore`.
- **Dry-run** → efêmero, pode descartar. **Aplicado** → arquivar em `historico/aplicacoes/`.
- **Relatório oficial do Sienge** (controladoria) → manter sempre.
- Doc de narrativa novo **supera** o velho → move o velho pra `historico/contexto-superado/`, não acumula versões em `contexto/`.
