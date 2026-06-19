import { useState, useEffect } from 'react'

// Campo de data em padrão BRASILEIRO (dd/mm/aaaa), sob NOSSA responsabilidade —
// o <input type="date"> nativo herda o locale do navegador/SO (mostra mm/dd no
// Chrome em inglês). Este é um input de texto mascarado que SEMPRE exibe dd/mm/aaaa.
//
// Drop-in do <input type="date">: recebe `value` em ISO ('aaaa-mm-dd') e dispara
// `onChange` com um evento sintético { target: { value: ISO } } — então os handlers
// existentes (e => ...e.target.value) continuam funcionando sem mudança.
// Emite ISO só quando a data está completa e é válida; senão emite '' (incompleto).

const isoToBR = (iso) => {
  if (!iso) return ''
  const m = String(iso).split('T')[0].match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

const brToISO = (br) => {
  const m = (br || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return ''
  const [, d, mo, y] = m
  const dt = new Date(Number(y), Number(mo) - 1, Number(d))
  // rejeita datas impossíveis (ex.: 31/02/2026)
  if (dt.getFullYear() !== Number(y) || dt.getMonth() !== Number(mo) - 1 || dt.getDate() !== Number(d)) return ''
  return `${y}-${mo}-${d}`
}

const mascarar = (txt) => {
  const d = String(txt).replace(/\D/g, '').slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

export default function InputDataBR({ value, onChange, className, placeholder = 'dd/mm/aaaa', ...rest }) {
  const [texto, setTexto] = useState(() => isoToBR(value))

  // Sincroniza com value externo (reset de form, edição) SEM atropelar digitação
  // parcial: só sobrescreve se o value de fora difere do que já está no campo.
  useEffect(() => {
    if ((value || '') !== brToISO(texto)) {
      setTexto(isoToBR(value))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const handle = (e) => {
    const masked = mascarar(e.target.value)
    setTexto(masked)
    onChange?.({ target: { value: brToISO(masked) } })
  }

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      placeholder={placeholder}
      maxLength={10}
      className={className}
      value={texto}
      onChange={handle}
    />
  )
}
