// Edge function ailos-boletos — API de Cobrança Ailos (banco 085), SEM mTLS.
//
// Rotas (verify_jwt=false; autenticação própria por rota):
//   POST /callback     — {state, code} da tela de login do cooperado (anti-CSRF: state_pendente)
//   POST /webhook      — notificações Ailos → boletos.webhook_eventos (nunca toca pagamentos_prosoluto)
//   POST /emitir-lote  — ADMIN (JWT) emite boletos das parcelas informadas: RECONFERE no servidor
//                        (pendente + sem boleto vivo em qualquer banco + endereço), emite V2 com
//                        bolePix, grava boletos banco='ailos'. PDF é gerado no NAVEGADOR (mesmo
//                        layout homologado) e enviado via /armazenar-pdf — CPU da edge não aguenta
//                        jsPDF em lote. Idempotente por parcela.
//   POST /armazenar-pdf — ADMIN (JWT) grava PDF (base64) no Storage 'boletos' + pdf_path.
//
// Segredos: AILOS_CONSUMER_KEY / AILOS_CONSUMER_SECRET (env ou Vault via RPC ailos_segredo).
// Estado de tokens em ailos_tokens (migration 038). Ver scripts/boletos/README.md.

import { createClient } from "npm:@supabase/supabase-js@2";

const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const AMBIENTE = "producao";
const HOST = "https://apiendpoint.ailos.coop.br";
const CONVENIO = "101004";
const CARTEIRA = 1;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const dig = (s: unknown) => String(s ?? "").replace(/\D/g, "");

// ── segredos ─────────────────────────────────────────────────────────────────
async function segredo(nome: string): Promise<string> {
  const env = Deno.env.get(nome);
  if (env) return env;
  const { data, error } = await supa.rpc("ailos_segredo", { nome });
  if (error || !data) throw new Error(`segredo ${nome} não configurado (Vault/env)`);
  return String(data);
}

// ── auth Ailos (2 níveis) ────────────────────────────────────────────────────
async function tokenClient(forcar = false): Promise<string> {
  const { data: row } = await supa.from("ailos_tokens").select("*").eq("id", AMBIENTE).single();
  const valido = row?.access_token && row.access_token_expira_em &&
    new Date(row.access_token_expira_em).getTime() - Date.now() > 60_000;
  if (valido && !forcar) return row.access_token;
  const basic = btoa(`${await segredo("AILOS_CONSUMER_KEY")}:${await segredo("AILOS_CONSUMER_SECRET")}`);
  const r = await fetch(`${HOST}/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`token client Ailos falhou (${r.status})`);
  const tok = await r.json();
  await supa.from("ailos_tokens").update({
    access_token: tok.access_token,
    access_token_expira_em: new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", AMBIENTE);
  return tok.access_token;
}

async function codeCooperado(): Promise<string> {
  const { data: row } = await supa.from("ailos_tokens").select("cooperado_code").eq("id", AMBIENTE).single();
  if (!row?.cooperado_code) throw new Error("cooperado Ailos não autorizado (rodar ailos-login)");
  return row.cooperado_code;
}

async function refreshCooperado(): Promise<string> {
  const token = await tokenClient();
  const code = await codeCooperado();
  const r = await fetch(`${HOST}/ailos/identity/api/v1/autenticacao/token/refresh?code=${encodeURIComponent(code)}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`refresh cooperado falhou (${r.status})`);
  const novo = (await r.text()).trim().replace(/^"|"$/g, "");
  await supa.from("ailos_tokens").update({
    cooperado_code: novo, cooperado_code_atualizado_em: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", AMBIENTE);
  return novo;
}

async function ailosApi(method: string, path: string, body?: unknown, tentativa = 0): Promise<{ status: number; body: string }> {
  const r = await fetch(`${HOST}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await tokenClient()}`,
      "x-ailos-authentication": `Bearer ${await codeCooperado()}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  if (r.status === 401 && tentativa < 2) {
    if ((r.headers.get("www-authenticate") ?? "").includes("WSO2")) await tokenClient(true);
    else await refreshCooperado();
    return ailosApi(method, path, body, tentativa + 1);
  }
  return { status: r.status, body: text };
}

const fmtData = (d: string) => { const [a, m, dd] = String(d).slice(0, 10).split("-"); return `${dd}/${m}/${a}`; };

// ── emitir-lote (admin) ──────────────────────────────────────────────────────
async function autenticarAdmin(req: Request): Promise<string | null> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await supa.auth.getUser(jwt);
  if (error || !data?.user) return null;
  const { data: perfil } = await supa.from("usuarios").select("tipo").eq("id", data.user.id).maybeSingle();
  return perfil?.tipo === "admin" ? data.user.id : null;
}

// deno-lint-ignore no-explicit-any
async function emitirLote(req: Request, body: any): Promise<Response> {
  const adminId = await autenticarAdmin(req);
  if (!adminId) return json({ error: "apenas administradores emitem boletos" }, 401);
  const ids: string[] = Array.isArray(body.pagamento_ids) ? body.pagamento_ids.map(String) : [];
  if (ids.length === 0 || ids.length > 300) return json({ error: "informe de 1 a 300 pagamento_ids" }, 400);
  // deno-lint-ignore no-explicit-any
  const pagadores: Record<string, any> = body.pagadores ?? {}; // {cpfDigitos: {nome, endereco, bairro, cidade, uf, cep}} da planilha de Clientes
  const hoje = new Date().toISOString().slice(0, 10);

  const { data: pags } = await supa.from("pagamentos_prosoluto")
    .select("id, venda_id, tipo, numero_parcela, valor, data_prevista, status").in("id", ids);
  // deno-lint-ignore no-explicit-any
  const vendaIds = [...new Set((pags ?? []).map((p: any) => p.venda_id))];
  const { data: vendas } = await supa.from("vendas").select("id, cliente_id, unidade, status, excluido").in("id", vendaIds);
  // deno-lint-ignore no-explicit-any
  const cliIds = [...new Set((vendas ?? []).map((v: any) => v.cliente_id).filter(Boolean))];
  const { data: clis } = await supa.from("clientes").select("id, nome_completo, cpf, cnpj, endereco, cidade, estado, cep").in("id", cliIds);
  const { data: vivos } = await supa.from("boletos").select("pagamento_id").in("pagamento_id", ids).not("status", "in", "(cancelado,baixado,erro)");
  // deno-lint-ignore no-explicit-any
  const vivoSet = new Set((vivos ?? []).map((b: any) => String(b.pagamento_id)));
  // deno-lint-ignore no-explicit-any
  const vendaMap = new Map((vendas ?? []).map((v: any) => [String(v.id), v]));
  // deno-lint-ignore no-explicit-any
  const cliMap = new Map((clis ?? []).map((c: any) => [String(c.id), c]));

  // deno-lint-ignore no-explicit-any
  const emitidos: any[] = [], erros: any[] = [];
  let seq = 0;
  for (const id of ids) {
    // deno-lint-ignore no-explicit-any
    const p = (pags ?? []).find((x: any) => String(x.id) === id);
    if (!p) { erros.push({ id, ref: id, motivo: "parcela não encontrada" }); continue; }
    const v = vendaMap.get(String(p.venda_id));
    const ref = `${v?.unidade ?? "?"} parc ${p.numero_parcela}`;
    if (p.status !== "pendente") { erros.push({ id, ref, motivo: `parcela está ${p.status}, não pendente` }); continue; }
    if (vivoSet.has(id)) { erros.push({ id, ref, motivo: "já tem boleto vivo (não duplica)" }); continue; }
    if (p.data_prevista <= hoje) { erros.push({ id, ref, motivo: `vencimento ${fmtData(p.data_prevista)} já passou` }); continue; }
    if (!v || v.excluido || v.status === "distrato") { erros.push({ id, ref, motivo: "venda inativa/distratada" }); continue; }
    const c = cliMap.get(String(v.cliente_id));
    if (!c) { erros.push({ id, ref, motivo: "venda sem cliente" }); continue; }
    const doc = dig(c.cpf) || dig(c.cnpj);
    if (!doc) { erros.push({ id, ref, motivo: `${c.nome_completo} sem CPF/CNPJ no cadastro` }); continue; }
    const pl = pagadores[doc] ?? {};
    const end = {
      cep: dig(pl.cep ?? c.cep),
      logradouro: String(pl.endereco ?? c.endereco ?? "").slice(0, 40) || "NAO INFORMADO",
      numero: "S/N", complemento: "",
      bairro: String(pl.bairro ?? "Centro").slice(0, 30),
      cidade: String(pl.cidade ?? c.cidade ?? "").slice(0, 30),
      uf: String(pl.uf ?? c.estado ?? "").toUpperCase().slice(0, 2),
    };
    if (!end.cep || !end.cidade || !end.uf) { erros.push({ id, ref, motivo: `${c.nome_completo}: endereço incompleto (CEP/cidade/UF) — preencha na planilha de Clientes ou no cadastro` }); continue; }

    const numeroDoc = Number(String(Date.now()).slice(-8)) + (seq++ % 100);
    const descricao = `Parcela ${p.numero_parcela} - Unidade ${v.unidade}`;
    const payload = {
      convenioCobranca: { codigoCarteiraCobranca: CARTEIRA },
      documento: { numeroDocumento: numeroDoc, descricaoDocumento: `P${p.numero_parcela}-${String(v.unidade ?? "").replace(/\s/g, "")}`.slice(0, 15), especieDocumento: 4 },
      emissao: { formaEmissao: 2, dataEmissaoDocumento: hoje },
      pagador: { entidadeLegal: { identificadorReceitaFederal: doc, tipoPessoa: doc.length > 11 ? 2 : 1, nome: String(pl.nome ?? c.nome_completo).slice(0, 50) }, emails: [], endereco: end, mensagemPagador: [descricao.slice(0, 60)] },
      vencimento: { dataVencimento: p.data_prevista },
      instrucoes: { valorAbatimento: 0, tipoMulta: 3, valorMulta: 0, tipoJurosMora: 3, valorJurosMora: 0, diasNegativacao: 0, diasProtesto: 0 },
      valorBoleto: { valorNominal: Number(p.valor) },
      avisoSms: { enviarAvisoVencimentoSms: 0, enviarAvisoVencimentoSmsAntesVencimento: false, enviarAvisoVencimentoSmsDiaVencimento: false, enviarAvisoVencimentoSmsAposVencimento: false },
      pagamentoDivergente: { tipoPagamentoDivergente: 0, valorMinimoPagamentoDivergente: 0 },
      indicadorRegistroNuclea: 1, bolePix: true,
    };
    const r = await ailosApi("POST", `/ailos/cobranca/api/v2/boletos/gerar/boleto/convenios/${CONVENIO}`, payload);
    // deno-lint-ignore no-explicit-any
    let b: any = null; try { b = JSON.parse(r.body).boleto; } catch { /* não-JSON */ }
    if ((r.status !== 200 && r.status !== 201) || !b?.codigoBarras?.codigoBarras) {
      let msg = r.body.slice(0, 200);
      // deno-lint-ignore no-explicit-any
      try { const j = JSON.parse(r.body); msg = (j.details ?? []).map((x: any) => x.message).join("; ") || j.message || msg; } catch { /* mantém */ }
      erros.push({ id, ref, motivo: `banco recusou: ${msg}` }); continue;
    }
    const { data: novo, error: insErr } = await supa.from("boletos").insert({
      pagamento_id: p.id, venda_id: v.id, cliente_id: c.id, banco: "ailos", ambiente: AMBIENTE,
      nosso_numero: String(b.documento?.nossoNumero ?? ""), seu_numero: String(numeroDoc),
      linha_digitavel: b.codigoBarras?.linhaDigitavel ?? null, codigo_barras: b.codigoBarras?.codigoBarras ?? null,
      qrcode_pix: b.pix?.copiaECola ?? null, valor: Number(p.valor), data_vencimento: p.data_prevista,
      status: "registrado", payload_emissao: payload, retorno_emissao: b, criado_por: adminId,
    }).select("id").single();
    if (insErr || !novo) { erros.push({ id, ref, motivo: "emitido no banco mas falhou ao gravar: " + (insErr?.message ?? "") }); continue; }

    // PDF NÃO é gerado aqui (CPU da edge estoura em lote) — o navegador gera com
    // o mesmo layout e envia via /armazenar-pdf. Devolvemos os dados necessários.
    emitidos.push({
      id, ref, cliente: c.nome_completo, valor: Number(p.valor), nossoNumero: b.documento?.nossoNumero, boleto_id: novo.id,
      pdfDados: {
        linhaDigitavel: b.codigoBarras.linhaDigitavel, codigoBarras: b.codigoBarras.codigoBarras, nossoNumero: b.documento?.nossoNumero,
        pagador: { nome: payload.pagador.entidadeLegal.nome, doc, endereco: `${end.logradouro} - ${end.bairro} - ${end.cidade}/${end.uf} - CEP ${end.cep}` },
        dataDoc: hoje, numeroDoc, valor: Number(p.valor), vencimento: p.data_prevista,
        instrucoes: [descricao, "Nao receber apos 60 dias do vencimento."], pixQr: b.pix?.qrCode || null,
      },
    });
  }
  console.log(JSON.stringify({ emitir_lote: { admin: adminId, emitidos: emitidos.length, erros: erros.length } }));
  return json({ ok: true, emitidos, erros });
}

// ── router ───────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const rota = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  // deno-lint-ignore no-explicit-any
  let body: any; try { body = await req.json(); } catch { return new Response("invalid json", { status: 400 }); }

  if (rota === "callback") {
    const state = String(body.state ?? ""), code = String(body.code ?? "");
    if (!state || !code) return new Response("missing state/code", { status: 400 });
    const { data: rows } = await supa.from("ailos_tokens").select("id").eq("state_pendente", state);
    if (!rows?.length) return new Response("unknown state", { status: 403 });
    await supa.from("ailos_tokens").update({ cooperado_code: code, cooperado_code_atualizado_em: new Date().toISOString(), state_pendente: null, updated_at: new Date().toISOString() }).eq("id", rows[0].id);
    return json({ ok: true });
  }
  if (rota === "webhook") {
    console.log(JSON.stringify({ webhook_ailos: body }));
    const nn = String(body?.nossoNumero ?? body?.boleto?.documento?.nossoNumero ?? "");
    if (nn) {
      const { data: bol } = await supa.from("boletos").select("id, webhook_eventos").eq("banco", "ailos").eq("nosso_numero", nn).maybeSingle();
      if (bol) await supa.from("boletos").update({ webhook_eventos: [...(bol.webhook_eventos ?? []), { recebido_em: new Date().toISOString(), evento: body }] }).eq("id", bol.id);
    }
    return json({ ok: true });
  }
  if (rota === "armazenar-pdf") {
    const adminId = await autenticarAdmin(req);
    if (!adminId) return json({ error: "apenas administradores" }, 401);
    const boletoId = String(body.boleto_id ?? ""), b64 = String(body.pdf_base64 ?? "");
    if (!boletoId || !b64) return json({ error: "boleto_id e pdf_base64 obrigatórios" }, 400);
    const { data: bol } = await supa.from("boletos").select("id").eq("id", boletoId).eq("banco", "ailos").maybeSingle();
    if (!bol) return json({ error: "boleto não encontrado" }, 404);
    const bin = atob(b64.replace(/[^A-Za-z0-9+/=]/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.length < 1000) return json({ error: "PDF truncado" }, 400);
    const { error: upErr } = await supa.storage.from("boletos").upload(`${boletoId}.pdf`, bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) return json({ error: "upload: " + upErr.message }, 500);
    await supa.from("boletos").update({ pdf_path: `${boletoId}.pdf` }).eq("id", boletoId);
    return json({ ok: true });
  }
  if (rota === "emitir-lote") {
    try { return await emitirLote(req, body); }
    catch (e) { return json({ error: String((e as Error).message ?? e) }, 500); }
  }
  return new Response("not found", { status: 404 });
});
