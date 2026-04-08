import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Supabase env is missing')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,      // 토큰 만료 전 자동 갱신
    persistSession: true,         // 브라우저 닫아도 세션 유지 (localStorage)
    detectSessionInUrl: false,    // Magic Link 안 쓰니까 off
  }
})