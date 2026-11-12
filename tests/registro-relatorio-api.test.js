import { describe, it, expect, vi, beforeEach } from 'vitest'

const upload = vi.fn()
const single = vi.fn()
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload }) },
    from: () => ({ insert: () => ({ select: () => ({ single }) }) }),
  },
}))

const { registrarEmissao } = await import('../src/utils/registroRelatorioApi')
const { gerarRelatorioCorretorPDF } = await import('../src/utils/relatorioCorretorPDF')

// blob com arrayBuffer do proprio Node (o Blob do jsdom vem de outro realm e o webcrypto do Node 20 recusa)
const blob = { type: 'application/pdf', arrayBuffer: async () => new TextEncoder().encode('%PDF-teste').buffer }
const args = { blob, origem: 'corretor', corretorId: 'c1', filtros: {}, totais: { total: 1, pago: 1, pendente: 0 }, parcelas: [{ id: 'p1', valor: 10, comissao: 1, status: 'pago' }] }

describe('registrarEmissao', () => {
  beforeEach(() => { upload.mockReset(); single.mockReset() })

  it('sobe o PDF na pasta do corretor e grava o registro com hash', async () => {
    upload.mockResolvedValue({ error: null })
    single.mockResolvedValue({ data: { id: 'r' }, error: null })
    await registrarEmissao(args)
    expect(upload.mock.calls[0][0]).toMatch(/^c1\/[0-9a-f-]{36}\.pdf$/)
  })

  it('falha no upload => lança (o PDF não é baixado)', async () => {
    upload.mockResolvedValue({ error: { message: 'sem permissão' } })
    await expect(registrarEmissao(args)).rejects.toThrow(/salvar o PDF/)
  })

  it('falha no insert => lança', async () => {
    upload.mockResolvedValue({ error: null })
    single.mockResolvedValue({ data: null, error: { message: 'rls' } })
    await expect(registrarEmissao(args)).rejects.toThrow(/registrar a emissão/)
  })
})

describe('gerarRelatorioCorretorPDF + registrar', () => {
  it('registro que falha impede o download e registra os totais impressos', async () => {
    const registrar = vi.fn().mockRejectedValue(new Error('falhou'))
    const vendas = [{ id: 'v1', valor_venda: 100000, valor_pro_soluto: 10000, percentual_corretor: 4, tipo_corretor: 'externo' }]
    const pagamentos = [{ id: 'p1', venda_id: 'v1', valor: 1000, status: 'pago', comissao_gerada: 70, data_pagamento: '2026-10-10', data_prevista: '2026-10-10' }]
    await expect(gerarRelatorioCorretorPDF({ corretorProfile: { nome: 'Ana' }, vendas, pagamentos, filtros: { status: 'todos' }, registrar })).rejects.toThrow('falhou')
    const { totais, parcelas } = registrar.mock.calls[0][0]
    expect(parcelas.map(p => p.id)).toEqual(['p1'])
    expect(totais.total).toBeCloseTo(parcelas[0].comissao)
    expect(totais.pago).toBeCloseTo(totais.total)
  })
})

// Caso real 2026-11-12 (corretor no iPhone): o download vinha DEPOIS do upload do registro.
// No iOS o navegador só deixa baixar arquivo dentro do toque do usuário; depois de esperar a
// rede o toque "expira" e o doc.save() falha em silêncio. 16 emissões registradas, 0 PDFs na mão.
// Por isso o corretor recebe o PDF já registrado e baixa num SEGUNDO toque (gesto novo).
// salvar() baixa via <a download>.click() SÍNCRONO — dentro do toque, que é o que o iOS exige.
function espiarDownload() {
  if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:teste'
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {}
  return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {})
}

describe('gerarRelatorioCorretorPDF com baixarAgora=false (download em toque novo)', () => {
  const vendas = [{ id: 'v1', valor_venda: 100000, valor_pro_soluto: 10000, percentual_corretor: 4, tipo_corretor: 'externo' }]
  const pagamentos = [{ id: 'p1', venda_id: 'v1', valor: 1000, status: 'pago', comissao_gerada: 70, data_pagamento: '2026-10-10', data_prevista: '2026-10-10' }]

  it('registra, não baixa sozinho e devolve salvar() que baixa o mesmo PDF registrado', async () => {
    const save = espiarDownload()
    const registrar = vi.fn().mockResolvedValue({ id: 'r1' })
    const pronto = await gerarRelatorioCorretorPDF({ corretorProfile: { nome: 'Ana Lima' }, vendas, pagamentos, filtros: { status: 'todos' }, registrar, baixarAgora: false })
    expect(registrar).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()
    expect(pronto.nomeArquivo).toMatch(/^Relatorio_Ana_Lima_\d{4}-\d{2}-\d{2}\.pdf$/)
    pronto.salvar()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.contexts[0].download).toBe(pronto.nomeArquivo)
    save.mockRestore()
  })

  it('registro que falha => nada para baixar', async () => {
    const registrar = vi.fn().mockRejectedValue(new Error('falhou'))
    await expect(gerarRelatorioCorretorPDF({ corretorProfile: { nome: 'Ana' }, vendas, pagamentos, filtros: { status: 'todos' }, registrar, baixarAgora: false })).rejects.toThrow('falhou')
  })

})
