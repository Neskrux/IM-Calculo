/**
 * Script para testar e ver dados brutos da API /creditors
 * Identifica estrutura real dos dados para filtrar corretores corretamente
 */

import https from 'https'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync, writeFileSync } from 'fs'

// Carregar .env manualmente (mesmo método do test-empreendimentos.js)
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

const SIENGE_CONFIG = {
  baseUrl: env.VITE_SIENGE_BASE_URL || 'https://api.sienge.com.br',
  subdomain: env.VITE_SIENGE_SUBDOMAIN || 'imincorporadora',
  username: env.VITE_SIENGE_USERNAME || '',
  password: env.VITE_SIENGE_PASSWORD || '',
  apiVersion: 'v1'
}

if (!SIENGE_CONFIG.username || !SIENGE_CONFIG.password) {
  console.error('❌ Erro: VITE_SIENGE_USERNAME e VITE_SIENGE_PASSWORD devem estar no .env')
  process.exit(1)
}

function getSiengeUrl(endpoint) {
  const base = `${SIENGE_CONFIG.baseUrl}/${SIENGE_CONFIG.subdomain}/public/api/${SIENGE_CONFIG.apiVersion}`
  return `${base}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`
}

function getSiengeAuth() {
  const authString = `${SIENGE_CONFIG.username}:${SIENGE_CONFIG.password}`
  return `Basic ${Buffer.from(authString).toString('base64')}`
}

function siengeGet(endpoint, params = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(getSiengeUrl(endpoint))
    
    // Adicionar parâmetros de query
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        url.searchParams.append(key, value)
      }
    })

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'authorization': getSiengeAuth()
      }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`🔍 Fazendo requisição: ${url.toString()}`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

    const req = https.request(options, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(json)}`))
            return
          }
          
          resolve(json)
        } catch (error) {
          reject(new Error(`Erro ao parsear JSON: ${error.message}\nResposta: ${data.substring(0, 500)}`))
        }
      })
    })

    req.on('error', (error) => {
      reject(error)
    })

    req.end()
  })
}

async function testCreditors() {
  try {
    console.log('📋 Testando API /creditors - Dados brutos (TODAS as páginas)\n')
    console.log('Configuração:')
    console.log(`  Subdomain: ${SIENGE_CONFIG.subdomain}`)
    console.log(`  Username: ${SIENGE_CONFIG.username ? '✅ Configurado' : '❌ Não configurado'}`)
    console.log('')

    // Buscar TODAS as páginas com paginação automática
    const limit = 200
    let offset = 0
    let allResults = []
    let totalCount = null
    let page = 1

    while (true) {
      console.log(`\n📄 Buscando página ${page} (offset: ${offset}, limit: ${limit})...`)
      
      const response = await siengeGet('/creditors', {
        limit,
        offset
      })

      if (!response.results || response.results.length === 0) {
        console.log('⚠️ Nenhum resultado nesta página, parando paginação')
        break
      }

      allResults = allResults.concat(response.results)
      
      if (totalCount === null) {
        totalCount = response.resultSetMetadata?.count || null
        console.log(`\n✅ Primeira página recebida!`)
        console.log(`Total de registros na API: ${totalCount || 'N/A'}`)
        console.log(`Registros nesta página: ${response.results.length}`)
      } else {
        console.log(`  ✅ Página ${page}: ${response.results.length} registros`)
      }

      // Verificar se tem mais páginas
      const currentCount = allResults.length
      if (totalCount && currentCount >= totalCount) {
        console.log(`\n✅ Todas as páginas buscadas! Total: ${currentCount} registros`)
        break
      }

      if (response.results.length < limit) {
        console.log(`\n✅ Última página (menos de ${limit} registros)`)
        break
      }

      offset += limit
      page++
    }

    console.log(`\n📊 Total de registros coletados: ${allResults.length}`)
    console.log('')

    if (allResults.length === 0) {
      console.log('⚠️ Nenhum resultado encontrado')
      return
    }

    // Criar objeto de resposta completo para análise
    const response = {
      resultSetMetadata: {
        count: allResults.length,
        offset: 0,
        limit: allResults.length
      },
      results: allResults
    }

    // Analisar estrutura do primeiro registro
    const primeiro = allResults[0]
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📊 ESTRUTURA DO PRIMEIRO REGISTRO:')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(JSON.stringify(primeiro, null, 2))
    console.log('')

    // Listar todos os campos disponíveis
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('🔑 CAMPOS DISPONÍVEIS:')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    Object.keys(primeiro).forEach(key => {
      const value = primeiro[key]
      const tipo = Array.isArray(value) ? 'array' : typeof value
      const preview = typeof value === 'string' 
        ? (value.length > 50 ? value.substring(0, 50) + '...' : value)
        : (typeof value === 'object' && value !== null ? JSON.stringify(value).substring(0, 50) + '...' : value)
      console.log(`  ${key}: ${tipo} = ${preview}`)
    })
    console.log('')

    // Analisar tipos de credores
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📊 ANÁLISE DE TIPOS DE CREDORES:')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    
    const tiposEncontrados = new Set()
    const tiposPorCampo = {}
    
    allResults.forEach((creditor, idx) => {
      // Verificar campo 'broker'
      if (creditor.broker !== undefined) {
        const brokerValue = creditor.broker
        if (!tiposPorCampo['broker']) tiposPorCampo['broker'] = new Set()
        tiposPorCampo['broker'].add(String(brokerValue))
      }
      
      // Verificar campo 'type' ou 'creditorType'
      if (creditor.type !== undefined) {
        if (!tiposPorCampo['type']) tiposPorCampo['type'] = new Set()
        tiposPorCampo['type'].add(String(creditor.type))
      }
      
      if (creditor.creditorType !== undefined) {
        if (!tiposPorCampo['creditorType']) tiposPorCampo['creditorType'] = new Set()
        tiposPorCampo['creditorType'].add(String(creditor.creditorType))
      }
      
      // Verificar se tem algum campo que indique tipo
      Object.keys(creditor).forEach(key => {
        if (key.toLowerCase().includes('tipo') || key.toLowerCase().includes('type')) {
          const value = creditor[key]
          if (value !== null && value !== undefined) {
            if (!tiposPorCampo[key]) tiposPorCampo[key] = new Set()
            tiposPorCampo[key].add(String(value))
          }
        }
      })
    })

    Object.entries(tiposPorCampo).forEach(([campo, valores]) => {
      console.log(`\n  Campo "${campo}":`)
      Array.from(valores).forEach(val => {
        const count = allResults.filter(c => String(c[campo]) === val).length
        console.log(`    "${val}": ${count} registros`)
      })
    })

    // Filtrar apenas corretores para análise
    const corretores = allResults.filter(c => c.broker === "S")
    const naoCorretores = allResults.filter(c => c.broker === "N")
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📊 ESTATÍSTICAS:')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`  Total de credores: ${allResults.length}`)
    console.log(`  Corretores (broker: "S"): ${corretores.length}`)
    console.log(`  Não-corretores (broker: "N"): ${naoCorretores.length}`)
    console.log('')

    // Mostrar alguns exemplos de corretores
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📋 EXEMPLOS DE CORRETORES (primeiros 5):')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    
    corretores.slice(0, 5).forEach((creditor, idx) => {
      console.log(`\n${idx + 1}. ID: ${creditor.id}`)
      console.log(`   Nome: ${creditor.name || creditor.tradeName || 'N/A'}`)
      console.log(`   CPF: ${creditor.cpf || 'N/A'}`)
      console.log(`   CNPJ: ${creditor.cnpj || 'N/A'}`)
      if (creditor.broker !== undefined) console.log(`   broker: ${creditor.broker}`)
      if (creditor.type !== undefined) console.log(`   type: ${creditor.type}`)
      if (creditor.creditorType !== undefined) console.log(`   creditorType: ${creditor.creditorType}`)
    })

    // Salvar dados brutos completos em arquivo
    const outputPath = join(__dirname, 'creditors-raw-data.json')
    writeFileSync(outputPath, JSON.stringify(response, null, 2), 'utf-8')
    console.log(`\n💾 Dados brutos completos salvos em: ${outputPath}`)
    
    // Salvar apenas corretores em arquivo separado
    const corretoresPath = join(__dirname, 'creditors-corretores-only.json')
    const corretoresData = {
      resultSetMetadata: {
        count: corretores.length,
        offset: 0,
        limit: corretores.length
      },
      results: corretores
    }
    writeFileSync(corretoresPath, JSON.stringify(corretoresData, null, 2), 'utf-8')
    console.log(`💾 Apenas corretores salvos em: ${corretoresPath}`)

  } catch (error) {
    console.error('\n❌ Erro:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

testCreditors()

