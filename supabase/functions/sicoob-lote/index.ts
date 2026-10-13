// Edge function sicoob-lote — emissão Sicoob (Cobrança V3) PELA TELA, com mTLS.
//
// Teste de 2026-10-13 provou que o edge runtime suporta Deno.createHttpClient com
// certificado de cliente (a nota antiga "edge sem mTLS" estava errada). Com isso o
// Sicoob deixa de depender do robô local (scripts/boletos/emitir-lote-excel.cjs).
//
// POST /emitir — ADMIN (JWT). Body: { pagamento_id, pagador? } — UM boleto por chamada
//   (o front itera e mostra progresso). Reconfere no servidor: parcela pendente, venc
//   futuro, venda ativa, sem boleto vivo em QUALQUER banco, CPF e endereço. Emite,
//   grava em `boletos` (banco='sicoob') e já busca/armazena o PDF OFICIAL (segunda via).
//   NUNCA toca pagamentos_prosoluto.
//
// Segredos (Supabase → Edge Functions → Secrets): SICOOB_CERT_PEM e SICOOB_KEY_PEM
// (e-CNPJ IM2 — validade 25/03/2027). Mesmas regras do validador de produção do robô:
// instrução ≤40 chars; sem blocos de protesto/negativação; juros/multa isentos.

import { createClient } from "npm:@supabase/supabase-js@2";

const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CLIENT_ID = "baa26af2-61c2-4e8b-98ba-35cef62e4025";
const NUMERO_CLIENTE = 3771512;   // contrato de cobrança (coop 4368 / conta 119.638-3)
const NUMERO_CONTA = 1196383;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const dig = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const fmtData = (d: string) => { const [a, m, dd] = String(d).slice(0, 10).split("-"); return `${dd}/${m}/${a}`; };

// deno-lint-ignore no-explicit-any
let httpClient: any = null;
function client() {
  if (httpClient) return httpClient;
  const cert = Deno.env.get("SICOOB_CERT_PEM"), key = Deno.env.get("SICOOB_KEY_PEM");
  if (!cert || !key) throw new Error("Certificado do Sicoob ainda não foi cadastrado no servidor (segredos SICOOB_CERT_PEM / SICOOB_KEY_PEM). Até lá, a emissão Sicoob sai pelo robô.");
  // deno-lint-ignore no-explicit-any
  httpClient = (Deno as any).createHttpClient({ cert, key });
  return httpClient;
}

let tokenCache: { v: string; exp: number } | null = null;
async function token(): Promise<string> {
  if (tokenCache && tokenCache.exp - Date.now() > 30_000) return tokenCache.v;
  const body = `grant_type=client_credentials&client_id=${CLIENT_ID}&scope=${encodeURIComponent("boletos_inclusao boletos_consulta")}`;
  const r = await fetch("https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, client: client(),
  // deno-lint-ignore no-explicit-any
  } as any);
  const t = await r.json().catch(() => ({}));
  if (!t.access_token) throw new Error(`Sicoob recusou a autenticação (HTTP ${r.status}) — confira se o certificado cadastrado é o e-CNPJ válido.`);
  tokenCache = { v: t.access_token, exp: Date.now() + (t.expires_in ?? 300) * 1000 };
  return t.access_token;
}

async function sicoob(method: string, path: string, payload?: unknown) {
  const r = await fetch(`https://api.sicoob.com.br/cobranca-bancaria/v3${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, client_id: CLIENT_ID, ...(payload ? { "Content-Type": "application/json" } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    client: client(),
  // deno-lint-ignore no-explicit-any
  } as any);
  return { status: r.status, body: await r.text() };
}

async function autenticarAdmin(req: Request): Promise<string | null> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await supa.auth.getUser(jwt);
  if (error || !data?.user) return null;
  const { data: perfil } = await supa.from("usuarios").select("tipo").eq("id", data.user.id).maybeSingle();
  return perfil?.tipo === "admin" ? data.user.id : null;
}

// deno-lint-ignore no-explicit-any
async function emitir(adminId: string, body: any): Promise<Response> {
  const id = String(body.pagamento_id ?? "");
  // deno-lint-ignore no-explicit-any
  const pl: any = body.pagador ?? {};
  const hoje = new Date().toISOString().slice(0, 10);
  if (!id) return json({ ok: false, motivo: "pagamento_id obrigatório" }, 400);

  const { data: p } = await supa.from("pagamentos_prosoluto").select("id, venda_id, tipo, numero_parcela, valor, data_prevista, status").eq("id", id).maybeSingle();
  if (!p) return json({ ok: false, motivo: "parcela não encontrada" });
  const { data: v } = await supa.from("vendas").select("id, cliente_id, unidade, status, excluido").eq("id", p.venda_id).maybeSingle();
  const ref = `${v?.unidade ?? "?"} parc ${p.numero_parcela}`;
  if (p.status !== "pendente") return json({ ok: false, ref, motivo: `parcela está ${p.status}, não pendente` });
  if (p.data_prevista <= hoje) return json({ ok: false, ref, motivo: `vencimento ${fmtData(p.data_prevista)} já passou` });
  if (!v || v.excluido || v.status === "distrato") return json({ ok: false, ref, motivo: "venda inativa/distratada" });
  const { data: vivo } = await supa.from("boletos").select("banco").eq("pagamento_id", id).not("status", "in", "(cancelado,baixado,erro)").limit(1);
  if (vivo?.length) return json({ ok: false, ref, motivo: `já tem boleto ${vivo[0].banco} vivo (não duplica)` });
  const { data: c } = await supa.from("clientes").select("id, nome_completo, cpf, cnpj, endereco, cidade, estado, cep").eq("id", v.cliente_id).maybeSingle();
  if (!c) return json({ ok: false, ref, motivo: "venda sem cliente" });
  const doc = dig(c.cpf) || dig(c.cnpj);
  if (!doc) return json({ ok: false, ref, motivo: `${c.nome_completo} sem CPF/CNPJ no cadastro` });
  const rua = String(pl.endereco ?? c.endereco ?? "").trim();
  const cidade = String(pl.cidade ?? c.cidade ?? "").trim();
  const uf = String(pl.uf ?? c.estado ?? "").toUpperCase().trim();
  const cep = dig(pl.cep ?? c.cep);
  if (!rua || !cidade || !uf || !cep) return json({ ok: false, ref, motivo: `${c.nome_completo}: endereço incompleto (rua/cidade/UF/CEP) — preencha na planilha de Clientes ou no cadastro` });

  const seuNumero = String(p.id).replace(/-/g, "").slice(0, 15);
  const descricao = `${p.tipo === "balao" ? "Balao" : "Parcela"} ${p.numero_parcela} - Unidade ${v.unidade}`.slice(0, 40);
  const payload = {
    numeroCliente: NUMERO_CLIENTE, codigoModalidade: 1, numeroContaCorrente: NUMERO_CONTA,
    codigoEspecieDocumento: "DM", dataEmissao: hoje, seuNumero,
    identificacaoEmissaoBoleto: 1, identificacaoDistribuicaoBoleto: 1,
    valor: Number(p.valor), dataVencimento: p.data_prevista, valorAbatimento: 0,
    tipoDesconto: 0, valorPrimeiroDesconto: 0, valorSegundoDesconto: 0, valorTerceiroDesconto: 0,
    tipoMulta: 0, dataMulta: p.data_prevista, valorMulta: 0,
    tipoJurosMora: 3, dataJurosMora: p.data_prevista, valorJurosMora: 0,
    numeroParcela: Number(p.numero_parcela) || 1, aceite: true,
    pagador: {
      numeroCpfCnpj: doc, nome: String(pl.nome ?? c.nome_completo).slice(0, 50),
      endereco: rua.slice(0, 40), bairro: String(pl.bairro ?? "Centro").slice(0, 30),
      cidade: cidade.slice(0, 30), cep, uf,
    },
    mensagensInstrucao: [descricao], gerarPdf: false, codigoCadastrarPIX: 0,
  };

  const r = await sicoob("POST", "/boletos", payload);
  // deno-lint-ignore no-explicit-any
  let res: any = {}; try { const j = JSON.parse(r.body); res = j.resultado ?? j; } catch { /* não-JSON */ }
  if (r.status !== 200 || res.nossoNumero == null) {
    let msg = r.body.slice(0, 200);
    // deno-lint-ignore no-explicit-any
    try { const j = JSON.parse(r.body); msg = (j.mensagens ?? []).map((m: any) => m.mensagem).join("; ") || msg; } catch { /* mantém */ }
    return json({ ok: false, ref, motivo: `banco recusou: ${msg}` });
  }
  const { data: novo, error: insErr } = await supa.from("boletos").insert({
    pagamento_id: p.id, venda_id: v.id, cliente_id: c.id, banco: "sicoob", ambiente: "producao",
    nosso_numero: String(res.nossoNumero), seu_numero: seuNumero,
    linha_digitavel: res.linhaDigitavel ?? null, codigo_barras: res.codigoBarras ?? null, qrcode_pix: res.qrCode ?? null,
    valor: Number(p.valor), data_emissao: hoje, data_vencimento: p.data_prevista, status: "registrado",
    payload_emissao: payload, retorno_emissao: res, criado_por: adminId,
  }).select("id").single();
  if (insErr || !novo) return json({ ok: false, ref, motivo: `EMITIDO no banco (nosso número ${res.nossoNumero}) mas falhou ao gravar no sistema: ${insErr?.message} — avise o suporte` });

  // PDF oficial (segunda via) — base64 já pronto, só armazena (sem custo de CPU)
  let pdf = false;
  try {
    const sv = await sicoob("GET", `/boletos/segunda-via?numeroCliente=${NUMERO_CLIENTE}&codigoModalidade=1&nossoNumero=${res.nossoNumero}&gerarPdf=true`);
    const b64 = (() => { try { const j = JSON.parse(sv.body); return (j.resultado ?? j).pdfBoleto ?? null; } catch { return null; } })();
    if (b64) {
      const bin = atob(String(b64).replace(/[^A-Za-z0-9+/=]/g, ""));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const { error: upErr } = await supa.storage.from("boletos").upload(`${novo.id}.pdf`, bytes, { contentType: "application/pdf", upsert: true });
      if (!upErr) { await supa.from("boletos").update({ pdf_path: `${novo.id}.pdf` }).eq("id", novo.id); pdf = true; }
    }
  } catch (e) { console.warn("pdf sicoob falhou", novo.id, String(e)); }

  return json({ ok: true, ref, cliente: c.nome_completo, valor: Number(p.valor), nossoNumero: res.nossoNumero, boleto_id: novo.id, pdf });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const rota = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  // deno-lint-ignore no-explicit-any
  let body: any; try { body = await req.json(); } catch { return json({ error: "json inválido" }, 400); }
  const adminId = await autenticarAdmin(req);
  if (!adminId) return json({ error: "apenas administradores emitem boletos" }, 401);
  try {
    if (rota === "status") { client(); await token(); return json({ ok: true, pronto: true }); }
    if (rota === "emitir") return await emitir(adminId, body);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
  return json({ error: "rota não encontrada" }, 404);
});
