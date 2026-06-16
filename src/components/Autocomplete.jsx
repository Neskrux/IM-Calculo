// Combobox de busca reutilizável: digita → dropdown de matches → clica pra escolher.
// Funciona em 2 modos via props:
//   - PICKER:  onSelect(item)        → escolhe um item (ex.: cliente da Nova Venda)
//   - FILTRO:  onQueryChange(texto)  → o pai filtra a lista exibida (ex.: Meus Clientes)
// Ambos podem coexistir. Normalização (acento/CPF) vem do searchUtils.
import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import { filtrarBusca } from '../utils/searchUtils'
import './Autocomplete.css'

export default function Autocomplete({
  items = [],
  fields = [],
  getLabel = (i) => i?.nome ?? i?.nome_completo ?? '',
  getSub,
  onSelect,
  onQueryChange,
  placeholder = 'Buscar...',
  value,                 // controlado (opcional)
  maxSugestoes = 8,
}) {
  const controlado = value !== undefined
  const [interno, setInterno] = useState('')
  const q = controlado ? value : interno
  const [aberto, setAberto] = useState(false)
  const [ativo, setAtivo] = useState(-1)
  const boxRef = useRef(null)

  const sugestoes = useMemo(
    () => (q && q.trim() ? filtrarBusca(items, q, fields).slice(0, maxSugestoes) : []),
    [items, q, fields, maxSugestoes],
  )

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setAberto(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const mudar = (val) => {
    if (!controlado) setInterno(val)
    onQueryChange?.(val)
    setAberto(true)
    setAtivo(-1)
  }
  const escolher = (item) => {
    onSelect?.(item)
    const label = getLabel(item)
    if (!controlado) setInterno(label)
    onQueryChange?.(label)
    setAberto(false)
  }
  const onKey = (e) => {
    if (!aberto || !sugestoes.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo((a) => Math.min(a + 1, sugestoes.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && ativo >= 0) { e.preventDefault(); escolher(sugestoes[ativo]) }
    else if (e.key === 'Escape') { setAberto(false) }
  }

  return (
    <div className="im-autocomplete" ref={boxRef}>
      <div className="im-autocomplete-input">
        <Search size={16} />
        <input
          type="text"
          value={q || ''}
          placeholder={placeholder}
          onChange={(e) => mudar(e.target.value)}
          onFocus={() => q && q.trim() && setAberto(true)}
          onKeyDown={onKey}
          autoComplete="off"
        />
        {q ? (
          <button type="button" className="im-autocomplete-clear" onClick={() => mudar('')} aria-label="Limpar">
            <X size={14} />
          </button>
        ) : null}
      </div>
      {aberto && sugestoes.length > 0 && (
        <ul className="im-autocomplete-list" role="listbox">
          {sugestoes.map((item, i) => (
            <li
              key={item.id ?? i}
              role="option"
              aria-selected={i === ativo}
              className={i === ativo ? 'ativo' : ''}
              onMouseEnter={() => setAtivo(i)}
              onMouseDown={(e) => { e.preventDefault(); escolher(item) }}
            >
              <span className="im-ac-label">{getLabel(item)}</span>
              {getSub ? <span className="im-ac-sub">{getSub(item)}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
