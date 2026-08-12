// Lib compartilhada do worker de boletos AILOS (banco 085, API de Cobrança WSO2).
// Ver runbook: scripts/boletos/README.md (seção Ailos)
//
// Diferente do Sicoob, a Ailos NÃO exige mTLS. Dois níveis de credencial:
//  1. Token do CLIENT — OAuth2 client_credentials (Consumer Key/Secret), ~1h.
//     Header: Authorization: Bearer <token>
//  2. Code do COOPERADO — autorização interativa única (tela de login Ailos ->
//     callback edge function) + refresh programático.
//     Header: x-ailos-authentication: Bearer <code>
// Estado persistido em ailos_tokens (migration 038).
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const REPO = path.join(__dirname, '..', '..')

// ---- credenciais (.env.ailos[.producao], fora do git) ----
// Ambiente: AILOS_ENV=producao usa .env.ailos.producao; default homolog (.env.ailos)
const AMBIENTE_SEL = (process.env.AILOS_ENV || 'homolog').toLowerCase()
const envAilosPath = path.join(__dirname, AMBIENTE_SEL === 'producao' ? '.env.ailos.producao' : '.env.ailos')
if (!fs.existsSync(envAilosPath)) {
  console.error(`ERRO: ${path.basename(envAilosPath)} não encontrado (credenciais Ailos ${AMBIENTE_SEL}).`)
  process.exit(1)
}
const envAilos = fs.readFileSync(envAilosPath, 'utf8')
const pick = (src, k) => (src.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim()

const CONFIG = {
  AMBIENTE: pick(envAilos, 'AILOS_AMBIENTE') || 'homolog',
  HOST: pick(envAilos, 'AILOS_HOST') || 'https://apiendpointhml.ailos.coop.br',
  CONSUMER_KEY: pick(envAilos, 'AILOS_CONSUMER_KEY'),
  CONSUMER_SECRET: pick(envAilos, 'AILOS_CONSUMER_SECRET'),
  API_KEY_DEVELOPER: pick(envAilos, 'AILOS_API_KEY_DEVELOPER'),
  CONVENIO: pick(envAilos, 'AILOS_CONVENIO') || '101004',
  CARTEIRA: pick(envAilos, 'AILOS_CARTEIRA') || '01',
  AGENCIA: pick(envAilos, 'AILOS_AGENCIA') || '0101-5',
  CEDENTE: pick(envAilos, 'AILOS_CEDENTE') || '20974370',
}

// ---- supabase (mesmo padrão do sicoob.cjs) ----
const envRepo = fs.readFileSync(path.join(REPO, '.env'), 'utf8')
const SUPABASE_URL = pick(envRepo, 'VITE_SUPABASE_URL')
const SUPABASE_ANON_KEY = pick(envRepo, 'VITE_SUPABASE_ANON_KEY')
const { createClient } = require(path.join(REPO, 'node_modules', '@supabase', 'supabase-js'))
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/ailos-boletos/callback`

const dormir = (ms) => new Promise(r => setTimeout(r, ms))

// ---- HTTP (fetch nativo do Node 18+) ----
async function req(url, opts = {}) {
  const res = await fetch(url, opts)
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: text }
}

// ---- nível 1: token do client (cache em ailos_tokens) ----
async function obterTokenClient({ forcar = false } = {}) {
  const { data: row, error } = await supabase
    .from('ailos_tokens').select('*').eq('id', CONFIG.AMBIENTE).single()
  if (error) throw new Error('ailos_tokens não encontrada: ' + error.message)

  const valido = row.access_token && row.access_token_expira_em &&
    new Date(row.access_token_expira_em).getTime() - Date.now() > 60_000
  if (valido && !forcar) return row.access_token

  const basic = Buffer.from(`${CONFIG.CONSUMER_KEY}:${CONFIG.CONSUMER_SECRET}`).toString('base64')
  const r = await req(`${CONFIG.HOST}/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (r.status !== 200) throw new Error(`token client falhou (${r.status}): ${r.body.slice(0, 300)}`)
  const tok = JSON.parse(r.body)

  await supabase.from('ailos_tokens').update({
    access_token: tok.access_token,
    access_token_expira_em: new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', CONFIG.AMBIENTE)

  return tok.access_token
}

// ---- nível 2: autorização do cooperado ----
// Inicia o fluxo: grava state, pede o id da tela de login e devolve a URL
// que o operador deve abrir no navegador (login com conta+senha de API).
async function iniciarLoginCooperado() {
  const token = await obterTokenClient()
  const state = `${CONFIG.AMBIENTE}-${crypto.randomUUID()}`

  const { error } = await supabase.from('ailos_tokens')
    .update({ state_pendente: state, updated_at: new Date().toISOString() })
    .eq('id', CONFIG.AMBIENTE)
  if (error) throw error

  const r = await req(`${CONFIG.HOST}/ailos/identity/api/v1/autenticacao/login/obter/id`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'text/plain',
    },
    body: JSON.stringify({
      ailosApiKeyDeveloper: CONFIG.API_KEY_DEVELOPER,
      state,
      urlCallback: CALLBACK_URL,
    }),
  })
  if (r.status !== 200) throw new Error(`obter/id falhou (${r.status}): ${r.body.slice(0, 500)}`)

  const id = r.body.trim().replace(/^"|"$/g, '')
  const loginUrl = `${CONFIG.HOST}/ailos/identity/api/v1/login/index?id=${encodeURIComponent(id)}`
  return { state, loginUrl }
}

// Aguarda o callback gravar o code (poll na tabela).
async function aguardarCodeCooperado({ timeoutMs = 5 * 60_000 } = {}) {
  const inicio = Date.now()
  while (Date.now() - inicio < timeoutMs) {
    const { data: row } = await supabase
      .from('ailos_tokens').select('cooperado_code, state_pendente')
      .eq('id', CONFIG.AMBIENTE).single()
    if (row?.cooperado_code && !row.state_pendente) return row.cooperado_code
    await dormir(3000)
  }
  throw new Error('timeout aguardando autorização do cooperado (callback não chegou)')
}

async function obterCodeCooperado() {
  const { data: row } = await supabase
    .from('ailos_tokens').select('cooperado_code').eq('id', CONFIG.AMBIENTE).single()
  if (!row?.cooperado_code) {
    throw new Error('cooperado não autorizado ainda — rode: node ailos-login.cjs')
  }
  return row.cooperado_code
}

// Refresh do code do cooperado (sem interação).
async function refreshCodeCooperado() {
  const token = await obterTokenClient()
  const code = await obterCodeCooperado()
  const r = await req(
    `${CONFIG.HOST}/ailos/identity/api/v1/autenticacao/token/refresh?code=${encodeURIComponent(code)}`,
    { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } },
  )
  if (r.status !== 200) throw new Error(`refresh cooperado falhou (${r.status}): ${r.body.slice(0, 300)}`)
  const novo = r.body.trim().replace(/^"|"$/g, '')
  await supabase.from('ailos_tokens').update({
    cooperado_code: novo,
    cooperado_code_atualizado_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', CONFIG.AMBIENTE)
  return novo
}

// ---- chamada de API de cobrança (com retry de 401 nos dois níveis) ----
async function ailosApi(method, pathApi, payloadObj, { _tentativa = 0 } = {}) {
  const token = await obterTokenClient()
  const code = await obterCodeCooperado()
  const r = await req(`${CONFIG.HOST}${pathApi}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-ailos-authentication': `Bearer ${code}`,
      'Accept': 'application/json',
      ...(payloadObj ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(payloadObj ? { body: JSON.stringify(payloadObj) } : {}),
  })

  if (r.status === 401 && _tentativa < 2) {
    const www = r.headers.get('www-authenticate') || ''
    if (www.includes('WSO2')) {
      // token do client expirou
      await obterTokenClient({ forcar: true })
    } else {
      // code do cooperado expirou
      await refreshCodeCooperado()
    }
    return ailosApi(method, pathApi, payloadObj, { _tentativa: _tentativa + 1 })
  }
  return r
}

module.exports = {
  CONFIG, SUPABASE_URL, supabase, dormir, CALLBACK_URL,
  obterTokenClient, iniciarLoginCooperado, aguardarCodeCooperado,
  obterCodeCooperado, refreshCodeCooperado, ailosApi,
}
