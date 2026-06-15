// Proxy de DEV (Node puro, sem Docker/deno/deps) para o e2e do form do Figueira.
// Espelha a edge `cadastro-parceria-proxy`: encaminha /upload, /submit, /empreendimentos pro RH.
// A edge (Deno) continua sendo o runner de PRODUÇÃO; isto é só pra rodar local agora.
//
// Rodar:  node scripts/parceria-proxy.mjs        (Node 18+ — usa fetch global)
// Env:    RH_BASE_URL (default prod) · PARCERIA_API_TOKEN (vazio = anônimo) · PORT (8787)
// Depois: VITE_PARCERIA_PROXY_URL=http://localhost:8787  no .env.local do front
import http from 'node:http'

const RH = process.env.RH_BASE_URL || 'https://rh.investmoneysa.com.br'
const TOKEN = process.env.PARCERIA_API_TOKEN || '' // prod é anônimo; vazio = sem header
const PORT = Number(process.env.PORT || 8787)
const FIGUEIRA_SIENGE = 2104

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-parceria-token',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}
const send = (res, status, body) => {
  res.writeHead(status, { ...CORS, 'content-type': 'application/json' })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}
const rhHeaders = (extra = {}) => (TOKEN ? { 'x-parceria-token': TOKEN, ...extra } : { ...extra })
const readBody = (req) => new Promise((resolve) => {
  const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => resolve(Buffer.concat(c)))
})

http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
    const url = new URL(req.url, `http://localhost:${PORT}`)
    const path = url.pathname.replace(/^\/cadastro-parceria-proxy/, '') || url.pathname

    // catálogo de empreendimentos (o form pega o Figueira)
    if (req.method === 'GET' && path.endsWith('/empreendimentos')) {
      const regiao = url.searchParams.get('regiao') || 'SC'
      const r = await fetch(`${RH}/api/empreendimentos?regiao=${encodeURIComponent(regiao)}`, { headers: rhHeaders() })
      return send(res, r.status, await r.text())
    }

    // upload de documento — byte pass-through (preserva o boundary do multipart)
    if (req.method === 'POST' && path.endsWith('/upload')) {
      const body = await readBody(req)
      const r = await fetch(`${RH}/api/cadastro-negociacao/upload`, {
        method: 'POST',
        headers: rhHeaders({ 'content-type': req.headers['content-type'] }),
        body,
      })
      return send(res, r.status, await r.text())
    }

    // submit final — força Figueira/SC e encaminha
    if (req.method === 'POST' && path.endsWith('/submit')) {
      const raw = await readBody(req)
      let payload = {}
      try { payload = JSON.parse(raw.toString('utf8') || '{}') } catch { /* noop */ }
      payload = { ...payload, regiao: 'SC', sienge_enterprise_id: FIGUEIRA_SIENGE }
      const r = await fetch(`${RH}/api/cadastro-negociacao`, {
        method: 'POST',
        headers: rhHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify(payload),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) return send(res, r.status, { error: 'RH recusou a submissão', status: r.status, detail: data })
      return send(res, 201, { card_id: data.id, warning: data.warning || null })
    }

    return send(res, 404, { error: 'rota não encontrada', path })
  } catch (e) {
    return send(res, 500, { error: String(e) })
  }
}).listen(PORT, () => console.log(`parceria-proxy no ar → ${RH} | http://localhost:${PORT}`))
