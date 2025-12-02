import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import AdminDashboard from './pages/AdminDashboard'
import CorretorDashboard from './pages/CorretorDashboard'
import './App.css'

// Componente para rotas protegidas
const ProtectedRoute = ({ children, requiredRole }) => {
  const { user, userProfile, loading } = useAuth()

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <div className="loading-spinner-screen"></div>
          <p>Carregando...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  // Se não tem perfil cadastrado
  if (!userProfile) {
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
            INSERT INTO usuarios (id, email, nome, tipo)<br/>
            VALUES (<br/>
            &nbsp;&nbsp;'{user.id}',<br/>
            &nbsp;&nbsp;'{user.email}',<br/>
            &nbsp;&nbsp;'Administrador',<br/>
            &nbsp;&nbsp;'admin'<br/>
            );
          </div>
        </div>
      </div>
    )
  }

  if (requiredRole && userProfile?.tipo !== requiredRole) {
    // Redireciona para o dashboard correto
    if (userProfile?.tipo === 'admin') {
      return <Navigate to="/admin" replace />
    }
    return <Navigate to="/corretor" replace />
  }

  return children
}

// Componente para redirecionar usuários logados
const PublicRoute = ({ children }) => {
  const { user, userProfile, loading } = useAuth()

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <div className="loading-spinner-screen"></div>
          <p>Carregando...</p>
        </div>
      </div>
    )
  }

  if (user && userProfile) {
    if (userProfile.tipo === 'admin') {
      return <Navigate to="/admin" replace />
    }
    return <Navigate to="/corretor" replace />
  }

  return children
}

// Componente de Dashboard que redireciona baseado no tipo de usuário
const DashboardRedirect = () => {
  const { userProfile, loading, user } = useAuth()

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <div className="loading-spinner-screen"></div>
          <p>Carregando...</p>
        </div>
      </div>
    )
  }

  // Se não tem perfil cadastrado na tabela usuarios
  if (user && !userProfile) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <p style={{ color: '#ef4444', marginBottom: '10px' }}>⚠️ Usuário não cadastrado no sistema</p>
          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>
            Peça ao administrador para cadastrar seu perfil na tabela 'usuarios'
          </p>
          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '10px' }}>
            UUID: {user.id}
          </p>
        </div>
      </div>
    )
  }

  if (userProfile?.tipo === 'admin') {
    return <Navigate to="/admin" replace />
  }
  
  return <Navigate to="/corretor" replace />
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
        path="/corretor" 
        element={
          <ProtectedRoute requiredRole="corretor">
            <CorretorDashboard />
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
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  )
}

export default App
