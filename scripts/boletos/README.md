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

---

# Worker de Boletos AILOS (banco 085) — homologação

Segundo banco de emissão. Diferente do Sicoob, a Ailos **não exige mTLS** —
autenticação é OAuth2 (WSO2) + autorização interativa do cooperado. Estado de
tokens em `ailos_tokens` (migration 038); callback público na edge function
`ailos-boletos/callback`.

**A Ailos não devolve PDF**: a API retorna código de barras/linha digitável/QR
Pix e o layout do boleto é responsabilidade nossa (`ailos-boleto-pdf.cjs`,
layout Febraban com ITF-25). A homologação valida 3 PDFs de exemplo.

## Credenciais

`scripts/boletos/.env.ailos` (fora do git) — credenciais de DESENVOLVEDOR da
homologação (fixas, valem pra futuras contas, e-mail Ailos 2026-08):
Consumer Key/Secret + AilosApiKeyDeveloper + dados do cooperado
(convênio 101004 · carteira 01 · agência 0101-5 · cedente 20974370).

## Fluxo de homologação

```bash
cd scripts/boletos

# 1. Autorizar o cooperado (1x — abre URL de login no navegador):
node ailos-login.cjs
#    → homolog: conta 7902.556-0 · senha aaaaa11111@
#    O callback grava o code em ailos_tokens; o script confirma sozinho.

# 2. Emitir 3 boletos de teste + gerar os PDFs:
node ailos-emitir-teste.cjs

# 3. Enviar ailos-homolog-boleto-{1,2,3}.pdf pra homologacaocobranca@ailos.coop.br
#    (responder o MESMO e-mail, sem alterar o assunto)
```

Tokens renovam sozinhos: client (1h) via Basic consumer key/secret; code do
cooperado via `/identity/api/v1/autenticacao/token/refresh` (sem interação).
O 401 é tratado nos dois níveis em `ailos.cjs::ailosApi`.

## Teste de produção (etapa final da homologação — e-mail Ailos 2026-08-10)

Layout do PDF **aprovado** (logo + Bolepix). Falta o teste em produção: 2
boletos REAIS de R$ 10,00 — o 1º pago via BolePIX (QR), o 2º via código de
barras. Credenciais de produção em `.env.ailos.producao` (gitignored; OAuth do
client já validado contra `apiendpoint.ailos.coop.br`).

```bash
cd scripts/boletos

# 1. Autorizar o cooperado em PRODUÇÃO (1x — tela de login Ailos):
AILOS_ENV=producao node ailos-login.cjs
#    → conta 20974370 + SENHA DE API DE PRODUÇÃO
#    ⚠️ a Ailos não tem essa senha; se o cooperado não tiver, contatar o
#      posto de atendimento da cooperativa pra criar/redefinir.

# 2. Emitir os 2 boletos de teste (R$ 10,00 cada, venc +7d):
AILOS_ENV=producao node ailos-teste-producao.cjs

# 3. Pagar: boleto 1 pelo QR/copia-e-cola · boleto 2 pela linha digitável.
# 4. Compensou os dois → responder o e-mail da Ailos confirmando.
```

## Emissão em massa Ailos

`ailos-emitir-lote-excel.cjs` — espelho do lote Sicoob (mesmas planilhas, mesmo
match-exato, mesma trava de 1 boleto vivo/parcela — vale ENTRE bancos). Emite
V2 com bolePix, grava `boletos` com `banco='ailos'`, gera o PDF homologado e
armazena via `sicoob-boletos/armazenar-pdf` (rota agnóstica). Dry-run validado
2026-08-11 contra as planilhas de julho (223 corretamente pulados por já terem
boleto Sicoob vivo). Modelos de planilha: aba Boletos do Admin, card "Emissão
em massa" (seletor Sicoob|Ailos).

```powershell
$env:AILOS_ENV='producao'
node ailos-emitir-lote-excel.cjs "clientes.xlsx" "cobrancas.xlsx"          # dry-run
node ailos-emitir-lote-excel.cjs "clientes.xlsx" "cobrancas.xlsx" --apply  # emite
```

## Pendências Ailos

- [x] Homologação de layout (3 PDFs aprovados 2026-08-10, com logo + Bolepix).
- [x] Teste de produção (boleto 1 Pix liquidado ✅; boleto 2 barras pago, compensação Nuclea pendente de conferir).
- [x] Worker de lote (`ailos-emitir-lote-excel.cjs`, dry-run validado).
- [ ] Webhooks v2: cadastro retornou **403** — API de webhooks não liberada na
      nossa subscription; pedir habilitação à Ailos (eventos 2=BoletoLiquidado,
      1=BoletoBaixado → `.../functions/v1/ailos-boletos/webhook`). Sem webhook,
      conciliar por consulta (rodada periódica).
- [ ] Conferir compensação do boleto 2 (consulta `indicadorSituacaoBoleto`).
- [ ] Integração com o sistema: emissão gravando em `boletos` com
      `banco='ailos'` (tabela já suporta multi-banco), seletor de banco na aba
      Boletos do Admin, strip no portal do cliente (PDF do Storage, mesmo fluxo
      do Sicoob).
- [ ] Webhook v2 da Ailos (POST /ailos/cobranca/api/v2/webhooks) apontando pra
      `.../functions/v1/ailos-boletos/webhook` (rota já deployada).
- [ ] Decisão de negócio: juros/multa (hoje isento, igual Sicoob).
