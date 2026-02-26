# Análise: Geração do Relatório em PDF e Filtros

Foco na tela **Gerar Relatório em PDF** do Admin (Relatórios), com todos os filtros disponíveis e como cada um impacta o PDF gerado.

---

## 1. Onde está o código

| Item | Arquivo | Observação |
|------|---------|------------|
| Estado dos filtros | `AdminDashboard.jsx` | `relatorioFiltros` (linhas ~156–166) e `buscaCorretorRelatorio` |
| UI dos filtros | `AdminDashboard.jsx` | ~6182–6410 (seção `activeTab === 'relatorios'`) |
| Geração do PDF | `AdminDashboard.jsx` | `gerarRelatorioPDF()` a partir de ~3006 |
| Cálculo por cargo | `AdminDashboard.jsx` | `calcularComissaoPorCargoPagamento()` ~441 |

---

## 2. Filtros disponíveis na UI

| Filtro | Estado | Opções / Comportamento |
|--------|--------|------------------------|
| **Buscar corretor por nome** | `buscaCorretorRelatorio` | Campo de texto; filtra a lista do dropdown **Corretor** (não altera dados sozinho). |
| **Corretor** | `relatorioFiltros.corretorId` | `''` = Todos os corretores; senão UUID do corretor. Ao mudar: zera `empreendimentoId` e `vendaId`. |
| **Empreendimento** | `relatorioFiltros.empreendimentoId` | `''` = Todos (ou “Todos os empreendimentos (N)” se há corretor); senão UUID. Se há corretor, lista só empreendimentos em que ele tem vendas. Ao mudar: pode resetar `cargoId` se o cargo não existir no novo empreendimento; zera `vendaId`. |
| **Status** | `relatorioFiltros.status` | `'todos'` \| `'pendente'` \| `'pago'`. |
| **Beneficiário / Cargo** | `relatorioFiltros.cargoId` | Só visível se `empreendimentoId` estiver preenchido. `'Corretor'` (padrão), `''` (Todos os cargos) ou nome do cargo do empreendimento. |
| **Venda Específica** | `relatorioFiltros.vendaId` | `''` = Todas as vendas (com contagem); senão UUID da venda. Lista já considera corretor e empreendimento. |
| **Data Início** | `relatorioFiltros.dataInicio` | `input type="date"` (string YYYY-MM-DD). |
| **Data Fim** | `relatorioFiltros.dataFim` | `input type="date"` (string YYYY-MM-DD). |

**Limpar Filtros:** restaura `relatorioFiltros` (incl. `cargoId: 'Corretor'`, `empreendimentoId: ''`, etc.) e `buscaCorretorRelatorio: ''`.

---

## 3. Como cada filtro é aplicado no PDF

A função `gerarRelatorioPDF` parte de:

- **Fonte de dados:** `listaVendasComPagamentos` (vendas com pagamentos agrupados); se vazio, monta grupos a partir de `vendas` com `pagamentos: []`.
- **Variável trabalhada:** `dadosFiltrados`, que começa como cópia dessa lista e depois sofre cada filtro em sequência.

Resumo do efeito de cada filtro **nos dados** que entram no PDF:

### 3.1 Corretor (`corretorId`)

- **Onde:** Filtro em `dadosFiltrados` por `g.venda?.corretor?.id || g.venda?.corretor_id` igual a `relatorioFiltros.corretorId`.
- **Efeito:** Só entram vendas daquele corretor.
- **No PDF:** Cabeçalho pode mostrar o nome do corretor e “Corretor Interno/Externo”; resumo executivo lista “EMPREENDIMENTOS” quando há corretor selecionado; nome do arquivo pode incluir o nome do corretor.

### 3.2 Empreendimento (`empreendimentoId`)

- **Onde:** Filtro por `g.venda?.empreendimento?.id || g.venda?.empreendimento_id` igual a `relatorioFiltros.empreendimentoId`.
- **Efeito:** Só vendas daquele empreendimento.
- **No PDF:** Não muda estrutura; apenas reduz as vendas/parcelas listadas.

### 3.3 Venda Específica (`vendaId`)

- **Onde:** `dadosFiltrados = dadosFiltrados.filter(g => g.venda_id === relatorioFiltros.vendaId)`.
- **Efeito:** Uma única venda (e seus pagamentos).
- **No PDF:** Relatório de uma venda só.

### 3.4 Status (`status`)

- **Onde:** Se `relatorioFiltros.status !== 'todos'`:
  - Com `listaVendasComPagamentos`: para cada grupo, filtra `g.pagamentos` por `p.status === relatorioFiltros.status` e depois remove grupos sem pagamentos.
  - Sem pagamentos agrupados: filtra por `g.venda?.status === relatorioFiltros.status`.
- **Efeito:** Só parcelas (ou vendas) com status “pago” ou “pendente”.
- **No PDF:** Totais e tabela de parcelas refletem só esse status; nome do arquivo pode incluir `_pago` ou `_pendente`.

### 3.5 Data Início / Data Fim (`dataInicio`, `dataFim`)

- **Onde:** Se pelo menos um dos dois está preenchido:
  - Com pagamentos: filtra **parcelas** por `data_prevista` dentro do intervalo (início 00:00:00, fim 23:59:59 no dia).
  - Sem pagamentos: filtra **vendas** por `data_venda`.
- **Efeito:** Reduz vendas/parcelas ao período; grupos podem ficar com menos parcelas ou vazios (e são removidos se `pagamentos.length === 0`).
- **No PDF:** Seção “Filtros” mostra “Período: dd/mm/aaaa a dd/mm/aaaa”.

### 3.6 Beneficiário / Cargo (`cargoId`)

- **Não filtra linhas:** As **vendas e parcelas** que entram no PDF são as mesmas; o filtro de cargo **não** remove nenhuma venda nem parcela.
- **Altera valores exibidos:**
  - **Totais (cards e resumo):**  
    Se `cargoId` está preenchido, os totais “Comissão total”, “Paga” e “Pendente” usam apenas o valor do **cargo selecionado** (via `calcularComissaoPorCargoPagamento` e `cargoEncontrado.valor`).  
    Se `cargoId` está vazio e há corretor selecionado com `percentual_corretor`, usa esse percentual sobre o valor da parcela.  
    Senão, usa `comissao_gerada` de cada pagamento.
  - **Tabela de parcelas (por venda):**  
    Para cada parcela, a coluna “Comissão” e o “%” mostram:
    - Com `cargoId` preenchido: valor e percentual **daquele cargo** (proporção do cargo no total de comissão da parcela).
    - Com `cargoId` vazio e corretor com percentual: valor e % do corretor.
    - Caso contrário: `comissao_gerada` e percentual derivado.
- **Resumo:** O filtro de cargo **muda apenas o que se considera “comissão”** (qual beneficiário/cargo), não o conjunto de vendas/parcelas.

---

## 4. Ordem de aplicação dos filtros no código

1. Montagem de `dadosFiltrados` (lista de grupos venda + pagamentos).
2. Filtro por **corretor**.
3. Filtro por **empreendimento**.
4. Filtro por **venda específica**.
5. Filtro por **status** (em parcelas ou em venda).
6. Filtro por **data início/fim** (em `data_prevista` ou `data_venda`).

Depois disso, com `dadosFiltrados` já definido:

- Cálculo dos **totais** (e cards) considera **cargo** (e, se não houver cargo, percentual do corretor ou `comissao_gerada`).
- Para cada grupo, a **tabela de parcelas** usa o mesmo critério de cargo/percentual/comissão para preencher a coluna de comissão e %.

---

## 5. Texto “Filtros” no PDF

Na caixa “FILTROS” do PDF entram (quando aplicável):

- Corretor: nome.
- Empreend.: nome.
- Status: “Pago” ou “Pendente” (só se ≠ todos).
- Cargo: valor de `cargoId` (ex.: “Corretor” ou nome do cargo).
- Período: Data Início e Data Fim formatadas em pt-BR.

**Venda específica** não aparece explicitamente no texto de filtros; o efeito é apenas ter um único grupo em `dadosFiltrados`.

---

## 6. Possíveis inconsistências / melhorias

1. **“Todos os cargos”**  
   Com `cargoId === ''`, o PDF usa `comissao_gerada` (ou percentual do corretor). Ou seja, não mostra “soma de todos os beneficiários” por parcela; mostra um único valor por parcela. Se a expectativa for “relatório por todos os cargos”, hoje não existe essa visão (por exemplo, uma linha por cargo por parcela).

2. **Cargo sem empreendimento**  
   O dropdown de cargo só aparece com empreendimento selecionado. O estado inicial é `cargoId: 'Corretor'`. Se o usuário escolher empreendimento e depois “Todos os cargos”, o cargo volta a ser usado como descrito acima (comissão exibida = `comissao_gerada`/percentual corretor).

3. **Data e tipo de dado**  
   Filtro de data usa `data_prevista` nos pagamentos e `data_venda` nas vendas. Para relatório “por venda”, usar só `data_venda` pode ser mais intuitivo; hoje, com pagamentos, o corte é por data da parcela.

4. **Nome do arquivo**  
   O nome do PDF não inclui empreendimento, venda específica nem cargo; só corretor (quando selecionado) e status. Incluir período e/ou empreendimento no nome pode ajudar a organizar os arquivos.

5. **Venda sem pagamentos**  
   Quando a fonte é `listaVendasComPagamentos`, vendas sem pagamentos não entram. Quando se usa só `vendas`, os grupos são montados com `pagamentos: []`; a tabela de parcelas fica vazia para essas vendas. O filtro de **status** (pago/pendente) pode zerar parcelas e remover o grupo; isso está alinhado com “só parcelas com esse status”.

---

## 7. Resumo por filtro (efeito no PDF)

| Filtro | Reduz vendas/parcelas? | Altera valores (comissão)? | Aparece na caixa “Filtros”? |
|--------|------------------------|----------------------------|-----------------------------|
| Busca corretor (texto) | Não (só filtra o dropdown) | Não | Não |
| Corretor | Sim | Indiretamente (percentual corretor quando cargo vazio) | Sim |
| Empreendimento | Sim | Não | Sim |
| Status | Sim (só parcelas/vendas com aquele status) | Não | Sim |
| Beneficiário/Cargo | Não | Sim (totais e coluna Comissão/% por parcela) | Sim |
| Venda Específica | Sim (uma venda) | Não | Não |
| Data Início/Fim | Sim (por data de parcela ou venda) | Não | Sim |

---

## 8. Conclusão

A geração do PDF no Admin aplica de forma consistente os filtros **Corretor, Empreendimento, Venda Específica, Status e Data** sobre o conjunto de vendas/parcelas. O filtro **Beneficiário/Cargo** não altera esse conjunto, mas define **qual comissão** (qual cargo) é usada nos totais e em cada linha da tabela de parcelas. A “busca por nome” do corretor só afeta a escolha no dropdown, não os dados do relatório. Para relatórios ainda mais claros, vale considerar: incluir “Venda específica” e “Período” no nome do arquivo e documentar que “Todos os cargos” exibe um único valor por parcela (não a soma de todos os cargos).
