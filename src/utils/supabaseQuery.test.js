import { describe, it, expect, vi } from 'vitest'
import { fetchAllPaginated } from './supabaseQuery'

// Gera linhas fake { id: n }
const rows = (start, count) => Array.from({ length: count }, (_, i) => ({ id: start + i }))

describe('fetchAllPaginated', () => {
  it('retorna [] quando não há linhas (1 chamada)', async () => {
    const build = vi.fn().mockResolvedValue({ data: [], error: null })

    const result = await fetchAllPaginated(build)

    expect(result).toEqual([])
    expect(build).toHaveBeenCalledTimes(1)
    expect(build).toHaveBeenCalledWith(0, 999)
  })

  it('1 página parcial: termina sem pedir a próxima', async () => {
    const build = vi.fn().mockResolvedValueOnce({ data: rows(0, 500), error: null })

    const result = await fetchAllPaginated(build)

    expect(result).toHaveLength(500)
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('boundary do bug: exatamente 1000 linhas força a página seguinte (vazia)', async () => {
    const build = vi
      .fn()
      .mockResolvedValueOnce({ data: rows(0, 1000), error: null })
      .mockResolvedValueOnce({ data: [], error: null })

    const result = await fetchAllPaginated(build)

    expect(result).toHaveLength(1000)
    expect(build).toHaveBeenCalledTimes(2)
    expect(build).toHaveBeenNthCalledWith(1, 0, 999)
    expect(build).toHaveBeenNthCalledWith(2, 1000, 1999)
  })

  it('2.5 páginas: 2500 linhas na ordem, 3 chamadas com ranges certos', async () => {
    const build = vi
      .fn()
      .mockResolvedValueOnce({ data: rows(0, 1000), error: null })
      .mockResolvedValueOnce({ data: rows(1000, 1000), error: null })
      .mockResolvedValueOnce({ data: rows(2000, 500), error: null })

    const result = await fetchAllPaginated(build)

    expect(result).toHaveLength(2500)
    expect(result[0].id).toBe(0)
    expect(result[2499].id).toBe(2499)
    expect(build).toHaveBeenCalledTimes(3)
    expect(build).toHaveBeenNthCalledWith(3, 2000, 2999)
  })

  it('factory é chamada uma vez POR PÁGINA (builder novo a cada página)', async () => {
    const build = vi
      .fn()
      .mockResolvedValueOnce({ data: rows(0, 1000), error: null })
      .mockResolvedValueOnce({ data: rows(1000, 10), error: null })

    await fetchAllPaginated(build)

    expect(build).toHaveBeenCalledTimes(2)
  })

  it('erro em página do meio → throw, NUNCA retorno parcial', async () => {
    const build = vi
      .fn()
      .mockResolvedValueOnce({ data: rows(0, 1000), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } })

    await expect(fetchAllPaginated(build)).rejects.toEqual({ message: 'boom' })
  })

  it('respeita pageSize customizado', async () => {
    const build = vi
      .fn()
      .mockResolvedValueOnce({ data: rows(0, 200), error: null })
      .mockResolvedValueOnce({ data: rows(200, 50), error: null })

    const result = await fetchAllPaginated(build, { pageSize: 200 })

    expect(result).toHaveLength(250)
    expect(build).toHaveBeenNthCalledWith(1, 0, 199)
    expect(build).toHaveBeenNthCalledWith(2, 200, 399)
  })
})
