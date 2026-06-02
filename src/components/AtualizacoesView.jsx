import { useMemo, useState } from 'react'
import { Sparkles, Wrench, Bug, AlertTriangle, Filter, CheckCircle2 } from 'lucide-react'
import { NOTAS } from '../config/notas'

// Pagina (aba do admin) que lista TODAS as notas de atualizacao publicadas,
// como um historico. Diferente do modal que aparece automaticamente, aqui o
// admin pode reler quando quiser, filtrar por tipo, ver tudo agrupado por data.

const STORAGE_KEY = 'im-notas-vistas-ids'

const ICONES_TIPO = {
  novidade: { icon: Sparkles, cor: '#c9a962', label: 'Novidade' },
  melhoria: { icon: Wrench, cor: '#3b82f6', label: 'Melhoria' },
  correcao: { icon: Bug, cor: '#10b981', label: 'Correção' },
  aviso: { icon: AlertTriangle, cor: '#f59e0b', label: 'Aviso' },
}

function carregarVistas() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw))
  } catch { return new Set() }
}

const AtualizacoesView = () => {
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [vistas] = useState(() => carregarVistas())

  const notasFiltradas = useMemo(() => {
    if (filtroTipo === 'todos') return NOTAS
    return NOTAS
      .map(nota => ({ ...nota, itens: nota.itens.filter(it => it.tipo === filtroTipo) }))
      .filter(nota => nota.itens.length > 0)
  }, [filtroTipo])

  const contagensTipo = useMemo(() => {
    const acc = { novidade: 0, melhoria: 0, correcao: 0, aviso: 0 }
    for (const n of NOTAS) for (const it of n.itens) acc[it.tipo] = (acc[it.tipo] ?? 0) + 1
    return acc
  }, [])

  if (NOTAS.length === 0) {
    return (
      <div className="content-section" style={{ textAlign: 'center', padding: 40, color: 'var(--im-text-secondary)' }}>
        <Sparkles size={48} style={{ margin: '0 auto 16px', color: '#c9a962', opacity: 0.5 }} />
        <p>Nenhuma nota de atualização publicada ainda.</p>
      </div>
    )
  }

  const totalNaoLidas = NOTAS.filter(n => !vistas.has(n.id)).length

  return (
    <div className="content-section">
      {/* cabecalho com contagem geral */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 20,
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div style={{ color: 'var(--im-text-secondary)', fontSize: 14 }}>
          {NOTAS.length} {NOTAS.length === 1 ? 'atualização publicada' : 'atualizações publicadas'}
          {totalNaoLidas > 0 && (
            <span style={{
              marginLeft: 12,
              padding: '4px 10px',
              borderRadius: 12,
              background: 'rgba(201,169,98,0.15)',
              color: '#c9a962',
              fontSize: 11,
              fontWeight: 600,
            }}>
              {totalNaoLidas} não {totalNaoLidas === 1 ? 'lida' : 'lidas'}
            </span>
          )}
        </div>

        {/* filtros */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <FiltroChip ativo={filtroTipo === 'todos'} onClick={() => setFiltroTipo('todos')} icone={Filter} cor="#c9a962" label="Todos" />
          {['novidade', 'melhoria', 'correcao', 'aviso'].map(t => {
            const cfg = ICONES_TIPO[t]
            return (
              <FiltroChip
                key={t}
                ativo={filtroTipo === t}
                onClick={() => setFiltroTipo(t)}
                icone={cfg.icon}
                cor={cfg.cor}
                label={cfg.label}
                count={contagensTipo[t]}
              />
            )
          })}
        </div>
      </div>

      {/* timeline das notas */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {notasFiltradas.map(nota => {
          const ehNaoLida = !vistas.has(nota.id)
          return (
            <article
              key={nota.id}
              style={{
                background: 'var(--im-bg-secondary)',
                border: `1px solid ${ehNaoLida ? 'rgba(201,169,98,0.4)' : 'var(--im-border)'}`,
                borderRadius: 12,
                padding: 20,
                position: 'relative',
              }}
            >
              {ehNaoLida && (
                <div style={{
                  position: 'absolute',
                  top: 16, right: 16,
                  padding: '4px 10px',
                  borderRadius: 8,
                  background: 'rgba(201,169,98,0.15)',
                  color: '#c9a962',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                }}>
                  NÃO LIDA
                </div>
              )}

              <header style={{ marginBottom: 16, paddingRight: ehNaoLida ? 90 : 0 }}>
                <h3 style={{
                  margin: 0,
                  fontSize: 18,
                  color: 'var(--im-text-primary)',
                  fontFamily: 'Playfair Display, serif',
                  fontWeight: 500,
                }}>
                  {nota.titulo}
                </h3>
                <div style={{
                  fontSize: 12,
                  color: 'var(--im-text-secondary)',
                  marginTop: 4,
                }}>
                  {nota.data}
                </div>
              </header>

              <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
                {nota.itens.map((it, j) => {
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
                        borderTop: j === 0 ? 'none' : '1px solid rgba(255,255,255,0.04)',
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
            </article>
          )
        })}
      </div>

      {notasFiltradas.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--im-text-secondary)' }}>
          Nenhuma nota com este filtro.
        </div>
      )}
    </div>
  )
}

const FiltroChip = ({ ativo, onClick, icone: Icone, cor, label, count }) => (
  <button
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 12px',
      borderRadius: 8,
      background: ativo ? `${cor}20` : 'var(--im-bg-tertiary)',
      border: `1px solid ${ativo ? `${cor}60` : 'var(--im-border)'}`,
      color: ativo ? cor : 'var(--im-text-secondary)',
      fontSize: 12,
      fontWeight: ativo ? 600 : 400,
      cursor: 'pointer',
    }}
  >
    <Icone size={14} />
    <span>{label}</span>
    {count != null && (
      <span style={{
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 6,
        background: ativo ? `${cor}30` : 'rgba(255,255,255,0.05)',
      }}>
        {count}
      </span>
    )}
  </button>
)

export default AtualizacoesView
