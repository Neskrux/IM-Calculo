import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)


export const getCurrentSiteUrl = () => {
  // Detecta automaticamente baseado na URL atual
  if (typeof window !== 'undefined') {
    const url = window.location.origin
    return url
  }
  
  // Fallback para SSR ou variável de ambiente
  const fallbackUrl = import.meta.env.VITE_SITE_URL || 'http://localhost:3000'
  console.warn('⚠️ Window não disponível, usando fallback:', fallbackUrl)
  return fallbackUrl
}

