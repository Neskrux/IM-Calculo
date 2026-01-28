import { describe, it, expect, vi, beforeEach } from 'vitest'
import { deleteCliente } from './adminClientes'

describe('adminClientes.deleteCliente', () => {
  const clienteId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function mockChain(resolveValue) {
    return {
      from: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue(resolveValue)
    }
  }

  it('chama update com ativo: false, eq(id) e select(id) no Supabase', async () => {
    const chain = mockChain({ data: [{ id: clienteId }], error: null })
    const mockSupabase = { from: vi.fn(() => chain) }

    await deleteCliente(mockSupabase, clienteId)

    expect(mockSupabase.from).toHaveBeenCalledWith('clientes')
    expect(chain.update).toHaveBeenCalledWith({ ativo: false })
    expect(chain.eq).toHaveBeenCalledWith('id', clienteId)
    expect(chain.select).toHaveBeenCalledWith('id')
  })

  it('retorna { success: true } quando uma linha é atualizada', async () => {
    const chain = mockChain({ data: [{ id: clienteId }], error: null })
    const mockSupabase = { from: vi.fn(() => chain) }

    const result = await deleteCliente(mockSupabase, clienteId)

    expect(result).toEqual({ success: true })
  })

  it('lança erro quando Supabase retorna error', async () => {
    const chain = mockChain({ data: null, error: { message: 'RLS policy violation' } })
    const mockSupabase = { from: vi.fn(() => chain) }

    await expect(deleteCliente(mockSupabase, clienteId)).rejects.toThrow('RLS policy violation')
  })

  it('lança erro quando nenhuma linha é atualizada (data vazio)', async () => {
    const chain = mockChain({ data: [], error: null })
    const mockSupabase = { from: vi.fn(() => chain) }

    await expect(deleteCliente(mockSupabase, clienteId)).rejects.toThrow(
      'Nenhum registro atualizado'
    )
  })

  it('lança erro quando clienteId é vazio', async () => {
    const mockSupabase = { from: vi.fn() }

    await expect(deleteCliente(mockSupabase, '')).rejects.toThrow('ID do cliente é obrigatório')
  })

  it('lança erro quando clienteId é null/undefined', async () => {
    const mockSupabase = { from: vi.fn() }

    await expect(deleteCliente(mockSupabase, null)).rejects.toThrow('ID do cliente é obrigatório')
    await expect(deleteCliente(mockSupabase, undefined)).rejects.toThrow('ID do cliente é obrigatório')
  })
})
