// test-contratos.js (na raiz do projeto)
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
  enterpriseId: env.VITE_SIENGE_ENTERPRISE_ID || '2104'
}

if (!config.username || !config.password) {
  console.error('❌ Erro: VITE_SIENGE_USERNAME e VITE_SIENGE_PASSWORD devem estar no .env')
  process.exit(1)
}

const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64')
const url = `${config.baseUrl}/${config.subdomain}/public/api/v1/sales-contracts?enterpriseId=${config.enterpriseId}&limit=5`

console.log('🔍 Buscando contratos de venda do Sienge...')
console.log(`📍 URL: ${url}`)
console.log(`🏢 Empreendimento ID: ${config.enterpriseId}\n`)

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
        const contracts = json.results || json.data || []
        const metadata = json.resultSetMetadata || {}
        
        console.log(`✅ Encontrados ${contracts.length} contrato(s)`)
        if (metadata.count) {
          console.log(`📊 Total disponível: ${metadata.count}\n`)
        } else {
          console.log('')
        }
        
        if (contracts.length === 0) {
          console.log('Nenhum contrato encontrado.')
          console.log('Resposta completa:', JSON.stringify(json, null, 2))
        } else {
          // Mostrar resumo do primeiro contrato
          const primeiro = contracts[0]
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
          console.log('📄 PRIMEIRO CONTRATO (Resumo):')
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
          console.log(`ID: ${primeiro.id}`)
          console.log(`Número: ${primeiro.number || 'N/A'}`)
          console.log(`Valor: R$ ${primeiro.value?.toLocaleString('pt-BR') || 'N/A'}`)
          console.log(`Data do Contrato: ${primeiro.contractDate || 'N/A'}`)
          console.log(`Data de Emissão: ${primeiro.issueDate || 'N/A'}`)
          console.log(`Situação: ${primeiro.situation || 'N/A'}`)
          console.log(`Empreendimento ID: ${primeiro.enterpriseId || 'N/A'}`)
          console.log(`Empreendimento: ${primeiro.enterpriseName || 'N/A'}`)
          
          // Cliente
          if (primeiro.salesContractCustomers && primeiro.salesContractCustomers.length > 0) {
            const cliente = primeiro.salesContractCustomers[0]
            console.log(`\n👤 Cliente:`)
            console.log(`   ID: ${cliente.id || 'N/A'}`)
            console.log(`   Nome: ${cliente.name || 'N/A'}`)
            console.log(`   Principal: ${cliente.main ? 'Sim' : 'Não'}`)
          }
          
          // Unidade
          if (primeiro.salesContractUnits && primeiro.salesContractUnits.length > 0) {
            const unidade = primeiro.salesContractUnits[0]
            console.log(`\n🏠 Unidade:`)
            console.log(`   ID: ${unidade.id || 'N/A'}`)
            console.log(`   Nome: ${unidade.name || 'N/A'}`)
            console.log(`   Principal: ${unidade.main ? 'Sim' : 'Não'}`)
          }
          
          // Corretor
          if (primeiro.brokers && primeiro.brokers.length > 0) {
            const corretor = primeiro.brokers[0]
            console.log(`\n👔 Corretor:`)
            console.log(`   ID: ${corretor.id || 'N/A'}`)
            console.log(`   Principal: ${corretor.main ? 'Sim' : 'Não'}`)
          }
          
          // Condições de Pagamento (é um ARRAY!)
          if (primeiro.paymentConditions && Array.isArray(primeiro.paymentConditions) && primeiro.paymentConditions.length > 0) {
            console.log(`\n💰 Condições de Pagamento (${primeiro.paymentConditions.length} condição(ões)):`)
            
            // Calcular totais
            const totalParcelas = primeiro.paymentConditions.reduce((sum, cond) => sum + (cond.installmentsNumber || 0), 0)
            const totalValor = primeiro.paymentConditions.reduce((sum, cond) => sum + (parseFloat(cond.totalValue) || 0), 0)
            const totalSaldo = primeiro.paymentConditions.reduce((sum, cond) => sum + (parseFloat(cond.outstandingBalance) || 0), 0)
            
            console.log(`   Total de Parcelas: ${totalParcelas || 'N/A'}`)
            console.log(`   Valor Total: R$ ${totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || 'N/A'}`)
            console.log(`   Saldo Devedor: R$ ${totalSaldo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || 'N/A'}`)
            
            // Mostrar cada condição
            console.log(`\n   Detalhes por condição:`)
            primeiro.paymentConditions.forEach((cond, idx) => {
              console.log(`   ${idx + 1}. ${cond.conditionTypeName || 'N/A'}`)
              console.log(`      Parcelas: ${cond.installmentsNumber || 'N/A'}`)
              console.log(`      Valor: R$ ${parseFloat(cond.totalValue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
              console.log(`      Saldo: R$ ${parseFloat(cond.outstandingBalance || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
            })
          } else {
            console.log(`\n💰 Condições de Pagamento: N/A`)
          }
          
          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
          console.log('📋 DADOS COMPLETOS DO PRIMEIRO CONTRATO (JSON):')
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
          console.log(JSON.stringify(primeiro, null, 2))
          
          // Mostrar lista de todos os contratos
          if (contracts.length > 1) {
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
            console.log(`📋 LISTA DE TODOS OS ${contracts.length} CONTRATOS:`)
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
            contracts.forEach((contract, index) => {
              console.log(`\n${index + 1}. Contrato ${contract.number || contract.id}`)
              console.log(`   ID: ${contract.id}`)
              console.log(`   Valor: R$ ${contract.value?.toLocaleString('pt-BR') || 'N/A'}`)
              console.log(`   Data: ${contract.contractDate || 'N/A'}`)
              console.log(`   Cliente ID: ${contract.salesContractCustomers?.[0]?.id || 'N/A'}`)
              console.log(`   Corretor ID: ${contract.brokers?.[0]?.id || 'N/A'}`)
            })
          }
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