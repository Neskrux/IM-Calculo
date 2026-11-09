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

const blob = new Blob(['%PDF-teste'], { type: 'application/pdf' })
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
