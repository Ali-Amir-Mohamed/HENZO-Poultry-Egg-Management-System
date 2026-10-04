import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { SESSION_EXPIRY_ROLES } from '../config'

// Automatic sign-out after a period of inactivity (farm setting, 30 min by default).
// Employees are excluded: they often work offline and could not sign in again without network.
const LAST_KEY = 'henzo.lastActivity'
const MINUTES_KEY = 'henzo.sessionMinutes'
export const EXPIRED_FLAG = 'henzo.sessionExpired'

const read = (k, d) => { try { return Number(localStorage.getItem(k)) || d } catch { return d } }
const write = (k, v) => { try { localStorage.setItem(k, String(v)) } catch {} }

export default function SessionGuard() {
  const { role, signOut } = useAuth()

  useEffect(() => {
    if (!SESSION_EXPIRY_ROLES.includes(role)) return

    let minutes = read(MINUTES_KEY, 30)
    if (navigator.onLine) {
      supabase.from('fermes').select('session_minutes').limit(1).then(({ data }) => {
        if (data?.[0]?.session_minutes) { minutes = data[0].session_minutes; write(MINUTES_KEY, minutes) }
      })
    }

    const expired = () => Date.now() - read(LAST_KEY, Date.now()) > minutes * 60_000
    const logout = () => {
      try { sessionStorage.setItem(EXPIRED_FLAG, '1') } catch {}
      signOut('expiration')
    }
    if (expired()) { logout(); return }

    let throttle = 0
    const touch = () => {
      const now = Date.now()
      if (now - throttle > 15_000) { throttle = now; write(LAST_KEY, now) }
    }
    touch()
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart']
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    const timer = setInterval(() => { if (expired()) logout() }, 30_000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch))
      clearInterval(timer)
    }
  }, [role, signOut])

  return null
}
