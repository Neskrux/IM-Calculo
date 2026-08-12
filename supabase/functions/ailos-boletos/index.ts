// Edge function ailos-boletos — integração API de Cobrança Ailos (banco 085)
//
// Rotas:
//   POST /callback  — recebe {state, code} da tela de login do cooperado Ailos
//                     (urlCallback do fluxo de autorização). Valida o state contra
//                     ailos_tokens.state_pendente (anti-CSRF) e grava o code.
//   POST /webhook   — notificações da Ailos (liquidação etc.) — grava o evento no
//                     boleto correspondente (banco='ailos').
//
// verify_jwt=false: a Ailos chama sem Authorization do Supabase. A autenticação
// é feita pelo próprio protocolo: callback só aceita state previamente gravado
// por nós em ailos_tokens.state_pendente.
//
// Ver: scripts/boletos/README.md (runbook) + migration 038.

import { createClient } from "npm:@supabase/supabase-js@2";

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const rota = url.pathname.split("/").filter(Boolean).pop();

  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  if (rota === "callback") {
    const state = String(body.state ?? "");
    const code = String(body.code ?? "");
    if (!state || !code) return new Response("missing state/code", { status: 400 });

    // state só é aceito se corresponder a um fluxo que NÓS iniciamos
    const { data: rows, error } = await supa
      .from("ailos_tokens")
      .select("id, state_pendente")
      .eq("state_pendente", state);
    if (error) return new Response("db error", { status: 500 });
    if (!rows || rows.length === 0) {
      console.warn(JSON.stringify({ warn: "callback_state_desconhecido", state }));
      return new Response("unknown state", { status: 403 });
    }

    const { error: upErr } = await supa
      .from("ailos_tokens")
      .update({
        cooperado_code: code,
        cooperado_code_atualizado_em: new Date().toISOString(),
        state_pendente: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rows[0].id);
    if (upErr) return new Response("db error", { status: 500 });

    console.log(JSON.stringify({ ok: "cooperado_autorizado", ambiente: rows[0].id }));
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (rota === "webhook") {
    // Evento da Ailos: grava no boleto (auditoria) sem confiar cegamente —
    // conciliação de status fica pro worker/consulta. Nunca toca pagamentos_prosoluto.
    console.log(JSON.stringify({ webhook_ailos: body }));
    const nossoNumero = String(
      (body as any)?.nossoNumero ??
        (body as any)?.boleto?.documento?.nossoNumero ??
        "",
    );
    if (nossoNumero) {
      const { data: bol } = await supa
        .from("boletos")
        .select("id, webhook_eventos")
        .eq("banco", "ailos")
        .eq("nosso_numero", nossoNumero)
        .maybeSingle();
      if (bol) {
        await supa
          .from("boletos")
          .update({
            webhook_eventos: [
              ...(bol.webhook_eventos ?? []),
              { recebido_em: new Date().toISOString(), evento: body },
            ],
          })
          .eq("id", bol.id);
      }
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("not found", { status: 404 });
});
