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

    // Timeout de segurança para não travar
    const timeoutId = setTimeout(() => {
      console.log('Timeout ao carregar perfil, usando fallback')
      setUserProfile({ id: authUser.id, email: authUser.email, nome: 'Admin', tipo: 'admin' })
      setLoading(false)
    }, 5000)

    try {
      // Buscar perfil existente na tabela usuarios
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

      // Se não existe na tabela usuarios, verificar se é cliente
      // Buscar na tabela clientes pelo user_id
      const { data: clienteProfile, error: clienteError } = await supabase
        .from('clientes')
        .select('*')
        .eq('user_id', authUser.id)
        .maybeSingle()

      console.log('Cliente encontrado:', clienteProfile, 'Erro:', clienteError)

      if (clienteProfile) {
        // Criar perfil na tabela usuarios com tipo 'cliente'
        const { data: newProfile, error: createError } = await supabase
          .from('usuarios')
          .upsert({
            id: authUser.id,
            email: authUser.email,
            nome: clienteProfile.nome_completo || 'Cliente',
            tipo: 'cliente'
          }, { onConflict: 'id' })
          .select()
          .single()

        if (newProfile) {
          setUserProfile(newProfile)
        } else {
          // Se não conseguiu criar, usar dados do cliente
          setUserProfile({ 
            id: authUser.id, 
            email: authUser.email, 
            nome: clienteProfile.nome_completo || 'Cliente', 
            tipo: 'cliente' 
          })
        }
        setLoading(false)
        return
      }

      // Se não é cliente nem tem perfil, criar como admin (comportamento padrão)
      console.log('Criando perfil automaticamente como admin...')
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
    } finally {
      clearTimeout(timeoutId)
      setLoading(false)
    }
  }

  useEffect(() => {
    // Verificar sessão atual
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('Sessão inicial:', session?.user?.email || 'nenhuma')
      loadProfile(session?.user || null)
    })

    // Escutar mudanças
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth event:', event, 'User:', session?.user?.email)
      
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        await loadProfile(session?.user || null)
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
        setUserProfile(null)
        setLoading(false)
      } else if (event === 'USER_UPDATED') {
        await loadProfile(session?.user || null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email, password) => {
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ 
        email, 
        password 
      })
      
      if (error) {
        setLoading(false)
        console.error('Erro no signIn:', error)
        
        // Se o erro for "Email not confirmed", tentar fazer login mesmo assim
        // (útil para sistemas internos onde não queremos confirmação de email)
        if (error.message && error.message.includes('Email not confirmed')) {
          // Tentar obter a sessão diretamente (pode funcionar em alguns casos)
          const { data: sessionData } = await supabase.auth.getSession()
          if (sessionData?.session) {
            // Se conseguiu sessão, retornar sucesso
            return { data: sessionData }
          }
        }
        
        return { error }
      }
      
      // O perfil será carregado automaticamente pelo onAuthStateChange
      return { data }
    } catch (err) {
      setLoading(false)
      console.error('Erro inesperado no signIn:', err)
      return { error: { message: 'Erro inesperado ao fazer login', status: 500 } }
    }
  }

  const signOut = async () => {
    try {
      await supabase.auth.signOut()
      localStorage.clear()
      setUser(null)
      setUserProfile(null)
      // Redirecionar para login
      window.location.href = '/login'
    } catch (error) {
      console.error('Erro ao fazer logout:', error)
      // Mesmo com erro, limpa o estado local e redireciona
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
