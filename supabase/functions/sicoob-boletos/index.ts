// Edge function — Boletos Sicoob (Cobrança Bancária V3)
//
// Camada própria de cobrança da IM: emissão, consulta, cancelamento e webhook
// de liquidação de boletos das parcelas pro-soluto. Ver arquitetura em
// docs/contexto/2026-07-29-boletos-sicoob.md.
//
// INVARIANTE: esta function NUNCA altera pagamentos_prosoluto — só a tabela
// `boletos`. A baixa da parcela segue o fluxo existente (admin/Sienge).
//
// Ambientes:
//  * sandbox  — token estático do portal developers (SICOOB_ACCESS_TOKEN),
//               sem mTLS. Base: https://sandbox.sicoob.com.br/sicoob/sandbox/cobranca-bancaria/v3
//  * producao — OAuth2 client_credentials + mTLS (certificado e-CNPJ).
//               PENDENTE: validar Deno.createHttpClient com cert no edge
//               runtime quando as credenciais chegarem.
//
// Rotas:
//  POST /            {acao:'emitir', pagamento_id, data_vencimento?}   admin
//  POST /            {acao:'consultar', boleto_id}                     admin|dono
//  POST /            {acao:'cancelar', boleto_id, motivo?}             admin
//  POST /            {acao:'segunda_via', boleto_id}                   admin|dono (PDF base64)
//  POST /webhook     payload do Sicoob (sem JWT — banco não autentica)
//
// verify_jwt da plataforma DESLIGADO (webhook + preflight); autenticação das
// ações administrativas é feita AQUI (JWT do chamador + usuarios.tipo).
import "@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

// Config Sicoob (Supabase secrets)
const SICOOB_AMBIENTE = Deno.env.get("SICOOB_AMBIENTE") ?? "sandbox"
const SICOOB_BASE_URL = Deno.env.get("SICOOB_BASE_URL") ??
  (SICOOB_AMBIENTE === "producao"
    ? "https://api.sicoob.com.br/cobranca-bancaria/v3"
    : "https://sandbox.sicoob.com.br/sicoob/sandbox/cobranca-bancaria/v3")
const SICOOB_CLIENT_ID = Deno.env.get("SICOOB_CLIENT_ID") ?? ""
const SICOOB_ACCESS_TOKEN = Deno.env.get("SICOOB_ACCESS_TOKEN") ?? "" // sandbox: token estático do portal
const SICOOB_NUMERO_CLIENTE = Number(Deno.env.get("SICOOB_NUMERO_CLIENTE") ?? "0") // código do beneficiário na cooperativa
const SICOOB_NUMERO_CONTA = Number(Deno.env.get("SICOOB_NUMERO_CONTA") ?? "0")
const CODIGO_MODALIDADE = 1 // cobrança simples com registro
// Segredo do worker local (emissão/PDFs de produção rodam fora do edge — mTLS)
const WORKER_SECRET = Deno.env.get("BOLETOS_WORKER_SECRET") ?? ""

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } })

const db = () => createClient(SUPABASE_URL, SERVICE_ROLE)

// ── HTTP Sicoob ──────────────────────────────────────────────────────────────
function sicoobConfigurado(): boolean {
  return Boolean(SICOOB_CLIENT_ID && SICOOB_ACCESS_TOKEN && SICOOB_NUMERO_CLIENTE && SICOOB_NUMERO_CONTA)
}

async function sicoobFetch(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: unknown }> {
  // TODO produção: obter token via OAuth2 client_credentials em
  // https://auth.sicoob.com.br/... com mTLS. Sandbox usa token estático.
  const res = await fetch(`${SICOOB_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${SICOOB_ACCESS_TOKEN}`,
      "client_id": SICOOB_CLIENT_ID,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  let body: unknown = null
  try { body = await res.json() } catch { body = await res.text().catch(() => null) }
  return { ok: res.ok, status: res.status, body }
}

// Respostas V3 vêm embrulhadas em { resultado: ... } — desembrulha defensivamente
const resultado = (body: unknown): Record<string, unknown> => {
  const b = body as Record<string, unknown> | null
  if (b && typeof b === "object" && b.resultado && typeof b.resultado === "object") {
    return b.resultado as Record<string, unknown>
  }
  return (b ?? {}) as Record<string, unknown>
}

// ── Autenticação/autorização ────────────────────────────────────────────────
type Caller = { userId: string; tipo: string }

async function autenticar(req: Request): Promise<Caller | null> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
  if (!jwt) return null
  const admin = db()
  const { data, error } = await admin.auth.getUser(jwt)
  if (error || !data?.user) return null
  const { data: perfil } = await admin.from("usuarios").select("tipo").eq("id", data.user.id).maybeSingle()
  return { userId: data.user.id, tipo: perfil?.tipo ?? "" }
}

async function donoDoBoleto(caller: Caller, boleto: { cliente_id: string | null }): Promise<boolean> {
  if (!boleto.cliente_id) return false
  const { data } = await db()
    .from("clientes")
    .select("id")
    .eq("id", boleto.cliente_id)
    .eq("user_id", caller.userId)
    .maybeSingle()
  return Boolean(data)
}

// ── Ações ────────────────────────────────────────────────────────────────────
async function emitir(caller: Caller, body: Record<string, unknown>): Promise<Response> {
  if (caller.tipo !== "admin") return json({ error: "apenas administradores emitem boletos" }, 403)
  if (!sicoobConfigurado()) {
    return json({ error: "integração Sicoob não configurada — defina os secrets SICOOB_* no Supabase" }, 503)
  }
  const pagamentoId = String(body.pagamento_id ?? "")
  if (!pagamentoId) return json({ error: "pagamento_id é obrigatório" }, 400)

  const admin = db()
  const { data: parcela, error: pagErr } = await admin
    .from("pagamentos_prosoluto")
    .select("id, venda_id, tipo, numero_parcela, valor, data_prevista, status")
    .eq("id", pagamentoId)
    .maybeSingle()
  if (pagErr) return json({ error: pagErr.message }, 500)
  if (!parcela) return json({ error: "parcela não encontrada" }, 404)
  if (parcela.status !== "pendente") {
    return json({ error: `parcela está '${parcela.status}' — só se emite boleto de parcela pendente` }, 400)
  }

  const { data: venda } = await admin
    .from("vendas")
    .select("id, cliente_id, status, excluido, unidade, bloco")
    .eq("id", parcela.venda_id)
    .maybeSingle()
  if (!venda) return json({ error: "venda da parcela não encontrada" }, 404)
  if (venda.excluido === true || venda.status === "distrato") {
    return json({ error: "venda excluída/distratada — não emite boleto" }, 400)
  }

  const { data: cliente } = await admin
    .from("clientes")
    .select("id, nome_completo, cpf, cnpj, endereco, cep, cidade, estado")
    .eq("id", venda.cliente_id)
    .maybeSingle()
  if (!cliente) return json({ error: "cliente da venda não encontrado" }, 404)

  const cpfCnpj = (cliente.cpf || cliente.cnpj || "").replace(/\D/g, "")

  // Cidade/UF: colunas dedicadas quando existem; senão extrai do fim do
  // endereço (padrão Sienge: "Rua X, nº 1, Bairro, Cidade, SC"). Auditoria
  // 2026-07-29: 0/324 clientes têm as colunas preenchidas, mas 288 têm o
  // endereço completo com cidade/UF embutidos.
  const matchEnd = String(cliente.endereco ?? "").match(/,\s*([^,]+?)\s*,\s*([A-Za-z]{2})\s*$/)
  const cidade = cliente.cidade || matchEnd?.[1]?.trim() || ""
  const uf = (cliente.estado || matchEnd?.[2] || "").toUpperCase()

  const faltando = [
    !cliente.nome_completo && "nome",
    !cpfCnpj && "CPF/CNPJ",
    !cliente.endereco && "endereço",
    !cliente.cep && "CEP",
    !cidade && "cidade",
    !uf && "UF",
  ].filter(Boolean)
  if (faltando.length > 0) {
    return json({ error: `cadastro do cliente incompleto para emissão: falta ${faltando.join(", ")}` }, 400)
  }

  const hoje = new Date().toISOString().slice(0, 10)
  const dataVencimento = String(body.data_vencimento ?? parcela.data_prevista ?? "")
  if (!dataVencimento) return json({ error: "parcela sem data_prevista — informe data_vencimento" }, 400)
  if (dataVencimento < hoje) {
    return json({ error: `vencimento ${dataVencimento} já passou — informe data_vencimento futura para re-emissão` }, 400)
  }

  // seuNumero: rastreável de volta pra parcela (uuid sem hífens, 15 chars)
  const seuNumero = pagamentoId.replace(/-/g, "").slice(0, 15)

  // Payload validado contra o schema do sandbox V3 em 2026-07-29: os campos
  // numéricos de desconto/multa/juros/protesto são OBRIGATÓRIOS (zerados =
  // sem cobrança extra; tipoJurosMora 3 = isento). Juros/multa por atraso é
  // regra de negócio pendente — ver docs/contexto/2026-07-29-boletos-sicoob.md.
  const payload = {
    numeroCliente: SICOOB_NUMERO_CLIENTE,
    codigoModalidade: CODIGO_MODALIDADE,
    numeroContaCorrente: SICOOB_NUMERO_CONTA,
    codigoEspecieDocumento: "DM",
    dataEmissao: hoje,
    seuNumero,
    identificacaoEmissaoBoleto: 1,       // banco emite (registro online)
    identificacaoDistribuicaoBoleto: 1,  // nós distribuímos (portal do cliente)
    valor: Number(parcela.valor),
    dataVencimento,
    valorAbatimento: 0,
    tipoDesconto: 0,
    valorPrimeiroDesconto: 0,
    valorSegundoDesconto: 0,
    valorTerceiroDesconto: 0,
    tipoMulta: 0,
    dataMulta: dataVencimento,
    valorMulta: 0,
    tipoJurosMora: 3,                    // 3 = isento
    dataJurosMora: dataVencimento,
    valorJurosMora: 0,
    numeroParcela: Number(parcela.numero_parcela) || 1,
    aceite: true,
    // NÃO enviar blocos de protesto E negativação juntos (nem zerados) — o
    // validador de produção rejeita ("Informe apenas os dados de Protesto ou
    // de Negativação", 2026-07-30). Omitimos ambos.
    pagador: {
      numeroCpfCnpj: cpfCnpj,
      nome: cliente.nome_completo,
      endereco: cliente.endereco,
      bairro: String(body.bairro ?? "Centro"),
      cidade,
      cep: String(cliente.cep).replace(/\D/g, ""),
      uf,
    },
    // máx. 40 chars por linha de instrução (validador de produção, 2026-07-30)
    mensagensInstrucao: [
      `Parcela ${parcela.numero_parcela ?? ""} - Unidade ${venda.unidade ?? ""} ${venda.bloco ?? ""}`.trim().slice(0, 40),
    ],
    gerarPdf: false,
    codigoCadastrarPIX: 1,               // boleto híbrido (QR Pix junto)
  }

  const resp = await sicoobFetch("/boletos", { method: "POST", body: JSON.stringify(payload) })
  if (!resp.ok) {
    return json({ error: "Sicoob recusou a emissão", detalhe: resp.body, status_banco: resp.status }, 502)
  }

  const r = resultado(resp.body)
  // Sandbox: o mock devolve sempre o MESMO nossoNumero — gera um único por
  // emissão. Precisa ser NUMÉRICO: o schema da API valida nossoNumero como
  // inteiro nas consultas/segunda-via (testado 2026-07-29).
  const nossoNumero = SICOOB_AMBIENTE === "sandbox"
    ? String(Date.now())
    : (r.nossoNumero != null ? String(r.nossoNumero) : null)
  const { data: boleto, error: insErr } = await admin
    .from("boletos")
    .insert({
      pagamento_id: parcela.id,
      venda_id: venda.id,
      cliente_id: cliente.id,
      banco: "sicoob",
      ambiente: SICOOB_AMBIENTE,
      nosso_numero: nossoNumero,
      seu_numero: seuNumero,
      linha_digitavel: (r.linhaDigitavel as string) ?? null,
      codigo_barras: (r.codigoBarras as string) ?? null,
      qrcode_pix: (r.qrCode as string) ?? null,
      valor: Number(parcela.valor),
      data_emissao: hoje,
      data_vencimento: dataVencimento,
      status: "registrado",
      payload_emissao: payload,
      retorno_emissao: resp.body,
      criado_por: caller.userId,
    })
    .select()
    .single()
  if (insErr) {
    // Boleto ficou no banco mas não no nosso registro — erro grave, devolver tudo pra investigação
    return json({ error: `boleto emitido no Sicoob mas falhou ao gravar localmente: ${insErr.message}`, retorno_banco: resp.body }, 500)
  }

  return json({ ok: true, boleto })
}

async function consultar(caller: Caller, body: Record<string, unknown>): Promise<Response> {
  const boletoId = String(body.boleto_id ?? "")
  if (!boletoId) return json({ error: "boleto_id é obrigatório" }, 400)

  const admin = db()
  const { data: boleto } = await admin.from("boletos").select("*").eq("id", boletoId).maybeSingle()
  if (!boleto) return json({ error: "boleto não encontrado" }, 404)

  if (caller.tipo !== "admin" && !(await donoDoBoleto(caller, boleto))) {
    return json({ error: "sem permissão" }, 403)
  }
  if (!sicoobConfigurado()) return json({ ok: true, boleto, aviso: "integração não configurada — status local" })

  const qs = new URLSearchParams({
    numeroCliente: String(SICOOB_NUMERO_CLIENTE),
    codigoModalidade: String(CODIGO_MODALIDADE),
    nossoNumero: String(boleto.nosso_numero ?? ""),
  })
  const resp = await sicoobFetch(`/boletos?${qs}`)
  if (!resp.ok) return json({ ok: true, boleto, aviso: "consulta ao Sicoob falhou — status local", detalhe: resp.body })

  const r = resultado(resp.body)
  const atualizado = await aplicarSituacaoSicoob(boleto, r)
  return json({ ok: true, boleto: atualizado ?? boleto, situacao_banco: r })
}

async function cancelar(caller: Caller, body: Record<string, unknown>): Promise<Response> {
  if (caller.tipo !== "admin") return json({ error: "apenas administradores cancelam boletos" }, 403)
  const boletoId = String(body.boleto_id ?? "")
  if (!boletoId) return json({ error: "boleto_id é obrigatório" }, 400)

  const admin = db()
  const { data: boleto } = await admin.from("boletos").select("*").eq("id", boletoId).maybeSingle()
  if (!boleto) return json({ error: "boleto não encontrado" }, 404)
  if (boleto.status === "pago") return json({ error: "boleto já pago — não se cancela" }, 400)
  if (["cancelado", "baixado"].includes(boleto.status)) return json({ ok: true, boleto, aviso: "já cancelado" })

  if (sicoobConfigurado() && boleto.nosso_numero) {
    // Baixa no Sicoob V3 é PATCH /boletos/{nossoNumero}/baixar
    const resp = await sicoobFetch(`/boletos/${boleto.nosso_numero}/baixar`, {
      method: "PATCH",
      body: JSON.stringify({ numeroCliente: SICOOB_NUMERO_CLIENTE, codigoModalidade: CODIGO_MODALIDADE }),
    })
    if (!resp.ok) return json({ error: "Sicoob recusou a baixa do boleto", detalhe: resp.body }, 502)
  }

  const { data: atualizado, error } = await admin
    .from("boletos")
    .update({ status: "cancelado", motivo_cancelamento: String(body.motivo ?? "cancelado pelo admin") })
    .eq("id", boletoId)
    .select()
    .single()
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true, boleto: atualizado })
}

async function segundaVia(caller: Caller, body: Record<string, unknown>): Promise<Response> {
  const boletoId = String(body.boleto_id ?? "")
  if (!boletoId) return json({ error: "boleto_id é obrigatório" }, 400)

  const admin = db()
  const { data: boleto } = await admin.from("boletos").select("*").eq("id", boletoId).maybeSingle()
  if (!boleto) return json({ error: "boleto não encontrado" }, 404)
  if (caller.tipo !== "admin" && !(await donoDoBoleto(caller, boleto))) {
    return json({ error: "sem permissão" }, 403)
  }

  // 1º: PDF oficial armazenado no Storage (populado pelo worker de produção —
  // o edge não tem o certificado mTLS pra buscar na API real)
  if (boleto.pdf_path) {
    const { data: arquivo, error: dlErr } = await admin.storage.from("boletos").download(boleto.pdf_path)
    if (!dlErr && arquivo) {
      const bytes = new Uint8Array(await arquivo.arrayBuffer())
      let bin = ""
      for (let i = 0; i < bytes.length; i += 8192) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 8192))
      }
      return json({ ok: true, pdf_base64: btoa(bin), linha_digitavel: boleto.linha_digitavel })
    }
  }

  if (boleto.ambiente === "producao") {
    return json({ error: "PDF ainda não disponível — aguarde a sincronização de PDFs do lote" }, 404)
  }
  if (!sicoobConfigurado()) return json({ error: "integração Sicoob não configurada" }, 503)
  if (!boleto.nosso_numero) return json({ error: "boleto sem nossoNumero — não há segunda via" }, 400)

  const qs = new URLSearchParams({
    numeroCliente: String(SICOOB_NUMERO_CLIENTE),
    codigoModalidade: String(CODIGO_MODALIDADE),
    nossoNumero: String(boleto.nosso_numero),
    gerarPdf: "true",
  })
  const resp = await sicoobFetch(`/boletos/segunda-via?${qs}`)
  if (!resp.ok) return json({ error: "Sicoob não retornou a segunda via", detalhe: resp.body }, 502)

  const r = resultado(resp.body)
  return json({ ok: true, pdf_base64: r.pdfBoleto ?? null, linha_digitavel: r.linhaDigitavel ?? boleto.linha_digitavel })
}

// Mapeia a situação retornada pelo Sicoob pro nosso status e aplica se mudou
async function aplicarSituacaoSicoob(
  boleto: { id: string; status: string },
  r: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const situacao = String(r.situacaoBoleto ?? r.situacao ?? "").toLowerCase()
  let novoStatus: string | null = null
  if (situacao.includes("liquid")) novoStatus = "pago"
  else if (situacao.includes("baixa")) novoStatus = "baixado"
  else if (situacao.includes("vencid")) novoStatus = "vencido"
  else if (situacao.includes("aberto") || situacao.includes("registrad")) novoStatus = "registrado"
  if (!novoStatus || novoStatus === boleto.status) return null

  const patch: Record<string, unknown> = { status: novoStatus }
  if (novoStatus === "pago") {
    patch.data_pagamento = r.dataLiquidacao ?? r.dataPagamento ?? new Date().toISOString().slice(0, 10)
    patch.valor_pago = r.valorPago ?? r.valorLiquidado ?? null
  }
  const { data } = await db().from("boletos").update(patch).eq("id", boleto.id).select().single()
  return data
}

// Recebe do WORKER local (autenticado por segredo) o PDF oficial baixado da
// produção via mTLS e o guarda no Storage; segunda_via passa a servi-lo.
async function armazenarPdf(body: Record<string, unknown>): Promise<Response> {
  if (!WORKER_SECRET || String(body.worker_secret ?? "") !== WORKER_SECRET) {
    return json({ error: "worker_secret inválido" }, 403)
  }
  const boletoId = String(body.boleto_id ?? "")
  const pdfB64 = String(body.pdf_base64 ?? "")
  if (!boletoId || !pdfB64) return json({ error: "boleto_id e pdf_base64 são obrigatórios" }, 400)

  const admin = db()
  const { data: boleto } = await admin.from("boletos").select("id").eq("id", boletoId).maybeSingle()
  if (!boleto) return json({ error: "boleto não encontrado" }, 404)

  const bin = atob(pdfB64.replace(/[^A-Za-z0-9+/=]/g, ""))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  if (bytes.length < 1000) return json({ error: `PDF suspeito de truncado (${bytes.length} bytes) — não armazenado` }, 400)

  const path = `${boletoId}.pdf`
  const { error: upErr } = await admin.storage.from("boletos")
    .upload(path, bytes, { contentType: "application/pdf", upsert: true })
  if (upErr) return json({ error: `falha no upload: ${upErr.message}` }, 500)

  const { error: dbErr } = await admin.from("boletos").update({ pdf_path: path }).eq("id", boletoId)
  if (dbErr) return json({ error: dbErr.message }, 500)
  return json({ ok: true, pdf_path: path, bytes: bytes.length })
}

// ── Webhook (Sicoob → nós) ──────────────────────────────────────────────────
// O banco notifica liquidação/baixa. Não confiamos cegamente no payload:
// registramos o evento e, quando possível, CONFIRMAMOS via consulta na API
// antes de marcar pago. Sem match → evento fica em boletos órfãos? Não:
// devolvemos 200 sempre (banco não deve re-tentar infinitamente) e logamos.
async function webhook(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* payload não-JSON: ignora corpo */ }

  // Candidatos a nossoNumero no payload (formato varia por tipo de evento)
  const candidatos = new Set<string>()
  const coletar = (obj: unknown) => {
    if (!obj || typeof obj !== "object") return
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (/nossonumero/i.test(k) && v != null) candidatos.add(String(v))
      if (typeof v === "object") coletar(v)
    }
  }
  coletar(body)

  const admin = db()
  const evento = { recebido_em: new Date().toISOString(), payload: body }

  if (candidatos.size === 0) {
    console.warn("webhook sicoob sem nossoNumero identificável", JSON.stringify(body).slice(0, 500))
    return json({ ok: true, aviso: "evento sem nossoNumero" })
  }

  for (const nossoNumero of candidatos) {
    const { data: boleto } = await admin
      .from("boletos")
      .select("*")
      .eq("banco", "sicoob")
      .eq("nosso_numero", nossoNumero)
      .maybeSingle()
    if (!boleto) {
      console.warn(`webhook sicoob: boleto nossoNumero=${nossoNumero} não encontrado`)
      continue
    }

    // registra o evento no histórico do boleto
    await admin
      .from("boletos")
      .update({ webhook_eventos: [...(boleto.webhook_eventos ?? []), evento] })
      .eq("id", boleto.id)

    // confirma na API antes de mudar status (defesa contra payload forjado)
    if (sicoobConfigurado()) {
      const qs = new URLSearchParams({
        numeroCliente: String(SICOOB_NUMERO_CLIENTE),
        codigoModalidade: String(CODIGO_MODALIDADE),
        nossoNumero,
      })
      const resp = await sicoobFetch(`/boletos?${qs}`)
      if (resp.ok) await aplicarSituacaoSicoob(boleto, resultado(resp.body))
    }
  }

  return json({ ok: true })
}

// ── Router ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "edge mal configurada" }, 500)

  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/sicoob-boletos/, "") || "/"

  try {
    if (path === "/webhook") return await webhook(req)

    // ação do worker autenticada por segredo próprio (sem JWT de usuário)
    if (path === "/armazenar-pdf") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
      return await armazenarPdf(body)
    }

    const caller = await autenticar(req)
    if (!caller) return json({ error: "não autenticado" }, 401)

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const acao = String(body.acao ?? "")

    if (acao === "emitir") return await emitir(caller, body)
    if (acao === "consultar") return await consultar(caller, body)
    if (acao === "cancelar") return await cancelar(caller, body)
    if (acao === "segunda_via") return await segundaVia(caller, body)

    return json({ error: `ação desconhecida: ${acao}` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
