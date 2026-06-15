# Spec S1 (IM-Calculo) — Captura pública de negociação de parceria · Figueira Garcia

> **Lado IM-Calculo do spec conjunto.** Contrato em `SistemadeRH/docs/superpowers/specs/2026-06-11-figueira-corretor-parceria-integracao-spec.md`; decisões no `HUB-CONEXAO.md` §4.
> Spec-driven — ver `.claude/rules/sincronizacao-sienge.md`, `fator-comissao.md`, `leitura-de-listas-e-refetch.md`, `rodadas-b.md`.
>
> **Rev 2 (2026-06-12, decisão do owner):** captura **PÚBLICA (sem login)** · identidade por **CPF/email, depois** · **"minhas negociações" v1 = mensagem** (tela = fase 2) · token mantido.
> **D6:** reconciliação **cliente por `cliente_cpf`**, **corretor por `email`** (CRECI-número fica fase-2).

## 1. Objetivo
Corretor de parceria acessa uma **URL pública (sem login)**, preenche o formulário do Figueira (réplica visual do
`/cadastro-negociacao` do RH, **hospedado no IM-Calculo**), restrito a **Figueira (2104)**, e submete → **card no funil
do RH** (via API, com token server-side). É **intake de negociação**, não cadastro de usuário — baixa fricção.

**Não-objetivos:** login/conta na captura; funil/Kanban (RH); comissão atravessar pro RH; River 2103.

## 2. Os 3 momentos (modelo de produto)
1. **Captura (pública, sem login)** — este spec. O corretor submete a negociação.
2. **Controle (funil interno RH + Sienge)** — o time interno opera o card; vira dinheiro **só quando fecha no Sienge**.
3. **Visibilidade (login, depois)** — o corretor loga pra **ver comissão** (caminho Sienge normal dos 49 corretores).
   **Anti-fraude/aprovação mora AQUI**, não na captura.

## 3. Arquitetura (lado S1)
```
[corretor — público, SEM login]
   ▼
[Form Figueira público (hospedado no IM-Calculo)]
   ▼
[Edge function do IM-Calculo]  ← guarda x-parceria-token (server-side)
   │ 1. uploads → POST {RH}/api/cadastro-negociacao/upload  (1 arquivo/vez, com token)
   │ 2. submit  → POST {RH}/api/cadastro-negociacao  (SubmitBody + documentos[] + sienge_enterprise_id)   ← SEM identidade IM
   ▼
[card no funil RH]  → 201 { id }
   ▼
[registro local de submissão]  →  dispara MENSAGEM de confirmação ao contato
```
O browser **nunca** fala direto com o RH (token só na edge).

## 4. Contrato consumido (do S2 — rev 2)
- `POST {RH}/api/cadastro-negociacao/upload` (multipart) → `{ url, path, … }`.
- `POST {RH}/api/cadastro-negociacao` (`SubmitBody` + `documentos[]` + opcional `sienge_enterprise_id`) → `201 { id }`.
- **`corretor_parceria_ref` REMOVIDO** do contrato (sem login → sem `usuarios.id` no submit). O card identifica o corretor pelos campos `corretor_*` em texto.
- Campos relevantes do card: **`corretor_creci`** (obrigatório), `corretor_email`, `corretor_telefone`, `corretor_pix`, **`cliente_cpf`** (obrigatório). **Não há `corretor_cpf`** (mantém réplica fiel do form do RH).
- Header **`x-parceria-token`** (mantido). `GET {RH}/api/empreendimentos?regiao=SC` → `sienge_enterprise_id` + `aceita_corretor_parceria`. Mapeia por **2104**.

## 5. Componentes do lado S1
### 5.1 Formulário público
- **URL pública, sem auth.** 4 passos (corretor/cliente/imóvel/pagamento+termo) conforme a spec do form do S2.
- Região **SC fixa**; Figueira **2104 fixo**. Campos digitados (sem prefill — não há login).
### 5.2 Edge function (saída)
- Guarda `x-parceria-token` (env). Chama `/upload` + `/cadastro-negociacao`. **Não envia identidade IM.**
- Recebe `201 { id }`, grava o registro local (§5.3) e dispara a mensagem (§5.4).
### 5.3 Registro local de submissão
- Tabela (ex.: `submissoes_parceria`): `corretor_creci`, `corretor_email`, `corretor_telefone`, `cliente_cpf`,
  `empreendimento` (2104), resumo, **`rh_card_id`**, `contato` (email/telefone), `created_at`, `status`.
### 5.4 "Minhas negociações" — v1 = MENSAGEM
- Na submissão: **mensagem de confirmação** ao contato informado (email/WhatsApp — decidir na implementação) com protocolo/`rh_card_id`.
- **Tela** (lista de negociações enviadas) = **fase 2**, quando validado.
### 5.5 Vínculo de identidade (depois, desacoplado) — D6
- **A comissão NÃO depende deste form:** quando o negócio fecha, o **Sienge atribui o corretor** (`sienge_broker_id`)
  e a comissão aparece pelo caminho normal dos 49 corretores.
- O dado capturado serve só pra "minhas negociações" (fase-2). **Reconciliação:**
  - **Cliente** → por **`cliente_cpf`** (limpo).
  - **Corretor** → por **`email`** (v1). O form não tem CPF do corretor e `usuarios` tem `creci_url` (documento), **não o número** do CRECI → match por **CRECI-número fica fase-2** (adiciona `usuarios.creci` + popula).
  - Ambiguidade → **revisão humana** (rodada `b`).

## 6. Invariantes
- Captura é **PÚBLICA** (sem login). `x-parceria-token` **nunca** no cliente. Só **Figueira 2104** (form + RH).
- **Nada financeiro** sai pro RH. **PII** de documento no RH (signed URL). **Anti-fraude no momento de VER comissão**, não na captura.

## 7. Segurança
- Form público é seguro porque o **valor é controlado downstream** (funil interno revisa + Sienge atribui). O form não move dinheiro.
- Token server-side marca `origem='parceria'` e impede origens não-oficiais. Rate-limit na edge + endpoint RH. LGPD: consentimento no form; PII no RH.

## 8. Idempotência + métricas
- Submissão idempotente por **hash do payload** (`corretor_creci` + `cliente_cpf` + imóvel + valores) numa janela → não duplica card em retry.
- Métrica no schema canônico (ver `sincronizacao-sienge.md`).

## 9. Critérios de aceite (lado S1)
- Qualquer um abre a **URL pública**, submete Figueira → `201` + registro local + **mensagem de confirmação** ao contato.
- Token **nunca** no browser. Empreendimento ≠ 2104 bloqueado. Documento via **signed URL**.
- (Fase 2) corretor vê "minhas negociações" reconciliadas por email.

## 10. Decisões (HUB §4)
- **D1** token mantido · **D3** captura pública · **D4** drop `corretor_parceria_ref` (identidade por CPF/email depois) · **D5** "minhas negociações" v1 = mensagem · **D6** reconciliação: cliente por `cliente_cpf`, corretor por `email` (CRECI-número = fase-2).
