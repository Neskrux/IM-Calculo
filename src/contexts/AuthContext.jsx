import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export const useAuth = () => useContext(AuthContext)

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  // Distingue "perfil não existe" de "a busca do perfil falhou (timeout/rede)".
  // Sem isso, um soluço de rede virava a tela falsa de "Usuário não cadastrado".
  const [profileError, setProfileError] = useState(false)
  
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
      setProfileError(false)
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
      const accessToken = session?.access_token

      if (!accessToken) {
        console.error('Sem access token')
        setProfileError(true) // falha de sessão — NÃO é "sem perfil"
        setUserProfile(null)
        setLoading(false)
        isLoadingProfile.current = false
        return
      }

      // Busca com RETRY: timeout/erro de rede NÃO significa "sem perfil".
      // Só marcamos profileError depois de todas as tentativas falharem.
      const TENTATIVAS = 3
      let sucesso = false
      let perfil = null
      let ultimoErro = null

      for (let i = 0; i < TENTATIVAS; i++) {
        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('TIMEOUT')), 10000)
          )
          perfil = await Promise.race([fetchProfileDirect(authUser.id, accessToken), timeoutPromise])
          sucesso = true
          break
        } catch (err) {
          ultimoErro = err
          if (i < TENTATIVAS - 1) {
            await new Promise((r) => setTimeout(r, 800 * (i + 1))) // backoff progressivo
          }
        }
      }

      if (!sucesso) {
        // A BUSCA falhou (timeout/rede) — não dá pra afirmar que não tem perfil.
        // NÃO mostrar "Usuário não cadastrado"; mostrar erro com "Tentar novamente".
        console.error('Falha ao buscar perfil (todas as tentativas):', ultimoErro?.message)
        setProfileError(true)
        setUserProfile(null)
      } else if (perfil) {
        setProfileError(false)
        setUserProfile(perfil)
      } else {
        // Busca OK e VAZIA = genuinamente sem perfil cadastrado.
        console.warn('Usuário sem perfil:', authUser.email)
        setProfileError(false)
        setUserProfile(null)
      }
    } catch (err) {
      console.error('Erro inesperado ao carregar perfil:', err)
      setProfileError(true) // erro inesperado — trata como falha de busca, não "sem perfil"
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
        setProfileError(false)
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

  const refreshProfile = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      isLoadingProfile.current = false
      await loadProfile(session.user, session)
    }
  }

  return (
    <AuthContext.Provider value={{
      user,
      userProfile,
      loading,
      profileError,
      signIn,
      signOut,
      refreshProfile,
      isAdmin: userProfile?.tipo === 'admin',
      isCorretor: userProfile?.tipo === 'corretor'
    }}>
      {children}
    </AuthContext.Provider>
  )
}
