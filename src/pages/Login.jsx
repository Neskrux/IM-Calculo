import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Mail, Lock, LogIn, AlertCircle } from 'lucide-react'
import logo from '../imgs/logo.png'
import '../styles/Login.css'

const Login = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { data, error } = await signIn(email, password)
    
    if (error) {
      setError('Email ou senha incorretos')
      setLoading(false)
      return
    }

    navigate('/dashboard')
  }

  return (
    <div className="login-container">
      <div className="login-background">
        <div className="bg-shape shape-1"></div>
        <div className="bg-shape shape-2"></div>
        <div className="bg-shape shape-3"></div>
      </div>
      
      <div className="login-card">
        <div className="login-header">
          <div className="logo-container">
            <img src={logo} alt="IM Incorporadora" className="logo-img" />
          </div>
          <h1>IM Incorporadora</h1>
          <p>Sistema de Comissões</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="error-message">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <div className="input-group">
            <Mail size={20} className="input-icon" />
            <input
              type="email"
              placeholder="Seu email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="input-group">
            <Lock size={20} className="input-icon" />
            <input
              type="password"
              placeholder="Sua senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="login-button" disabled={loading}>
            {loading ? (
              <span className="loading-spinner"></span>
            ) : (
              <>
                <LogIn size={20} />
                <span>Entrar</span>
              </>
            )}
          </button>
        </form>

        <div className="login-footer">
          <p>IM Incorporadora</p>
        </div>
      </div>
    </div>
  )
}

export default Login
