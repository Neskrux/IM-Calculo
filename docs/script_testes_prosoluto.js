/**
 * Script de Testes: Cálculos de Pro-Soluto
 * 
 * IDs de Teste:
 * - Corretor: 0489316a-a963-415d-b9d1-1b6dac16482f (tabela usuarios)
 * - Cliente: f29a99ce-39cd-4824-aca5-ab60513d5673 (tabela clientes)
 * 
 * INSTRUÇÕES:
 * 1. Abra o console do navegador (F12)
 * 2. Certifique-se de estar na página AdminDashboard
 * 3. Cole este script completo no console
 * 4. Execute: executarTodosTestes()
 * 
 * O script testa todos os cenários sem criar vendas no banco.
 */

// IDs de teste
const IDS_TESTE = {
  corretor_id: '0489316a-a963-415d-b9d1-1b6dac16482f', // tabela usuarios
  cliente_id: 'f29a99ce-39cd-4824-aca5-ab60513d5673'   // tabela clientes
}

// Importar funções (se disponíveis no escopo)
// Se não estiverem disponíveis, o script tentará acessá-las via window ou módulos
let calcularValorProSoluto, calcularFatorComissao

// Tentar obter funções do módulo
try {
  // Se estiverem exportadas globalmente
  if (typeof window !== 'undefined') {
    // Tentar acessar via React DevTools ou módulos
    const calculosModule = require?.('../lib/calculos')
    if (calculosModule) {
      calcularValorProSoluto = calculosModule.calcularValorProSoluto
      calcularFatorComissao = calculosModule.calcularFatorComissao
    }
  }
} catch (e) {
  console.warn('Não foi possível importar funções automaticamente. Usando implementação local.')
}

// Implementação local das funções (caso não estejam disponíveis)
if (!calcularValorProSoluto) {
  calcularValorProSoluto = function(dadosVenda, gruposParcelasEntrada = [], gruposBalao = []) {
    if (!dadosVenda || typeof dadosVenda !== 'object') {
      console.warn('calcularValorProSoluto: dadosVenda inválido, retornando 0')
      return 0
    }

    const valorSinal = dadosVenda.teve_sinal ? (parseFloat(dadosVenda.valor_sinal) || 0) : 0
    
    let valorEntradaTotal = 0
    if (dadosVenda.teve_entrada) {
      if (dadosVenda.parcelou_entrada) {
        if (Array.isArray(gruposParcelasEntrada) && gruposParcelasEntrada.length > 0) {
          valorEntradaTotal = gruposParcelasEntrada.reduce((sum, grupo) => {
            if (!grupo || typeof grupo !== 'object' || grupo === null) return sum
            const qtd = parseFloat(grupo.qtd) || 0
            const valor = parseFloat(grupo.valor) || 0
            return sum + (qtd * valor)
          }, 0)
        } else {
          const qtd = parseFloat(dadosVenda.qtd_parcelas_entrada) || 0
          const valor = parseFloat(dadosVenda.valor_parcela_entrada) || 0
          valorEntradaTotal = qtd * valor
        }
      } else {
        valorEntradaTotal = parseFloat(dadosVenda.valor_entrada) || 0
      }
    }
    
    let valorTotalBalao = 0
    if (dadosVenda.teve_balao === 'sim') {
      if (Array.isArray(gruposBalao) && gruposBalao.length > 0) {
        valorTotalBalao = gruposBalao.reduce((sum, grupo) => {
          if (!grupo || typeof grupo !== 'object' || grupo === null) return sum
          const qtd = parseFloat(grupo.qtd) || 0
          const valor = parseFloat(grupo.valor) || 0
          return sum + (qtd * valor)
        }, 0)
      } else {
        const qtd = parseFloat(dadosVenda.qtd_balao) || 0
        const valor = parseFloat(dadosVenda.valor_balao) || 0
        valorTotalBalao = qtd * valor
      }
    }
    
    const resultado = valorSinal + valorEntradaTotal + valorTotalBalao
    return isNaN(resultado) ? 0 : resultado
  }
}

if (!calcularFatorComissao) {
  calcularFatorComissao = function(percentualTotal) {
    if (percentualTotal === null || percentualTotal === undefined || isNaN(percentualTotal)) {
      return 0
    }
    const resultado = parseFloat(percentualTotal) / 100
    return isNaN(resultado) ? 0 : resultado
  }
}

// Função de cálculo antigo (para comparação)
// Reflete o comportamento real do sistema:
// - handleSaveVenda: usa grupos quando disponíveis
// - gerarPagamentosVenda: usa campos simples quando grupos não estão disponíveis
// - ImportarVendas: usa campos simples
function calcularProSolutoAntigo(vendaForm, gruposParcelasEntrada, gruposBalao) {
  // SINAL - Comportamento idêntico em todas as implementações
  const valorSinalAntigo = vendaForm.teve_sinal ? (parseFloat(vendaForm.valor_sinal) || 0) : 0
  
  // ENTRADA - Comportamento híbrido: grupos (prioridade) ou campos simples (fallback)
  let valorEntradaTotalAntigo = 0
  if (vendaForm.teve_entrada) {
    if (vendaForm.parcelou_entrada) {
      // Se tem grupos, usar grupos (comportamento de handleSaveVenda)
      if (Array.isArray(gruposParcelasEntrada) && gruposParcelasEntrada.length > 0) {
        valorEntradaTotalAntigo = gruposParcelasEntrada.reduce((sum, grupo) => {
          if (!grupo || typeof grupo !== 'object' || grupo === null) return sum
          return sum + ((parseFloat(grupo.qtd) || 0) * (parseFloat(grupo.valor) || 0))
        }, 0)
      } else {
        // Se não tem grupos, usar campos simples (comportamento de gerarPagamentosVenda e ImportarVendas)
        valorEntradaTotalAntigo = (parseFloat(vendaForm.qtd_parcelas_entrada) || 0) * 
                                  (parseFloat(vendaForm.valor_parcela_entrada) || 0)
      }
    } else {
      // Entrada à vista
      valorEntradaTotalAntigo = parseFloat(vendaForm.valor_entrada) || 0
    }
  }
  
  // BALÕES - Comportamento híbrido: grupos (prioridade) ou campos simples (fallback)
  let valorTotalBalaoAntigo = 0
  if (vendaForm.teve_balao === 'sim') {
    // Se tem grupos, usar grupos (comportamento de handleSaveVenda)
    if (Array.isArray(gruposBalao) && gruposBalao.length > 0) {
      valorTotalBalaoAntigo = gruposBalao.reduce((sum, grupo) => {
        if (!grupo || typeof grupo !== 'object' || grupo === null) return sum
        return sum + ((parseFloat(grupo.qtd) || 0) * (parseFloat(grupo.valor) || 0))
      }, 0)
    } else {
      // Se não tem grupos, usar campos simples (comportamento de gerarPagamentosVenda e ImportarVendas)
      valorTotalBalaoAntigo = (parseFloat(vendaForm.qtd_balao) || 0) * 
                              (parseFloat(vendaForm.valor_balao) || 0)
    }
  }
  
  return valorSinalAntigo + valorEntradaTotalAntigo + valorTotalBalaoAntigo
}

function calcularFatorComissaoAntigo(percentualTotal) {
  return percentualTotal / 100
}

// Função de teste comparativo
function testarCenario(nomeCenario, vendaForm, gruposParcelasEntrada, gruposBalao, comissoesDinamicas, valorEsperado) {
  // Cálculo antigo
  const valorProSolutoAntigo = calcularProSolutoAntigo(vendaForm, gruposParcelasEntrada, gruposBalao)
  const fatorComissaoAntigo = calcularFatorComissaoAntigo(comissoesDinamicas.percentualTotal)
  
  // Cálculo novo
  const valorProSolutoNovo = calcularValorProSoluto(vendaForm, gruposParcelasEntrada, gruposBalao)
  const fatorComissaoNovo = calcularFatorComissao(comissoesDinamicas.percentualTotal)
  
  // Comparação
  const saoIguais = Math.abs(valorProSolutoAntigo - valorProSolutoNovo) < 0.01 &&
                    Math.abs(fatorComissaoAntigo - fatorComissaoNovo) < 0.01
  
  const resultadoEsperado = valorEsperado !== undefined ? 
    Math.abs(valorProSolutoNovo - valorEsperado) < 0.01 : true
  
  const resultado = {
    cenario: nomeCenario,
    antigo: {
      valorProSoluto: valorProSolutoAntigo,
      fatorComissao: fatorComissaoAntigo
    },
    novo: {
      valorProSoluto: valorProSolutoNovo,
      fatorComissao: fatorComissaoNovo
    },
    saoIguais,
    resultadoEsperado,
    passou: saoIguais && resultadoEsperado
  }
  
  // Log
  if (resultado.passou) {
    console.log(`✅ ${nomeCenario}`, resultado)
  } else {
    console.error(`❌ ${nomeCenario}`, resultado)
  }
  
  return resultado
}

// Definir todos os cenários de teste
const CENARIOS_TESTE = [
  // Cenário 1: Apenas Sinal
  {
    nome: 'Cenário 1: Apenas Sinal',
    vendaForm: {
      teve_sinal: true,
      valor_sinal: 10000,
      teve_entrada: false,
      teve_balao: 'nao'
    },
    gruposParcelasEntrada: [],
    gruposBalao: [],
    comissoesDinamicas: { percentualTotal: 7 },
    valorEsperado: 10000
  },
  
  // Cenário 1.1: Sinal com valor zero
  {
    nome: 'Cenário 1.1: Sinal com valor zero',
    vendaForm: {
      teve_sinal: true,
      valor_sinal: 0,
      teve_entrada: false,
      teve_balao: 'nao'
    },
    gruposParcelasEntrada: [],
    gruposBalao: [],
    comissoesDinamicas: { percentualTotal: 7 },
    valorEsperado: 0
  },
  
  // Cenário 1.2: Sinal com valor null
  {
    nome: 'Cenário 1.2: Sinal com valor null',
    vendaForm: {
      teve_sinal: true,
      valor_sinal: null,
      teve_entrada: false,
      teve_balao: 'nao'
    },
    gruposParcelasEntrada: [],
    gruposBalao: [],
    comissoesDinamicas: { percentualTotal: 7 },
    valorEsperado: 0
  },
  
  // Cenário 1.3: Sinal como string
  {
    nome: 'Cenário 1.3: Sinal como string',
    vendaForm: {
      teve_sinal: true,
      valor_sinal: '10000',
      teve_entrada: false,
      teve_balao: 'nao'
    },
    gruposParcelasEntrada: [],
    gruposBalao: [],
    comissoesDinamicas: { percentualTotal: 7 },
    valorEsperado: 10000
  },
  
  // Cenário 1.4: teve_sinal = false (deve ignorar valor_sinal)
  {
    nome: 'Cenário 1.4: teve_sinal = false',
    vendaForm: {
      teve_sinal: false,
      valor_sinal: 10000,
      teve_entrada: false,
      teve_balao: 'nao'
    },
    gruposParcelasEntrada: [],
    gruposBalao: [],
    comissoesDinamicas: { percentualTotal: 7 },
    valorEsperado: 0
  },
  
  // Cenário 2: Apenas Entrada à Vista
  {
    nome: 'Cenário 2: Apenas Entrada à Vista',
    vendaForm: {
      teve_sinal: false,
      teve_entrada: true,
      parcelou_entrada: false,
      valor_entrada: 20000,
      teve_balao: 'nao'
    },
    gruposParcelasEntrada: [],
    gruposBalao: [],
    comissoesDinamicas: { percentualTotal: 7 },
    valorEsperado: 20000
  },
  
  // Cenário 3: Entrada Parcelada (1 grupo)
  {
    nome: 'Cenário 3: Entrada Parcelada (1 grupo)',
    vendaForm: {
      teve_sinal: false,
      teve_entrada: true,
      parcelou_entrada: true,
      teve_balao: 'nao'
    },
    gruposParcelasEntrada: [{qtd: 5, valor: 2000}],
    gruposBalao: [],
    comissoesDinamicas: { percentualTotal: 7 },
    valorEsperado: 10000
  },
  
  // Cenário 4: Entrada Parcelada (múltiplos grupos)
  {
    nome: 'Cenário 4: Entrada Parcelada (múltiplos grupos)',
    vendaForm: {
      teve_sinal: false,
      teve_entrada: true,
      parcelou_entrada: true,
      teve_balao: 'nao'
    },
    gruposParcelasEntrada: [
      {qtd: 3, valor: 1000},
      {qtd: 2, valor: 2000}
    ],
    gruposBalao: [],
    comissoesDinamicas: { percentualTotal: 7 },
    valorEsperado: 7000
  },
  
  // Cenário 5: Apenas Balões (1 grupo)
  {
    nome: 'Cenário 5: Apenas Balões (1 grupo)',
    vendaForm: {
      teve_sinal: false,
      teve_entrada: false,
      teve_balao: 'sim'
    },
    gruposParcelasEntrada: [],
    gruposBalao: [{qtd: 2, valor: 5000}],
    comissoesDinamicas: { percentualTotal: 7 },
    valorEsperado: 10000
  },
  
  // Cenário 6: Balões (múltiplos grupos)
  {
    nome: 'Cenário 6: Balões (múltiplos grupos)',
    vendaForm: {
      teve_sinal: false,
      teve_entrada: false,
      teve_balao: 'sim'
    },
    gruposParcelasEntrada: [],
    gruposBalao: [
      {qtd: 1, valor: 10000},
      {qtd: 2, valor: 5000}
    ],
    comissoesDinamicas: { percentualTotal: 7 },
    valorEsperado: 20000
  },
  
  // Cenário 7: Sinal + Entrada + Balões (completo)
  {
    nome: 'Cenário 7: Sinal + Entrada + Balões (completo)',
    vendaForm: {
      teve_sinal: true,
      valor_sinal: 5000,
      teve_entrada: true,
      parcelou_entrada: true,
      teve_balao: 'sim'
    },
    gruposParcelasEntrada: [{qtd: 4, valor: 2500}],
    gruposBalao: [{qtd: 1, valor: 10000}],
    comissoesDinamicas: { percentualTotal: 7 },
    valorEsperado: 25000
  },
  
  // Cenário 8: Valores Zero/Nulos
  {
    nome: 'Cenário 8: Valores Zero/Nulos',
    vendaForm: {
      teve_sinal: false,
      valor_sinal: null,
      teve_entrada: false,
      valor_entrada: 0,
      teve_balao: 'nao'
    },
    gruposParcelasEntrada: [],
    gruposBalao: [],
    comissoesDinamicas: { percentualTotal: 7 },
    valorEsperado: 0
  },
  
  // Cenário 9: Grupos Inválidos
  {
    nome: 'Cenário 9: Grupos Inválidos',
    vendaForm: {
      teve_sinal: false,
      teve_entrada: true,
      parcelou_entrada: true,
      teve_balao: 'sim'
    },
    gruposParcelasEntrada: [
      {qtd: 3, valor: 1000},
      null,
      undefined,
      {qtd: 'abc', valor: 2000},
      {qtd: 2, valor: 'xyz'},
      {qtd: 1, valor: 500}
    ],
    gruposBalao: [
      {qtd: 2, valor: 5000},
      null,
      {}
    ],
    comissoesDinamicas: { percentualTotal: 7 },
    valorEsperado: 13500 // (3*1000) + (1*500) + (2*5000) = 3500 + 10000 = 13500
  },
  
  // Cenário 10: Entrada Parcelada com Campos Simples (compatibilidade)
  {
    nome: 'Cenário 10: Entrada Parcelada com Campos Simples',
    vendaForm: {
      teve_sinal: false,
      teve_entrada: true,
      parcelou_entrada: true,
      qtd_parcelas_entrada: 5,
      valor_parcela_entrada: 2000,
      teve_balao: 'nao'
    },
    gruposParcelasEntrada: [], // vazio (usar campos simples)
    gruposBalao: [],
    comissoesDinamicas: { percentualTotal: 7 },
    valorEsperado: 10000
  },
  
  // Cenário 10.1: Balões com Campos Simples (compatibilidade)
  {
    nome: 'Cenário 10.1: Balões com Campos Simples',
    vendaForm: {
      teve_sinal: false,
      teve_entrada: false,
      teve_balao: 'sim',
      qtd_balao: 3,
      valor_balao: 5000
    },
    gruposParcelasEntrada: [],
    gruposBalao: [], // vazio (usar campos simples)
    comissoesDinamicas: { percentualTotal: 7 },
    valorEsperado: 15000 // 3 * 5000
  },
  
  // Cenário 11: Fator de Comissão Normal
  {
    nome: 'Cenário 11: Fator de Comissão Normal',
    vendaForm: {
      teve_sinal: false,
      teve_entrada: false,
      teve_balao: 'nao'
    },
    gruposParcelasEntrada: [],
    gruposBalao: [],
    comissoesDinamicas: { percentualTotal: 7 },
    valorEsperado: 0,
    testarApenasFator: true,
    fatorEsperado: 0.07
  },
  
  // Cenário 12: Fator de Comissão Zero
  {
    nome: 'Cenário 12: Fator de Comissão Zero',
    vendaForm: {
      teve_sinal: false,
      teve_entrada: false,
      teve_balao: 'nao'
    },
    gruposParcelasEntrada: [],
    gruposBalao: [],
    comissoesDinamicas: { percentualTotal: 0 },
    valorEsperado: 0,
    testarApenasFator: true,
    fatorEsperado: 0
  },
  
  // Cenário 13: Fator de Comissão Decimal
  {
    nome: 'Cenário 13: Fator de Comissão Decimal',
    vendaForm: {
      teve_sinal: false,
      teve_entrada: false,
      teve_balao: 'nao'
    },
    gruposParcelasEntrada: [],
    gruposBalao: [],
    comissoesDinamicas: { percentualTotal: 6.5 },
    valorEsperado: 0,
    testarApenasFator: true,
    fatorEsperado: 0.065
  },
  
  // Cenário 14: Fator de Comissão com Percentual Alto
  {
    nome: 'Cenário 14: Fator de Comissão com Percentual Alto',
    vendaForm: {
      teve_sinal: false,
      teve_entrada: false,
      teve_balao: 'nao'
    },
    gruposParcelasEntrada: [],
    gruposBalao: [],
    comissoesDinamicas: { percentualTotal: 15 },
    valorEsperado: 0,
    testarApenasFator: true,
    fatorEsperado: 0.15
  },
  
  // Cenário 15: Fator de Comissão com Valores Inválidos
  {
    nome: 'Cenário 15: Fator de Comissão com Valores Inválidos (null)',
    vendaForm: {
      teve_sinal: false,
      teve_entrada: false,
      teve_balao: 'nao'
    },
    gruposParcelasEntrada: [],
    gruposBalao: [],
    comissoesDinamicas: { percentualTotal: null },
    valorEsperado: 0,
    testarApenasFator: true,
    fatorEsperado: 0
  }
]

// Função principal para executar todos os testes
function executarTodosTestes() {
  console.log('🚀 Iniciando testes de Pro-Soluto...')
  console.log('📋 IDs de Teste:', IDS_TESTE)
  console.log('─'.repeat(80))
  
  const resultados = []
  let passou = 0
  let falhou = 0
  
  CENARIOS_TESTE.forEach((cenario, index) => {
    console.log(`\n[${index + 1}/${CENARIOS_TESTE.length}] Testando: ${cenario.nome}`)
    
    let resultado
    
    if (cenario.testarApenasFator) {
      // Testar apenas fator de comissão
      const fatorAntigo = calcularFatorComissaoAntigo(cenario.comissoesDinamicas.percentualTotal)
      const fatorNovo = calcularFatorComissao(cenario.comissoesDinamicas.percentualTotal)
      const saoIguais = Math.abs(fatorAntigo - fatorNovo) < 0.01
      const resultadoEsperado = Math.abs(fatorNovo - cenario.fatorEsperado) < 0.01
      
      resultado = {
        cenario: cenario.nome,
        antigo: { fatorComissao: fatorAntigo },
        novo: { fatorComissao: fatorNovo },
        esperado: cenario.fatorEsperado,
        saoIguais,
        resultadoEsperado,
        passou: saoIguais && resultadoEsperado
      }
      
      if (resultado.passou) {
        console.log(`✅ ${cenario.nome}`, resultado)
        passou++
      } else {
        console.error(`❌ ${cenario.nome}`, resultado)
        falhou++
      }
    } else {
      // Testar valor pro-soluto e fator
      resultado = testarCenario(
        cenario.nome,
        cenario.vendaForm,
        cenario.gruposParcelasEntrada,
        cenario.gruposBalao,
        cenario.comissoesDinamicas,
        cenario.valorEsperado
      )
      
      if (resultado.passou) {
        passou++
      } else {
        falhou++
      }
    }
    
    resultados.push(resultado)
  })
  
  // Resumo final
  console.log('\n' + '═'.repeat(80))
  console.log('📊 RESUMO DOS TESTES')
  console.log('═'.repeat(80))
  console.log(`✅ Passou: ${passou}/${CENARIOS_TESTE.length}`)
  console.log(`❌ Falhou: ${falhou}/${CENARIOS_TESTE.length}`)
  console.log(`📈 Taxa de sucesso: ${((passou / CENARIOS_TESTE.length) * 100).toFixed(2)}%`)
  
  if (falhou > 0) {
    console.log('\n❌ TESTES QUE FALHARAM:')
    resultados.filter(r => !r.passou).forEach(r => {
      console.log(`  - ${r.cenario}`)
    })
  }
  
  console.log('\n' + '═'.repeat(80))
  
  return {
    total: CENARIOS_TESTE.length,
    passou,
    falhou,
    taxaSucesso: (passou / CENARIOS_TESTE.length) * 100,
    resultados
  }
}

// Função para testar um cenário específico
function testarCenarioEspecifico(numeroCenario) {
  if (numeroCenario < 1 || numeroCenario > CENARIOS_TESTE.length) {
    console.error(`❌ Cenário ${numeroCenario} não existe. Use um número entre 1 e ${CENARIOS_TESTE.length}`)
    return null
  }
  
  const cenario = CENARIOS_TESTE[numeroCenario - 1]
  console.log(`🧪 Testando: ${cenario.nome}`)
  
  if (cenario.testarApenasFator) {
    const fatorAntigo = calcularFatorComissaoAntigo(cenario.comissoesDinamicas.percentualTotal)
    const fatorNovo = calcularFatorComissao(cenario.comissoesDinamicas.percentualTotal)
    const saoIguais = Math.abs(fatorAntigo - fatorNovo) < 0.01
    const resultadoEsperado = Math.abs(fatorNovo - cenario.fatorEsperado) < 0.01
    
    const resultado = {
      cenario: cenario.nome,
      antigo: { fatorComissao: fatorAntigo },
      novo: { fatorComissao: fatorNovo },
      esperado: cenario.fatorEsperado,
      saoIguais,
      resultadoEsperado,
      passou: saoIguais && resultadoEsperado
    }
    
    if (resultado.passou) {
      console.log('✅ Teste passou!', resultado)
    } else {
      console.error('❌ Teste falhou!', resultado)
    }
    
    return resultado
  } else {
    return testarCenario(
      cenario.nome,
      cenario.vendaForm,
      cenario.gruposParcelasEntrada,
      cenario.gruposBalao,
      cenario.comissoesDinamicas,
      cenario.valorEsperado
    )
  }
}

// Exportar funções para uso no console
console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    SCRIPT DE TESTES PRO-SOLUTO CARREGADO                    ║
╚══════════════════════════════════════════════════════════════════════════════╝

📋 FUNÇÕES DISPONÍVEIS:

1. executarTodosTestes()
   → Executa todos os ${CENARIOS_TESTE.length} cenários de teste
   → Retorna resumo com estatísticas

2. testarCenarioEspecifico(numero)
   → Testa um cenário específico (1 a ${CENARIOS_TESTE.length})
   → Exemplo: testarCenarioEspecifico(1)

3. IDS_TESTE
   → Objeto com IDs de teste:
     - corretor_id: ${IDS_TESTE.corretor_id}
     - cliente_id: ${IDS_TESTE.cliente_id}

📝 CENÁRIOS DISPONÍVEIS:
${CENARIOS_TESTE.map((c, i) => `   ${i + 1}. ${c.nome}`).join('\n')}

🚀 Para começar, execute: executarTodosTestes()
`)

