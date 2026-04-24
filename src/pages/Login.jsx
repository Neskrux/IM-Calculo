import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Mail, Lock, ArrowRight, AlertCircle, ChevronLeft, ChevronRight, Building2, Palette } from 'lucide-react'
import logo from '../imgs/logo.png'
import LoginTransition from '../components/LoginTransition'
import '../styles/Login.css'

const FORGOT_COOLDOWN_SECONDS = 60
const FORGOT_COOLDOWN_KEY = 'im-forgot-cooldown'

const Login = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [focusedField, setFocusedField] = useState(null)
  const [showTransition, setShowTransition] = useState(false)
  const [redirectUrl, setRedirectUrl] = useState(null)
  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotMessage, setForgotMessage] = useState(null)
  const [forgotCooldown, setForgotCooldown] = useState(0)
  const { signIn } = useAuth()
  const navigate = useNavigate()

  // Tema de cores (gold ou blue)
  const [theme, setTheme] = useState('gold')

  // Carrossel de empreendimentos
  const [empreendimentos, setEmpreendimentos] = useState([])
  const [currentSlide, setCurrentSlide] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [loadingEmpreendimentos, setLoadingEmpreendimentos] = useState(true)

  // Carregar empreendimentos com fotos (2 queries em vez de N+1)
  useEffect(() => {
    let cancelled = false
    const timeout = setTimeout(() => { cancelled = true; setLoadingEmpreendimentos(false) }, 8000)

    const carregarEmpreendimentos = async () => {
      try {
        const [empsResult, fotosResult] = await Promise.all([
          supabase.from('empreendimentos').select('id, nome, logo_url').eq('ativo', true).order('nome'),
          supabase.from('empreendimento_fotos').select('empreendimento_id, url, categoria, destaque, ordem').in('categoria', ['fachada', 'logo']).order('destaque', { ascending: false }).order('ordem', { ascending: true })
        ])

        if (cancelled) return
        if (empsResult.error || fotosResult.error) return

        const fotos = fotosResult.data || []
        const comFotos = (empsResult.data || []).map(emp => {
          const empFotos = fotos.filter(f => f.empreendimento_id === emp.id)
          const fotoFachada = empFotos.find(f => f.categoria === 'fachada' && f.destaque) || empFotos.find(f => f.categoria === 'fachada')
          const logoUrl = emp.logo_url || empFotos.find(f => f.categoria === 'logo')?.url || null
          return { ...emp, fotoUrl: fotoFachada?.url || null, logoUrl }
        }).filter(e => e.fotoUrl)

        if (!cancelled) setEmpreendimentos(comFotos)
      } catch (_) {
        // Silencioso - carrossel é decorativo, não deve bloquear login
      } finally {
        if (!cancelled) setLoadingEmpreendimentos(false)
      }
    }

    carregarEmpreendimentos()
    return () => { cancelled = true; clearTimeout(timeout) }
  }, [])

  // Auto-play do carrossel
  useEffect(() => {
    if (empreendimentos.length <= 1) return

    const interval = setInterval(() => {
      if (!isTransitioning) {
        nextSlide()
      }
    }, 6000) // Muda a cada 6 segundos

    return () => clearInterval(interval)
  }, [empreendimentos.length, isTransitioning, currentSlide])

  // Tick do cooldown de reenvio de email de recuperação (persistido em localStorage por email).
  useEffect(() => {
    if (!showForgot) return
    const key = (forgotEmail || '').trim().toLowerCase()
    const compute = () => {
      try {
        const raw = localStorage.getItem(FORGOT_COOLDOWN_KEY)
        const map = raw ? JSON.parse(raw) : {}
        const until = key ? map[key] : 0
        const remaining = until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0
        setForgotCooldown(remaining)
      } catch {
        setForgotCooldown(0)
      }
    }
    compute()
    const id = setInterval(compute, 1000)
    return () => clearInterval(id)
  }, [showForgot, forgotEmail])

  const nextSlide = useCallback(() => {
    if (isTransitioning || empreendimentos.length <= 1) return
    setIsTransitioning(true)
    setCurrentSlide((prev) => (prev + 1) % empreendimentos.length)
    setTimeout(() => setIsTransitioning(false), 800)
  }, [empreendimentos.length, isTransitioning])

  const prevSlide = useCallback(() => {
    if (isTransitioning || empreendimentos.length <= 1) return
    setIsTransitioning(true)
    setCurrentSlide((prev) => (prev - 1 + empreendimentos.length) % empreendimentos.length)
    setTimeout(() => setIsTransitioning(false), 800)
  }, [empreendimentos.length, isTransitioning])

  const goToSlide = (index) => {
    if (isTransitioning || index === currentSlide) return
    setIsTransitioning(true)
    setCurrentSlide(index)
    setTimeout(() => setIsTransitioning(false), 800)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    // IMPORTANTE: Marcar transição ANTES de fazer login para evitar redirecionamento automático
    sessionStorage.setItem('im-login-transition', 'true')

    try {
      // Fazer login
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
      })
      
      if (signInError) {
        let errorMessage = 'Email ou senha incorretos'
        
        console.error('Erro no login:', signInError)
        
        if (signInError.message) {
          const errorMsg = signInError.message.toLowerCase()
          
          if (errorMsg.includes('invalid login credentials') || errorMsg.includes('invalid_credentials')) {
            errorMessage = 'Email ou senha incorretos. Se você é um cliente, verifique se o administrador criou seu acesso ao sistema.'
          } else if (errorMsg.includes('email not confirmed') || errorMsg.includes('email_not_confirmed')) {
            errorMessage = 'Seu email ainda não foi confirmado. Entre em contato com o administrador para ativar sua conta.'
          } else if (errorMsg.includes('too many requests') || errorMsg.includes('rate_limit')) {
            errorMessage = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
          } else if (errorMsg.includes('user not found') || errorMsg.includes('user_not_found')) {
            errorMessage = 'Usuário não encontrado. Se você é um cliente, peça ao administrador para criar seu acesso.'
          } else if (errorMsg.includes('bad request') || signInError.status === 400) {
            errorMessage = 'Dados inválidos. Verifique se o email e senha estão corretos.'
          } else {
            errorMessage = signInError.message || 'Erro ao fazer login. Tente novamente.'
          }
        } else if (signInError.status) {
          if (signInError.status === 400) {
            errorMessage = 'Dados inválidos. Verifique suas credenciais.'
          } else if (signInError.status === 401) {
            errorMessage = 'Email ou senha incorretos.'
          } else if (signInError.status === 429) {
            errorMessage = 'Muitas tentativas. Aguarde alguns minutos.'
          } else {
            errorMessage = `Erro ${signInError.status}. Tente novamente mais tarde.`
          }
        }
        
        sessionStorage.removeItem('im-login-transition') // Limpar flag em caso de erro
        setError(errorMessage)
        setLoading(false)
        return
      }

      if (!data) {
        sessionStorage.removeItem('im-login-transition') // Limpar flag em caso de erro
        setError('Erro ao fazer login. Tente novamente.')
        setLoading(false)
        return
      }

      // Login bem sucedido! Buscar perfil em usuarios
      const { data: userProfile } = await supabase
        .from('usuarios')
        .select('tipo')
        .eq('id', data.user.id)
        .maybeSingle()

      // Perfil não existe – mesmo formato que erro de senha: caixa vermelha acima do form
      if (!userProfile) {
        sessionStorage.removeItem('im-login-transition')
        await supabase.auth.signOut()
        const keysToRemove = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && (key.includes('supabase') || key.includes('sb-'))) keysToRemove.push(key)
        }
        keysToRemove.forEach(k => localStorage.removeItem(k))
        setError('Perfil não encontrado. Entre em contato com o administrador para liberar seu acesso.')
        setLoading(false)
        return
      }
      
      // Determinar URL de redirecionamento
      let url = '/dashboard'
      if (userProfile.tipo === 'admin') {
        url = '/admin/dashboard'
      } else if (userProfile.tipo === 'corretor') {
        url = '/corretor/dashboard'
      } else if (userProfile.tipo === 'cliente') {
        url = '/cliente/dashboard'
      }
      
      // Mostrar a transição e redirecionar
      setRedirectUrl(url)
      setShowTransition(true)
      return
      
    } catch (err) {
      sessionStorage.removeItem('im-login-transition') // Limpar flag em caso de erro
      console.error('Erro inesperado no login:', err)
      setError('Erro inesperado ao fazer login. Tente novamente.')
      setLoading(false)
    }
  }

  const currentEmpreendimento = empreendimentos[currentSlide]

  const toggleTheme = () => {
    setTheme(prev => prev === 'gold' ? 'blue' : 'gold')
  }

  const openForgot = () => {
    setForgotEmail(email)
    setForgotMessage(null)
    setShowForgot(true)
  }

  const closeForgot = () => {
    setShowForgot(false)
    setForgotLoading(false)
    setForgotMessage(null)
  }

  const handleForgotSubmit = async (e) => {
    e.preventDefault()
    if (!forgotEmail || forgotLoading || forgotCooldown > 0) return
    setForgotLoading(true)
    setForgotMessage(null)
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (resetError) {
        setForgotMessage({ type: 'error', text: resetError.message || 'Não foi possível enviar o email.' })
      } else {
        try {
          const raw = localStorage.getItem(FORGOT_COOLDOWN_KEY)
          const map = raw ? JSON.parse(raw) : {}
          const now = Date.now()
          Object.keys(map).forEach((k) => { if (!map[k] || map[k] < now) delete map[k] })
          const key = forgotEmail.trim().toLowerCase()
          map[key] = now + FORGOT_COOLDOWN_SECONDS * 1000
          localStorage.setItem(FORGOT_COOLDOWN_KEY, JSON.stringify(map))
        } catch { /* storage indisponível: cooldown fica só em memória */ }
        setForgotCooldown(FORGOT_COOLDOWN_SECONDS)
        setForgotMessage({ type: 'success' })
      }
    } catch (err) {
      setForgotMessage({ type: 'error', text: 'Erro inesperado. Tente novamente.' })
    } finally {
      setForgotLoading(false)
    }
  }

  // Callback quando a transição terminar
  const handleTransitionComplete = () => {
    sessionStorage.removeItem('im-login-transition')
    if (redirectUrl) {
      window.location.href = redirectUrl
    }
  }

  // Se a transição está ativa, mostrar apenas a intro
  if (showTransition) {
    return (
      <LoginTransition 
        onComplete={handleTransitionComplete}
      />
    )
  }

  return (
    <div className={`premium-login theme-${theme}`}>
      {/* Carrossel de Background */}
      <div className="carousel-container">
        {empreendimentos.map((emp, index) => (
          <div
            key={emp.id}
            className={`carousel-slide ${index === currentSlide ? 'active' : ''}`}
            style={{ backgroundImage: `url(${emp.fotoUrl})` }}
          >
            <div className="slide-overlay"></div>
          </div>
        ))}
        
        {/* Fallback quando não há empreendimentos */}
        {empreendimentos.length === 0 && !loadingEmpreendimentos && (
          <div className="carousel-slide active fallback-slide">
            <div className="slide-overlay"></div>
          </div>
        )}

        {/* Loading state */}
        {loadingEmpreendimentos && (
          <div className="carousel-loading">
            <div className="loading-spinner"></div>
          </div>
        )}
      </div>

      {/* Controles do Carrossel */}
      {empreendimentos.length > 1 && (
        <>
          <button className="carousel-btn carousel-prev" onClick={prevSlide} aria-label="Anterior">
            <ChevronLeft size={28} />
          </button>
          <button className="carousel-btn carousel-next" onClick={nextSlide} aria-label="Próximo">
            <ChevronRight size={28} />
          </button>
        </>
      )}

      {/* Indicadores do Carrossel */}
      {empreendimentos.length > 1 && (
        <div className="carousel-indicators">
          {empreendimentos.map((_, index) => (
            <button
              key={index}
              className={`indicator ${index === currentSlide ? 'active' : ''}`}
              onClick={() => goToSlide(index)}
              aria-label={`Slide ${index + 1}`}
            />
          ))}
        </div>
      )}

      {/* Info do Empreendimento Atual */}
      {currentEmpreendimento && (
        <div className="empreendimento-info">
          {currentEmpreendimento.logoUrl ? (
            <img 
              src={currentEmpreendimento.logoUrl} 
              alt={currentEmpreendimento.nome}
              className="info-logo"
            />
          ) : (
            <>
              <div className="info-badge">
                <Building2 size={14} />
                <span>Empreendimento</span>
              </div>
              <h2 className="info-nome">{currentEmpreendimento.nome}</h2>
            </>
          )}
        </div>
      )}

      {/* Container do Login */}
      <div className="login-glass-container">
        {/* Logo e Branding */}
        <div className="login-branding">
          <div className="logo-container">
            <div className="logo-glow"></div>
            <img src={logo} alt="IM Incorporadora" className="login-logo" />
          </div>
          <div className="brand-text">
            <h1>IM Incorporadora</h1>
            <div className="brand-divider">
              <span className="line"></span>
              <span className="diamond">◆</span>
              <span className="line"></span>
            </div>
            <p className="brand-tagline">Sistema de Comissões</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="login-error">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <div className={`input-group ${focusedField === 'email' ? 'focused' : ''} ${email ? 'filled' : ''}`}>
            <label>Email</label>
            <div className="input-wrapper">
              <Mail size={18} className="input-icon" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                placeholder="seu@email.com"
                required
                autoComplete="email"
              />
              <div className="input-highlight"></div>
            </div>
          </div>

          <div className={`input-group ${focusedField === 'password' ? 'focused' : ''} ${password ? 'filled' : ''}`}>
            <label>Senha</label>
            <div className="input-wrapper">
              <Lock size={18} className="input-icon" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(null)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
              <div className="input-highlight"></div>
            </div>
          </div>

          <button type="submit" className="login-button" disabled={loading}>
            {loading ? (
              <div className="button-loading">
                <span></span>
                <span></span>
                <span></span>
              </div>
            ) : (
              <>
                <span>Entrar</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>

          <button type="button" className="forgot-password-link" onClick={openForgot}>
            Esqueci minha senha
          </button>
        </form>

        {/* Footer */}
        <div className="login-footer">
          <span>Desenvolvido por IM Tecnologia @ 2025</span>
        </div>
      </div>

      {/* Efeitos de Partículas */}
      <div className="particles">
        {[...Array(20)].map((_, i) => (
          <div key={i} className="particle" style={{
            '--delay': `${Math.random() * 5}s`,
            '--duration': `${15 + Math.random() * 10}s`,
            '--x-start': `${Math.random() * 100}%`,
            '--x-end': `${Math.random() * 100}%`,
          }}></div>
        ))}
      </div>

      {/* Botão de Troca de Tema */}
      <button
        className="theme-toggle"
        onClick={toggleTheme}
        title={`Mudar para tema ${theme === 'gold' ? 'Azul' : 'Dourado'}`}
      >
        <Palette size={20} />
        <span>{theme === 'gold' ? 'Azul' : 'Dourado'}</span>
      </button>

      {showForgot && (
        <div className="forgot-modal-backdrop" onClick={closeForgot}>
          <div className="forgot-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Redefinir senha</h3>
            <p className="forgot-modal-hint">
              Informe o email cadastrado. Enviaremos um link para você criar uma nova senha.
            </p>
            <form onSubmit={handleForgotSubmit}>
              <div className="input-group filled">
                <label>Email</label>
                <div className="input-wrapper">
                  <Mail size={18} className="input-icon" />
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="seu@email.com"
                    required
                    autoFocus
                  />
                  <div className="input-highlight"></div>
                </div>
              </div>

              {forgotMessage && (
                <div className={`forgot-message forgot-message-${forgotMessage.type}`}>
                  {forgotMessage.type === 'error' && <AlertCircle size={16} />}
                  {forgotMessage.type === 'success' ? (
                    <div style={{ lineHeight: 1.5 }}>
                      <p style={{ margin: 0, fontWeight: 600 }}>Link de redefinição enviado</p>
                      <p style={{ margin: '6px 0 0' }}>
                        Se o email estiver cadastrado, você receberá o link em instantes. O link expira em 1 hora.
                      </p>
                      <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                        <li>Confira as pastas <strong>Spam</strong>, <strong>Lixo Eletrônico</strong> e <strong>Promoções</strong>.</li>
                        <li>Adicione o remetente aos contatos para os próximos emails chegarem direto.</li>
                        <li>Não recebeu? Use o botão de reenvio abaixo após a contagem.</li>
                      </ul>
                    </div>
                  ) : (
                    <span>{forgotMessage.text}</span>
                  )}
                </div>
              )}

              <div className="forgot-modal-actions">
                <button type="button" className="forgot-btn-secondary" onClick={closeForgot} disabled={forgotLoading}>
                  {forgotMessage?.type === 'success' ? 'Fechar' : 'Cancelar'}
                </button>
                <button
                  type="submit"
                  className="login-button forgot-btn-primary"
                  disabled={forgotLoading || forgotCooldown > 0 || !forgotEmail}
                >
                  {forgotLoading ? (
                    <div className="button-loading">
                      <span></span><span></span><span></span>
                    </div>
                  ) : forgotCooldown > 0 ? (
                    <span>Reenviar em {forgotCooldown}s</span>
                  ) : (
                    <>
                      <span>{forgotMessage?.type === 'success' ? 'Reenviar link' : 'Enviar link'}</span>
                      <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Login
