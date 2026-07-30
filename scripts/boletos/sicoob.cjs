// Lib compartilhada do worker de boletos Sicoob (PRODUÇÃO, mTLS).
// Ver runbook: scripts/boletos/README.md · arquitetura: docs/contexto/2026-07-29-boletos-sicoob.md
//
// O worker roda numa máquina que tenha o CERTIFICADO e-CNPJ (cert+key PEM) —
// o runtime das edge functions não suporta mTLS, por isso emissão/segunda via
// de produção vivem aqui. client_id sem o certificado não autentica nada.
const https = require('https')
const fs = require('fs')
const path = require('path')

const REPO = path.join(__dirname, '..', '..')

const CONFIG = {
  CLIENT_ID: process.env.SICOOB_CLIENT_ID_PROD || 'baa26af2-61c2-4e8b-98ba-35cef62e4025',
  NUMERO_CLIENTE: Number(process.env.SICOOB_NUMERO_CLIENTE || 3771512), // contrato de cobrança (coop 4368 / conta 119.638-3)
  NUMERO_CONTA: Number(process.env.SICOOB_NUMERO_CONTA || 1196383),
  CERT: process.env.SICOOB_CERT_PEM || 'C:/Users/HP/Downloads/im2_cert.pem',
  KEY: process.env.SICOOB_KEY_PEM || 'C:/Users/HP/Downloads/im2_key.pem',
  WORKER_SECRET_FILE: process.env.BOLETOS_WORKER_SECRET_FILE || 'C:/Users/HP/Downloads/boletos_worker_secret.txt',
}

const cert = fs.readFileSync(CONFIG.CERT)
const key = fs.readFileSync(CONFIG.KEY)

const env = fs.readFileSync(path.join(REPO, '.env'), 'utf8')
const pickEnv = (k) => (env.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim()
const SUPABASE_URL = pickEnv('VITE_SUPABASE_URL')
const SUPABASE_ANON_KEY = pickEnv('VITE_SUPABASE_ANON_KEY')

const { createClient } = require(path.join(REPO, 'node_modules', '@supabase', 'supabase-js'))
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const digitos = (s) => String(s ?? '').replace(/\D/g, '')
const dormir = (ms) => new Promise(r => setTimeout(r, ms))

// request HTTPS com certificado de cliente (mTLS)
function reqMtls(opts, body) {
  return new Promise((resolve) => {
    const r = https.request({ ...opts, cert, key }, (res) => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => resolve({ status: res.statusCode, body: d }))
    })
    r.on('error', (e) => resolve({ status: 0, body: e.message }))
    if (body) r.write(body)
    r.end()
  })
}

// token OAuth2 client_credentials (dura 300s — renovar a cada ~40-50 chamadas)
async function obterToken(scopes = 'boletos_inclusao boletos_consulta boletos_alteracao') {
  const b = `grant_type=client_credentials&client_id=${CONFIG.CLIENT_ID}&scope=${encodeURIComponent(scopes)}`
  const t = await reqMtls({
    host: 'auth.sicoob.com.br',
    path: '/auth/realms/cooperado/protocol/openid-connect/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(b) },
  }, b)
  const token = JSON.parse(t.body).access_token
  if (!token) throw new Error('falha no token Sicoob: ' + t.body.slice(0, 200))
  return token
}

function sicoobApi(token, method, pathApi, payloadObj) {
  const body = payloadObj ? JSON.stringify(payloadObj) : null
  return reqMtls({
    host: 'api.sicoob.com.br',
    path: `/cobranca-bancaria/v3${pathApi}`,
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'client_id': CONFIG.CLIENT_ID,
      ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
    },
  }, body)
}

const workerSecret = () => fs.readFileSync(CONFIG.WORKER_SECRET_FILE, 'utf8').trim()

module.exports = { CONFIG, SUPABASE_URL, supabase, digitos, dormir, reqMtls, obterToken, sicoobApi, workerSecret }
