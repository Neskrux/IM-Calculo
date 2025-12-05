import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export const useAuth = () => useContext(AuthContext)

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Função para buscar/criar perfil
  const loadProfile = async (authUser) => {
    if (!authUser) {
      setUser(null)
      setUserProfile(null)
      setLoading(false)
      return
    }

    console.log('Carregando perfil para:', authUser.email)
    setUser(authUser)

    try {
      // Buscar perfil existente
      const { data: profile, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle()

      console.log('Perfil encontrado:', profile, 'Erro:', error)

      if (profile) {
        setUserProfile(profile)
        setLoading(false)
        return
      }

      // Se não existe, criar como admin
      console.log('Criando perfil automaticamente...')
      const { data: newProfile, error: createError } = await supabase
        .from('usuarios')
        .upsert({
          id: authUser.id,
          email: authUser.email,
          nome: 'Administrador',
          tipo: 'admin'
        }, { onConflict: 'id' })
        .select()
        .single()

      console.log('Novo perfil:', newProfile, 'Erro:', createError)

      if (newProfile) {
        setUserProfile(newProfile)
      } else {
        // Última tentativa: buscar novamente
        const { data: retry } = await supabase
          .from('usuarios')
          .select('*')
          .eq('id', authUser.id)
          .maybeSingle()
        
        setUserProfile(retry || { id: authUser.id, email: authUser.email, nome: 'Admin', tipo: 'admin' })
      }
    } catch (err) {
      console.error('Erro ao carregar perfil:', err)
      // Fallback: criar perfil local para não travar
      setUserProfile({ id: authUser.id, email: authUser.email, nome: 'Admin', tipo: 'admin' })
    }

    setLoading(false)
  }

  useEffect(() => {
    // Verificar sessão atual
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('Sessão inicial:', session?.user?.email || 'nenhuma')
      loadProfile(session?.user || null)
    })

    // Escutar mudanças
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth event:', event)
      
      if (event === 'SIGNED_IN') {
        loadProfile(session?.user || null)
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
        setUserProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email, password) => {
    setLoading(true)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setLoading(false)
      return { error }
    }
    return { data }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    localStorage.clear()
    setUser(null)
    setUserProfile(null)
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
