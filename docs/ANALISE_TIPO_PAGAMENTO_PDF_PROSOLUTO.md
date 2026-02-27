# Análise: Tipo de pagamento no PDF e Pro-Soluto

## Faz sentido todos aparecerem como "Parc. Entrada"?

**Resposta curta:** Não, em geral não faz sentido *todos* os pagamentos serem "Parc. Entrada". O sistema diferencia vários tipos de pagamento Pro-Soluto. Se no seu relatório só aparece "Parc. Entrada", pode ser (1) os contratos que você está vendo realmente só têm esse tipo, ou (2) há dado antigo/cadastro manual que gravou tudo como parcela de entrada.

---

## 1. Tipos de pagamento Pro-Soluto no sistema

O mapeamento vem do Sienge (e do cadastro manual) e é gravado na tabela `pagamentos_prosoluto` no campo **`tipo`**:

| Valor no banco   | Significado              | Origem Sienge        | Quando aparece no PDF      |
|------------------|--------------------------|----------------------|----------------------------|
| `sinal`          | Sinal                    | AT (Ato), SN (Sinal) | "Sinal"                    |
| `entrada`        | Entrada à vista          | EN (Entrada)         | "Entrada"                  |
| `parcela_entrada`| Parcelas mensais entrada  | PM (Parcelas Mensais)| "Parc. Entrada"            |
| `balao`          | Balão (anual ou B1–B5)   | BA, B1, B2, B3, B4, B5 | "Balão"                 |
| `bens`           | Bens / dação em pagamento| BN (Bens)            | "Bens / Dação"             |

Condições que **não** são Pro-Soluto (e não geram linha nessa tabela): CA (Crédito Associativo), FI (Financiamento), CV (Comissão de Venda).

---

## 2. Onde o tipo é definido

- **Sync Sienge (syncVendasV2.js):**  
  `mapearPaymentConditions` lê as condições do contrato e monta `_condicoes_prosoluto` com `tipo`: `'sinal'`, `'entrada'`, `'parcela_entrada'`, `'balao'` ou `'bens'`.  
  Depois `criarPagamentosProsoluto` insere em `pagamentos_prosoluto` com essa mesma coluna `tipo`.

- **Cadastro manual de venda (AdminDashboard):**  
  Ao criar/editar venda e gerar pagamentos, o código pode estar fixando tipo (ex.: só `parcela_entrada`). Vale revisar os pontos que fazem `insert` em `pagamentos_prosoluto` e garantir que usem o tipo correto (sinal, entrada, parcela_entrada, balao, bens) conforme o que o usuário escolheu.

- **PDF (AdminDashboard – gerarRelatorioPDF):**  
  O relatório lê `pag.tipo` (ou `pag.tipo_pagamento`, se existir) e converte para o texto exibido na coluna "Tipo" usando o mapeamento acima. Ou seja: o PDF só reflete o que está salvo em `tipo`; não inventa "Parc. Entrada".

---

## 3. Por que você pode estar vendo só "Parc. Entrada"

1. **Contratos só com PM no Sienge**  
   Se as vendas que entram no relatório têm, no Sienge, apenas condição PM (Parcelas Mensais), então todos os pagamentos Pro-Soluto dessas vendas são mesmo "Parc. Entrada". Aí faz sentido aparecer só isso para esse conjunto.

2. **Vendas cadastradas manualmente**  
   Se as vendas foram criadas pela tela de admin (sem sync) e o fluxo de "gerar pagamentos" está sempre usando `tipo: 'parcela_entrada'`, então todos esses pagamentos vão aparecer como "Parc. Entrada" no PDF até o cadastro passar a preencher o tipo certo (sinal, entrada, balão, bens).

3. **Dados antigos**  
   Migrações ou imports antigos podem ter preenchido apenas um tipo (ex.: parcela_entrada). Conferir no banco (`SELECT DISTINCT tipo FROM pagamentos_prosoluto`) mostra se há outros tipos ou não.

4. **Campo errado ou nulo**  
   O PDF usa `pag.tipo_pagamento ?? pag.tipo`. Se por algum motivo a coluna lida estiver nula ou com outro nome no select, o fallback pode acabar exibindo um valor padrão; hoje o mapeamento cobre todos os tipos acima e um fallback para qualquer outro valor de `tipo`.

---

## 4. O que foi ajustado no código

- Inclusão do tipo **`bens`** no mapeamento do PDF → exibido como "Bens / Dação".
- "Balao" padronizado para "Balão" (com acento).
- Uso explícito de `pag.tipo_pagamento ?? pag.tipo` e fallback para qualquer valor de `tipo` (ex.: exibir "Entrada" se vier "entrada"), para que nenhum tipo válido fique em branco ou errado.

Assim, sempre que o banco tiver `sinal`, `entrada`, `parcela_entrada`, `balao` ou `bens`, o PDF passa a mostrar o rótulo correto. Se ainda assim **todos** aparecerem como "Parc. Entrada", a causa está nos dados (Sienge só com PM, ou cadastro manual/import sempre gravando esse tipo), não no desenho do relatório.

---

## 5. Como conferir no banco

```sql
SELECT tipo, COUNT(*) 
FROM pagamentos_prosoluto 
GROUP BY tipo 
ORDER BY 2 DESC;
```

Se só existir `parcela_entrada`, então de fato todos os pagamentos estão cadastrados assim e o PDF está coerente com os dados. Se existirem `sinal`, `entrada`, `balao`, `bens` e ainda assim o PDF mostrar só "Parc. Entrada", aí sim seria bug na leitura do tipo no relatório (e com o ajuste acima isso já deve estar corrigido).
