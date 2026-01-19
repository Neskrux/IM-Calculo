import { useState, useEffect } from 'react'
import brasao from '../imgs/brasao.png'
import './SiteIntro.css'

const SiteIntro = ({ onComplete }) => {
  const [phase, setPhase] = useState('closed') // closed, opening, open, fadeout

  useEffect(() => {
    const timeline = [
      { phase: 'opening', delay: 300 },
      { phase: 'open', delay: 2000 },
      { phase: 'fadeout', delay: 3500 },
      { phase: 'complete', delay: 4200 }
    ]

    const timeouts = timeline.map(({ phase: p, delay }) => 
      setTimeout(() => {
        if (p === 'complete') {
          onComplete?.()
        } else {
          setPhase(p)
        }
      }, delay)
    )

    return () => timeouts.forEach(clearTimeout)
  }, [onComplete])

  return (
    <div className={`site-intro ${phase}`}>
      {/* Cortina Esquerda */}
      <div className="curtain curtain-left" />
      
      {/* Cortina Direita */}
      <div className="curtain curtain-right" />
      
      {/* Brasão */}
      <div className="intro-center">
        <img 
          src={brasao} 
          alt="IM Incorporadora" 
          className="intro-brasao"
        />
      </div>
    </div>
  )
}

export default SiteIntro
