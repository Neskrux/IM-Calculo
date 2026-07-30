# Worker de Boletos Sicoob — runbook operacional

Arquitetura completa: [docs/contexto/2026-07-29-boletos-sicoob.md](../../docs/contexto/2026-07-29-boletos-sicoob.md)

**Por que existe um worker:** o runtime das edge functions do Supabase não suporta
o certificado mTLS que a API de produção do Sicoob exige. Tudo que fala com a
**produção** do banco (emitir, segunda via, baixar) roda por aqui, numa máquina
que tenha o certificado. O portal/admin consomem os dados gravados
(tabela `boletos` + PDFs no Storage) via edge function.

## Pré-requisitos da máquina (hoje: máquina do Bruno)

| Arquivo | Onde | O que é |
|---|---|---|
| `im2_cert.pem` / `im2_key.pem` | `C:\Users\HP\Downloads\` | e-CNPJ A1 da IM2 extraído do .pfx (`openssl pkcs12 ... -legacy`). **Validade: 25/03/2027** ⚠️ |
| `boletos_worker_secret.txt` | `C:\Users\HP\Downloads\` | segredo que autentica o worker na edge function (`BOLETOS_WORKER_SECRET` nos secrets do Supabase) |
| `.env` do repo | raiz | URL/anon key do Supabase (leitura/escrita — RLS desligado) |

Caminhos podem ser sobrescritos por env: `SICOOB_CERT_PEM`, `SICOOB_KEY_PEM`,
`BOLETOS_WORKER_SECRET_FILE`. **NUNCA commitar cert/key/secret.**

Config de produção (em [sicoob.cjs](sicoob.cjs)): cooperativa 4368 ·
conta 119.638-3 · contrato de cobrança (`numeroCliente`) **3771512** ·
client_id do app "Portal do Cliente" (inútil sem o certificado).

## Fluxo mensal de emissão em massa

```bash
cd scripts/boletos

# 1. Dry-run — cruza as planilhas do financeiro com o banco, SEM emitir:
node emitir-lote-excel.cjs "C:\caminho\clientes.xlsx" "C:\caminho\cobrancas.xlsx"

# 2. Revisar o resultado (lote-dryrun-*.json): lote vs excluídos.
#    Só entra no lote quem casa EXATO com parcela pendente do sistema.

# 3. Emitir de verdade:
node emitir-lote-excel.cjs "C:\caminho\clientes.xlsx" "C:\caminho\cobrancas.xlsx" --apply

# 4. SEMPRE na sequência — armazenar os PDFs oficiais (senão o botão
#    "Baixar PDF" do sistema não tem o que servir):
node baixar-pdfs-lote.cjs
```

Ambos são **idempotentes**: cair no meio e rodar de novo continua de onde parou,
sem duplicar boleto nem PDF.

Formato das planilhas: gerado pelos modelos (`modelo-clientes.xlsx` /
`modelo-cobrancas.xlsx` — abas "Clientes" e "Cobrancas", não renomear colunas).

## Baixar (cancelar) um boleto

```bash
node baixar-boleto.cjs <nossoNumero>
```

Cancela no Sicoob e marca `baixado` na tabela local.

## Regras aprendidas do validador de produção (2026-07-30)

- `mensagensInstrucao`: máx. **40 caracteres** por linha.
- Blocos `codigoProtesto*` e `codigoNegativacao*`: **omitir ambos** (enviar os
  dois juntos, mesmo zerados, é rejeitado).
- `tipoJurosMora: 3` (isento) + multa zerada — **até decisão de negócio** sobre
  cobrar juros/multa por atraso.
- `codigoCadastrarPIX: 0` — QR Pix só sai com chave Pix cadastrada na conta.
- Token OAuth dura **300s** — os scripts renovam a cada ~40–50 chamadas.

## Histórico

- **2026-07-30 — primeiro lote:** 223 boletos / R$ 290.683,49 (parcelas ago–dez,
  planilha do financeiro cruzada 1:1 com o sistema; 16 divergências excluídas e
  devolvidas — `conferencia-16-excluidos-boletos.xlsx`). 223 PDFs armazenados.
  Boleto teste: nossoNumero 11 (R$ 5, baixar após conferência).

## Pendências

- [ ] **Webhook** de liquidação no portal Sicoob → `https://<proj>.supabase.co/functions/v1/sicoob-boletos/webhook`
      (sem ele, pagamento não marca o boleto como pago sozinho; alternativa
      provisória: script de conciliação por consulta).
- [ ] Migrar worker pra GitHub Action (cert/secret em GitHub Secrets) quando
      virar cron mensal.
- [ ] Decisão de negócio: juros/multa por atraso.
- [ ] Renovação do e-CNPJ antes de 25/03/2027.
