/**
 * Calcula o fator de comissão conforme fator-comissao.mdc
 * fator_comissao_aplicado = (valorVenda * percentualTotal) / valorProSoluto
 */
export function calcularFatorComissao(valorVenda, valorProSoluto, percentualTotal) {
  const valorVendaNum = parseFloat(valorVenda) || 0
  const valorProSolutoNum = parseFloat(valorProSoluto) || 0
  const percentualTotalNum = parseFloat(percentualTotal) || 0
  if (valorProSolutoNum <= 0) return 0
  return (valorVendaNum * (percentualTotalNum / 100)) / valorProSolutoNum
}

/**
 * Calcula comissão da parcela: valorParcela * fator_comissao_aplicado
 * API simples usada pelo Admin quando o fator já está conhecido.
 */
export function calcularComissaoPagamento(valorParcela, fatorComissaoAplicado) {
  const valorParcelaNum = parseFloat(valorParcela) || 0
  const fatorComissaoAplicadoNum = parseFloat(fatorComissaoAplicado) || 0
  return valorParcelaNum * fatorComissaoAplicadoNum
}

/**
 * Fatia do CORRETOR por venda (conta multi-tipo — caso Matheus Pires).
 * Prioridade:
 *  1. venda.percentual_corretor (quando existir — snapshot por venda);
 *  2. percentual do PERFIL, mas SO quando a venda e do MESMO tipo do cadastro;
 *  3. taxa padrao do tipo DA VENDA (interno 2,5 / externo 4).
 * A regra 3 e o coracao do multi-tipo: cadastro interno com venda externa recebe
 * pela taxa da VENDA, nunca pela do perfil. Validado em 20/08/2026 contra o snapshot
 * percentual_comissao_total (2.340 parcelas do Matheus, 100% consistentes).
 * TODO multi-empreendimento: quando outro empreendimento entrar (percentuais 6,0%),
 * TAXA_CORRETOR_PADRAO deve ser lida de cargos_empreendimento por empreendimento —
 * este helper e o UNICO lugar a mudar. Ver stream multi-empreendimento.
 */
export const TAXA_CORRETOR_PADRAO = Object.freeze({ interno: 2.5, externo: 4 })

export function percentualCorretorDaVenda(venda, perfil) {
  const pctVenda = parseFloat(venda?.percentual_corretor)
  if (Number.isFinite(pctVenda) && pctVenda > 0) return pctVenda
  const tipoVenda = venda?.tipo_corretor || perfil?.tipo_corretor || 'externo'
  const mesmoTipo = !venda?.tipo_corretor || venda.tipo_corretor === perfil?.tipo_corretor
  const pctPerfil = parseFloat(perfil?.percentual_corretor)
  if (mesmoTipo && Number.isFinite(pctPerfil) && pctPerfil > 0) return pctPerfil
  return TAXA_CORRETOR_PADRAO[tipoVenda] ?? TAXA_CORRETOR_PADRAO.externo
}

/**
 * Status canônicos. Use sempre via constante pra evitar typo em string mágica.
 */
export const STATUS = Object.freeze({
  PAGO: 'pago',
  PENDENTE: 'pendente',
  CANCELADO: 'cancelado',
})

/**
 * Predicates de pagamento.
 */
export const isPago = (pag) => pag?.status === STATUS.PAGO
export const isPendente = (pag) => pag?.status === STATUS.PENDENTE
export const isCancelado = (pag) => pag?.status === STATUS.CANCELADO
export const isAtivo = (pag) => pag?.status !== STATUS.CANCELADO

/**
 * Predicate de VENDA ativa — para CONTAGEM e OCUPAÇÃO DE UNIDADE, não para soma financeira.
 *
 * Uma venda distratada (status='distrato', vindo de situacao_contrato='3' do Sienge) NÃO é
 * uma venda ativa: não deve contar como "venda ativa", nem ocupar unidade, nem disparar
 * alerta de unidade duplicada. Mas a comissão JÁ PAGA dela continua nos totais — por isso
 * NÃO use este predicate pra filtrar pagamentos numa soma de comissão; some sempre dos
 * pagamentos (que preservam as linhas 'pago' do distrato). Ver:
 *   .claude/rules/visualizacao-totais.md  ·  docs/contexto/2026-06-01-distratos-mapa-completo.md
 */
export const isVendaAtiva = (v) =>
  (v?.excluido === false || v?.excluido == null) &&
  v?.status !== 'distrato'

/**
 * Data efetiva para relatórios e filtros temporais:
 * - Pago → usa data_pagamento (quando realmente ocorreu)
 * - Pendente/outros → usa data_prevista (quando deveria ocorrer)
 * Retorna string (YYYY-MM-DD) ou null.
 */
export const dataEfetiva = (pag) => {
  if (!pag) return null
  return pag.data_pagamento || pag.data_prevista || null
}

/**
 * Cascata completa de cálculo de comissão por pagamento.
 * Use quando não se tem o fator pré-calculado e precisa resolver do snapshot.
 *
 * Ordem de preferência (respeita R1 — fator-comissao.md):
 *  1) comissao_gerada no pagamento (snapshot definitivo — fonte da verdade histórica)
 *  2) fator_comissao_aplicado no pagamento × valor
 *  3) fator_comissao_corretor no pagamento × valor (legado)
 *  4) fator_comissao da venda × valor (fallback histórico)
 *  5) fator_comissao_corretor da venda × valor (legado)
 *  6) proporção comissao_corretor / valor_pro_soluto × valor (fallback grosseiro)
 *  7) último recurso — recalcula fator canônico a partir de valor_venda, pro-soluto e percentual informado
 *
 * NUNCA aplica (percentual/100) direto na parcela — isso viola R1.
 *
 * @param {object} pagamento - linha de pagamentos_prosoluto
 * @param {object} [opts]
 * @param {Array}  [opts.vendas] - coleção de vendas para lookup por pagamento.venda_id
 * @param {object} [opts.venda]  - venda já resolvida (pula o lookup se informada)
 * @param {number} [opts.percentualFallback] - usado só no passo 7 quando nada mais resolve
 * @returns {number}
 */
export function calcularComissaoPagamentoCompleto(pagamento, opts = {}) {
  if (!pagamento) return 0

  if (pagamento.comissao_gerada && parseFloat(pagamento.comissao_gerada) > 0) {
    return parseFloat(pagamento.comissao_gerada)
  }

  const valorParcela = parseFloat(pagamento.valor) || 0
  if (valorParcela <= 0) return 0

  if (pagamento.fator_comissao_aplicado && parseFloat(pagamento.fator_comissao_aplicado) > 0) {
    return valorParcela * parseFloat(pagamento.fator_comissao_aplicado)
  }

  if (pagamento.fator_comissao_corretor && parseFloat(pagamento.fator_comissao_corretor) > 0) {
    return valorParcela * parseFloat(pagamento.fator_comissao_corretor)
  }

  const venda = opts.venda || (Array.isArray(opts.vendas) ? opts.vendas.find((v) => v.id === pagamento.venda_id) : null)

  if (venda) {
    if (venda.fator_comissao && parseFloat(venda.fator_comissao) > 0) {
      return valorParcela * parseFloat(venda.fator_comissao)
    }
    if (venda.fator_comissao_corretor && parseFloat(venda.fator_comissao_corretor) > 0) {
      return valorParcela * parseFloat(venda.fator_comissao_corretor)
    }
    const comissaoVenda = parseFloat(venda.comissao_corretor) || 0
    const proSolutoVenda = parseFloat(venda.valor_pro_soluto) || 0
    if (comissaoVenda > 0 && proSolutoVenda > 0) {
      return valorParcela * (comissaoVenda / proSolutoVenda)
    }
    const percentual = parseFloat(opts.percentualFallback)
    if (percentual > 0 && proSolutoVenda > 0) {
      const fatorCanonico = calcularFatorComissao(venda.valor_venda, proSolutoVenda, percentual)
      return valorParcela * fatorCanonico
    }
  }

  return 0
}

/**
 * Soma comissão de uma lista de pagamentos aplicando um predicate opcional.
 * Evita repetir o padrão `reduce` em cada dashboard.
 *
 * @param {Array} pagamentos
 * @param {object} [opts]
 * @param {function} [opts.predicate] - ex: isPago, isPendente
 * @param {Array}    [opts.vendas]    - repassa pra calcularComissaoPagamentoCompleto
 * @param {number}   [opts.percentualFallback]
 * @returns {number}
 */
export function somarComissao(pagamentos, opts = {}) {
  if (!Array.isArray(pagamentos)) return 0
  const { predicate, vendas, percentualFallback } = opts
  // Default: ignora canceladas (parcela cancelada nao deve entrar em soma
  // financeira). Quem precisa do total bruto pra auditoria passa
  // predicate explicito (ex: () => true).
  const lista = predicate ? pagamentos.filter(predicate) : pagamentos.filter(isAtivo)
  return lista.reduce(
    (acc, pag) => acc + calcularComissaoPagamentoCompleto(pag, { vendas, percentualFallback }),
    0,
  )
}

// ---------------------------------------------------------------------------
// Taxa da coordenadora por venda (relatório coordenadoras)
// Prioridade: snapshot da venda (vendas.coordenadora_taxa, migration 040) →
// taxa negociada vigente (coordenadoras.percentual_padrao, migration 031) → null.
// O snapshot existe porque a taxa mudou no tempo (cutover 15/07/2025) e a taxa
// vigente não pode reescrever relatório de mês antigo.
export const CUTOVER_TAXA_COORDENADORA = '2025-07-15'

export function taxaCoordenadoraDaVenda(venda, coordenadoras = []) {
  if (!venda?.coordenadora_id) return null
  const snap = parseFloat(venda.coordenadora_taxa)
  if (Number.isFinite(snap) && snap > 0) return snap
  const co = coordenadoras.find(c => String(c.id) === String(venda.coordenadora_id))
  const vigente = co ? parseFloat(co.percentual_padrao) : NaN
  return Number.isFinite(vigente) && vigente > 0 ? vigente : null
}

// Regra do cutover usada pelo backfill do snapshot (scripts/backfill-coordenadora-taxa.mjs):
// contrato (data_venda) antes de 15/07/2025 → 1,0 · a partir de 15/07/2025 → 0,5.
// Sem data_venda → null (caso vai pra revisão humana, nunca gravar chute).
export function taxaCoordenadoraPorCutover(dataVenda) {
  const d = String(dataVenda || '').slice(0, 10)
  if (!d) return null
  return d < CUTOVER_TAXA_COORDENADORA ? 1.0 : 0.5
}

// ---------------------------------------------------------------------------
// Fatia de UM CARGO numa parcela (visão do beneficiário: Nohros, Beton, ...).
// Regra canônica: comissao_gerada é a comissão TOTAL da parcela; a fatia do cargo é
// proporcional — comissao_gerada × (pct_cargo / pct_total). Ver fator-comissao.md.
//  - pct_total: snapshot da parcela (percentual_comissao_total) quando existir;
//    fallback = soma dos cargos do tipo da venda.
//  - pct_cargo: cargos_empreendimento filtrado pelo tipo da venda; cargo Coordenadora
//    usa a taxa por venda (taxaCoordenadoraDaVenda) quando houver.
// Retorna 0 pra parcela cancelada — cancelada nunca infla total (visualizacao-totais.md).
export function fatiaCargoDoPagamento(pagamento, venda, nomeCargo, cargosDoEmp = [], coordenadoras = []) {
  if (!pagamento || isCancelado(pagamento) || !venda || !nomeCargo) return 0

  const tipoVenda = venda.tipo_corretor || 'externo'
  const cargosDoTipo = cargosDoEmp.filter(c => (c.tipo_corretor || 'externo') === tipoVenda)

  let pctCargo = parseFloat(cargosDoTipo.find(c => c.nome_cargo === nomeCargo)?.percentual) || 0
  if (nomeCargo === 'Coordenadora') {
    const taxa = taxaCoordenadoraDaVenda(venda, coordenadoras)
    if (taxa != null) pctCargo = taxa
    else if (!venda.coordenadora_id) return 0 // venda sem coordenadora não gera fatia do cargo
  }
  if (pctCargo <= 0) return 0

  const pctTotal = parseFloat(pagamento.percentual_comissao_total) ||
    cargosDoTipo.reduce((acc, c) => acc + (parseFloat(c.percentual) || 0), 0)
  if (pctTotal <= 0) return 0

  const comissaoTotal = calcularComissaoPagamentoCompleto(pagamento, { vendas: [venda] })
  return comissaoTotal * (pctCargo / pctTotal)
}

// ─────────────────────────────────────────────────────────────────────────────
// Régua única das telas do corretor + cura de distrato
// Spec: docs/specs/2026-08-28-spec-regua-unica-telas-distrato.md
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Contagem canônica de vendas pra QUALQUER contador de tela (D2 da spec).
 * "Vendas" = ativas (isVendaAtiva). Distratos aparecem rotulados do lado, nunca
 * somados no número principal — foi a mistura silenciosa (donut contava 31,
 * Relatórios 25) que o financeiro flagrou como inconsistência.
 */
export const contarVendas = (vendas = []) => {
  const visiveis = vendas.filter((v) => v?.excluido !== true)
  const ativas = visiveis.filter(isVendaAtiva).length
  const distratos = visiveis.filter((v) => v?.status === 'distrato').length
  return { ativas, distratos, total: visiveis.length }
}

/**
 * Régua FÍSICA da baixa-em-massa de distrato: ao distratar, o Sienge dá baixa em
 * TODAS as parcelas do contrato na data do distrato — inclusive as que só
 * venceriam anos depois. Só o VENCIMENTO decide: paga com data_prevista posterior
 * à data do distrato nunca foi dinheiro. `data_pagamento` NÃO serve de régua
 * porque a baixa em massa reescreve a data das parcelas legitimamente pagas.
 * Sem `data_distrato` conhecida → false (a janela é coberta pelo guard S6 do
 * reconciliador, que parqueia a venda). Usada pela cura (curar-distrato --auto).
 */
export const ehBaixaFalsaDeDistrato = (pagamento, venda) => {
  if (pagamento?.status !== STATUS.PAGO) return false
  const ehDistratada = venda?.status === 'distrato' || venda?.situacao_contrato === '3'
  if (!ehDistratada || !venda?.data_distrato) return false
  const dd = String(venda.data_distrato).slice(0, 10)
  const venc = String(pagamento?.data_prevista || '').slice(0, 10)
  if (!venc || venc <= dd) return false
  // Parcela futura paga ANTES do distrato é antecipação real do cliente (lição
  // 412 B: régua só por data de pagamento cancelava recebimento legítimo).
  const pg = String(pagamento?.data_pagamento || '').slice(0, 10)
  if (pg && pg < dd) return false
  return true
}

/**
 * Header "Valor Comissão" do PDF do Admin decide pela MESMA régua das linhas da
 * tabela (filtro de cargo), não pelo percentual_corretor do cadastro — que é NULL
 * pra vários corretores e fazia o header cair no total (7%) enquanto as linhas
 * mostravam a fatia (4%): o card não fechava consigo mesmo (caso 908 C).
 * `calcPorCargo` = calcularComissaoPorCargoPagamento (injetado; vive no Admin).
 */
export const comissaoHeaderVenda = (pagamentos = [], { cargoId, mostrarTotal } = {}, calcPorCargo) => {
  const ativos = pagamentos.filter(isAtivo)
  const porCargo = cargoId && cargoId !== '__total__' && !mostrarTotal
  if (porCargo && typeof calcPorCargo === 'function') {
    const valor = ativos.reduce((acc, p) => {
      const cargo = calcPorCargo(p).find((c) => c.nome_cargo === cargoId)
      return acc + (cargo?.valor ?? 0)
    }, 0)
    return { valor, rotulo: `Comissão (${cargoId})` }
  }
  const valor = ativos.reduce((acc, p) => acc + (parseFloat(p.comissao_gerada) || 0), 0)
  return { valor, rotulo: 'Comissão total (todos os cargos)' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Papel COORDENADOR na conta do corretor (Pires, Carolina, Jessica).
// Spec: docs/specs/2026-09-04-spec-papel-coordenador.md
//
// Coordenação NÃO é um tipo de acesso novo nem o `beneficiario` genérico por cargo:
// `usuarios.tipo` é coluna única (marcar de coordenador apagaria a carteira própria,
// e duas contas por pessoa é proibido), e o beneficiário escopa por CARGO no
// empreendimento inteiro — coordenação escopa por PESSOA, via vendas.coordenadora_id.
// O que se reusa do beneficiário é o motor da conta (fatiaCargoDoPagamento), não o
// tipo de acesso. O vínculo pessoa→coordenação já existe: coordenadoras.usuario_id
// (migrations 030/031). Zero migration.
// ─────────────────────────────────────────────────────────────────────────────

const mesmoId = (a, b) => a != null && b != null && String(a) === String(b)

/**
 * A linha de `coordenadoras` deste usuário, ou null. Só linha ATIVA vira papel —
 * coordenadora desativada não deve reabrir a visão de coordenação.
 */
export function coordenadoraDoUsuario(userProfile, coordenadoras = []) {
  if (!userProfile?.id || !Array.isArray(coordenadoras)) return null
  return coordenadoras.find(c => c?.ativo !== false && mesmoId(c?.usuario_id, userProfile.id)) || null
}

/**
 * Papéis do login. 'corretor' é sempre o primeiro (default da tela, zero regressão
 * pra quem não coordena); 'coordenacao' entra só quando há vínculo ativo.
 */
export function papeisDisponiveis(userProfile, coordenadoras = []) {
  return coordenadoraDoUsuario(userProfile, coordenadoras)
    ? ['corretor', 'coordenacao']
    : ['corretor']
}

/**
 * Escopo do papel de coordenação: vendas DIRECIONADAS à coordenadora, menos as que
 * ela mesma vendeu (regra da migration 031 — coordenadora não reporta venda própria;
 * sem isso a mesma venda contaria nos dois papéis), e sob a régua única das telas do
 * corretor: distratada e excluída ficam fora (spec 2026-08-28).
 */
export function vendasDaCoordenacao(vendas, coordenadora) {
  if (!Array.isArray(vendas) || !coordenadora?.id) return []
  return vendas.filter(v =>
    mesmoId(v?.coordenadora_id, coordenadora.id) &&
    !mesmoId(v?.corretor_id, coordenadora.usuario_id) &&
    isVendaAtiva(v),
  )
}

/**
 * Resumo do papel de coordenação: a fatia do cargo Coordenadora + macro NEUTRO
 * (contagens e valores de PARCELA — nunca a comissão de outro cargo).
 *
 * A fatia sai de `fatiaCargoDoPagamento(..., 'Coordenadora', ...)`, que já resolve a
 * taxa por venda (snapshot `vendas.coordenadora_taxa` > `coordenadoras.percentual_padrao`)
 * e devolve 0 pra parcela cancelada. Nada aqui recalcula comissão: a taxa decide só a
 * PROPORÇÃO sobre `comissao_gerada` (visualizacao-totais.md).
 *
 * `vazio` é o que a tela usa pro estado "ainda não tem venda direcionada" (caso Pires,
 * virando coordenador com carteira vazia) — nunca R$ 0,00 mudo.
 *
 * @param {object}   p
 * @param {Array}    p.vendas         - vendas já carregadas (qualquer escopo)
 * @param {Array}    p.pagamentos     - parcelas já carregadas
 * @param {object}   p.coordenadora   - linha de `coordenadoras` deste usuário
 * @param {Array}    p.cargos         - cargos_empreendimento
 * @param {Array}    p.coordenadoras  - todas as coordenadoras (fallback da taxa vigente)
 * @param {string}   [p.mes]          - 'YYYY-MM' pra filtrar a fatia; '' = todo o período
 * @param {string}   [p.hoje]         - 'YYYY-MM-DD' (injetável pra teste determinístico)
 */
export function resumoCoordenacao({
  vendas = [], pagamentos = [], coordenadora, cargos = [], coordenadoras = [],
  mes = '', hoje = new Date().toISOString().slice(0, 10),
} = {}) {
  const escopo = vendasDaCoordenacao(vendas, coordenadora)
  const vazio = escopo.length === 0
  const base = {
    vazio, nVendas: escopo.length,
    nParcelasPagas: 0, nParcelasPendentes: 0, pctRecebido: 0,
    nVencidasAbertas: 0, valorVencidoAberto: 0,
    fatiaPaga: 0, fatiaPendente: 0, serieMensal: [],
  }
  if (vazio) return base

  const porId = new Map(escopo.map(v => [String(v.id), v]))
  const ativos = (Array.isArray(pagamentos) ? pagamentos : [])
    .filter(p => porId.has(String(p?.venda_id)) && isAtivo(p))

  const fatia = (p) =>
    fatiaCargoDoPagamento(p, porId.get(String(p.venda_id)), 'Coordenadora', cargos, coordenadoras)

  const pagos = ativos.filter(isPago)
  const pendentes = ativos.filter(isPendente)
  const noMes = (p) => !mes || (dataEfetiva(p) || '').slice(0, 7) === mes

  const valorTotal = ativos.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0)
  const valorPago = pagos.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0)
  const vencidas = pendentes.filter(p => p.data_prevista && String(p.data_prevista).slice(0, 10) < hoje)

  const porMes = new Map()
  for (const p of pagos) {
    const ym = String(p.data_pagamento || '').slice(0, 7)
    if (!ym) continue
    porMes.set(ym, (porMes.get(ym) || 0) + fatia(p))
  }

  return {
    ...base,
    nParcelasPagas: pagos.length,
    nParcelasPendentes: pendentes.length,
    pctRecebido: valorTotal > 0 ? (valorPago / valorTotal) * 100 : 0,
    nVencidasAbertas: vencidas.length,
    valorVencidoAberto: vencidas.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0),
    fatiaPaga: pagos.filter(noMes).reduce((s, p) => s + fatia(p), 0),
    fatiaPendente: pendentes.filter(noMes).reduce((s, p) => s + fatia(p), 0),
    serieMensal: [...porMes.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 13),
  }
}

/**
 * Enriquecimento da venda na tela do corretor: percentual, fator e comissão do
 * cargo Corretor PARA AQUELA VENDA.
 *
 * Existe porque o CorretorDashboard fazia essa conta inline e colava em cada venda um
 * `percentual_corretor` tirado do CADASTRO. Como `percentualCorretorDaVenda` trata
 * `venda.percentual_corretor` como snapshot (e snapshot vence tudo), o objeto enriquecido
 * voltava pro helper e anulava a regra multi-tipo: venda EXTERNA de cadastro INTERNO
 * passava a pagar 2,5% em vez de 4%.
 *
 * Caso Matheus Pires (agosto/2026, parcelas pagas, cargo Corretor), medido em produção:
 *   relatório do próprio corretor  R$ 4.352,55  (2,5% em tudo)   ← errado
 *   relatório do Admin             R$ 4.704,87  (taxa do tipo)   ← certo
 * A diferença de R$ 352,32 não tinha nada a ver com distrato: naquele mês a fatia vinda
 * de venda distratada é R$ 0,00.
 *
 * ⚠️ `vendas.percentual_corretor` NÃO EXISTE no banco — o campo nasce só neste
 * enriquecimento. Passe sempre a venda como veio do banco.
 */
export function fatiaCorretorDaVenda(venda, perfil) {
  const valorVenda = parseFloat(venda?.valor_venda) || 0
  const valorProSoluto = parseFloat(venda?.valor_pro_soluto) || 0
  const percentual = percentualCorretorDaVenda(venda, perfil)

  const comissaoSnapshot = parseFloat(venda?.comissao_corretor) || 0
  const comissao = comissaoSnapshot > 0 ? comissaoSnapshot : (valorVenda * percentual) / 100

  return {
    percentual,
    comissao,
    fator: calcularFatorComissao(valorVenda, valorProSoluto, percentual),
  }
}
