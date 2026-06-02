import { useState, useEffect, useMemo } from 'react'
import { Sparkles, X, CheckCircle2, ChevronLeft, ChevronRight, Wrench, AlertTriangle, Bug } from 'lucide-react'
import { NOTAS } from '../config/notas'

// Modal de notas de atualizacao — admin-only.
// Abre automaticamente quando houver pelo menos uma nota nao lida.
// Suporta paginacao entre todas as notas (inclusive ja vistas — vira historico).
// Cada admin pode marcar individualmente ou tudo como lido.
//
// Pra publicar uma nota nova: crie um arquivo em src/config/notas/
// nomeado AAAA-MM-DD-HHMM-slug.js. O index.js carrega automaticamente.

const STORAGE_KEY = 'im-notas-vistas-ids'

function carregarVistas() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw))
  } catch { return new Set() }
}

function salvarVistas(set) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...set])) } catch { /* ignora */ }
}

const ICONES_TIPO = {
  novidade: { icon: Sparkles, cor: '#c9a962', label: 'Novidade' },
  melhoria: { icon: Wrench, cor: '#3b82f6', label: 'Melhoria' },
  correcao: { icon: Bug, cor: '#10b981', label: 'Correção' },
  aviso: { icon: AlertTriangle, cor: '#f59e0b', label: 'Aviso' },
}

const NotasAtualizacaoModal = ({ forceOpen = false, onClose }) => {
  const [open, setOpen] = useState(false)
  const [vistas, setVistas] = useState(() => carregarVistas())
  const [indice, setIndice] = useState(0)

  const naoLidas = useMemo(() => NOTAS.filter(n => !vistas.has(n.id)), [vistas])

  useEffect(() => {
    if (forceOpen) { setOpen(true); setIndice(0); return }
    if (naoLidas.length > 0) { setOpen(true); setIndice(0) }
  }, [forceOpen])

  if (!open || NOTAS.length === 0) return null

  const notaAtual = NOTAS[indice]
  if (!notaAtual) return null

  const marcarComoVista = (id) => {
    const nova = new Set(vistas)
    nova.add(id)
    setVistas(nova)
    salvarVistas(nova)
  }

  const proxima = () => {
    if (indice < NOTAS.length - 1) {
      marcarComoVista(notaAtual.id)
      setIndice(indice + 1)
    }
  }

  const anterior = () => {
    if (indice > 0) setIndice(indice - 1)
  }

  const marcarTodasComoLidas = () => {
    const nova = new Set([...vistas, ...NOTAS.map(n => n.id)])
    setVistas(nova)
    salvarVistas(nova)
    setOpen(false)
    onClose?.()
  }

  const fecharAtual = () => {
    marcarComoVista(notaAtual.id)
    setOpen(false)
    onClose?.()
  }

  const ehNaoLida = !vistas.has(notaAtual.id)
  const totalNotas = NOTAS.length
  const totalNaoLidas = naoLidas.length

  return (
    <div className="modal-overlay" onClick={fecharAtual} style={{ zIndex: 2000 }}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 680 }}
      >
        <div className="modal-header" style={{ borderBottom: '1px solid var(--im-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'linear-gradient(135deg, #c9a962, #8b7355)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Sparkles size={20} color="#0f0f0f" />
            </div>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{notaAtual.titulo}</h2>
              <div style={{ fontSize: 12, color: 'var(--im-text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{notaAtual.data}</span>
                {ehNaoLida && (
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: 8,
                    background: 'rgba(201,169,98,0.15)',
                    color: '#c9a962',
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: 0.5,
                  }}>
                    NOVA
                  </span>
                )}
              </div>
            </div>
          </div>
          <button className="close-btn" onClick={fecharAtual} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', maxHeight: '50vh', overflowY: 'auto' }}>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
            {notaAtual.itens.map((it, j) => {
              const cfg = ICONES_TIPO[it.tipo] ?? ICONES_TIPO.melhoria
              const Icone = cfg.icon
              return (
                <li
                  key={j}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: '10px 0',
                    borderBottom: j < notaAtual.itens.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: `${cfg.cor}15`,
                    border: `1px solid ${cfg.cor}40`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: 2,
                  }}>
                    <Icone size={16} style={{ color: cfg.cor }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 10,
                      textTransform: 'uppercase',
                      letterSpacing: 1,
                      color: cfg.cor,
                      fontWeight: 700,
                      marginBottom: 4,
                    }}>
                      {cfg.label}
                    </div>
                    <div style={{
                      fontSize: 14,
                      lineHeight: 1.5,
                      color: 'var(--im-text-primary)',
                    }}>
                      {it.texto}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid var(--im-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <button
            onClick={anterior}
            disabled={indice === 0}
            style={{
              width: 36, height: 36, borderRadius: 8,
              background: 'var(--im-bg-tertiary)',
              border: '1px solid var(--im-border)',
              color: indice === 0 ? 'rgba(255,255,255,0.2)' : 'var(--im-text-secondary)',
              cursor: indice === 0 ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="Anterior"
          >
            <ChevronLeft size={18} />
          </button>

          <div style={{ fontSize: 12, color: 'var(--im-text-secondary)', minWidth: 70, textAlign: 'center' }}>
            {indice + 1} de {totalNotas}
            {totalNaoLidas > 0 && (
              <div style={{ fontSize: 10, color: '#c9a962', marginTop: 2 }}>
                {totalNaoLidas} não {totalNaoLidas === 1 ? 'lida' : 'lidas'}
              </div>
            )}
          </div>

          <button
            onClick={proxima}
            disabled={indice >= totalNotas - 1}
            style={{
              width: 36, height: 36, borderRadius: 8,
              background: 'var(--im-bg-tertiary)',
              border: '1px solid var(--im-border)',
              color: indice >= totalNotas - 1 ? 'rgba(255,255,255,0.2)' : 'var(--im-text-secondary)',
              cursor: indice >= totalNotas - 1 ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="Próxima"
          >
            <ChevronRight size={18} />
          </button>

          <div style={{ flex: 1 }} />

          {totalNaoLidas > 0 && (
            <button
              onClick={marcarTodasComoLidas}
              style={{
                padding: '8px 14px',
                background: 'transparent',
                color: 'var(--im-text-secondary)',
                border: '1px solid var(--im-border)',
                borderRadius: 8,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Marcar todas como lidas
            </button>
          )}

          <button
            onClick={fecharAtual}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 18px',
              background: 'linear-gradient(135deg, #c9a962, #8b7355)',
              color: '#0f0f0f',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <CheckCircle2 size={14} />
            Entendi
          </button>
        </div>
      </div>
    </div>
  )
}

export default NotasAtualizacaoModal
