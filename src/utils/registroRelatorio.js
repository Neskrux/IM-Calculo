// Registro de emissão de relatório — o IM Cálculo prova o que emitiu.
// Spec: docs/specs/2026-11-09-spec-registro-relatorios.md · Migration 043.
//
// Regra: o registro grava OS MESMOS números que saíram impressos no PDF
// (nunca um recálculo). Se o registro falhar, o download não acontece.

export const BUCKET_RELATORIOS = 'relatorios'

export const FILTROS_RELATORIO_INICIAIS = Object.freeze({
  tipo: 'pagamentos',
  corretorId: '',
  vendaId: '',
  cargoId: 'Corretor',
  coordenadoraId: '',
  papel: 'corretor',
  status: 'todos',
  dataInicio: '',
  dataFim: '',
  empreendimentoId: '',
  empreendimentoDetalhe: '',
  incluirDistratos: false,
})

const ORIGENS = ['admin', 'corretor', 'admin_ver_pdf_corretor']
const cent = (n) => Math.round((parseFloat(n) || 0) * 100) / 100

export function caminhoPdfRelatorio(corretorId, relatorioId) {
  return `${corretorId || 'geral'}/${relatorioId}.pdf`
}

/** Monta a linha de `relatorios_emitidos` (puro, testável). */
export function montarRegistroEmissao({ id, origem, corretorId, filtros, totais, parcelas, pdfPath, pdfSha256, versaoApp }) {
  if (!ORIGENS.includes(origem)) throw new Error(`origem inválida: ${origem}`)
  const lista = (parcelas || []).map(p => {
    if (!p?.id) throw new Error('parcela sem id no registro do relatório')
    return {
      id: p.id,
      venda_id: p.venda_id ?? null,
      valor: cent(p.valor),
      comissao: cent(p.comissao),
      status: p.status ?? null,
    }
  })
  const row = {
    origem,
    corretor_id: corretorId || null,
    filtros: JSON.parse(JSON.stringify(filtros || {})),
    total: cent(totais?.total),
    pago: cent(totais?.pago),
    pendente: cent(totais?.pendente),
    parcelas: lista,
    qtd_parcelas: lista.length,
    pdf_path: pdfPath,
    pdf_sha256: pdfSha256,
    versao_app: versaoApp ?? null,
  }
  if (id) row.id = id
  return row
}

/** Texto dos filtros para mostrar na tela antes de gerar (e no cabeçalho do PDF). */
export function filtrosVisiveis(f, { corretores = [], empreendimentos = [] } = {}) {
  const cargo = f.cargoId === '__total__'
    ? 'Total (todos os cargos somados)'
    : f.cargoId === '' ? 'Todos os cargos' : f.cargoId
  const emp = f.empreendimentoId
    ? (empreendimentos.find(e => String(e.id) === String(f.empreendimentoId))?.nome || f.empreendimentoId)
    : 'Todos'
  const corretor = f.corretorId
    ? (corretores.find(c => String(c.id) === String(f.corretorId))?.nome || f.corretorId)
    : 'Todos'
  const status = f.status === 'pago' ? 'Pagos' : f.status === 'pendente' ? 'Pendentes' : 'Todos'
  const chaves = ['corretorId', 'vendaId', 'cargoId', 'coordenadoraId', 'status', 'dataInicio', 'dataFim', 'empreendimentoId', 'incluirDistratos']
  const alterado = chaves.some(k => (f[k] ?? '') !== (FILTROS_RELATORIO_INICIAIS[k] ?? ''))
  return {
    cargo, empreendimento: emp, corretor, status,
    periodo: f.dataInicio || f.dataFim ? `${f.dataInicio || '…'} a ${f.dataFim || '…'}` : 'Todo o período',
    distratos: f.incluirDistratos ? 'Incluídos' : 'Fora',
    alterado,
  }
}
