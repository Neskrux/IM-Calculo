import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export const useAuth = () => useContext(AuthContext)

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  
  const isLoadingProfile = useRef(false)

  // Função para buscar perfil usando fetch direto (bypass do cliente Supabase)
  const fetchProfileDirect = async (userId, accessToken) => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    
    const response = await fetch(
      `${supabaseUrl}/rest/v1/usuarios?id=eq.${userId}&select=*`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        }
      }
    )
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    
    const data = await response.json()
    return data[0] || null
  }

  // Função para buscar perfil do usuário
  const loadProfile = async (authUser, session) => {
    if (!authUser) {
      setUser(null)
      setUserProfile(null)
      setLoading(false)
      return
    }

    if (isLoadingProfile.current) {
      return
    }

    isLoadingProfile.current = true
    console.log('Carregando perfil para:', authUser.email)
    setUser(authUser)

    try {
      // Usar fetch direto com timeout
      const accessToken = session?.access_token
      
      if (!accessToken) {
        console.error('Sem access token')
        setUserProfile(null)
        setLoading(false)
        isLoadingProfile.current = false
        return
      }

      console.log('>>> Buscando perfil via REST API...')
      
      // Timeout de 8 segundos
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TIMEOUT')), 8000)
      )
      
      const fetchPromise = fetchProfileDirect(authUser.id, accessToken)
      
      const profile = await Promise.race([fetchPromise, timeoutPromise])

      if (profile) {
        console.log('Perfil encontrado:', profile)
        setUserProfile(profile)
      } else {
        console.warn('Usuário sem perfil:', authUser.email)
        setUserProfile(null)
      }
    } catch (err) {
      if (err.message === 'TIMEOUT') {
        console.error('❌ TIMEOUT ao buscar perfil')
      } else {
        console.error('Erro ao carregar perfil:', err)
      }
      setUserProfile(null)
    } finally {
      isLoadingProfile.current = false
      setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true

    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        
        if (!mounted) return
        
        if (session?.user) {
          await loadProfile(session.user, session)
        } else {
          setLoading(false)
        }
      } catch (err) {
        console.error('Erro ao verificar sessão:', err)
        if (mounted) setLoading(false)
      }
    }

    initAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return
      
      console.log('Auth event:', event)

      if (event === 'SIGNED_OUT') {
        setUser(null)
        setUserProfile(null)
        setLoading(false)
      } else if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
        if (!userProfile) {
          await loadProfile(session.user, session)
        }
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email, password) => {
    setLoading(true)
    isLoadingProfile.current = false
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      
      if (error) {
        setLoading(false)
        return { error }
      }
      
      return { data }
    } catch (err) {
      setLoading(false)
      return { error: { message: 'Erro ao fazer login' } }
    }
  }

  const signOut = async () => {
    try {
      await supabase.auth.signOut()
    } catch (error) {
      console.error('Erro ao fazer logout:', error)
    } finally {
      localStorage.clear()
      setUser(null)
      setUserProfile(null)
      window.location.href = '/login'
    }
  }

  return (
    <AuthContext.Provider value={{
      user,
      userProfile,
      loading,
      signIn,
      signOut,
      isAdmin: userProfile?.tipo === 'admin',
      isCorretor: userProfile?.tipo === 'corretor'
    }}>
      {children}
    </AuthContext.Provider>
  )
}
