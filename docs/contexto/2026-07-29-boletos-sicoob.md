# Boletos Sicoob — arquitetura e roadmap

**Status 2026-07-30: EM PRODUÇÃO.** Fundação (2026-07-29) + validação completa de
produção + **primeiro lote real emitido: 223 boletos / R$ 290.683,49** (parcelas
ago–dez casadas 1:1 com `pagamentos_prosoluto`; planilha do financeiro cruzada com
o banco; 16 divergências excluídas e devolvidas pra conferência —
`Downloads\conferencia-16-excluidos-boletos.xlsx`).

## Produção — o que está validado

- **Contrato de cobrança:** `numeroCliente = 3771512` (cooperativa 4368, conta
  119.638-3, cooperado IM2 CONSTRUTORA — CNPJ 14.587.169/0001-02).
- **App "Portal do Cliente"** ativo; client_id de produção `baa26af2-61c2-4e8b-98ba-35cef62e4025`.
- **Auth:** OAuth2 client_credentials + mTLS com e-CNPJ A1 (validade até 25/03/2027 ⚠️)
  em `https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token`.
  Token dura 300s. Testado e funcionando via Node (cert+key PEM extraídos do .pfx
  com `openssl -legacy`).
- **Emissão real:** boleto teste nossoNumero 11 (R$ 5) + lote 223 (nossoNumero 12–242).
- **Lições do validador de produção** (já aplicadas na edge function):
  - `mensagensInstrucao`: máx. **40 chars** por linha;
  - **não** enviar blocos `codigoProtesto*` e `codigoNegativacao*` juntos (nem
    zerados) — omitir ambos;
  - `codigoCadastrarPIX: 0` por ora (QR só vem com chave Pix cadastrada na conta).

## Arquitetura de produção (decisão 2026-07-30)

- **Emissão/lote roda como script worker** (Node local; futuro: GitHub Action) —
  o runtime de edge functions não tem o certificado mTLS. Script do lote:
  casa planilha↔banco, emite e grava em `boletos` (idempotente; dry-run default).
- **Edge function `sicoob-boletos`** segue servindo o portal/admin com os dados
  já gravados (consulta local) e o sandbox; ações que exigem mTLS em produção
  (consulta live, 2ª via, baixa) migram pro worker ou pra function quando o
  mTLS for resolvido no edge.
- ⚠️ Segurança: cert/key PEM vivem na máquina local (`Downloads\im2_cert.pem` /
  `im2_key.pem`) — NUNCA commitar; mover pra secret do GitHub Actions quando o
  cron nascer.

## Decisões de negócio (owner, 2026-07-29)

1. **Camada própria, sem Sienge**: o boleto tem ciclo de vida na tabela `boletos`;
   quando o banco confirma pagamento (webhook), atualizamos **o boleto** no nosso
   sistema. A baixa da **parcela** (`pagamentos_prosoluto.status`) segue o fluxo
   existente — o boleto NUNCA mexe nela automaticamente.
   ⚠️ Se um dia quisermos boleto-pago ⇒ parcela-paga automática, precisa alinhar
   com a reconciliação Sienge (o cron diário reverteria/parquearia baixas que o
   Sienge não conhece — ver `.claude/rules/sincronizacao-sienge.md`).
2. **Emissão**: admin emite agora (botão por parcela); cron automático depois.
3. **Banco**: Sicoob (Cobrança Bancária **V3** — V2 descontinuada em 04/2025).

## Peças

| Peça | Onde | O quê |
|---|---|---|
| Tabela `boletos` | [migrations/035_boletos.sql](../../migrations/035_boletos.sql) | 1 boleto vivo por parcela; payload/retorno/webhook_eventos gravados (auditoria); status: emitido→registrado→pago/vencido/baixado/cancelado/erro |
| Edge function `sicoob-boletos` | [supabase/functions/sicoob-boletos](../../supabase/functions/sicoob-boletos/index.ts) | ações `emitir` (admin), `consultar`/`segunda_via` (admin ou dono), `cancelar` (admin) + rota `/webhook` (banco → nós) |
| Admin | AdminDashboard → Pagamentos → parcela | botão "Boleto" (pendente sem boleto) · pill de status com cancelar |
| Cliente | ClienteDashboard → aba Pagamentos | strip sob a parcela: status (aguardando/pago/atrasado), copiar linha digitável, copiar Pix, baixar PDF |

**Segurança do webhook:** não confiamos no payload — registramos o evento e
**re-consultamos a API** do Sicoob antes de marcar o boleto como pago.

## Configuração (Supabase secrets → Edge Functions)

| Secret | Valor |
|---|---|
| `SICOOB_AMBIENTE` | `sandbox` (depois `producao`) |
| `SICOOB_CLIENT_ID` | client_id do app no portal developers |
| `SICOOB_ACCESS_TOKEN` | sandbox: token estático do portal; produção: (ver TODO OAuth) |
| `SICOOB_NUMERO_CLIENTE` | código do beneficiário na cooperativa (contrato de cobrança) |
| `SICOOB_NUMERO_CONTA` | conta corrente |
| `SICOOB_BASE_URL` | (opcional) override; default por ambiente |

Sem os secrets a function responde `503 integração não configurada` — o resto
do sistema funciona normalmente.

## Checklist de credenciamento (fazer no portal https://developers.sicoob.com.br)

1. Criar conta no portal com o CNPJ/conta da IM (gerente da cooperativa pode
   precisar liberar o serviço "API Cobrança" no contrato de cobrança).
2. **Sandbox** (desbloqueia o desenvolvimento JÁ):
   - Menu "Sandbox" → gerar `client_id` + token de acesso estático.
   - Preencher secrets acima com `SICOOB_AMBIENTE=sandbox`.
3. **Produção**:
   - Certificado **ICP-Brasil e-CNPJ tipo A1** (arquivo .pfx/.pem) da IM.
   - "Minhas Aplicações" → Nova Aplicação → vincular conta corrente + subir a
     chave pública do certificado → recebe `client_id` de produção.
   - Escopos de cobrança (boletos_inclusao, boletos_consulta, boletos_alteracao,
     webhooks_*).
   - Cadastrar o webhook de liquidação apontando para
     `https://jdkkusrxullttyeakwib.supabase.co/functions/v1/sicoob-boletos/webhook`.
4. Dados a levantar com o financeiro: `numeroCliente` (código do beneficiário),
   conta corrente de cobrança, carteira/modalidade (assumimos **1 — simples com
   registro**), espécie do documento (assumimos **DM**).

## TODO / próximos passos

- [ ] Secrets do sandbox → testar emissão ponta a ponta (payload V3 foi escrito
      defensivamente; validar shapes reais de request/response no sandbox e
      ajustar `sicoobFetch`/`resultado()` se preciso).
- [ ] **Produção — OAuth2 + mTLS**: token via `auth.sicoob.com.br` (client_credentials)
      com certificado. Validar se o edge runtime do Supabase suporta
      `Deno.createHttpClient({ cert, key })`; senão, mover a chamada pra um worker
      (GitHub Action / VPS) e a function só orquestra.
- [ ] Cron de emissão automática (parcelas que vencem no mês seguinte) — reusar a
      ação `emitir` em lote; gate: sandbox validado + decisão da gestão.
- [ ] Aba/painel de boletos no admin (visão geral: emitidos, pagos, atrasados,
      conciliação com parcelas) — hoje o status aparece por parcela.
- [ ] Decisão de negócio: o que fazer quando boleto=pago e parcela=pendente
      (aviso pro admin dar baixa? auto-baixa? conciliação com Sienge?).
- [ ] Juros/multa por atraso na emissão (campos `multa`/`jurosMora` do payload) —
      hoje não enviamos; regra de negócio a definir.
