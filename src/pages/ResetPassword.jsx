import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Lock, ArrowRight, AlertCircle, CheckCircle2 } from 'lucide-react'
import logo from '../imgs/logo.png'
import '../styles/Login.css'

const ResetPassword = () => {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [recoverySession, setRecoverySession] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [focusedField, setFocusedField] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    let cancelled = false

    const parseHash = () => {
      const raw = window.location.hash?.startsWith('#')
        ? window.location.hash.slice(1)
        : ''
      if (!raw) return null
      const params = new URLSearchParams(raw)
      const access_token = params.get('access_token')
      const refresh_token = params.get('refresh_token')
      const type = params.get('type')
      const error_description = params.get('error_description')
      return { access_token, refresh_token, type, error_description }
    }

    const init = async () => {
      const hash = parseHash()

      if (hash?.error_description) {
        setChecking(false)
        return
      }

      if (hash?.access_token && hash?.refresh_token && hash.type === 'recovery') {
        const { error: setErr } = await supabase.auth.setSession({
          access_token: hash.access_token,
          refresh_token: hash.refresh_token,
        })
        if (cancelled) return
        if (!setErr) {
          window.history.replaceState(null, '', window.location.pathname)
          setRecoverySession(true)
          setChecking(false)
          return
        }
      }

      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      if (data?.session) setRecoverySession(true)
      setChecking(false)
    }

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setRecoverySession(true)
        setChecking(false)
      }
    })

    init()

    return () => {
      cancelled = true
      authListener?.subscription?.unsubscribe()
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('A senha deve ter pelo menos 8 caracteres.')
      return
    }
    if (password !== confirmPassword) {
      setError('As senhas não conferem.')
      return
    }

    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(updateError.message || 'Não foi possível atualizar a senha.')
        setLoading(false)
        return
      }
      setSuccess(true)
      await supabase.auth.signOut()
      setTimeout(() => navigate('/login', { replace: true }), 2500)
    } catch (err) {
      setError('Erro inesperado. Tente novamente.')
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="premium-login theme-gold">
        <div className="carousel-container">
          <div className="carousel-slide active fallback-slide">
            <div className="slide-overlay"></div>
          </div>
        </div>
        <div className="login-glass-container">
          <p style={{ color: 'var(--premium-silver)', textAlign: 'center' }}>Validando link...</p>
        </div>
      </div>
    )
  }

  if (!recoverySession && !success) {
    return (
      <div className="premium-login theme-gold">
        <div className="carousel-container">
          <div className="carousel-slide active fallback-slide">
            <div className="slide-overlay"></div>
          </div>
        </div>
        <div className="login-glass-container">
          <div className="login-branding">
            <div className="logo-container">
              <div className="logo-glow"></div>
              <img src={logo} alt="IM Incorporadora" className="login-logo" />
            </div>
            <div className="brand-text">
              <h1>IM Incorporadora</h1>
            </div>
          </div>
          <div className="login-error" style={{ marginBottom: 20 }}>
            <AlertCircle size={18} />
            <span>Link inválido ou expirado. Solicite um novo email de redefinição.</span>
          </div>
          <button className="login-button" onClick={() => navigate('/login', { replace: true })}>
            <span>Voltar ao login</span>
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="premium-login theme-gold">
      <div className="carousel-container">
        <div className="carousel-slide active fallback-slide">
          <div className="slide-overlay"></div>
        </div>
      </div>

      <div className="login-glass-container">
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
            <p className="brand-tagline">Redefinir senha</p>
          </div>
        </div>

        {success ? (
          <div
            className="forgot-message forgot-message-success"
            style={{ padding: '16px', fontSize: '14px', lineHeight: 1.5 }}
          >
            <CheckCircle2 size={18} />
            <span>Senha alterada com sucesso. Redirecionando para o login...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="login-form">
            {error && (
              <div className="login-error">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            <div className={`input-group ${focusedField === 'password' ? 'focused' : ''} ${password ? 'filled' : ''}`}>
              <label>Nova senha</label>
              <div className="input-wrapper">
                <Lock size={18} className="input-icon" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                  placeholder="Mínimo 8 caracteres"
                  required
                  autoComplete="new-password"
                  minLength={8}
                />
                <div className="input-highlight"></div>
              </div>
            </div>

            <div className={`input-group ${focusedField === 'confirm' ? 'focused' : ''} ${confirmPassword ? 'filled' : ''}`}>
              <label>Confirmar nova senha</label>
              <div className="input-wrapper">
                <Lock size={18} className="input-icon" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onFocus={() => setFocusedField('confirm')}
                  onBlur={() => setFocusedField(null)}
                  placeholder="Repita a nova senha"
                  required
                  autoComplete="new-password"
                  minLength={8}
                />
                <div className="input-highlight"></div>
              </div>
            </div>

            <button type="submit" className="login-button" disabled={loading}>
              {loading ? (
                <div className="button-loading">
                  <span></span><span></span><span></span>
                </div>
              ) : (
                <>
                  <span>Salvar nova senha</span>
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default ResetPassword
