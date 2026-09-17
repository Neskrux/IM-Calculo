# Spec: Visão do beneficiário (Nohros e afins — genérica por cargo)

> Demanda do card "Login Matheus Pires e pessoal da Nohros" (parte 2, 20/08/2026):
> *"a nohros deve ter uma visão totalmente diferente dos corretores"* — métricas macro
> e relatórios com base em cada beneficiário.

## Decisões de negócio (20/08, aprovadas)

1. **O que o beneficiário vê**: a **fatia do próprio cargo** + **macro neutro**
   (nº de vendas ativas, parcelas pagas, % do pró-soluto recebido, vencidas em aberto).
   **Nunca** a fatia dos outros cargos.
2. **Desenho genérico por cargo**: um tipo de acesso `beneficiario` ligado a
   `usuarios.cargo_beneficiario` (nome do cargo em `cargos_empreendimento`).
   Nohros é o 1º usuário; Beton/Ferretti entram sem código novo.

## Comportamento (BDD)

**Cenário 1 — fatia do cargo pelo tipo da venda**
- Dado um usuário `beneficiario` com cargo "Nohros"
- Então cada parcela contribui `comissao_gerada × (pct_Nohros / pct_total)`,
  com `pct_Nohros` do TIPO da venda (externo 0,5 / interno 1,25)
  e `pct_total` do snapshot da parcela (`percentual_comissao_total`)

**Cenário 2 — macro neutro**
- O painel mostra nº de vendas ativas, parcelas pagas/pendentes, % recebido e
  vencidas em aberto (valores de PARCELA) — sem nenhum valor de outro cargo

**Cenário 3 — relatório PDF**
- Botão "Gerar relatório PDF" emite a lista de parcelas pagas do período com a
  fatia do cargo por linha e o total (fonte única: `fatiaCargoDoPagamento`)

**Cenário 4 — cancelada nunca infla**
- Parcela `cancelado` não entra em nenhum número (fatia = 0)

## Peças

| peça | arquivo |
|---|---|
| Tipo + cargo do beneficiário | `migrations/041_usuarios_beneficiario.sql` |
| Fatia por cargo (testada) | `src/utils/comissaoCalculator.js` (`fatiaCargoDoPagamento`) |
| Painel | `src/pages/BeneficiarioDashboard.jsx` |
| PDF | `src/utils/relatorioBeneficiarioPDF.js` |
| Rotas `/beneficiario` | `src/App.jsx` |

## Regras respeitadas

- Totais SEMPRE de `pagamentos_prosoluto` (visualizacao-totais.md).
- Listas paginadas com `fetchAllPaginated` + `.order('id')` e `.in()` fatiado por lote
  (leitura-de-listas-e-refetch.md — o escopo passa de 14k parcelas).
- Cargo Coordenadora reusa a taxa snapshotada por venda (spec relatório coordenadoras).

## Fora de escopo (registrado)

- **RLS**: o acesso beneficiário nasce no mesmo regime dos corretores (RLS off,
  escopo por UI). O gate de segurança é do stream RLS (`feat/rls-fase0`) — quando
  ligar, `beneficiario` precisa de policy própria (leitura de vendas/pagamentos do
  empreendimento, sem PII de cliente).
- Criação do login da Nohros: via botão 🔑 do Admin (edge `admin-corretor-acesso`),
  nunca senha em texto plano por fora.
