import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export const useAuth = () => useContext(AuthContext)

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    let isMounted = true

    const initAuth = async () => {
      try {
        // Buscar sessão atual
        const { data: { session } } = await supabase.auth.getSession()
        
        if (!isMounted) return

        if (session?.user) {
          setUser(session.user)
          await fetchUserProfile(session.user.id)
        } else {
          setUser(null)
          setUserProfile(null)
        }
      } catch (error) {
        console.error('Erro ao inicializar auth:', error)
      } finally {
        if (isMounted) {
          setLoading(false)
          setInitialized(true)
        }
      }
    }

    initAuth()

    // Escutar mudanças de autenticação
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth event:', event)
      
      if (!isMounted) return

      if (event === 'SIGNED_OUT') {
        setUser(null)
        setUserProfile(null)
        setLoading(false)
        return
      }

      if (event === 'SIGNED_IN' && session?.user) {
        setUser(session.user)
        setLoading(true)
        await fetchUserProfile(session.user.id)
        setLoading(false)
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const fetchUserProfile = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('id', userId)
        .maybeSingle()
      
      if (error) {
        console.error('Erro ao buscar perfil:', error)
        setUserProfile(null)
        return
      }
      
      setUserProfile(data)
    } catch (err) {
      console.error('Erro:', err)
      setUserProfile(null)
    }
  }

  const signIn = async (email, password) => {
    setLoading(true)
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    if (error) {
      setLoading(false)
    }
    return { data, error }
  }

  const signOut = async () => {
    setLoading(true)
    await supabase.auth.signOut()
    setUser(null)
    setUserProfile(null)
    setLoading(false)
    // Limpar storage local
    localStorage.removeItem('sb-jdkkusrxullttyyeakwb-auth-token')
  }

  const value = {
    user,
    userProfile,
    loading,
    initialized,
    signIn,
    signOut,
    isAdmin: userProfile?.tipo === 'admin',
    isCorretor: userProfile?.tipo === 'corretor'
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
