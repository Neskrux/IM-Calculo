# Análise: Relatório para Coordenadora (Ganho de Coordenadoras)

## 1. Quem são os coordenadores no banco?

### Identificação atual

| Tabela | Campo | Como identificar coordenador |
|--------|-------|------------------------------|
| `usuarios` | `cargo_id` | FK para `cargos_empreendimento.id` |
| `cargos_empreendimento` | `nome_cargo` | Ex: "Coordenadora", "Coordenador" |

**Query para listar coordenadores (interno e externo):**

```sql
SELECT u.id, u.nome, u.email, u.tipo_corretor, c.nome_cargo, e.nome as empreendimento
FROM usuarios u
JOIN cargos_empreendimento c ON c.id = u.cargo_id
LEFT JOIN empreendimentos e ON e.id = u.empreendimento_id
WHERE u.tipo = 'corretor'
  AND (LOWER(c.nome_cargo) LIKE '%coordenador%' OR LOWER(c.nome_cargo) LIKE '%coordenadora%')
ORDER BY u.nome;
```

**Observação:** Não existe `tipo: 'coordenador'` em `usuarios`. Coordenadores são corretores com `cargo_id` apontando para um cargo cujo `nome_cargo` contém "Coordenador(a)".

---

## 2. De onde vem o ganho da coordenadora?

| Fonte | Descrição | Onde está no sistema |
|-------|-----------|----------------------|
| **1. Como corretor** | Vendas que ela fez (`corretor_id = ela`) | CorretorDashboard, `meusPagamentos` |
| **2. Como cargo Coordenadora** | 0,5% sobre vendas de **outros** corretores no empreendimento | `calcularComissaoPorCargoPagamento`, `comissoes_venda` |

O ganho (2) é calculado por parcela em `pagamentos_prosoluto`, usando o fator do cargo "Coordenadora" do empreendimento.

---

## 3. O relatório atual funciona 100% para coordenadora?

### CorretorDashboard (relatório do corretor logado)

| Aspecto | Funciona? | Detalhe |
|---------|-----------|---------|
| Vendas próprias (ela como corretor) | ✅ Sim | `fetchVendas` filtra `corretor_id = user.id` |
| Pagamentos das vendas próprias | ✅ Sim | `meusPagamentos` = pagamentos das vendas do corretor |
| Comissão do cargo Corretor | ✅ Sim | `calcularComissaoPagamento` usa `comissao_gerada` ou fator do corretor |
| **Comissão do cargo Coordenadora** (vendas de outros) | ❌ **Não** | Não há busca de vendas onde ela recebe como coordenadora |

**Conclusão:** O CorretorDashboard **não inclui** o ganho da coordenadora como cargo (0,5% sobre vendas da equipe). Só mostra o ganho como corretor.

---

### AdminDashboard (relatório admin)

| Filtro | Funciona? | Observação |
|--------|-----------|------------|
| Corretor | ✅ Sim | Filtra por `corretor_id` da venda |
| Empreendimento | ✅ Sim | Filtra por `empreendimento_id` |
| Cargo (ex: Coordenadora) | ✅ Sim | Soma apenas a parcela daquele cargo por pagamento |
| Status (pago/pendente) | ✅ Sim | Filtra por `pagamentos_prosoluto.status` |
| Data início/fim | ✅ Sim | Filtra por `venda.data_venda` |
| Venda específica | ✅ Sim | Filtra por `venda_id` |

**Problema:** O filtro de **Corretor** filtra vendas onde `corretor_id = corretor selecionado`. Se o admin filtrar por "Corretor: Maria (Coordenadora)", ele vê só as vendas que **Maria fez** como corretor. O ganho dela como **Coordenadora** (vendas de outros) **não** aparece nesse filtro.

Para ver o ganho da coordenadora como cargo, o admin precisa:
1. **Não** filtrar por corretor (ou filtrar por outro corretor)
2. Filtrar por **Empreendimento** onde ela tem cargo
3. Filtrar por **Cargo: Coordenadora**

Isso mostra o **total** daquele cargo no empreendimento, mas **não** vincula ao usuário coordenadora específica — o sistema não sabe qual usuário é coordenadora de qual empreendimento.

---

## 4. Gaps identificados

| # | Gap | Impacto |
|---|-----|---------|
| 1 | **CorretorDashboard** não busca ganho do cargo Coordenadora | Coordenadora não vê seu ganho completo no relatório |
| 2 | **Sem vínculo usuário → cargo por empreendimento** | Não há como saber "Maria é coordenadora do Empreendimento X" para filtrar só o ganho dela |
| 3 | **Admin relatório** com Corretor + Cargo | Se filtrar por corretor (coordenadora), não mostra o ganho dela como cargo; se filtrar por cargo, mostra o total do cargo, não por usuário |
| 4 | **Filtros combinados** | Corretor + Empreendimento + Cargo pode gerar cenários vazios ou confusos |

---

## 5. Fluxo de dados (resumo)

```
Admin Relatório:
  fetchData() → vendas, pagamentos, corretores, empreendimentos
  → Agrupa por venda (grupos com pagamentos)
  → Aplica filtros (corretor, emp, cargo, status, data, venda)
  → calcularComissaoPorCargoPagamento(pag) para cada cargo
  → Totais: soma por cargo ou por percentual corretor

Corretor Relatório:
  fetchVendas() → vendas onde corretor_id = user.id
  fetchMeusPagamentos() → pagamentos onde venda_id in vendas do corretor
  → Filtros: empreendimento, status, data
  → calcularComissaoPagamento(pag) = comissão do CORRETOR da venda
  → NÃO considera cargo do usuário logado
```

---

## 6. Recomendações para o relatório funcionar 100%

### Passo 1: Identificar coordenadores no banco
- Query SQL acima para listar usuários com cargo Coordenador(a)
- Validar se `cargo_id` e `empreendimento_id` estão corretos

### Passo 2: CorretorDashboard para coordenadora
- Se `userProfile.cargo_id` → cargo com nome "Coordenador(a)":
  - Buscar vendas do empreendimento onde ela tem cargo (corretor_id ≠ ela)
  - Para cada pagamento dessas vendas, extrair a parcela do cargo "Coordenadora"
  - Somar ao total dela

### Passo 3: Admin relatório "por coordenador"
- Novo filtro: "Coordenador" (lista de usuários com cargo coordenadora)
- Ao selecionar: filtrar vendas do empreendimento dela e somar apenas a parcela do cargo Coordenadora

### Passo 4: Validação dos filtros
- Testar todos os cenários: Corretor, Empreendimento, Cargo, Status, Data, Venda
- Garantir que combinações não retornam dados incorretos ou vazios indevidamente

---

## 7. Checklist de validação

- [ ] Corretor comum: relatório mostra só vendas dele
- [ ] Coordenadora: relatório mostra vendas dela + ganho dela como cargo Coordenadora
- [ ] Admin filtro Corretor: mostra vendas daquele corretor
- [ ] Admin filtro Cargo Coordenadora: mostra total daquele cargo (sem filtro de corretor)
- [ ] Admin filtro Corretor + Cargo: combinação coerente (ex: quando ambos se aplicam)
- [ ] Filtros de data: aplicados corretamente em data_venda
- [ ] Filtros de status: aplicados em pagamentos (pago/pendente)
