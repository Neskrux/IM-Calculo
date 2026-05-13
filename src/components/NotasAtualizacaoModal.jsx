import { useState, useEffect } from 'react'
import { Sparkles, X, CheckCircle2 } from 'lucide-react'
import { NOTAS_VERSAO, NOTAS_LISTA } from '../config/notasAtualizacao'

// Modal de notas de atualizacao — admin-only.
// Aparece automaticamente uma vez por versao (controle via localStorage).
// Pra liberar pra todos os admins de novo apos uma nova versao, basta
// incrementar NOTAS_VERSAO em src/config/notasAtualizacao.js.
//
// Tambem dah pra reabrir manualmente via o botao "Notas" no header (futuro).
const STORAGE_KEY = 'im-notas-vista-versao'

const NotasAtualizacaoModal = ({ forceOpen = false, onClose }) => {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (forceOpen) { setOpen(true); return }
    try {
      const visto = localStorage.getItem(STORAGE_KEY)
      if (visto !== NOTAS_VERSAO) setOpen(true)
    } catch {
      setOpen(true) // se localStorage falhar, mostra
    }
  }, [forceOpen])

  const handleClose = () => {
    try { localStorage.setItem(STORAGE_KEY, NOTAS_VERSAO) } catch { /* ignora */ }
    setOpen(false)
    onClose?.()
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={handleClose} style={{ zIndex: 2000 }}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 640 }}
      >
        <div className="modal-header" style={{ borderBottom: '1px solid var(--im-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'linear-gradient(135deg, #c9a962, #8b7355)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Sparkles size={20} color="#0f0f0f" />
            </div>
            <div>
              <h2 style={{ margin: 0 }}>Notas de Atualização</h2>
              <div style={{ fontSize: 12, color: 'var(--im-text-secondary)', marginTop: 2 }}>
                {NOTAS_VERSAO}
              </div>
            </div>
          </div>
          <button className="close-btn" onClick={handleClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {NOTAS_LISTA.map((secao, i) => (
            <div key={i} style={{ marginBottom: 20 }}>
              <h3 style={{
                fontSize: 13,
                textTransform: 'uppercase',
                letterSpacing: 1.5,
                color: '#c9a962',
                margin: '0 0 10px',
                fontWeight: 600,
              }}>
                {secao.titulo}
              </h3>
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
                {secao.itens.map((it, j) => (
                  <li
                    key={j}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '8px 0',
                      fontSize: 14,
                      lineHeight: 1.5,
                      color: 'var(--im-text-primary)',
                    }}
                  >
                    <CheckCircle2 size={16} style={{ color: '#10b981', marginTop: 2, flexShrink: 0 }} />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid var(--im-border)',
          display: 'flex',
          justifyContent: 'flex-end',
        }}>
          <button
            onClick={handleClose}
            style={{
              padding: '10px 24px',
              background: 'linear-gradient(135deg, #c9a962, #8b7355)',
              color: '#0f0f0f',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  )
}

export default NotasAtualizacaoModal
