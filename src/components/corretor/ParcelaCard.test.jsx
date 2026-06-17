import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ParcelaCard, { labelTipoParcela } from './ParcelaCard'

// Contrato de COMPORTAMENTO do card comissão-first (jsdom).
// O layout real (sem scroll horizontal, tamanhos) é coberto pelo Playwright.

describe('labelTipoParcela', () => {
  it('rotula cada tipo', () => {
    expect(labelTipoParcela({ tipo: 'sinal' })).toBe('Sinal')
    expect(labelTipoParcela({ tipo: 'entrada' })).toBe('Entrada')
    expect(labelTipoParcela({ tipo: 'parcela_entrada', numero_parcela: 7 })).toBe('Parcela 7')
    expect(labelTipoParcela({ tipo: 'balao', numero_parcela: 2 })).toBe('Balão 2')
    expect(labelTipoParcela({ tipo: 'comissao_integral' })).toBe('✨ Comissão Integral')
  })
})

describe('ParcelaCard — comissão-first', () => {
  const pagPago = {
    tipo: 'parcela_entrada',
    numero_parcela: 1,
    status: 'pago',
    valor: 1962.39,
    data_pagamento: '2026-03-20',
    data_prevista: '2026-03-20',
  }

  it('lidera com a comissão do corretor, rotulada', () => {
    render(<ParcelaCard pagamento={pagPago} comissao={392.48} />)
    expect(screen.getByText('Minha comissão')).toBeInTheDocument()
    expect(screen.getByText('R$ 392,48')).toBeInTheDocument()
  })

  it('mostra o valor da parcela como contexto (rotulado) no rodapé', () => {
    render(<ParcelaCard pagamento={pagPago} comissao={392.48} />)
    expect(screen.getByText(/valor da parcela/i)).toBeInTheDocument()
    expect(screen.getByText(/R\$ 1\.962,39/)).toBeInTheDocument()
  })

  it('pago → "pago em" + data_pagamento; pendente → "vence" + data_prevista', () => {
    const { unmount } = render(<ParcelaCard pagamento={pagPago} comissao={392.48} />)
    expect(screen.getByText(/pago em/i)).toBeInTheDocument()
    unmount()

    render(
      <ParcelaCard
        pagamento={{ ...pagPago, status: 'pendente', data_prevista: '2026-04-20', data_pagamento: null }}
        comissao={392.48}
      />,
    )
    expect(screen.getByText(/vence/i)).toBeInTheDocument()
  })

  it('status pago aplica a classe .pago no card', () => {
    const { container } = render(<ParcelaCard pagamento={pagPago} comissao={392.48} />)
    expect(container.querySelector('.parcela-card')).toHaveClass('pago')
  })

  it('renegociacao_id mostra a pill Aditivo', () => {
    render(<ParcelaCard pagamento={{ ...pagPago, renegociacao_id: 'r1' }} comissao={1} />)
    expect(screen.getByText('Aditivo')).toBeInTheDocument()
  })
})
