import { createClient } from '@supabase/supabase-js'

//const SUPABASE_URL = 'https://jfycelbaatseeekgonvo.supabase.co'
//const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpmeWNlbGJhYXRzZWVla2dvbnZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc0ODIsImV4cCI6MjA5MDU4MzQ4Mn0.VOUGLVUqfcFqIQQfXRp5pghtX00p38JUa3wSOMaMF-I'
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
 