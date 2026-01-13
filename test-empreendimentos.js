// test-empreendimentos.js (na raiz do projeto)
import https from 'https'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync } from 'fs'

// Carregar .env manualmente
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let env = {}
try {
  const envFile = readFileSync(join(__dirname, '.env'), 'utf-8')
  envFile.split('\n').forEach(line => {
    const [key, ...values] = line.split('=')
    if (key && values.length > 0) {
      env[key.trim()] = values.join('=').trim().replace(/^["']|["']$/g, '')
    }
  })
} catch (e) {
  console.log('⚠️ Arquivo .env não encontrado, usando valores padrão')
}

const config = {
  baseUrl: env.VITE_SIENGE_BASE_URL || 'https://api.sienge.com.br',
  subdomain: env.VITE_SIENGE_SUBDOMAIN || 'imincorporadora',
  username: env.VITE_SIENGE_USERNAME || '',
  password: env.VITE_SIENGE_PASSWORD || '',
}

if (!config.username || !config.password) {
  console.error('❌ Erro: VITE_SIENGE_USERNAME e VITE_SIENGE_PASSWORD devem estar no .env')
  process.exit(1)
}

const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64')
const url = `${config.baseUrl}/${config.subdomain}/public/api/v1/enterprises`

console.log('🔍 Buscando empreendimentos do Sienge...')
console.log(`📍 URL: ${url}\n`)

const req = https.get(url, {
  headers: {
    'accept': 'application/json',
    'authorization': `Basic ${auth}`
  }
}, (res) => {
  let data = ''
  
  res.on('data', (chunk) => {
    data += chunk
  })
  
  res.on('end', () => {
    if (res.statusCode === 200) {
      try {
        const json = JSON.parse(data)
        const lista = Array.isArray(json) ? json : (json.results || json.data || [])
        
        console.log(`✅ Encontrados ${lista.length} empreendimento(s):\n`)
        
        if (lista.length === 0) {
          console.log('Nenhum empreendimento encontrado.')
          console.log('Resposta completa:', json)
        } else {
          lista.forEach((emp, index) => {
            console.log(`${index + 1}. ID: ${emp.id}`)
            console.log(`   Nome: ${emp.name || emp.nome || 'N/A'}`)
            if (emp.description) console.log(`   Descrição: ${emp.description}`)
            console.log('')
          })
          
          console.log('\n📋 Dados completos do primeiro empreendimento:')
          console.log(JSON.stringify(lista[0], null, 2))
        }
      } catch (e) {
        console.error('❌ Erro ao parsear JSON:', e.message)
        console.log('Resposta:', data)
      }
    } else {
      console.error(`❌ Erro ${res.statusCode}`)
      console.log('Resposta:', data)
    }
  })
})

req.on('error', (error) => {
  console.error('❌ Erro de conexão:', error.message)
})

req.end()