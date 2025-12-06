import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export const useAuth = () => useContext(AuthContext)

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Função para buscar perfil
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
      // Buscar perfil existente pelo ID
      const { data: profile, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle()

      console.log('Perfil encontrado por ID:', profile, 'Erro:', error)

      if (profile) {
        setUserProfile(profile)
        setLoading(false)
        return
      }

      // Se não encontrou pelo ID, tentar buscar pelo email
      console.log('Perfil não encontrado pelo ID, buscando pelo email...')
      const { data: profileByEmail, error: emailError } = await supabase
        .from('usuarios')
        .select('*')
        .eq('email', authUser.email)
        .maybeSingle()

      console.log('Perfil encontrado por email:', profileByEmail, 'Erro:', emailError)

      if (profileByEmail) {
        // Se encontrou pelo email mas com ID diferente, atualizar o ID
        console.log('Atualizando ID do perfil...')
        const { error: updateError } = await supabase
          .from('usuarios')
          .update({ id: authUser.id })
          .eq('email', authUser.email)

        if (!updateError) {
          setUserProfile({ ...profileByEmail, id: authUser.id })
        } else {
          // Usar o perfil mesmo assim
          setUserProfile(profileByEmail)
        }
        setLoading(false)
        return
      }

      // Se não encontrou de nenhuma forma, perfil não existe no sistema
      console.error('Usuário não cadastrado no sistema:', authUser.email)
      setUserProfile(null)
      // Fazer logout
      await supabase.auth.signOut()
      alert('Seu usuário não está cadastrado no sistema. Entre em contato com o administrador.')
    } catch (err) {
      console.error('Erro ao carregar perfil:', err)
      setUserProfile(null)
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
