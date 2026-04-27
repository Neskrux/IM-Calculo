# Regra: Rodadas "b" — Revisão Humana de Casos Delicados

## Princípio

Quando um script automatizado encontra caso onde a decisão **não é mecânica** (drift suspeito, ambiguidade entre Sienge e local, dado faltando que precisa de contexto humano), o script **NÃO decide**. Gera artefato pra gestora resolver.

Esses artefatos seguem formato canônico chamado "rodada b" (b1, b2, ..., b6, b7, ...). Cada rodada é uma fila de casos pendentes, ciclada sequencialmente.

---

## Naming canônico

```
docs/b{N}-{slug}.json              # dados estruturados (input pro script de aplicação)
docs/b{N}-texto-para-usuaria.md    # texto humano pra gestora ler/decidir
docs/b{N}-respostas.json           # respostas da gestora (input pra aplicação)
docs/b{N}-execucao.json            # relatório do script de aplicação (schema canônico de métrica)
```

`{N}` é sequencial global do projeto. `{slug}` descreve o tipo de problema (`-revisao-humana`, `-corretores-faltantes`, `-baloes-sem-data`, etc).

---

## Estrutura do JSON

```jsonc
{
  "meta": {
    "geradoEm": "ISO8601",
    "total": N,
    "regra": "explicação curta de por que esses casos precisam de humano"
  },
  "casos": [
    {
      // identificadores suficientes pra decidir SEM voltar ao banco
      "venda_id": "uuid",
      "sienge_contract_id": "...",
      "numero_contrato": "...",
      "cliente": "nome", "cliente_cpf": "...",
      "corretor": "nome", "corretor_telefone": "...",
      "valor_venda": "...", "valor_pro_soluto": "...",

      // estado atual + estado proposto
      "estado_atual": { /* o que tá no banco hoje */ },
      "estado_proposto": { /* o que script faria automaticamente */ },

      // por que o script parou
      "motivo": "string",
      "acao_sugerida": "cancelar|realocar|aguardar_confirmacao|...",

      // opções de decisão
      "opcoes": [
        { "id": "1", "label": "Confirma cancelar", "efeito": "..." },
        { "id": "2", "label": "Aguarda investigação", "efeito": "..." }
      ]
    }
  ]
}
```

---

## Estrutura do MD pra gestora

- Agrupa casos por **nível de risco** (Grupo 1 = baixo risco / Grupo 2 = média / Grupo 3 = urgente).
- Cada caso traz dados-chave (cliente, contrato, valor, decisão a tomar).
- Termina com **"O que fazer agora"** — instrução clara de como responder.

Modelo em [docs/b6-texto-para-usuaria.md](docs/b6-texto-para-usuaria.md).

---

## Ciclo de uma rodada

1. **Geração** — script automatizado encontra casos delicados → escreve `docs/b{N}-{slug}.json` + `.md`.
2. **Envio pra gestora** — Markdown enviado por mensagem. JSON fica no repo pra rastreio.
3. **Resposta** — gestora responde por linha (id do caso → opção). Operador transcreve em `docs/b{N}-respostas.json`.
4. **Aplicação** — script de aplicação lê respostas + JSON original → executa UPDATE/DELETE/INSERT respeitando spec.
5. **Relatório** — output em `docs/b{N}-execucao.json` no schema canônico de métrica (ver `.claude/rules/sincronizacao-sienge.md`).
6. **Fechamento** — adicionar nota em CLAUDE.md "Auditorias recentes" referenciando a rodada.

---

## Quando criar uma rodada nova vs adicionar a uma existente

- **Rodada nova (`b{N+1}`)** se o tipo de problema é diferente das rodadas anteriores.
- **Mesma rodada** só se ainda não foi enviada pra gestora.

Não amontoar tipos diferentes de problema na mesma rodada — fica difícil pra gestora ler.

---

## Princípio: script automatizado NUNCA decide o que é delicado

Critérios pra rotear pra rodada b (não-exaustivo):
- Vencedor (linha que script escolheu manter) tem `data_prevista` fora do range Sienge (>30d).
- Perdedor (linha que script ia cancelar) está `pago` em período não-correspondente.
- Cliente / corretor / unidade ambíguos (múltiplos matches possíveis).
- Diferença de valor pro-soluto > R$ 100 entre payload Sienge e banco local.
- Qualquer apagamento de linha com `status='pago'` (trigger 017 já bloqueia, mas o script registra em vez de tentar).

Em dúvida: registra em `humano_pendente[]` da métrica E gera entrada na rodada b atual.
