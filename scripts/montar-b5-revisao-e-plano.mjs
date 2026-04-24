// Separa decisoes B.5 em:
//   - docs/b5-plano-seguro.json      (68 grupos — cancelar perdedores, mutacao segura)
//   - docs/b5-revisao-humana.json    (21 grupos delicados — precisa decisao)
//
// Grupo delicado = qualquer um onde vencedor_dist > 30d  OU  algum perdedor pago com dist > 30d
//
// Contexto de venda (cliente/corretor/unidade) vem embutido no output pra revisao humana.

import { readFileSync, writeFileSync } from 'node:fs'

const an = JSON.parse(readFileSync('docs/analise-b5-duplicatas.json', 'utf8'))

const ctx = {
  '163': {contrato:'73',unidade:'1603 A',cliente:'DIOGO DA LUZ DOS SANTOS',cpf:'09233207927',telCliente:'(47)99724-4138',corretor:'MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS',telCorretor:'1192003475',valorVenda:'346440.81',proSoluto:'69200.00'},
  '166': {contrato:'76',unidade:'1607 A',cliente:'GHIZIERI JENNINFER FREITAS COSTA BOSZCZOWSKI',cpf:'08401031907',telCliente:'(47)988623130',corretor:'CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA',telCorretor:'4797071735',valorVenda:'440166.26',proSoluto:'88033.20'},
  '246': {contrato:'154',unidade:'1302 C',cliente:'MARIA VITORIA DA SILVA FRANCISCO',cpf:'11625933932',telCliente:'(43)99669-8714',corretor:'CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA',telCorretor:'4797071735',valorVenda:'427221.03',proSoluto:'85444.15'},
  '255': {contrato:'163',unidade:'1405 C',cliente:'ANDREY LUIZ MESSIAS SANTOS',cpf:'05319809522',telCliente:'(47)99282-8064',corretor:'CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA',telCorretor:'4797071735',valorVenda:'363369.59',proSoluto:'73581.34'},
  '256': {contrato:'164',unidade:'1406 C',cliente:'WANDERLEY ROSA GUIMARÃES JÚNIOR',cpf:'05204505903',telCliente:'(47)99617-9440',corretor:'CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA',telCorretor:'4797071735',valorVenda:'431493.25',proSoluto:'86298.50'},
  '269': {contrato:'177',unidade:'609 D',cliente:'DIEGO RAMOS',cpf:'10099686961',telCliente:'(47)99629-9164',corretor:'ALECXANDER SOUZA E SILVA',telCorretor:'47999580426',valorVenda:'383188.92',proSoluto:'124200.00'},
  '275': {contrato:'183',unidade:'803 D',cliente:'SAMUEL MUELLER LEMOS',cpf:'11319608906',telCliente:'(47) 99660-0856',corretor:'RONAL RESMINI BALENA',telCorretor:'4830948119',valorVenda:'410443.77',proSoluto:'150850.00'},
  '346': {contrato:'246',unidade:'508 A',cliente:'MICHEL CHRISTIAN BORBA',cpf:'09786118960',telCliente:'(47)99713-2318',corretor:'CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA',telCorretor:'4797071735',valorVenda:'295289.72',proSoluto:'62800.00'},
  '351': {contrato:'249',unidade:'506 A',cliente:'LILIAM THAINE CARVALHO',cpf:'11043972935',telCliente:'(47)99765-1106',corretor:'CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA',telCorretor:'4797071735',valorVenda:'232413.12',proSoluto:'46482.63'},
  '382': {contrato:'268',unidade:'1305 A',cliente:'(sem cliente vinculado)',cpf:null,telCliente:null,corretor:'MATEUS GABRIEL DE OLIVEIRA',telCorretor:'47999033809',valorVenda:'457103.88',proSoluto:'93143.41'},
  '87':  {contrato:'40', unidade:'908 A', cliente:'LEANDRO DE OLIVEIRA VICENTIN',cpf:'18757055890',telCliente:'(47)98420-3075',corretor:'CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA',telCorretor:'4797071735',valorVenda:'418341.97',proSoluto:'83668.30'},
  '204': {contrato:'112',unidade:'1204 B',cliente:'SARA JANE DE OLIVEIRA BARBOSA',cpf:'04304256009',telCliente:'(47)99245-8784',corretor:'CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA',telCorretor:'4797071735',valorVenda:'431026.76',proSoluto:'86205.49'},
}

const delicados = []
const seguros = []

for (const d of an.decisoes) {
  const vencedorDistAlto = d.vencedor.dist_dias > 30
  const perdedorPagoLonge = d.perdedores.some(p => p.status === 'pago' && p.dist_dias > 30)
  const ehDelicado = vencedorDistAlto || perdedorPagoLonge

  if (ehDelicado) {
    const c = ctx[d.contract] || { contrato:'?',unidade:'?',cliente:'?',cpf:null,telCliente:null,corretor:'?',telCorretor:null,valorVenda:null,proSoluto:null }
    delicados.push({
      venda_id: d.venda_id,
      sienge_contract_id: d.contract,
      numero_contrato: c.contrato,
      unidade: c.unidade,
      cliente: c.cliente,
      cliente_cpf: c.cpf,
      cliente_telefone: c.telCliente,
      corretor: c.corretor,
      corretor_telefone: c.telCorretor,
      valor_venda: c.valorVenda,
      valor_pro_soluto: c.proSoluto,
      billId: d.billId,
      numero_parcela: d.seq,
      sienge_due_atual: d.sienge.due,
      vencedor: d.vencedor,
      perdedores: d.perdedores,
      motivo_delicado: vencedorDistAlto ? 'vencedor_nao_bate_sienge' : 'perdedor_pago_em_outro_periodo',
    })
  } else {
    seguros.push(d)
  }
}

writeFileSync('docs/b5-revisao-humana.json', JSON.stringify({
  meta: {
    geradoEm: new Date().toISOString(),
    total: delicados.length,
    motivos: delicados.reduce((a,d)=>{a[d.motivo_delicado]=(a[d.motivo_delicado]||0)+1;return a},{}),
    regra: 'delicado se vencedor nao bate Sienge (dist>30d) OU algum perdedor pago tem dist>30d. Cancelar esses perdedores = perder registro unico de pagamento. Precisa confirmacao humana (se pagamento foi estornado no Sienge pela renegociacao, OK cancelar; se nao foi, realocar para outra seq).',
  },
  casos: delicados,
}, null, 2))

writeFileSync('docs/b5-plano-seguro.json', JSON.stringify({
  meta: {
    geradoEm: new Date().toISOString(),
    gruposSeguros: seguros.length,
    gruposDelicados: delicados.length,
    acao: 'Em cada grupo, marcar perdedores com status=cancelado (pular ja cancelados).',
    invariante: 'Preserva data_pagamento e valor (nao e delete, nao e reversao pago->pendente).',
  },
  grupos: seguros,
}, null, 2))

// Sumario stdout
console.log(`grupos delicados (revisao humana): ${delicados.length}`)
console.log(`grupos seguros (executar agora):    ${seguros.length}`)
const linhasCancelar = seguros.reduce((acc, g) => acc + g.perdedores.filter(p => p.acao === 'cancelar').length, 0)
console.log(`linhas a cancelar no plano seguro:  ${linhasCancelar}`)
console.log(`\nOutputs:`)
console.log(`  docs/b5-revisao-humana.json`)
console.log(`  docs/b5-plano-seguro.json`)

// Impressao compacta pra usuaria
console.log(`\n=== CASOS DELICADOS PRA VALIDACAO HUMANA ===\n`)
for (const d of delicados) {
  console.log(`Contrato ${d.numero_contrato} (Sienge ${d.sienge_contract_id})  UND ${d.unidade}`)
  console.log(`  Cliente: ${d.cliente}${d.cliente_cpf ? `  CPF ${d.cliente_cpf}` : ''}${d.cliente_telefone ? `  Tel ${d.cliente_telefone}` : ''}`)
  console.log(`  Corretor: ${d.corretor}${d.corretor_telefone ? `  ${d.corretor_telefone}` : ''}`)
  console.log(`  Parcela ${d.numero_parcela} (PM) — Sienge atual vence ${d.sienge_due_atual}`)
  console.log(`  VENCEDOR escolhido:  id=${d.vencedor.id.slice(0,8)} status=${d.vencedor.status} dp=${d.vencedor.data_prevista} dpag=${d.vencedor.data_pagamento||'-'}`)
  for (const p of d.perdedores) {
    const flag = (p.status==='pago' && p.dist_dias>30) ? '  <<< PAGAMENTO REAL A REVISAR >>>' : ''
    console.log(`  Perdedor:            id=${p.id.slice(0,8)} status=${p.status} dp=${p.data_prevista} dpag=${p.data_pagamento||'-'} dist=${p.dist_dias}d${flag}`)
  }
  console.log(`  Motivo: ${d.motivo_delicado}\n`)
}
