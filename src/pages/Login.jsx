import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Mail, Lock, ArrowRight, AlertCircle } from 'lucide-react'
import logo from '../imgs/logo.png'
import '../styles/Login.css'

const Login = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [focusedField, setFocusedField] = useState(null)
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { data, error: signInError } = await signIn(email, password)
      
      if (signInError) {
        // Mensagens de erro mais específicas
        let errorMessage = 'Email ou senha incorretos'
        
        console.error('Erro no login:', signInError)
        
        if (signInError.message) {
          const errorMsg = signInError.message.toLowerCase()
          
          if (errorMsg.includes('invalid login credentials') || errorMsg.includes('invalid_credentials')) {
            errorMessage = 'Email ou senha incorretos. Se você é um cliente, verifique se o administrador criou seu acesso ao sistema.'
          } else if (errorMsg.includes('email not confirmed') || errorMsg.includes('email_not_confirmed')) {
            errorMessage = 'Seu email ainda não foi confirmado. Entre em contato com o administrador para ativar sua conta. O administrador pode desabilitar a confirmação de email nas configurações do Supabase.'
          } else if (errorMsg.includes('too many requests') || errorMsg.includes('rate_limit')) {
            errorMessage = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
          } else if (errorMsg.includes('user not found') || errorMsg.includes('user_not_found')) {
            errorMessage = 'Usuário não encontrado. Se você é um cliente, peça ao administrador para criar seu acesso.'
          } else if (errorMsg.includes('bad request') || signInError.status === 400) {
            errorMessage = 'Dados inválidos. Verifique se o email e senha estão corretos. Se você é um cliente, verifique se o administrador criou seu acesso.'
          } else {
            errorMessage = signInError.message || 'Erro ao fazer login. Tente novamente ou entre em contato com o administrador.'
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
        
        setError(errorMessage)
        setLoading(false)
        return
      }

      if (!data) {
        setError('Erro ao fazer login. Tente novamente.')
        setLoading(false)
        return
      }

      // Aguardar um pouco para o perfil carregar
      await new Promise(resolve => setTimeout(resolve, 800))
      
      // Redirecionar para dashboard (o DashboardRedirect vai direcionar corretamente)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      console.error('Erro inesperado no login:', err)
      setError('Erro inesperado ao fazer login. Tente novamente ou entre em contato com o suporte.')
      setLoading(false)
    }
  }

  return (
    <div className="luxury-login theme-blue">
      {/* Background Elements */}
      <div className="luxury-bg">
        <div className="bg-gradient"></div>
        <div className="bg-pattern"></div>
        <div className="bg-glow"></div>
      </div>

      {/* Decorative Lines */}
      <div className="deco-line deco-top-left"></div>
      <div className="deco-line deco-top-right"></div>
      <div className="deco-line deco-bottom-left"></div>
      <div className="deco-line deco-bottom-right"></div>

      {/* Main Container */}
      <div className="luxury-container">
        {/* Left Side - Branding */}
        <div className="luxury-branding">
          <div className="brand-content">
            <div className="brand-logo-wrapper">
              <div className="logo-glow"></div>
              <img src={logo} alt="IM Incorporadora" className="brand-logo" />
            </div>
            
            <div className="brand-text">
              <div className="brand-divider">
                <span className="divider-line"></span>
                <span className="divider-diamond">◆</span>
                <span className="divider-line"></span>
              </div>
              
              <h1 className="brand-title">Incorporadora</h1>
              
              <p className="brand-tagline">Excellence in Real Estate</p>
              
              <div className="brand-subtitle">
                <span>Sistema de Comissões</span>
              </div>
            </div>

            <div className="brand-footer">
              <div className="footer-line"></div>
              <span>Est. 2024</span>
              <div className="footer-line"></div>
            </div>
          </div>

          {/* Animated Background Elements */}
          <div className="floating-elements">
            <div className="float-element float-1"></div>
            <div className="float-element float-2"></div>
            <div className="float-element float-3"></div>
          </div>
        </div>

        {/* Right Side - Login Form */}
        <div className="luxury-form-section">
          <div className="form-container">
            <div className="form-header">
              <span className="form-welcome">Bem-vindo</span>
              <h2 className="form-title">Acesse sua conta</h2>
              <p className="form-subtitle">Entre com suas credenciais para continuar</p>
            </div>

            <form onSubmit={handleSubmit} className="luxury-form">
              {error && (
                <div className="luxury-error" role="alert" aria-live="polite">
                  <AlertCircle size={18} />
                  <span>{error}</span>
                </div>
              )}

              <div className={`luxury-input-group ${focusedField === 'email' ? 'focused' : ''} ${email ? 'filled' : ''}`}>
                <label className="luxury-label">Email</label>
                <div className="input-wrapper">
                  <Mail size={18} className="input-icon" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setFocusedField('email')}
                    onBlur={() => setFocusedField(null)}
                    required
                    autoComplete="email"
                  />
                  <div className="input-line"></div>
                </div>
              </div>

              <div className={`luxury-input-group ${focusedField === 'password' ? 'focused' : ''} ${password ? 'filled' : ''}`}>
                <label className="luxury-label">Senha</label>
                <div className="input-wrapper">
                  <Lock size={18} className="input-icon" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    required
                    autoComplete="current-password"
                  />
                  <div className="input-line"></div>
                </div>
              </div>

              <button type="submit" className="luxury-button" disabled={loading}>
                {loading ? (
                  <div className="button-loading">
                    <span className="loading-dot"></span>
                    <span className="loading-dot"></span>
                    <span className="loading-dot"></span>
                  </div>
                ) : (
                  <>
                    <span>Entrar</span>
                    <ArrowRight size={18} className="button-arrow" />
                  </>
                )}
              </button>
            </form>

            <div className="form-footer">
              <div className="footer-decoration">
                <span className="footer-dot"></span>
                <span className="footer-text">IM Incorporadora</span>
                <span className="footer-dot"></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Corner Decorations */}
      <div className="corner-deco corner-tl">
        <svg viewBox="0 0 100 100" fill="none">
          <path d="M0 0 L100 0 L100 10 L10 10 L10 100 L0 100 Z" fill="currentColor"/>
        </svg>
      </div>
      <div className="corner-deco corner-br">
        <svg viewBox="0 0 100 100" fill="none">
          <path d="M100 100 L0 100 L0 90 L90 90 L90 0 L100 0 Z" fill="currentColor"/>
        </svg>
      </div>
    </div>
  )
}

export default Login
