# 🔄 Versionamento de Comissões

## Visão Geral

O sistema de versionamento de comissões permite **alterar percentuais de cargos** sem afetar **vendas já registradas**, mantendo um histórico completo para auditoria.

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│  cargos_empreendimento (percentuais ATUAIS)                     │
│  ─────────────────────────────────────────────────────────────  │
│  id | empreendimento_id | cargo | percentual | vigente_desde   │
│  1  | uuid-figueira     | corretor | 4%      | 2024-01-01      │
│  2  | uuid-figueira     | gerente  | 2%      | 2024-01-01      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (trigger automático)
┌─────────────────────────────────────────────────────────────────┐
│  cargos_empreendimento_historico (LOG de alterações)            │
│  ─────────────────────────────────────────────────────────────  │
│  cargo_id | percentual_anterior | percentual_novo | motivo      │
│  1        | 4%                  | 5%              | "Reajuste"  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 Tabelas

### `cargos_empreendimento` (existente, com novos campos)

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `vigente_desde` | DATE | Data de início da vigência |
| `vigente_ate` | DATE | Data de fim (NULL = vigente) |
| `ativo` | BOOLEAN | Soft delete |
| `updated_at` | TIMESTAMP | Última atualização |
| `updated_by` | UUID | Quem alterou |

### `cargos_empreendimento_historico` (nova)

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | UUID | ID do registro |
| `cargo_id` | UUID | Referência ao cargo |
| `empreendimento_id` | UUID | Referência ao empreendimento |
| `nome_cargo` | TEXT | Nome do cargo na época |
| `tipo_corretor` | TEXT | 'externo' ou 'interno' |
| `percentual_anterior` | NUMERIC | Percentual antes |
| `percentual_novo` | NUMERIC | Percentual depois |
| `alterado_em` | TIMESTAMP | Data/hora da alteração |
| `alterado_por` | UUID | Usuário que alterou |
| `motivo` | TEXT | Justificativa (opcional) |
| `operacao` | TEXT | CREATE, UPDATE, DELETE, REACTIVATE |

---

## 🔄 Fluxo de Alteração

1. **Admin edita empreendimento** no modal
2. **Sistema detecta** quais percentuais mudaram
3. **Exibe alerta** com as alterações detectadas
4. **Solicita motivo** (opcional, mas recomendado)
5. **Ao salvar**, trigger do banco registra no histórico
6. **Vendas antigas** não são afetadas (usam snapshot)

---

## 🎯 Garantias

| Cenário | Comportamento |
|---------|---------------|
| Alterar % do corretor | Novas vendas usam novo %, antigas mantêm antigo |
| Ver venda antiga | Mostra % que estava vigente na época |
| Relatório histórico | Pode consultar % em qualquer data |
| Auditoria | Quem alterou, quando, de quanto para quanto |

---

## 🖥️ Interface

### No modal de Empreendimento

- **Alerta de alterações**: Mostra quais percentuais mudaram
- **Campo de motivo**: Permite justificar a alteração
- **Botão "Ver Histórico"**: Abre modal com timeline

### No card de Empreendimento

- **Ícone de relógio**: Acesso rápido ao histórico

### Modal de Histórico

- **Timeline visual**: Todas as alterações ordenadas
- **Badges coloridos**: CREATE (verde), UPDATE (amarelo), DELETE (vermelho)
- **Motivos**: Exibidos quando disponíveis

---

## 📋 SQL da Migration

A migration `007_versionamento_comissoes.sql` inclui:

1. Campos de vigência em `cargos_empreendimento`
2. Tabela `cargos_empreendimento_historico`
3. Trigger automático para logging
4. View de cargos vigentes
5. Functions auxiliares

---

## 🔒 Snapshots em Vendas

Quando uma venda é criada, os percentuais são **"fotografados"** em:

- `comissoes_venda.percentual_snapshot` - Percentual do cargo
- `comissoes_venda.fator_aplicado` - Fator calculado
- `pagamentos_prosoluto.fator_comissao_aplicado` - Fator por pagamento

Isso garante que **alterações futuras não afetam vendas passadas**.

---

## 🛡️ Regra de Negócio

> **NUNCA recalcule comissões de vendas antigas ao alterar percentuais.**

O fator de comissão salvo em `pagamentos_prosoluto.fator_comissao_aplicado` é **imutável** após a criação da venda.
