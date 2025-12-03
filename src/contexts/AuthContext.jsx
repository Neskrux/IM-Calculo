import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export const useAuth = () => useContext(AuthContext)

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const loadingTimeout = useRef(null)

  useEffect(() => {
    // Timeout de segurança - para o loading após 3 segundos
    loadingTimeout.current = setTimeout(() => {
      console.log('Timeout: forçando fim do loading')
      setLoading(false)
    }, 3000)

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

    return () => {
      subscription.unsubscribe()
      if (loadingTimeout.current) clearTimeout(loadingTimeout.current)
    }
  }, [])

  const fetchUserProfile = async (userId) => {
    try {
      console.log('Buscando perfil para:', userId)
      
      // Timeout de 3 segundos para a busca
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)
      
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, email, nome, tipo, tipo_corretor, telefone, percentual_corretor, empreendimento_id, cargo_id')
        .eq('id', userId)
        .maybeSingle()
        .abortSignal(controller.signal)
      
      clearTimeout(timeoutId)
      console.log('Resultado busca perfil:', { data, error })
      
      if (error && error.name !== 'AbortError') {
        console.error('Erro ao buscar perfil:', error)
      }
      
      setUserProfile(data || null)
    } catch (err) {
      console.error('Erro catch:', err)
      setUserProfile(null)
    } finally {
      if (loadingTimeout.current) clearTimeout(loadingTimeout.current)
      setLoading(false)
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
