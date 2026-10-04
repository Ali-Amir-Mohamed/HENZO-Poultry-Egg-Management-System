import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import LanguageSwitch from '../components/LanguageSwitch'
import Icon, { Logo } from '../components/Icon'
import { EXPIRED_FLAG } from '../components/SessionGuard'

export default function Login() {
  const { t } = useTranslation()
  const { signIn } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [expired] = useState(() => {
    try { const v = sessionStorage.getItem(EXPIRED_FLAG); sessionStorage.removeItem(EXPIRED_FLAG); return !!v } catch { return false }
  })

  const submit = async (e) => {
    e.preventDefault()
    if (!navigator.onLine) return setError(t('auth.offline'))
    setBusy(true)
    setError(null)
    // A fresh sign-in starts a new activity period (see SessionGuard)
    try { localStorage.setItem('henzo.lastActivity', String(Date.now())) } catch {}
    const { error } = await signIn(username, password)
    setBusy(false)
    if (error) setError(t('auth.error'))
  }

  return (
    <div className="login-page">
      <div className="login-lang"><LanguageSwitch className="icon-btn light" /></div>
      <div className="login-hero">
        <Logo size={72} />
        <h1>{t('app.name')}</h1>
        <p>{t('app.tagline')}</p>
      </div>
      <form className="login-card" onSubmit={submit}>
        <h2>{t('auth.title')}</h2>
        <p className="muted">{t('auth.subtitle')}</p>
        {expired && <div className="alert warn"><Icon name="clock" size={18} />{t('auth.expired')}</div>}
        <label className="field">
          <span>{t('auth.username')}</span>
          <input type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck="false"
            required value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('auth.password')}</span>
          <input type="password" autoComplete="current-password" required value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </label>
        {error && <div className="alert danger"><Icon name="alert" size={18} />{error}</div>}
        <button type="submit" className="btn primary block" disabled={busy}>
          {busy ? t('common.loading') : t('auth.submit')}
        </button>
      </form>
      <p className="login-foot">© {new Date().getFullYear()} HENZO</p>
    </div>
  )
}
