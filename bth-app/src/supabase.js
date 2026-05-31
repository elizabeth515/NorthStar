import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://fvilkxrtgomawwlizwij.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2aWxreHJ0Z29tYXd3bGl6d2lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyMTgwODQsImV4cCI6MjA5NTc5NDA4NH0.a_9eMlI6L_Ya0ekofyNHPTCBbM8RvD9QevkaU4SvS_U'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'bth-auth',
  }
})
