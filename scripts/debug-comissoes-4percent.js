/**
 * Script de Debug: Encontrar pagamentos com comissão de 4% (incorreta)
 * 
 * PROBLEMA: Alguns pagamentos podem ainda estar com o cálculo antigo
 * onde a comissão era aplicada diretamente (4%) ao invés de usar o FATOR (~16.75%)
 * 
 * COMO USAR:
 * 1. Abra o sistema no navegador
 * 2. Vá para a aba de Pagamentos
 * 3. Abra o DevTools (F12)
 * 4. Cole este script no Console e pressione Enter
 */

(async function debugComissoes4Percent() {
  console.log('🔍 Buscando pagamentos com comissão de corretor ~4%...\n');
  
  // Buscar todos os elementos de comissão de corretor
  const comissaoElements = document.querySelectorAll('.comissao-percentual');
  
  if (comissaoElements.length === 0) {
    console.log('⚠️ Nenhum elemento de comissão encontrado.');
    console.log('   Certifique-se de estar na aba de Pagamentos e ter expandido algumas vendas.');
    return;
  }
  
  console.log(`📊 Total de elementos de comissão encontrados: ${comissaoElements.length}\n`);
  
  const problemáticos = [];
  
  comissaoElements.forEach((el, index) => {
    const texto = el.textContent.trim();
    const percentual = parseFloat(texto.replace('%', '').replace(',', '.'));
    
    // Buscar contexto (nome do cargo, valor da comissão)
    const parcelaComissao = el.closest('.parcela-comissao') || el.closest('.comissao-cargo-item');
    const cargoNome = parcelaComissao?.querySelector('.cargo-nome, .comissao-nome')?.textContent || 'N/A';
    const valorComissao = parcelaComissao?.querySelector('.comissao-valor span:first-child')?.textContent || 'N/A';
    
    // Buscar info da venda/parcela
    const vendaCard = el.closest('.venda-pagamento-card');
    const parcelaCard = el.closest('.parcela-item');
    const corretorNome = vendaCard?.querySelector('.corretor-nome, .venda-corretor')?.textContent || 'N/A';
    const unidade = vendaCard?.querySelector('.unidade-info, .venda-unidade')?.textContent || 'N/A';
    const valorParcela = parcelaCard?.querySelector('.parcela-valor')?.textContent || 'N/A';
    
    // Detectar percentuais problemáticos (próximos a 4%, 2%, 0.5%, 1% - valores de cargo, não fator)
    const isProblematico = (
      (percentual >= 3.5 && percentual <= 4.5) ||  // Corretor ~4%
      (percentual >= 1.8 && percentual <= 2.2) ||  // Alguns cargos 2%
      (percentual >= 0.4 && percentual <= 0.6) ||  // Cargos 0.5%
      (percentual >= 0.9 && percentual <= 1.1)     // Cargos 1%
    );
    
    // Foco principal: Corretor com 4%
    const isCorretor4Percent = cargoNome.toLowerCase().includes('corretor') && percentual >= 3.5 && percentual <= 4.5;
    
    if (isCorretor4Percent) {
      problemáticos.push({
        index,
        cargo: cargoNome,
        percentual: texto,
        valorComissao,
        corretor: corretorNome,
        unidade,
        valorParcela,
        elemento: el
      });
    }
  });
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`🚨 PAGAMENTOS COM CORRETOR ~4% (POTENCIALMENTE INCORRETOS): ${problemáticos.length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  if (problemáticos.length === 0) {
    console.log('✅ Nenhum pagamento encontrado com comissão de corretor = 4%');
    console.log('   Isso é BOM! Significa que o fator está sendo aplicado corretamente.\n');
  } else {
    problemáticos.forEach((p, i) => {
      console.log(`[${i + 1}] ─────────────────────────────────`);
      console.log(`   Corretor: ${p.corretor}`);
      console.log(`   Unidade: ${p.unidade}`);
      console.log(`   Cargo: ${p.cargo}`);
      console.log(`   Percentual: ${p.percentual} ⚠️`);
      console.log(`   Valor Comissão: ${p.valorComissao}`);
      console.log(`   Valor Parcela: ${p.valorParcela}`);
      console.log('');
    });
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('💡 EXPLICAÇÃO:');
    console.log('   Se o corretor tem 4% de comissão no cargo, o FATOR deveria ser ~16.75%');
    console.log('   Fórmula: FATOR = (valorVenda × 4%) / proSoluto');
    console.log('');
    console.log('   Se está aparecendo 4%, significa que esses pagamentos');
    console.log('   foram calculados ANTES da correção do fator de comissão.');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    // Destacar visualmente os elementos problemáticos
    console.log('🎯 Destacando elementos no DOM (borda vermelha)...');
    problemáticos.forEach(p => {
      p.elemento.style.border = '2px solid red';
      p.elemento.style.borderRadius = '4px';
      p.elemento.style.padding = '2px 4px';
    });
  }
  
  // Resumo geral
  console.log('\n📈 RESUMO GERAL:');
  console.log(`   Total de comissões na tela: ${comissaoElements.length}`);
  console.log(`   Potencialmente incorretas (4%): ${problemáticos.length}`);
  console.log(`   Taxa de erro: ${((problemáticos.length / comissaoElements.length) * 100).toFixed(2)}%`);
  
  return problemáticos;
})();
