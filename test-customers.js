/**
 * Script para testar e ver dados brutos da API /customers
 * Identifica estrutura real dos dados de clientes para mapeamento completo
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
  apiVersion: 'v1',
  enterpriseId: env.VITE_SIENGE_ENTERPRISE_ID || '2104'
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

async function testCustomers() {
  try {
    console.log('📋 Testando API /customers - Dados brutos (TODAS as páginas)\n')
    console.log('Configuração:')
    console.log(`  Subdomain: ${SIENGE_CONFIG.subdomain}`)
    console.log(`  Enterprise ID: ${SIENGE_CONFIG.enterpriseId}`)
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
      
      const response = await siengeGet('/customers', {
        enterpriseId: SIENGE_CONFIG.enterpriseId,
        onlyActive: false, // Buscar todos (ativos e inativos)
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

    // Analisar tipos de clientes
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📊 ANÁLISE DE TIPOS DE CLIENTES:')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    
    const tiposPorCampo = {}
    
    allResults.forEach((customer) => {
      // Verificar personType (Física ou Jurídica)
      if (customer.personType !== undefined) {
        if (!tiposPorCampo['personType']) tiposPorCampo['personType'] = new Set()
        tiposPorCampo['personType'].add(String(customer.personType))
      }
      
      // Verificar clientType
      if (customer.clientType !== undefined) {
        if (!tiposPorCampo['clientType']) tiposPorCampo['clientType'] = new Set()
        tiposPorCampo['clientType'].add(String(customer.clientType))
      }
      
      // Verificar se tem CPF ou CNPJ
      const temCpf = customer.cpf && customer.cpf.trim() !== ''
      const temCnpj = customer.cnpj && customer.cnpj.trim() !== ''
      if (!tiposPorCampo['tipo_documento']) tiposPorCampo['tipo_documento'] = { cpf: 0, cnpj: 0, nenhum: 0 }
      if (temCpf) tiposPorCampo['tipo_documento'].cpf++
      else if (temCnpj) tiposPorCampo['tipo_documento'].cnpj++
      else tiposPorCampo['tipo_documento'].nenhum++
    })

    Object.entries(tiposPorCampo).forEach(([campo, valores]) => {
      if (campo === 'tipo_documento') {
        console.log(`\n  Campo "${campo}":`)
        console.log(`    CPF: ${valores.cpf} registros`)
        console.log(`    CNPJ: ${valores.cnpj} registros`)
        console.log(`    Nenhum: ${valores.nenhum} registros`)
      } else {
        console.log(`\n  Campo "${campo}":`)
        Array.from(valores).forEach(val => {
          const count = allResults.filter(c => String(c[campo]) === val).length
          console.log(`    "${val}": ${count} registros`)
        })
      }
    })

    // Estatísticas gerais
    const comTelefone = allResults.filter(c => c.phones && c.phones.length > 0).length
    const comEndereco = allResults.filter(c => c.addresses && c.addresses.length > 0).length
    const comEmail = allResults.filter(c => c.email && c.email.trim() !== '').length
    const comCpf = allResults.filter(c => c.cpf && c.cpf.trim() !== '').length
    const comCnpj = allResults.filter(c => c.cnpj && c.cnpj.trim() !== '').length
    const comConjuge = allResults.filter(c => c.spouse && c.spouse.name).length
    const comComplementoRenda = allResults.filter(c => c.familyIncome && c.familyIncome.length > 0).length
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📊 ESTATÍSTICAS GERAIS:')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`  Total de clientes: ${allResults.length}`)
    console.log(`  Com telefone: ${comTelefone} (${((comTelefone/allResults.length)*100).toFixed(1)}%)`)
    console.log(`  Com endereço: ${comEndereco} (${((comEndereco/allResults.length)*100).toFixed(1)}%)`)
    console.log(`  Com email: ${comEmail} (${((comEmail/allResults.length)*100).toFixed(1)}%)`)
    console.log(`  Com CPF: ${comCpf} (${((comCpf/allResults.length)*100).toFixed(1)}%)`)
    console.log(`  Com CNPJ: ${comCnpj} (${((comCnpj/allResults.length)*100).toFixed(1)}%)`)
    console.log(`  Com cônjuge: ${comConjuge} (${((comConjuge/allResults.length)*100).toFixed(1)}%)`)
    console.log(`  Com complemento de renda: ${comComplementoRenda} (${((comComplementoRenda/allResults.length)*100).toFixed(1)}%)`)
    console.log('')

    // Mostrar alguns exemplos
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📋 EXEMPLOS DE CLIENTES (primeiros 5):')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    
    allResults.slice(0, 5).forEach((customer, idx) => {
      console.log(`\n${idx + 1}. ID: ${customer.id}`)
      console.log(`   Nome: ${customer.name || 'N/A'}`)
      console.log(`   CPF: ${customer.cpf || 'N/A'}`)
      console.log(`   CNPJ: ${customer.cnpj || 'N/A'}`)
      console.log(`   Email: ${customer.email || 'N/A'}`)
      console.log(`   Person Type: ${customer.personType || 'N/A'}`)
      console.log(`   Telefones: ${customer.phones?.length || 0}`)
      console.log(`   Endereços: ${customer.addresses?.length || 0}`)
      console.log(`   Cônjuge: ${customer.spouse?.name || 'N/A'}`)
      console.log(`   Created: ${customer.createdAt || 'N/A'}`)
      console.log(`   Modified: ${customer.modifiedAt || 'N/A'}`)
    })

    // Salvar dados brutos completos em arquivo
    const outputPath = join(__dirname, 'customers-raw-data.json')
    writeFileSync(outputPath, JSON.stringify(response, null, 2), 'utf-8')
    console.log(`\n💾 Dados brutos completos salvos em: ${outputPath}`)

  } catch (error) {
    console.error('\n❌ Erro:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

testCustomers()

