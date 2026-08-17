// Edge function ailos-boletos — API de Cobrança Ailos (banco 085), SEM mTLS.
//
// Rotas (verify_jwt=false; autenticação própria por rota):
//   POST /callback     — {state, code} da tela de login do cooperado (anti-CSRF: state_pendente)
//   POST /webhook      — notificações Ailos → boletos.webhook_eventos (nunca toca pagamentos_prosoluto)
//   POST /emitir-lote  — ADMIN (JWT) emite boletos das parcelas informadas: RECONFERE no servidor
//                        (pendente + sem boleto vivo em qualquer banco + endereço), emite V2 com
//                        bolePix, grava boletos banco='ailos', gera PDF (layout homologado) e
//                        armazena no Storage 'boletos'. Idempotente por parcela.
//
// Segredos: AILOS_CONSUMER_KEY / AILOS_CONSUMER_SECRET (env ou Vault via RPC ailos_segredo).
// Estado de tokens em ailos_tokens (migration 038). Ver scripts/boletos/README.md.

import { createClient } from "npm:@supabase/supabase-js@2";
import { jsPDF } from "npm:jspdf@3.0.4";

const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const AMBIENTE = "producao";
const HOST = "https://apiendpoint.ailos.coop.br";
const CONVENIO = "101004";
const CARTEIRA = 1;
const AGENCIA_CODIGO = "0101-5 / 20974370";
const BENEF = { nome: "IM CONSTRUTORA E INCORPORADORA", cnpj: "14587169000102" };
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

// ── PDF (mesmo layout homologado de scripts/boletos/ailos-boleto-pdf.cjs) ───
const ITF: Record<string, string> = { "0": "nnwwn", "1": "wnnnw", "2": "nwnnw", "3": "wwnnn", "4": "nnwnw", "5": "wnwnn", "6": "nwwnn", "7": "nnnww", "8": "wnnwn", "9": "nwnwn" };
// deno-lint-ignore no-explicit-any
function drawITF(doc: any, codigo: string, x: number, y: number, h = 13) {
  const d = dig(codigo); const n = 0.254, w = n * 3; let cx = x;
  doc.setFillColor(0, 0, 0);
  const bar = (l: number) => { doc.rect(cx, y, l, h, "F"); cx += l; };
  const gap = (l: number) => { cx += l; };
  bar(n); gap(n); bar(n); gap(n);
  for (let i = 0; i < d.length; i += 2) {
    const b = ITF[d[i]], s = ITF[d[i + 1]];
    for (let j = 0; j < 5; j++) { bar(b[j] === "w" ? w : n); gap(s[j] === "w" ? w : n); }
  }
  bar(w); gap(n); bar(n);
}
const fmtBRL = (v: number) => "R$ " + v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const fmtData = (d: string) => { const [a, m, dd] = String(d).slice(0, 10).split("-"); return `${dd}/${m}/${a}`; };
const fmtDoc = (s: string) => { const d = dig(s); return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : s; };

let LOGO_B64: string | null = null;
async function logo(): Promise<string | null> {
  if (LOGO_B64) return LOGO_B64;
  const { data } = await supa.storage.from("boletos").download("_assets/ailos-logo.png");
  if (!data) return null;
  const buf = new Uint8Array(await data.arrayBuffer());
  let s = ""; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  LOGO_B64 = btoa(s); return LOGO_B64;
}

// deno-lint-ignore no-explicit-any
async function gerarPdf(d: any): Promise<Uint8Array> {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setLineWidth(0.2);
  const M = 8, LARG = 194, wDir = 42;
  const lg = await logo();
  const cab = (x: number, y: number, label: string) => { doc.setFont("helvetica", "normal"); doc.setFontSize(5.5); doc.text(label, x + 0.8, y + 2.2); };
  // deno-lint-ignore no-explicit-any
  const val = (x: number, y: number, w: number, t: string, o: any = {}) => { doc.setFont("helvetica", o.bold === false ? "normal" : "bold"); doc.setFontSize(o.size ?? 8); if (o.right) doc.text(t, x + w - 1, y + 6, { align: "right" }); else doc.text(t, x + 0.8, y + 6); };
  const bloco = (yTop: number, titulo: string, comBarcode: boolean) => {
    let y = yTop;
    if (lg) doc.addImage(lg, "PNG", M + 2, y + 0.75, 19, 6.5, "logoAilos", "FAST");
    else { doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text("AILOS", M + 2, y + 6); }
    doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.line(M + 32, y, M + 32, y + 8); doc.text("085-0", M + 34, y + 6); doc.line(M + 48, y, M + 48, y + 8);
    doc.setFontSize(comBarcode ? 10.5 : 9.5); doc.text(d.linhaDigitavel, M + LARG - 1, y + 6, { align: "right" });
    doc.line(M, y + 8, M + LARG, y + 8);
    doc.setFont("helvetica", "italic"); doc.setFontSize(6.5); doc.text(titulo, M + LARG - 1, y - 1, { align: "right" });
    y += 8;
    // deno-lint-ignore no-explicit-any
    const linha = (h: number, cols: any[]) => { let x = M; for (const c of cols) { doc.rect(x, y, c.w, h); if (c.label) cab(x, y, c.label); if (c.v !== undefined) val(x, y, c.w, c.v, c.o); x += c.w; } y += h; };
    linha(8, [{ w: LARG - wDir, label: "Local de Pagamento", v: "PAGÁVEL PREFERENCIALMENTE NAS COOPERATIVAS DO SISTEMA AILOS", o: { bold: false, size: 7 } }, { w: wDir, label: "Vencimento", v: fmtData(d.vencimento), o: { right: true } }]);
    linha(8, [{ w: LARG - wDir, label: "Beneficiário", v: `${BENEF.nome}  -  CNPJ: ${fmtDoc(BENEF.cnpj)}`, o: { bold: false, size: 7.5 } }, { w: wDir, label: "Agência/Código Beneficiário", v: AGENCIA_CODIGO, o: { right: true } }]);
    linha(8, [{ w: 30, label: "Data do Documento", v: fmtData(d.dataDoc), o: { bold: false, size: 7.5 } }, { w: 40, label: "Nº do Documento", v: String(d.numeroDoc), o: { bold: false, size: 7.5 } }, { w: 22, label: "Espécie Doc.", v: "MENS", o: { bold: false, size: 7.5 } }, { w: 16, label: "Aceite", v: "N", o: { bold: false, size: 7.5 } }, { w: LARG - wDir - 108, label: "Data Processamento", v: fmtData(d.dataDoc), o: { bold: false, size: 7.5 } }, { w: wDir, label: "Nosso Número", v: String(d.nossoNumero), o: { right: true } }]);
    linha(8, [{ w: 30, label: "Uso do Banco", v: "" }, { w: 20, label: "Carteira", v: "01", o: { bold: false, size: 7.5 } }, { w: 20, label: "Espécie Moeda", v: "R$", o: { bold: false, size: 7.5 } }, { w: 24, label: "Quantidade", v: "" }, { w: LARG - wDir - 94, label: "(x) Valor", v: "" }, { w: wDir, label: "(=) Valor do Documento", v: fmtBRL(d.valor), o: { right: true } }]);
    const hI = 30, xDir = M + LARG - wDir;
    doc.rect(M, y, LARG - wDir, hI); cab(M, y, "Instruções (texto de responsabilidade do beneficiário)");
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
    d.instrucoes.slice(0, 6).forEach((t: string, i: number) => doc.text(t, M + 1, y + 6 + i * 3.6));
    if (d.pixQr) { try { doc.addImage(d.pixQr, "PNG", M + LARG - wDir - 26, y + 3, 24, 24); doc.setFontSize(5.5); doc.text("Pague via Pix", M + LARG - wDir - 14, y + 29, { align: "center" }); } catch { /* QR inválido não derruba o PDF */ } }
    ["(-) Desconto/Abatimento", "(-) Outras Deduções", "(+) Mora/Multa", "(+) Outros Acréscimos", "(=) Valor Cobrado"].forEach((r, i) => { doc.rect(xDir, y + i * 6, wDir, 6); cab(xDir, y + i * 6, r); });
    y += hI;
    doc.rect(M, y, LARG, 14); cab(M, y, "Pagador");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.text(`${d.pagador.nome}  -  ${fmtDoc(d.pagador.doc)}`, M + 1, y + 6);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.text(d.pagador.endereco, M + 1, y + 10);
    y += 14;
    doc.setFontSize(6); doc.text("Sacador/Avalista:", M, y + 3.5);
    doc.text(comBarcode ? "Autenticação Mecânica — FICHA DE COMPENSAÇÃO" : "Autenticação Mecânica — RECIBO DO PAGADOR", M + LARG, y + 3.5, { align: "right" });
    y += 6;
    if (comBarcode) { drawITF(doc, d.codigoBarras, M, y + 2, 13); y += 17; }
    return y;
  };
  let y = bloco(14, "RECIBO DO PAGADOR", false);
  y += 4; doc.setLineDashPattern([1.2, 1.2], 0); doc.line(M, y, M + LARG, y); doc.setLineDashPattern([], 0);
  doc.setFontSize(6); doc.text("corte na linha pontilhada", M + LARG, y - 1, { align: "right" }); y += 6;
  bloco(y, "FICHA DE COMPENSAÇÃO", true);
  return new Uint8Array(doc.output("arraybuffer"));
}

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

    let pdfOk = false;
    try {
      const pdf = await gerarPdf({
        linhaDigitavel: b.codigoBarras.linhaDigitavel, codigoBarras: b.codigoBarras.codigoBarras, nossoNumero: b.documento?.nossoNumero,
        pagador: { nome: payload.pagador.entidadeLegal.nome, doc, endereco: `${end.logradouro} - ${end.bairro} - ${end.cidade}/${end.uf} - CEP ${end.cep}` },
        dataDoc: hoje, numeroDoc, valor: Number(p.valor), vencimento: p.data_prevista,
        instrucoes: [descricao, "Nao receber apos 60 dias do vencimento."], pixQr: b.pix?.qrCode || null,
      });
      const { error: upErr } = await supa.storage.from("boletos").upload(`${novo.id}.pdf`, pdf, { contentType: "application/pdf", upsert: true });
      if (!upErr) { pdfOk = true; await supa.from("boletos").update({ pdf_path: `${novo.id}.pdf` }).eq("id", novo.id); }
    } catch (e) { console.warn("pdf falhou", novo.id, String(e)); }

    emitidos.push({ id, ref, cliente: c.nome_completo, valor: Number(p.valor), nossoNumero: b.documento?.nossoNumero, boleto_id: novo.id, pdf: pdfOk });
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
  if (rota === "emitir-lote") {
    try { return await emitirLote(req, body); }
    catch (e) { return json({ error: String((e as Error).message ?? e) }, 500); }
  }
  return new Response("not found", { status: 404 });
});
