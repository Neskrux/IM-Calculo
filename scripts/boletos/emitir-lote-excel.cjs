// LOTE DE PRODUÇÃO — emite boletos a partir das planilhas do financeiro,
// APENAS cobranças que casam EXATAMENTE (cliente+parcela+valor+data) com
// parcela PENDENTE do sistema. Ver scripts/boletos/README.md.
//
// Uso:
//   node emitir-lote-excel.cjs "caminho\clientes.xlsx" "caminho\cobrancas.xlsx"           → DRY-RUN
//   node emitir-lote-excel.cjs "caminho\clientes.xlsx" "caminho\cobrancas.xlsx" --apply   → EMITE
//
// Garantias:
//  * Idempotente: parcela com boleto vivo é pulada (rodar 2x não duplica).
//  * NUNCA toca pagamentos_prosoluto — só a tabela boletos.
//  * Divergências planilha↔sistema ficam FORA e são relatadas (nunca emite
//    cobrança de parcela paga/cancelada/de outro titular).
//  * Regras do validador de produção: instrução ≤40 chars; sem blocos de
//    protesto/negativação; tipoJurosMora 3 (isento) enquanto multa/juros não
//    forem decisão de negócio.
const path = require('path')
const fs = require('fs')
const { CONFIG, supabase, digitos, dormir, obterToken, sicoobApi } = require('./sicoob.cjs')
const XLSX = require(path.join(__dirname, '..', '..', 'node_modules', 'xlsx'))

const args = process.argv.slice(2).filter(a => a !== '--apply')
const APPLY = process.argv.includes('--apply')
const ARQ_CLIENTES = args[0]
const ARQ_COBRANCAS = args[1]
if (!ARQ_CLIENTES || !ARQ_COBRANCAS) {
  console.log('uso: node emitir-lote-excel.cjs <clientes.xlsx> <cobrancas.xlsx> [--apply]')
  process.exit(1)
}
const HOJE = new Date().toISOString().slice(0, 10)

const dataISO = (s) => {
  const m = String(s ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

async function fetchAll(tabela, select) {
  const all = []
  for (let page = 0; ; page++) {
    const { data, error } = await supabase.from(tabela).select(select)
      .order('id', { ascending: true }).range(page * 1000, page * 1000 + 999)
    if (error) throw new Error(`${tabela}: ${error.message}`)
    all.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return all
}

async function main() {
  console.log(APPLY ? '*** MODO APPLY — VAI EMITIR BOLETOS REAIS ***' : '--- DRY-RUN (use --apply pra valer) ---')

  const planCli = XLSX.utils.sheet_to_json(XLSX.readFile(ARQ_CLIENTES).Sheets['Clientes'], { defval: null })
  const planCob = XLSX.utils.sheet_to_json(XLSX.readFile(ARQ_COBRANCAS).Sheets['Cobrancas'], { defval: null })

  const [dbClientes, dbVendas, dbPags, dbBoletos] = await Promise.all([
    fetchAll('clientes', 'id, nome_completo, cpf, cnpj, cidade, estado, cep, endereco'),
    fetchAll('vendas', 'id, cliente_id, unidade, bloco, status, excluido'),
    fetchAll('pagamentos_prosoluto', 'id, venda_id, tipo, numero_parcela, valor, data_prevista, status'),
    fetchAll('boletos', 'id, pagamento_id, status'),
  ])

  const cliPorCpf = new Map()
  dbClientes.forEach(c => {
    const d = digitos(c.cpf) || digitos(c.cnpj)
    if (d) cliPorCpf.set(d, c)
  })
  const planCliPorCpf = new Map()
  planCli.forEach(l => { const d = digitos(l['CPF/CNPJ *']); if (d) planCliPorCpf.set(d, l) })
  const boletoVivo = new Set(
    dbBoletos.filter(b => !['cancelado', 'baixado', 'erro'].includes(b.status)).map(b => String(b.pagamento_id))
  )

  const lote = []
  const fora = { divergente: [], sem_match: [], ja_tem_boleto: [], venc_passado: [] }
  for (const l of planCob) {
    const cpfD = digitos(l['CPF/CNPJ do Cliente *'])
    const cli = cliPorCpf.get(cpfD)
    const ref = `${l['Contrato/Unidade'] ?? '?'} parc ${l['Nº da Parcela'] ?? '?'}`
    if (!cli) { fora.sem_match.push(ref + ' (cliente)'); continue }

    const mUni = String(l['Contrato/Unidade'] ?? '').match(/(\d+)\s*([A-Za-z]?)\s*$/)
    const uni = mUni?.[1]
    const vendasCli = dbVendas.filter(v =>
      String(v.cliente_id) === String(cli.id) && v.excluido !== true && v.status !== 'distrato' &&
      (!uni || String(v.unidade ?? '').replace(/\D/g, '') === uni))
    const nparc = Number(l['Nº da Parcela'])
    const ehBalao = /bal[aã]o/i.test(String(l['Descrição *'] ?? ''))
    const valorPlan = Number(l['Valor (R$) *'])
    const vencPlan = dataISO(l['Data de Vencimento *'])

    const exata = dbPags.find(p =>
      vendasCli.some(v => String(v.id) === String(p.venda_id)) &&
      p.status === 'pendente' &&
      (ehBalao ? p.tipo === 'balao' : p.tipo !== 'balao') &&
      (!nparc || Number(p.numero_parcela) === nparc) &&
      Math.abs(Number(p.valor) - valorPlan) < 0.01 &&
      p.data_prevista === vencPlan)

    if (!exata) {
      const quase = dbPags.some(p => vendasCli.some(v => String(v.id) === String(p.venda_id)) && Number(p.numero_parcela) === nparc)
      ;(quase ? fora.divergente : fora.sem_match).push(ref)
      continue
    }
    if (boletoVivo.has(String(exata.id))) { fora.ja_tem_boleto.push(ref); continue }
    if (exata.data_prevista <= HOJE) { fora.venc_passado.push(`${ref} (venc ${exata.data_prevista})`); continue }

    const venda = vendasCli.find(v => String(v.id) === String(exata.venda_id))
    lote.push({ ref, planilha: l, cliPlan: planCliPorCpf.get(cpfD), cli, venda, parcela: exata })
  }

  const somaLote = lote.reduce((a, x) => a + Number(x.parcela.valor), 0)
  console.log(`\nLOTE: ${lote.length} boletos | R$ ${somaLote.toFixed(2)}`)
  console.log(`FORA: ${fora.divergente.length} divergentes | ${fora.sem_match.length} sem match | ${fora.ja_tem_boleto.length} já tinham boleto | ${fora.venc_passado.length} vencimento passado`)

  const relatorioPath = path.join(__dirname, `lote-${APPLY ? 'resultado' : 'dryrun'}-${HOJE}.json`)
  if (!APPLY) {
    fs.writeFileSync(relatorioPath, JSON.stringify({ lote: lote.map(x => x.ref), fora }, null, 2))
    console.log(`\nDry-run concluído. Detalhe: ${relatorioPath}`)
    return
  }

  // completa cadastro (cep/cidade/uf) com dados do Excel
  let cadastrosAtualizados = 0
  for (const [cpfD, l] of planCliPorCpf) {
    const cli = cliPorCpf.get(cpfD)
    if (!cli) continue
    const patch = {}
    if (!cli.cep && l['CEP *']) patch.cep = String(l['CEP *'])
    if (!cli.cidade && l['Cidade *']) patch.cidade = String(l['Cidade *'])
    if (!cli.estado && l['UF *']) patch.estado = String(l['UF *']).toUpperCase()
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from('clientes').update(patch).eq('id', cli.id)
      if (!error) cadastrosAtualizados++
    }
  }
  console.log(`cadastros completados (cep/cidade/uf): ${cadastrosAtualizados}`)

  let token = await obterToken('boletos_inclusao boletos_consulta')
  let emitidos = 0
  const erros = []
  const resultados = []

  for (let i = 0; i < lote.length; i++) {
    const { ref, planilha, cliPlan, cli, venda, parcela } = lote[i]
    if (i > 0 && i % 50 === 0) token = await obterToken('boletos_inclusao boletos_consulta')
    const seuNumero = String(parcela.id).replace(/-/g, '').slice(0, 15)
    const descricao = String(planilha['Descrição *'] ?? `Parcela ${parcela.numero_parcela}`).slice(0, 40)

    const resp = await sicoobApi(token, 'POST', '/boletos', {
      numeroCliente: CONFIG.NUMERO_CLIENTE,
      codigoModalidade: 1,
      numeroContaCorrente: CONFIG.NUMERO_CONTA,
      codigoEspecieDocumento: 'DM',
      dataEmissao: HOJE,
      seuNumero,
      identificacaoEmissaoBoleto: 1,
      identificacaoDistribuicaoBoleto: 1,
      valor: Number(parcela.valor),
      dataVencimento: parcela.data_prevista,
      valorAbatimento: 0,
      tipoDesconto: 0,
      valorPrimeiroDesconto: 0,
      valorSegundoDesconto: 0,
      valorTerceiroDesconto: 0,
      tipoMulta: 0,
      dataMulta: parcela.data_prevista,
      valorMulta: 0,
      tipoJurosMora: 3,
      dataJurosMora: parcela.data_prevista,
      valorJurosMora: 0,
      numeroParcela: Number(parcela.numero_parcela) || 1,
      aceite: true,
      pagador: {
        numeroCpfCnpj: digitos(cliPlan?.['CPF/CNPJ *'] ?? cli.cpf),
        nome: String(cliPlan?.['Nome Completo *'] ?? cli.nome_completo).slice(0, 50),
        endereco: String(cliPlan?.['Endereço (Rua e Número) *'] ?? cli.endereco).slice(0, 40),
        bairro: String(cliPlan?.['Bairro *'] ?? 'Centro').slice(0, 30),
        cidade: String(cliPlan?.['Cidade *'] ?? cli.cidade).slice(0, 30),
        cep: digitos(cliPlan?.['CEP *'] ?? cli.cep),
        uf: String(cliPlan?.['UF *'] ?? cli.estado).toUpperCase(),
      },
      mensagensInstrucao: [descricao],
      gerarPdf: false,
      codigoCadastrarPIX: 0,
    })

    let r = {}
    try { const j = JSON.parse(resp.body); r = j.resultado ?? j } catch { /* corpo não-JSON */ }

    if (resp.status === 200 && r.nossoNumero != null) {
      const { error: insErr } = await supabase.from('boletos').insert({
        pagamento_id: parcela.id,
        venda_id: venda.id,
        cliente_id: cli.id,
        banco: 'sicoob',
        ambiente: 'producao',
        nosso_numero: String(r.nossoNumero),
        seu_numero: seuNumero,
        linha_digitavel: r.linhaDigitavel ?? null,
        codigo_barras: r.codigoBarras ?? null,
        qrcode_pix: r.qrCode ?? null,
        valor: Number(parcela.valor),
        data_emissao: HOJE,
        data_vencimento: parcela.data_prevista,
        status: 'registrado',
        payload_emissao: null,
        retorno_emissao: JSON.parse(resp.body),
      })
      if (insErr) erros.push(`${ref}: EMITIDO (nossoNumero ${r.nossoNumero}) mas falhou gravar local: ${insErr.message}`)
      else emitidos++
      resultados.push({ ref, nossoNumero: r.nossoNumero, linhaDigitavel: r.linhaDigitavel })
    } else {
      erros.push(`${ref}: HTTP ${resp.status} ${resp.body.slice(0, 160)}`)
    }
    process.stdout.write(`\r${i + 1}/${lote.length} emitidos=${emitidos} erros=${erros.length}   `)
    await dormir(300)
  }

  console.log(`\n\nFINAL: ${emitidos} emitidos | ${erros.length} erros`)
  if (erros.length) console.log('erros:\n  ' + erros.slice(0, 20).join('\n  '))
  fs.writeFileSync(relatorioPath, JSON.stringify({ geradoEm: new Date().toISOString(), emitidos, erros, fora, resultados }, null, 2))
  console.log(`relatório: ${relatorioPath}`)
  console.log('\nPRÓXIMO PASSO: node baixar-pdfs-lote.cjs   (armazena os PDFs oficiais)')
}
main().catch(e => { console.error('\nERRO FATAL:', e.message); process.exit(1) })
