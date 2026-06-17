import { formatDataBR } from '../../utils/datas'
import './ParcelaCard.css'

// Card de parcela na visão do CORRETOR — comissão-first.
// O número que importa pro corretor (a comissão DELE) é o herói, rotulado.
// O valor da parcela (o que o cliente paga pra IM) é contexto secundário no rodapé.
// Unifica os 2 cards divergentes que existiam (Vendas: .corretor-parcela-row,
// sem rótulo · Pagamentos: .parcela-row) num componente único e reutilizável.

const fmtBRL = (v) =>
  v === null || v === undefined || isNaN(v)
    ? 'R$ 0,00'
    : new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(v)

const STATUS_LABEL = { pago: 'Pago', cancelado: 'Cancelado', pendente: 'Pendente' }

export function labelTipoParcela(p) {
  if (!p) return ''
  if (p.tipo === 'sinal') return 'Sinal'
  if (p.tipo === 'entrada') return 'Entrada'
  if (p.tipo === 'parcela_entrada') return `Parcela ${p.numero_parcela || ''}`.trim()
  if (p.tipo === 'balao') return `Balão ${p.numero_parcela || ''}`.trim()
  if (p.tipo === 'comissao_integral') return '✨ Comissão Integral'
  return p.tipo || ''
}

export default function ParcelaCard({ pagamento, comissao }) {
  if (!pagamento) return null
  const status = pagamento.status || 'pendente'
  const pago = status === 'pago'
  const cancelado = status === 'cancelado'
  const data = pago ? pagamento.data_pagamento || pagamento.data_prevista : pagamento.data_prevista

  return (
    <div className={`parcela-card ${pago ? 'pago' : cancelado ? 'cancelado' : 'pendente'}`}>
      <div className="parcela-card-top">
        <span className="parcela-card-tipo">{labelTipoParcela(pagamento)}</span>
        <span className="parcela-card-badges">
          <span className={`status-pill ${status}`}>{STATUS_LABEL[status] || 'Pendente'}</span>
          {pagamento.renegociacao_id && (
            <span className="pill-aditivo" title="Parcela de grade renegociada por aditivo (reparcelamento)">
              Aditivo
            </span>
          )}
        </span>
      </div>

      <div className="parcela-card-comissao-label">Minha comissão</div>
      <div className="parcela-card-comissao">{fmtBRL(comissao)}</div>

      <div className="parcela-card-rodape">
        <span>
          {pago ? 'pago em' : 'vence'} {formatDataBR(data)}
        </span>
        <span className="parcela-card-sep">·</span>
        <span className="parcela-card-valor">valor da parcela {fmtBRL(pagamento.valor)}</span>
      </div>
    </div>
  )
}
