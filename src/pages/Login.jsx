import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import LanguageSwitch from '../components/LanguageSwitch'

export default function Login() {
  const { t } = useTranslation()
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!navigator.onLine) return setError(t('auth.offline'))
    setBusy(true)
    const { error } = await signIn(email, password)
    setBusy(false)
    if (error) setError(t('auth.error'))
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <div className="row">
          <h1>{t('app.name')}</h1>
          <span className="spacer" />
          <LanguageSwitch />
        </div>
        <p className="muted">{t('app.tagline')}</p>
        <label>{t('auth.email')}
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>{t('auth.password')}
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>{t('auth.submit')}</button>
      </form>
    </div>
  )
}
