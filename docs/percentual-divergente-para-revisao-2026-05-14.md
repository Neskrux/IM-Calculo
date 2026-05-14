# Percentual de comissão divergente — revisão — 2026-05-14

Você reportou que a venda da **THAINARA (903 A)** estava com o percentual errado. Investiguei e **você está certa** — e o problema não é só nela. Varri todas as vendas e achei **27 vendas** no mesmo caso.

---

## O que está acontecendo

Cada venda tem um percentual de comissão conforme o tipo do corretor:
- **Interno:** 6,5%
- **Externo:** 7,0%

Nessas 27 vendas, **parte das parcelas foi gerada com o percentual errado**. O padrão é quase sempre o mesmo — exemplo da THAINARA:

> 12 parcelas a **7%** (errado) + 49 parcelas a **6,5%** (certo)

As **parcelas mais antigas** (geralmente as que já foram pagas) ficaram no percentual velho; as mais novas foram geradas no percentual certo. Isso indica que a venda foi **cadastrada com um tipo de corretor e depois trocada** — e as parcelas antigas não foram atualizadas junto.

---

## A pergunta que preciso te fazer

Pra cada uma dessas vendas, **qual o percentual correto de verdade?**

- Se a venda **sempre foi interno** (e o 7% foi erro de cadastro) → as parcelas a 7% **pagaram comissão a mais** e precisam ser corrigidas.
- Se a venda **foi vendida como externo e depois reclassificada** → as parcelas a 7% foram pagas corretamente na época, e o histórico fica como está.

**Isso é decisão sua** — eu não tenho como saber qual era o tipo do corretor no momento da venda. Mas pelo que você reportou na THAINARA, parece que o caso é "sempre foi interno, o 7% foi erro".

---

## Grupo 1 — Vendas INTERNO com parcelas a 7% (23 vendas)

Comissão **inflada** — total de **R$ 8.667,74** a mais.

| Cliente | Unidade | Parcelas erradas | Já pagas | A mais |
|---|---|---|---:|---:|
| SIDNEY DE JESUS JUNIOR | 1008 D | **65 (todas!)** | 65 | R$ 1.746,03 |
| LUIZ CARLOS DA SILVA | 1302 A | 12 | 12 | R$ 703,12 |
| MILENA PAULA NASCIMENTO SANTOS | 403 B | 14 | 14 | R$ 440,50 |
| EDSON SANTANA | 1004 B | 10 | 10 | R$ 357,90 |
| JOÃO VICTOR NASCIMENTO DA SILVA WANDREY | 1704 A | 12 | 13 | R$ 353,12 |
| MARIA EDUARDA EVANGELISTA | 504 D | 12 | 12 | R$ 344,71 |
| FRANCISCO DE ASSIS MENDES DE SOUZA | 603 C | 13 | 13 | R$ 342,87 |
| CAIO GORGULHO CAMPOS | 1408 A | 9 | 10 | R$ 339,71 |
| JOSÉ CARLOS PICINELI MALUCELLI JUNIOR | 1707 D | 12 | 12 | R$ 331,38 |
| MARCELO GOMES DA SILVA | 1003 A | 12 | 13 | R$ 326,41 |
| WELMITON FERREIRA GOMES | 804 A | 11 | 11 | R$ 325,57 |
| RENATO CARLOS SILVA DO NASCIMENTO | 710 D | 12 | 13 | R$ 319,80 |
| JISIANE APARECIDA REICHERT | 1505 A | 11 | 11 | R$ 316,77 |
| RAISSA SANTOS FERREIRA | 503 A | 12 | 13 | R$ 314,92 |
| JAMILE KATE MARTINS SANTOS | 709 A | 12 | 12 | R$ 313,28 |
| **THAINARA DA CUNHA KANGERSKI** | **903 A** | 12 | 13 | R$ 305,59 |
| RAIMUNDO SEBASTIAO PORFIRIO BRAGA | 810 D | 11 | 11 | R$ 296,25 |
| MAX EMILIANO DE OLIVEIRA | 509 A | 11 | 11 | R$ 287,59 |
| JOSIAS GRAMINHO MACHADO | 902 D | 12 | 13 | R$ 238,89 |
| GUSTAVO KAUE SAIBERT | 612 A | 12 | 13 | R$ 234,75 |
| CRISTIANO FERRETTI ADRIANO | 1603 B | 13 | 13 | R$ 217,16 |
| FLÁVIO RODOLFO DO NASCIMENTO | 1408 C | 9 | 9 | R$ 182,50 |
| RUAN FERNANDO RICARDO | 1703 A | 1 | 1 | R$ 28,92 |

> Destaque: **SIDNEY DE JESUS (1008 D)** tem **todas as 65 parcelas** a 7% — essa venda nunca foi regenerada, está 100% no percentual errado.

---

## Grupo 2 — Vendas EXTERNO com parcelas a 6,5% (3 vendas)

Comissão **subestimada** — total de **R$ 1.545,16** a menos (a IM pagou comissão a menos pro corretor).

| Cliente | Unidade | Parcelas erradas | Já pagas | A menos |
|---|---|---|---:|---:|
| LEANDRO APARECIDO DO ROSÁRIO | 805 A | 4 | 14 | R$ 725,72 |
| LEANDRO APARECIDO DO ROSÁRIO | 1005 A | 4 | 14 | R$ 547,79 |
| CAROLINE SARAIVA DA SILVEIRA RODRIGUES | 905 B | 3 | 5 | R$ 271,65 |

---

## Caso à parte — TAYARA GUERRA DE BARROS (905 A)

Aparece na varredura mas é **falso alarme** pra esse problema — só 1 das 63 parcelas está divergente. Essa venda tem outro problema já conhecido (o valor do pro-soluto está cadastrado errado, igual ao valor da venda) — está na lista de revisão da rodada b6.

---

## O que eu preciso de você

1. **Confirmar a regra:** essas vendas do Grupo 1 são "sempre foram interno, o 7% foi erro"? (Se alguma foi reclassificada de verdade, me avisa quais.)
2. **Decidir o que fazer com as parcelas já pagas:**
   - **Opção A:** corrigir tudo (pagas e pendentes) pro percentual certo — implica que a IM tem crédito/débito a acertar com os corretores.
   - **Opção B:** corrigir só as parcelas **pendentes** (daqui pra frente) e deixar as pagas como estão (histórico).
3. Pro Grupo 2, mesma pergunta — corrigir tudo ou só pendente?

Quando você decidir, eu preparo a correção. As parcelas pendentes eu corrijo direto; as pagas têm proteção no sistema e precisam do seu OK explícito (mesma regra que protege contra alteração indevida de pagamento auditado).

---

## Resumo

| Grupo | Vendas | Impacto | Status |
|---|---:|---|---|
| Interno a 7% (inflado) | 23 | +R$ 8.667,74 | Aguardando sua decisão |
| Externo a 6,5% (subestimado) | 3 | −R$ 1.545,16 | Aguardando sua decisão |
| TAYARA (falso alarme) | 1 | — | Já na rodada b6 |
