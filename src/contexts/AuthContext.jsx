import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export const useAuth = () => useContext(AuthContext)

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Verificar sessão atual
    const getSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        console.log('Sessão:', session)
        setUser(session?.user ?? null)
        
        if (session?.user) {
          await fetchUserProfile(session.user.id)
        } else {
          setLoading(false)
        }
      } catch (error) {
        console.error('Erro ao buscar sessão:', error)
        setLoading(false)
      }
    }

    getSession()

    // Escutar mudanças de autenticação
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event, session)
      setUser(session?.user ?? null)
      
      if (session?.user) {
        await fetchUserProfile(session.user.id)
      } else {
        setUserProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchUserProfile = async (userId) => {
    try {
      console.log('Buscando perfil para:', userId)
      
      const { data, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('id', userId)
        .maybeSingle()  // Usar maybeSingle ao invés de single para não dar erro se não existir
      
      console.log('Resultado busca perfil:', { data, error })
      
      if (error) {
        console.error('Erro ao buscar perfil:', error)
      }
      
      setUserProfile(data || null)
    } catch (err) {
      console.error('Erro catch:', err)
      setUserProfile(null)
    } finally {
      setLoading(false)  // Sempre para o loading
    }
  }

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    return { data, error }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (!error) {
      setUser(null)
      setUserProfile(null)
    }
    return { error }
  }

  const value = {
    user,
    userProfile,
    loading,
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
