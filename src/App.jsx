import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import AdminDashboard from './pages/AdminDashboard'
import CorretorDashboard from './pages/CorretorDashboard'
import ClienteDashboard from './pages/ClienteDashboard'
import HomeDashboard from './pages/HomeDashboard'
import SiteIntro from './components/SiteIntro'
import LoginTransition from './components/LoginTransition'
import './App.css'

// Componente de Loading com botão de sair
const LoadingScreen = ({ showLogout = false }) => {
  const handleForceLogout = async () => {
    await supabase.auth.signOut()
    // Limpar todo storage do Supabase
    const keysToRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && (key.includes('supabase') || key.includes('sb-'))) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key))
    window.location.href = '/login'
  }

  return (
    <div className="loading-screen">
      <div className="loading-content">
        <div className="loading-spinner-screen"></div>
        <p>Carregando...</p>
        {showLogout && (
          <button 
            onClick={handleForceLogout}
            style={{
              marginTop: '20px',
              padding: '10px 20px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.3)',
              color: 'rgba(255,255,255,0.7)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            Problemas? Clique para sair
          </button>
        )}
      </div>
    </div>
  )
}

// Componente para rotas protegidas
const ProtectedRoute = ({ children, requiredRole }) => {
  const { user, userProfile, loading } = useAuth()

  if (loading) {
    return <LoadingScreen showLogout={true} />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  // Se não tem perfil cadastrado
  if (!userProfile) {
    // Detectar tipo de usuário baseado no email ou contexto
    const userTipo = 'corretor' // ou detectar dinamicamente
    
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <p style={{ color: '#ef4444', marginBottom: '10px', fontSize: '18px' }}>Usuário não cadastrado</p>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)', marginBottom: '20px' }}>
            Execute este SQL no Supabase:
          </p>
          <div style={{ 
            background: 'rgba(0,0,0,0.3)', 
            padding: '15px', 
            borderRadius: '8px', 
            fontSize: '12px',
            fontFamily: 'monospace',
            color: '#d4af37',
            textAlign: 'left',
            maxWidth: '500px',
            wordBreak: 'break-all'
          }}>
            INSERT INTO usuarios (id, email, nome, tipo, tipo_corretor)<br/>
            VALUES (<br/>
            &nbsp;&nbsp;'{user.id}',<br/>
            &nbsp;&nbsp;'{user.email}',<br/>
            &nbsp;&nbsp;'{user.email?.split('@')[0] || 'Corretor'}',<br/>
            &nbsp;&nbsp;'corretor',<br/>
            &nbsp;&nbsp;'externo'<br/>
            );
          </div>
          <button 
            onClick={async () => {
              await supabase.auth.signOut()
              localStorage.clear()
              window.location.href = '/login'
            }}
            style={{
              marginTop: '20px',
              padding: '10px 20px',
              background: '#ef4444',
              border: 'none',
              color: '#fff',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            Sair
          </button>
        </div>
      </div>
    )
  }

         if (requiredRole && userProfile?.tipo !== requiredRole) {
           if (userProfile?.tipo === 'admin') {
             return <Navigate to="/admin" replace />
           } else if (userProfile?.tipo === 'corretor') {
             return <Navigate to="/corretor" replace />
           } else if (userProfile?.tipo === 'cliente') {
             return <Navigate to="/cliente" replace />
           }
         }

  return children
}

// Componente para redirecionar usuários logados
const PublicRoute = ({ children }) => {
  const { user, userProfile, loading } = useAuth()

  // Verificar se há transição de login em andamento (via sessionStorage)
  const loginTransitionActive = sessionStorage.getItem('im-login-transition')
  
  // Se há transição ativa, não fazer nada - deixar o App mostrar a transição
  if (loginTransitionActive) {
    return children
  }

  // Não mostrar loading na página de login - deixa renderizar o formulário
  if (loading) {
    return <LoadingScreen showLogout={false} />
  }

  if (user && userProfile) {
    if (userProfile.tipo === 'admin') {
      return <Navigate to="/admin" replace />
    } else if (userProfile.tipo === 'corretor') {
      return <Navigate to="/corretor" replace />
    } else if (userProfile.tipo === 'cliente') {
      return <Navigate to="/cliente" replace />
    }
  }

  return children
}

// Componente de Dashboard que redireciona baseado no tipo de usuário
const DashboardRedirect = () => {
  const { userProfile, loading, user } = useAuth()
  const navigate = useNavigate()

  if (loading) {
    return <LoadingScreen showLogout={true} />
  }

  if (user && !userProfile) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <p style={{ color: '#ef4444', marginBottom: '10px', fontSize: '18px' }}>Usuário não cadastrado</p>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)', marginBottom: '20px' }}>
            Seu perfil não foi encontrado no sistema. Entre em contato com a administração.
          </p>
          <button
            onClick={async () => {
              await supabase.auth.signOut()
              localStorage.clear()
              window.location.href = '/login'
            }}
            style={{
              padding: '10px 20px',
              background: '#ef4444',
              border: 'none',
              color: '#fff',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            Voltar ao Login
          </button>
        </div>
      </div>
    )
  }

        // Redirecionar baseado no tipo de usuário
        useEffect(() => {
          if (userProfile) {
            if (userProfile.tipo === 'admin') {
              navigate('/admin/dashboard', { replace: true })
            } else if (userProfile.tipo === 'corretor') {
              navigate('/corretor', { replace: true })
            } else if (userProfile.tipo === 'cliente') {
              navigate('/cliente', { replace: true })
            }
          }
        }, [userProfile, navigate])

  // Mostrar HomeDashboard enquanto redireciona
  return <HomeDashboard />
}

function AppRoutes() {
  return (
    <Routes>
      <Route 
        path="/login" 
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        } 
      />
      <Route 
        path="/admin" 
        element={
          <ProtectedRoute requiredRole="admin">
            <AdminDashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/dashboard" 
        element={
          <ProtectedRoute requiredRole="admin">
            <AdminDashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/:tab" 
        element={
          <ProtectedRoute requiredRole="admin">
            <AdminDashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/corretor" 
        element={
          <ProtectedRoute requiredRole="corretor">
            <CorretorDashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/corretor/dashboard" 
        element={
          <ProtectedRoute requiredRole="corretor">
            <CorretorDashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/corretor/:tab" 
        element={
          <ProtectedRoute requiredRole="corretor">
            <CorretorDashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/cliente" 
        element={
          <ProtectedRoute requiredRole="cliente">
            <ClienteDashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/cliente/dashboard" 
        element={
          <ProtectedRoute requiredRole="cliente">
            <ClienteDashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/cliente/:tab" 
        element={
          <ProtectedRoute requiredRole="cliente">
            <ClienteDashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/dashboard" 
        element={
          <ProtectedRoute>
            <DashboardRedirect />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/home" 
        element={
          <ProtectedRoute>
            <HomeDashboard />
          </ProtectedRoute>
        } 
      />
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

function App() {
  const [showIntro, setShowIntro] = useState(() => {
    const hasSeenIntro = sessionStorage.getItem('im-intro-seen')
    return !hasSeenIntro
  })
  
  const [showLoginTransition, setShowLoginTransition] = useState(null)

  const handleIntroComplete = () => {
    sessionStorage.setItem('im-intro-seen', 'true')
    setShowIntro(false)
  }
  
  const handleLoginTransitionComplete = () => {
    setShowLoginTransition(null)
  }

  // Verificar se há transição pendente (polling)
  useEffect(() => {
    const checkTransition = () => {
      const transitionData = sessionStorage.getItem('im-login-transition')
      if (transitionData) {
        try {
          const data = JSON.parse(transitionData)
          if (!showLoginTransition) {
            console.log('🎬 App: Detectou transição!', data)
            setShowLoginTransition(data)
          }
        } catch (e) {
          // Formato antigo (string 'true')
          sessionStorage.removeItem('im-login-transition')
        }
      }
    }
    
    // Verificar imediatamente e a cada 50ms
    checkTransition()
    const interval = setInterval(checkTransition, 50)
    return () => clearInterval(interval)
  }, [showLoginTransition])

  return (
    <>
      {showIntro && <SiteIntro onComplete={handleIntroComplete} />}
      {showLoginTransition && (
        <LoginTransition 
          redirectUrl={showLoginTransition.redirectUrl} 
          onComplete={handleLoginTransitionComplete}
        />
      )}
      <Router>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </Router>
    </>
  )
}

export default App
