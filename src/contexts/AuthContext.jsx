import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export const useAuth = () => useContext(AuthContext)

// Limpar todo o storage relacionado ao Supabase
const clearAuthStorage = () => {
  const keysToRemove = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && (key.includes('supabase') || key.includes('sb-'))) {
      keysToRemove.push(key)
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key))
  sessionStorage.clear()
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true
    let timeoutId = null

    // Timeout de segurança - máximo 4 segundos
    timeoutId = setTimeout(() => {
      if (isMounted && loading) {
        console.log('Timeout: forçando fim do loading')
        setLoading(false)
      }
    }, 4000)

    const initAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        
        if (error) {
          console.error('Erro ao buscar sessão:', error)
          clearAuthStorage()
          if (isMounted) {
            setUser(null)
            setUserProfile(null)
            setLoading(false)
          }
          return
        }

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
        clearAuthStorage()
      } finally {
        if (isMounted) {
          setLoading(false)
          if (timeoutId) clearTimeout(timeoutId)
        }
      }
    }

    initAuth()

    // Escutar mudanças de autenticação
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth event:', event)
      
      if (!isMounted) return

      // Token inválido ou expirado
      if (event === 'TOKEN_REFRESHED' && !session) {
        clearAuthStorage()
        setUser(null)
        setUserProfile(null)
        setLoading(false)
        return
      }

      if (event === 'SIGNED_OUT') {
        clearAuthStorage()
        setUser(null)
        setUserProfile(null)
        setLoading(false)
        return
      }

      if (event === 'SIGNED_IN' && session?.user) {
        setUser(session.user)
        await fetchUserProfile(session.user.id)
        setLoading(false)
      }
    })

    return () => {
      isMounted = false
      if (timeoutId) clearTimeout(timeoutId)
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
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })
      if (error) {
        setLoading(false)
        return { data: null, error }
      }
      return { data, error: null }
    } catch (err) {
      setLoading(false)
      return { data: null, error: err }
    }
  }

  const signOut = async () => {
    setLoading(true)
    try {
      await supabase.auth.signOut()
    } catch (err) {
      console.error('Erro no signOut:', err)
    } finally {
      clearAuthStorage()
      setUser(null)
      setUserProfile(null)
      setLoading(false)
    }
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
