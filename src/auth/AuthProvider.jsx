import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { TABLES, toLoginEmail } from '../config'

const AuthContext = createContext(null)
const PROFILE_CACHE = 'henzo.profile'

function readCachedProfile(userId) {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_CACHE))
    return p?.id === userId ? p : null
  } catch { return null }
}

async function loadProfile(user) {
  // Offline: the Supabase session is restored from localStorage, the profile from our cache
  if (!navigator.onLine) return readCachedProfile(user.id)
  const { data, error } = await supabase
    .from(TABLES.profiles)
    .select('id, nom_complet, role')
    .eq('id', user.id)
    .eq('actif', true)
    .maybeSingle()
  if (error) return readCachedProfile(user.id)
  try { localStorage.setItem(PROFILE_CACHE, JSON.stringify(data)) } catch {}
  return data
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const apply = async (s) => {
      const p = s ? await loadProfile(s.user) : null
      if (!active) return
      setSession(s)
      setProfile(p)
      setLoading(false)
    }
    supabase.auth.getSession().then(({ data }) => apply(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event !== 'INITIAL_SESSION') apply(s)
    })
    return () => { active = false; sub.subscription.unsubscribe() }
  }, [])

  const signIn = (identifier, password) =>
    supabase.auth.signInWithPassword({ email: toLoginEmail(identifier), password })
  const signOut = async () => {
    try { localStorage.removeItem(PROFILE_CACHE) } catch {}
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, profile, role: profile?.role, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
