// Edge proxy — Captura pública de negociação de parceria (Figueira) → API do RH.
// Spec: docs/specs/2026-06-12-cadastro-publico-parceria-figueira-S1-spec.md
// Decisões: HUB-CONEXAO.md §4 (D1–D6). Captura PÚBLICA (sem login).
//
// Por que existe: o token x-parceria-token é segredo server-side — o browser NUNCA
// fala direto com o RH. O form chama esta edge; ela injeta o token, força Figueira/SC,
// grava o registro local (submissoes_parceria) com idempotência e devolve o card_id.
//
// Rotas:
//   POST /cadastro-parceria-proxy/upload  → proxia multipart p/ {RH}/api/cadastro-negociacao/upload
//   POST /cadastro-parceria-proxy/submit  → proxia JSON p/ {RH}/api/cadastro-negociacao + registra local
import "@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "@supabase/supabase-js"

const RH_BASE_URL = Deno.env.get("RH_BASE_URL") ?? "https://rh.investmoneysa.com.br"  // default prod; override por env
const PARCERIA_API_TOKEN = Deno.env.get("PARCERIA_API_TOKEN") ?? ""
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

const FIGUEIRA_SIENGE_ENTERPRISE_ID = 2104                     // escopo único (D3); River 2103 deferido

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } })

const db = () => createClient(SUPABASE_URL, SERVICE_ROLE)

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

// v1 de "minhas negociações" (D5): mensagem de confirmação ao contato do form.
// Canal (email/WhatsApp) = decisão de implementação. Stub não-bloqueante por ora.
async function dispararConfirmacao(contato: string | undefined, cardId: string): Promise<void> {
  if (!contato) return
  // TODO(impl): enviar email/WhatsApp "recebemos sua negociação — protocolo {cardId}".
  console.log("confirmacao_pendente", { contato, cardId })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  // Rodada 11 (owner): o RH não valida x-parceria-token por ora (anônimo) — token é hardening
  // futuro. Só RH_BASE_URL é obrigatória (e já tem default de prod), então isto raramente trava.
  if (!RH_BASE_URL) {
    return json({ error: "edge mal configurada: falta RH_BASE_URL no env" }, 500)
  }

  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/cadastro-parceria-proxy/, "") || "/"

  try {
    // ── 0) Catálogo de empreendimentos SC (proxy GET) — o form pega o Figueira ─
    if (req.method === "GET" && path === "/empreendimentos") {
      const regiao = url.searchParams.get("regiao") ?? "SC"
      const r = await fetch(`${RH_BASE_URL}/api/empreendimentos?regiao=${encodeURIComponent(regiao)}`, {
        headers: { "x-parceria-token": PARCERIA_API_TOKEN },
      })
      return json(await r.json().catch(() => ([])), r.status)
    }

    // ── 1) Upload de documento (proxy multipart, 1 arquivo/vez) ───────────────
    if (req.method === "POST" && path === "/upload") {
      const inForm = await req.formData()
      const file = inForm.get("file")
      const tipo = inForm.get("tipo")
      if (!(file instanceof File) || typeof tipo !== "string") {
        return json({ error: "upload requer multipart com 'file' + 'tipo'" }, 400)
      }
      const fwd = new FormData()
      fwd.append("file", file, file.name)
      fwd.append("tipo", tipo)
      const r = await fetch(`${RH_BASE_URL}/api/cadastro-negociacao/upload`, {
        method: "POST",
        headers: { "x-parceria-token": PARCERIA_API_TOKEN },   // token só na edge
        body: fwd,
      })
      return json(await r.json().catch(() => ({})), r.status)
    }

    // ── 2) Submit final (proxy JSON + registro local) ─────────────────────────
    if (req.method === "POST" && path === "/submit") {
      const body = await req.json()

      // força o escopo do Figueira (defesa em profundidade — o RH também valida)
      const payload = {
        ...body,
        regiao: "SC",
        sienge_enterprise_id: FIGUEIRA_SIENGE_ENTERPRISE_ID,
      }

      const payloadHash = await sha256(JSON.stringify(payload))
      const supa = db()

      // idempotência (§8): mesmo payload já enviado → devolve o card existente, não re-POSTa
      const { data: existente } = await supa
        .from("submissoes_parceria")
        .select("id, rh_card_id")
        .eq("payload_hash", payloadHash)
        .not("rh_card_id", "is", null)
        .maybeSingle()
      if (existente?.rh_card_id) {
        return json({ card_id: existente.rh_card_id, submission_id: existente.id, idempotent: true }, 200)
      }

      // chama o RH com o token
      const r = await fetch(`${RH_BASE_URL}/api/cadastro-negociacao`, {
        method: "POST",
        headers: { "x-parceria-token": PARCERIA_API_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const rhResp = await r.json().catch(() => ({}))
      if (!r.ok) {
        return json({ error: "RH recusou a submissão", status: r.status, detail: rhResp }, r.status)
      }
      const cardId: string | undefined = rhResp?.id

      // registro local (vínculo + chaves de reconciliação D6)
      const { data: rec, error: recErr } = await supa
        .from("submissoes_parceria")
        .insert({
          corretor_creci: payload.corretor_creci ?? null,
          corretor_email: payload.corretor_email ?? null,
          corretor_telefone: payload.corretor_telefone ?? null,
          corretor_nome: [payload.corretor_nome, payload.corretor_sobrenome].filter(Boolean).join(" ") || null,
          cliente_cpf: payload.cliente_cpf ?? null,
          cliente_nome: [payload.cliente_nome, payload.cliente_sobrenome].filter(Boolean).join(" ") || null,
          sienge_enterprise_id: FIGUEIRA_SIENGE_ENTERPRISE_ID,
          rh_card_id: cardId ?? null,
          contato: payload.corretor_email ?? payload.corretor_telefone ?? null,
          payload_hash: payloadHash,
          resumo: {
            unidade: payload.imovel_unidade_reservada ?? null,
            valor_imovel: payload.imovel_valor ?? null,
            forma_pagamento: payload.forma_pagamento_entrada ?? null,
          },
          status: cardId ? "enviado" : "erro",
        })
        .select("id")
        .single()
      if (recErr) {
        // o card já existe no RH; logamos o erro local mas não falhamos a submissão
        console.error("falha_registro_local", recErr)
      }

      await dispararConfirmacao(payload.corretor_email ?? payload.corretor_telefone, cardId ?? "")

      return json({ card_id: cardId, submission_id: rec?.id ?? null }, 201)
    }

    return json({ error: "rota não encontrada" }, 404)
  } catch (e) {
    return json({ error: "erro inesperado", detail: String(e) }, 500)
  }
})
