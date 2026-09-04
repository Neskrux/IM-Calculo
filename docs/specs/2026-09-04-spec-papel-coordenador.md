# Spec: papel Coordenador na conta do corretor (Pires, Carolina, Jessica)

> **Demanda (04/09/2026):** dar acesso a Matheus Pires, Carolina e Jessica. Os três
> **acumulam papel**: são corretores com carteira própria **e** coordenadores de vendas
> direcionadas. A visão de coordenação é o **macro dessas vendas** + a fatia do cargo
> Coordenadora. Pires está virando coordenador **agora** e hoje tem carteira de
> coordenação **vazia** — a tela precisa dizer isso, não quebrar.

## 0. Estado verificado em produção (04/09/2026, read-only)

Levantado antes de desenhar. Controle negativo aplicado (email inexistente → `[]`).

| Pessoa | `usuarios.id` | cadastro | login | linha em `coordenadoras` | carteira própria | vendas direcionadas |
|---|---|---|---|---|---|---|
| MATHEUS DE S. PIRES | `9b1f5c90…4349` | `corretor` / **interno** / 2,5% | **já tem** (`piresmatheusdesouza@gmail.com`) | **não existe** | 46 (32 internas + 13 **externas**) | **0** |
| Carolina de Oliveira dos Santos Rita | `4c04b405…3c0c` | `corretor` / externo | **não tem** (email é placeholder `corretor.129@sync.local`) | "Carol", 0,50% | 4 | **172** (4 próprias excluídas) |
| Jessica Regina Cararo | `e94de4d7…ab7e` | `corretor` / externo | **já tem** (`jessica@imincorporadora.com.br`) | "Jessica", 1,00% | 1 (distratada) | **12** (1 própria excluída) |

Outros fatos que mudam o desenho:

- Existe um **segundo cadastro do Pires** (`a80c1aa4…3602`, `MEUCNPJ@ACCOUNTTECH.COM.BR`,
  `ativo=false`) com **0 vendas**. É a duplicata inerte; **o id vivo é `9b1f5c90`**.
- O cargo **Coordenadora existe só para `tipo_corretor='externo'`**, 0,50%, num único
  empreendimento (Figueira). Venda interna não tem coordenadora.
- **Todas as 184 vendas direcionadas já têm `vendas.coordenadora_taxa` preenchida** —
  o fallback pela taxa vigente hoje não é exercido por nenhuma venda existente.
- **Nada escreve `coordenadora_taxa` na criação da venda** — só o backfill
  (`scripts/backfill-coordenadora-taxa.mjs`). Venda direcionada nova nasce com snapshot
  NULL. Ver ticket T6.
- Os emails do card não são os do cadastro: `carolina@imincorporadora.com.br` **não existe**
  em `usuarios`; a Jessica está cadastrada como `jessica@`, não `jessicacararo@`. Ver §6.

## 1. A pergunta de desenho: quarto tipo de acesso, `beneficiario`, ou papel?

**Resposta: papel dentro da conta de corretor. Nem tipo novo, nem `beneficiario`.**

Por que **não** um quarto `usuarios.tipo`:

- `tipo` é **coluna única** e decide a rota (`App.jsx` manda `beneficiario` pra `/beneficiario`).
  Marcar os três de coordenador **apagaria a carteira própria deles** — e a saída seria a
  segunda conta, que é exatamente o erro proibido pela restrição 1.

Por que **não** `beneficiario` com `cargo_beneficiario='Coordenadora'`:

- O beneficiário é genérico **por cargo**, e o escopo dele é **o empreendimento inteiro**
  (`BeneficiarioDashboard` carrega todas as vendas ativas dos empreendimentos onde o cargo
  existe). Isso é certo pra Nohros/Beton/Ferretti, que recebem em **toda** venda.
- Coordenação **não é por cargo, é por pessoa**: a fatia da Carol sai de 172 vendas
  específicas, a da Jessica de 12. O nome do cargo não distingue as duas — a Carol veria as
  vendas da Jessica. O que separa é `vendas.coordenadora_id`, que `cargo_beneficiario` não
  carrega.
- E continuaria esbarrando no `tipo` único acima.

O que **se reusa** do beneficiário é o motor, não o tipo de acesso: `fatiaCargoDoPagamento`
já resolve o cargo Coordenadora com a taxa por venda. A spec do beneficiário segue válida e
intocada.

**O vínculo pessoa→coordenação já existe no schema**: `coordenadoras.usuario_id` (migration
030, preenchido na 031 pra Carol). O papel se liga por ele. **Zero migration.**

## 2. Decisão

`usuarios.tipo` continua `'corretor'` para os três. Quem tem linha **ativa** em
`coordenadoras` com `usuario_id = user.id` ganha um **seletor de papel** no próprio
CorretorDashboard — mesma mecânica do toggle que o `AdminDashboard` já usa no relatório.

| papel | escopo das vendas | número principal |
|---|---|---|
| **Corretor** (default) | `corretor_id = eu` (comportamento atual, zero regressão) | fatia do cargo Corretor |
| **Coordenação** | `coordenadora_id = minha` **menos** as que eu vendi | fatia do cargo **Coordenadora** + macro neutro |

Excluir a venda própria do papel de coordenação é regra de negócio já vigente
(migration 031 e spec das coordenadoras): coordenadora não reporta venda que ela mesma
vendeu. Sem isso a Jessica contaria a mesma venda nos dois papéis.

## 3. Comportamento (BDD)

**Cenário 1 — quem vê o seletor**
- Dado um corretor **sem** linha ativa em `coordenadoras`
- Então nenhum seletor de papel aparece e a tela é exatamente a de hoje

**Cenário 2 — papel Coordenação**
- Dado que a Carolina troca o papel para "Coordenação"
- Então a tela passa a mostrar as vendas direcionadas a ela, **sem** as 4 que ela vendeu
- E o número principal é `comissao_gerada × (taxa_coordenadora / percentual_comissao_total)`

**Cenário 3 — taxa histórica manda**
- Dada uma venda direcionada com `coordenadora_taxa = 1,0` (contrato pré-cutover 15/07/2025)
- Então a fatia usa 1,0 mesmo que `coordenadoras.percentual_padrao` valha 0,5 hoje
- E a taxa vigente só entra quando o snapshot é NULL

**Cenário 4 — carteira de coordenação vazia (Pires)**
- Dado um coordenador com zero vendas direcionadas
- Então a tela mostra "Nenhuma venda direcionada a você ainda" com uma frase explicando
  que os números aparecem quando o Admin direcionar vendas
- E **não** mostra R$ 0,00 mudo, nem erro, nem tela em branco

**Cenário 5 — cancelada nunca infla**
- Parcela `cancelado` não entra em nenhum número da coordenação (fatia = 0)

**Cenário 6 — distratada fora**
- Venda distratada não entra na coordenação, pela mesma régua única das telas do corretor
  (`isVendaAtiva`, spec 2026-08-28)

**Cenário 7 — o papel não vaza**
- No papel Coordenação nenhum número da fatia do cargo **Corretor** de outra pessoa é
  exibido; e no papel Corretor nada da coordenação aparece

**Cenário 8 — multi-tipo do Pires segue intacto**
- As 13 vendas externas dele continuam pagando fatia de corretor pela taxa do tipo **da
  venda** (4%), não pela do cadastro (2,5%) — `percentualCorretorDaVenda`, já testado

## 4. Peças

| peça | arquivo | novo? |
|---|---|---|
| `coordenadoraDoUsuario`, `papeisDisponiveis`, `vendasDaCoordenacao`, `resumoCoordenacao` | `src/utils/comissaoCalculator.js` | **novo (puro, testado)** |
| Testes | `src/utils/comissaoCalculator.test.js` | novo |
| Seletor de papel + painel de coordenação | `src/pages/CorretorDashboard.jsx` | altera |
| Fatia por cargo | `fatiaCargoDoPagamento` | reusa |
| Taxa por venda | `taxaCoordenadoraDaVenda` | reusa |
| Vínculo pessoa→coordenação | `coordenadoras.usuario_id` (migr. 030/031) | reusa |
| Criação de login | edge `admin-corretor-acesso` (botão 🔑) | reusa |

**Toda regra de negócio nasce em helper puro** — o componente só monta a tela com o que o
helper devolveu. Nada de conta dentro de JSX.

## 5. Regras respeitadas

- Totais **sempre** de `pagamentos_prosoluto` (`visualizacao-totais.md`). A taxa decide só a
  **proporção** da fatia, nunca recalcula comissão.
- Snapshot > vigente (`fator-comissao.md`).
- Listas paginadas com `fetchAllPaginated` + `.order('id')` e `.in()` fatiado por lote
  (`leitura-de-listas-e-refetch.md`) — a coordenação da Carol são 172 vendas, milhares de
  parcelas.
- Régua única das telas do corretor: `isVendaAtiva` (spec 2026-08-28).
- `usuarios.id` é a identidade; login só pela edge, nunca pelo painel do Supabase.

## 6. Decisões que precisam do Jonas (bloqueiam produção, não o código)

1. **Email da Jessica**: o cadastro é `jessica@imincorporadora.com.br` e ela **já tem
   login**. O card diz `jessicacararo@`. Manter o atual ou trocar?
2. **Email da Carolina**: cadastro tem placeholder de sync. Criar o acesso com
   `carolina@imincorporadora.com.br` reusando o id `4c04b405…3c0c` — confirmar que a
   Carolina do card é a "Carolina de Oliveira dos Santos Rita" (existe outra Caroline no
   banco, `CAROLINE CRISTINA PERES SUDRE`, que **não** é a coordenadora).
3. **Taxa do Pires como coordenador** (`coordenadoras.percentual_padrao`): 0,50% como a
   Carol, 1,00% como a Jessica, ou outra? Sem isso a linha dele não é criada.
4. **Cadastro duplicado do Pires** (`a80c1aa4`, inativo, 0 vendas): deixar como está ou
   limpar? Não bloqueia — só é ruído.

## 7. Fora de escopo (registrado)

- **RLS**: o papel nasce no mesmo regime dos corretores (RLS off, escopo por UI). Quando o
  `feat/rls-fase0` ligar, coordenação precisa de policy própria: ler vendas e parcelas onde
  `coordenadora_id` pertence a uma linha de `coordenadoras` com `usuario_id = auth.uid()`,
  sem PII do cliente além do que o corretor já vê.
- **PDF de coordenação**: o `relatorioBeneficiarioPDF` já emite fatia por cargo. Fica pra
  uma segunda passada, depois que a tela estiver no ar.
- **Rótulo "Sua Comissão (X%)"** do CorretorDashboard usa o percentual do cadastro
  (2,5% pro Pires) mesmo em venda externa. Só o rótulo — o dinheiro já sai certo por
  `percentualCorretorDaVenda`. Bug pré-existente, anotado, não corrigido aqui.
- Escrever `coordenadora_taxa` na criação da venda (ticket T6) — depende da decisão 3.
