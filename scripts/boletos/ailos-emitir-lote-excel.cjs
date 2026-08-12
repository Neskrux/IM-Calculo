// LOTE DE PRODUÇÃO AILOS (banco 085) — emite boletos das planilhas do financeiro.
// Espelho do emitir-lote-excel.cjs (Sicoob): APENAS cobranças que casam EXATAMENTE
// (cliente+parcela+valor+data) com parcela PENDENTE. Ver scripts/boletos/README.md.
//
// Uso (PowerShell: $env:AILOS_ENV='producao' antes):
//   node ailos-emitir-lote-excel.cjs "clientes.xlsx" "cobrancas.xlsx"           → DRY-RUN
//   node ailos-emitir-lote-excel.cjs "clientes.xlsx" "cobrancas.xlsx" --apply   → EMITE
//
// Garantias (idênticas ao Sicoob):
//  * Idempotente: parcela com boleto vivo (qualquer banco) é pulada.
//  * NUNCA toca pagamentos_prosoluto — só a tabela boletos (banco='ailos').
//  * Divergências ficam FORA e são relatadas.
//  * Regras Ailos: descricaoDocumento ≤15 chars; juros/multa isentos (tipo 3);
//    bolePix=true (QR no PDF); PDF gerado por nós e armazenado via edge
//    sicoob-boletos/armazenar-pdf (rota agnóstica de banco: boleto_id+pdf).
const path = require('path')
const fs = require('fs')
const { CONFIG, supabase, SUPABASE_URL, ailosApi, dormir } = require('./ailos.cjs')
const { gerarBoletoPdf } = require('./ailos-boleto-pdf.cjs')
const XLSX = require(path.join(__dirname, '..', '..', 'node_modules', 'xlsx'))

const WORKER_SECRET_FILE = process.env.BOLETOS_WORKER_SECRET_FILE || 'C:/Users/HP/Downloads/boletos_worker_secret.txt'
const digitos = (s) => String(s ?? '').replace(/\D/g, '')

const args = process.argv.slice(2).filter(a => a !== '--apply')
const APPLY = process.argv.includes('--apply')
const [ARQ_CLIENTES, ARQ_COBRANCAS] = args
if (!ARQ_CLIENTES || !ARQ_COBRANCAS) {
  console.log('uso: node ailos-emitir-lote-excel.cjs <clientes.xlsx> <cobrancas.xlsx> [--apply]')
  process.exit(1)
}
if (APPLY && CONFIG.AMBIENTE !== 'producao') {
  console.error('--apply exige AILOS_ENV=producao'); process.exit(1)
}
const HOJE = new Date().toISOString().slice(0, 10)
const dataISO = (s) => { const m = String(s ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }

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
  console.log(APPLY ? '*** MODO APPLY — VAI EMITIR BOLETOS AILOS REAIS ***' : '--- DRY-RUN (use --apply pra valer) ---')
  console.log(`Ambiente: ${CONFIG.AMBIENTE} · convênio ${CONFIG.CONVENIO}\n`)

  const planCli = XLSX.utils.sheet_to_json(XLSX.readFile(ARQ_CLIENTES).Sheets['Clientes'], { defval: null })
  const planCob = XLSX.utils.sheet_to_json(XLSX.readFile(ARQ_COBRANCAS).Sheets['Cobrancas'], { defval: null })

  const [dbClientes, dbVendas, dbPags, dbBoletos] = await Promise.all([
    fetchAll('clientes', 'id, nome_completo, cpf, cnpj, cidade, estado, cep, endereco'),
    fetchAll('vendas', 'id, cliente_id, unidade, status, excluido'),
    fetchAll('pagamentos_prosoluto', 'id, venda_id, tipo, numero_parcela, valor, data_prevista, status'),
    fetchAll('boletos', 'id, pagamento_id, status'),
  ])

  const cliPorCpf = new Map()
  dbClientes.forEach(c => { const d = digitos(c.cpf) || digitos(c.cnpj); if (d) cliPorCpf.set(d, c) })
  const planCliPorCpf = new Map()
  planCli.forEach(l => { const d = digitos(l['CPF/CNPJ *']); if (d) planCliPorCpf.set(d, l) })
  const boletoVivo = new Set(
    dbBoletos.filter(b => !['cancelado', 'baixado', 'erro'].includes(b.status)).map(b => String(b.pagamento_id)))

  const lote = []
  const fora = { divergente: [], sem_match: [], ja_tem_boleto: [], venc_passado: [], sem_endereco: [] }
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

    const cliPlan = planCliPorCpf.get(cpfD)
    // Ailos exige endereço completo do pagador (logradouro, bairro, cidade, uf, cep)
    if (!cliPlan?.['Endereço (Rua e Número) *'] && !cli.endereco) { fora.sem_endereco.push(ref); continue }

    const venda = vendasCli.find(v => String(v.id) === String(exata.venda_id))
    lote.push({ ref, planilha: l, cliPlan, cli, venda, parcela: exata })
  }

  const somaLote = lote.reduce((a, x) => a + Number(x.parcela.valor), 0)
  console.log(`LOTE: ${lote.length} boletos | R$ ${somaLote.toFixed(2)}`)
  console.log(`FORA: ${fora.divergente.length} divergentes | ${fora.sem_match.length} sem match | ${fora.ja_tem_boleto.length} já tinham boleto | ${fora.venc_passado.length} venc passado | ${fora.sem_endereco.length} sem endereço`)

  const relatorioPath = path.join(__dirname, `ailos-lote-${APPLY ? 'resultado' : 'dryrun'}-${HOJE}.json`)
  if (!APPLY) {
    fs.writeFileSync(relatorioPath, JSON.stringify({ lote: lote.map(x => x.ref), fora }, null, 2))
    console.log(`\nDry-run concluído. Detalhe: ${relatorioPath}`)
    return
  }

  const workerSecret = fs.readFileSync(WORKER_SECRET_FILE, 'utf8').trim()
  let emitidos = 0
  const erros = []
  const resultados = []

  for (let i = 0; i < lote.length; i++) {
    const { ref, planilha, cliPlan, cli, venda, parcela } = lote[i]
    const numeroDocumento = Number(String(Date.now()).slice(-8)) // único: 1 emissão/ms
    const end = {
      cep: digitos(cliPlan?.['CEP *'] ?? cli.cep),
      logradouro: String(cliPlan?.['Endereço (Rua e Número) *'] ?? cli.endereco ?? '').slice(0, 40) || 'NAO INFORMADO',
      numero: 'S/N',
      complemento: '',
      bairro: String(cliPlan?.['Bairro *'] ?? 'Centro').slice(0, 30),
      cidade: String(cliPlan?.['Cidade *'] ?? cli.cidade ?? '').slice(0, 30),
      uf: String(cliPlan?.['UF *'] ?? cli.estado ?? '').toUpperCase().slice(0, 2),
    }
    const descricao = String(planilha['Descrição *'] ?? `Parcela ${parcela.numero_parcela}`)

    const payload = {
      convenioCobranca: { codigoCarteiraCobranca: Number(CONFIG.CARTEIRA) },
      documento: {
        numeroDocumento,
        descricaoDocumento: `P${parcela.numero_parcela ?? ''}-${String(venda.unidade ?? '').replace(/\s/g, '')}`.slice(0, 15),
        especieDocumento: 4,
      },
      emissao: { formaEmissao: 2, dataEmissaoDocumento: HOJE },
      pagador: {
        entidadeLegal: {
          identificadorReceitaFederal: digitos(cliPlan?.['CPF/CNPJ *'] ?? cli.cpf ?? cli.cnpj),
          tipoPessoa: digitos(cliPlan?.['CPF/CNPJ *'] ?? cli.cpf ?? cli.cnpj).length > 11 ? 2 : 1,
          nome: String(cliPlan?.['Nome Completo *'] ?? cli.nome_completo).slice(0, 50),
        },
        emails: [],
        endereco: end,
        mensagemPagador: [descricao.slice(0, 60)],
      },
      vencimento: { dataVencimento: parcela.data_prevista },
      instrucoes: {
        valorAbatimento: 0, tipoMulta: 3, valorMulta: 0,
        tipoJurosMora: 3, valorJurosMora: 0, diasNegativacao: 0, diasProtesto: 0,
      },
      valorBoleto: { valorNominal: Number(parcela.valor) },
      avisoSms: { enviarAvisoVencimentoSms: 0, enviarAvisoVencimentoSmsAntesVencimento: false, enviarAvisoVencimentoSmsDiaVencimento: false, enviarAvisoVencimentoSmsAposVencimento: false },
      pagamentoDivergente: { tipoPagamentoDivergente: 0, valorMinimoPagamentoDivergente: 0 },
      indicadorRegistroNuclea: 1,
      bolePix: true,
    }

    const r = await ailosApi('POST', `/ailos/cobranca/api/v2/boletos/gerar/boleto/convenios/${CONFIG.CONVENIO}`, payload)
    let b = null
    try { b = JSON.parse(r.body).boleto } catch { /* não-JSON */ }

    if ((r.status !== 200 && r.status !== 201) || !b?.codigoBarras?.codigoBarras) {
      erros.push({ ref, status: r.status, body: r.body.slice(0, 300) })
      console.log(`  ✗ ${ref}: HTTP ${r.status}`)
      continue
    }

    const { data: novo, error: insErr } = await supabase.from('boletos').insert({
      pagamento_id: parcela.id,
      venda_id: venda.id,
      cliente_id: cli.id,
      banco: 'ailos',
      ambiente: 'producao',
      nosso_numero: String(b.documento?.nossoNumero ?? ''),
      seu_numero: String(numeroDocumento),
      linha_digitavel: b.codigoBarras?.linhaDigitavel ?? null,
      codigo_barras: b.codigoBarras?.codigoBarras ?? null,
      qrcode_pix: b.pix?.copiaECola ?? null,
      valor: Number(parcela.valor),
      data_vencimento: parcela.data_prevista,
      status: 'registrado',
      payload_emissao: payload,
      retorno_emissao: b,
    }).select('id').single()
    if (insErr) { erros.push({ ref, msg: 'insert: ' + insErr.message }); continue }

    // PDF: gera com nosso layout homologado e armazena no Storage via edge
    const pdfTmp = path.join(__dirname, `_ailos-tmp-${novo.id}.pdf`)
    gerarBoletoPdf({
      linhaDigitavel: b.codigoBarras.linhaDigitavel,
      codigoBarras: b.codigoBarras.codigoBarras,
      nossoNumero: b.documento?.nossoNumero,
      beneficiario: { nome: 'IM CONSTRUTORA E INCORPORADORA', cnpj: '14587169000102' },
      agenciaCodigo: `${CONFIG.AGENCIA} / ${CONFIG.CEDENTE}`,
      pagador: {
        nome: payload.pagador.entidadeLegal.nome,
        doc: payload.pagador.entidadeLegal.identificadorReceitaFederal,
        endereco: `${end.logradouro} - ${end.bairro} - ${end.cidade}/${end.uf} - CEP ${end.cep}`,
      },
      dataDocumento: HOJE, numeroDocumento, especieDoc: 'MENS', aceite: 'N',
      dataProcessamento: HOJE, carteira: CONFIG.CARTEIRA,
      valor: Number(parcela.valor), vencimento: parcela.data_prevista,
      instrucoes: [descricao.slice(0, 70), 'Nao receber apos 60 dias do vencimento.'],
      pixQrCodeBase64: b.pix?.qrCode || null,
    }, pdfTmp)
    const pdfB64 = fs.readFileSync(pdfTmp).toString('base64')
    fs.unlinkSync(pdfTmp)
    const up = await fetch(`${SUPABASE_URL}/functions/v1/sicoob-boletos/armazenar-pdf`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_secret: workerSecret, boleto_id: novo.id, pdf_base64: pdfB64 }),
    })
    const pdfOk = up.status === 200

    emitidos++
    resultados.push({ ref, boleto_id: novo.id, nossoNumero: b.documento?.nossoNumero, pdf: pdfOk })
    console.log(`  ✓ [${emitidos}/${lote.length}] ${ref} — nossoNumero ${b.documento?.nossoNumero}${pdfOk ? '' : ' (⚠ PDF não armazenado)'}`)
    await dormir(1100) // numeroDocumento é derivado do relógio (ms) — garante unicidade
  }

  fs.writeFileSync(relatorioPath, JSON.stringify({ emitidos, erros, resultados, fora }, null, 2))
  console.log(`\nEmitidos: ${emitidos} | Erros: ${erros.length} | Relatório: ${relatorioPath}`)
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
