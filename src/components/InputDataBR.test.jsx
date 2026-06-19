import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import InputDataBR from './InputDataBR'

describe('InputDataBR — padrão BR (dd/mm/aaaa)', () => {
  it('exibe um value ISO como dd/mm/aaaa', () => {
    render(<InputDataBR value="2026-03-20" onChange={() => {}} />)
    expect(screen.getByRole('textbox').value).toBe('20/03/2026')
  })

  it('digitar dd/mm/aaaa emite ISO no onChange (drop-in do input nativo)', () => {
    const onChange = vi.fn()
    render(<InputDataBR value="" onChange={onChange} />)
    const inp = screen.getByRole('textbox')
    fireEvent.change(inp, { target: { value: '20/03/2026' } })
    expect(inp.value).toBe('20/03/2026')
    expect(onChange).toHaveBeenLastCalledWith({ target: { value: '2026-03-20' } })
  })

  it('mascara só dígitos automaticamente (20032026 → 20/03/2026)', () => {
    const onChange = vi.fn()
    render(<InputDataBR value="" onChange={onChange} />)
    const inp = screen.getByRole('textbox')
    fireEvent.change(inp, { target: { value: '20032026' } })
    expect(inp.value).toBe('20/03/2026')
    expect(onChange).toHaveBeenLastCalledWith({ target: { value: '2026-03-20' } })
  })

  it('data impossível (31/02/2026) emite vazio', () => {
    const onChange = vi.fn()
    render(<InputDataBR value="" onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '31/02/2026' } })
    expect(onChange).toHaveBeenLastCalledWith({ target: { value: '' } })
  })

  it('parcial não emite ISO e não é apagado pelo value externo vazio', () => {
    const onChange = vi.fn()
    const { rerender } = render(<InputDataBR value="" onChange={onChange} />)
    const inp = screen.getByRole('textbox')
    fireEvent.change(inp, { target: { value: '20/03' } })
    expect(onChange).toHaveBeenLastCalledWith({ target: { value: '' } })
    // parent re-renderiza com value '' (incompleto) — o texto parcial deve permanecer
    rerender(<InputDataBR value="" onChange={onChange} />)
    expect(inp.value).toBe('20/03')
  })

  it('o type="date" herdado do call-site é sobrescrito por type=text (vira BR)', () => {
    render(<InputDataBR type="date" value="2026-01-02" onChange={() => {}} />)
    expect(screen.getByRole('textbox').getAttribute('type')).toBe('text')
  })
})
