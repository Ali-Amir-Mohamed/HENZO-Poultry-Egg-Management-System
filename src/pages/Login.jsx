import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import LanguageSwitch from '../components/LanguageSwitch'
import ThemeSwitch from '../components/ThemeSwitch'
import Icon, { Logo } from '../components/Icon'
import { EXPIRED_FLAG } from '../components/SessionGuard'
import { faceIdActiveIci, faceIdSupported, messageFaceId, nomBiometrie } from '../lib/faceid'
import { APP_VERSION, forcerMiseAJour } from '../lib/version'
import { demanderSplash } from '../components/Splash'

export default function Login({ systeme = 'elevage', site, onRetour }) {
  const negoce = systeme === 'negoce'
  const { t } = useTranslation()
  const { signIn, signInWithFaceId } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [voir, setVoir] = useState(false)   // show the password while typing
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
    demanderSplash()   // « Bon retour » screen once the app opens
    const { error } = await signIn(username, password)
    setBusy(false)
    if (error) setError(t('auth.error'))
  }

  // Face ID / fingerprint: no username needed, the phone finds its HENZO passkey itself
  const faceId = async () => {
    if (!navigator.onLine) return setError(t('auth.offline'))
    setBusy(true)
    setError(null)
    try { localStorage.setItem('henzo.lastActivity', String(Date.now())) } catch {}
    demanderSplash()
    const { error } = await signInWithFaceId()
    setBusy(false)
    if (error) setError(messageFaceId(error, t))
  }
  const boutonFaceId = faceIdSupported() && (
    <button type="button" className={`btn ${faceIdActiveIci() ? 'primary' : 'ghost'} block`} onClick={faceId} disabled={busy}>
      <Icon name="check" size={18} />{t('faceid.signIn', { nom: nomBiometrie() })}
    </button>
  )

  // Slight 3D tilt following the mouse, with a light reflection on the glass (computers only:
  // nothing moves on a phone, nor when the person asked the system for less motion)
  const carte = useRef(null)
  const incliner = (e) => {
    const el = carte.current
    if (!el || e.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const r = el.getBoundingClientRect()
    const x = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1)
    const y = Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1)
    el.style.setProperty('--ry', `${(x - 0.5) * 10}deg`)
    el.style.setProperty('--rx', `${(0.5 - y) * 8}deg`)
    el.style.setProperty('--gx', `${x * 100}%`)
    el.style.setProperty('--gy', `${y * 100}%`)
    el.classList.add('tilt')
  }
  const redresser = () => {
    const el = carte.current
    if (!el) return
    el.classList.remove('tilt')
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
  }

  // A frosted-glass card over a photo of the farm (public/login-fond.webp)
  return (
    <div className={`login-page ${negoce ? 'negoce' : ''}`}>
      <div className="login-bg" aria-hidden="true" />
      <header className="login-top">
        <div className="login-brand">
          <Logo size={36} />
          <div><strong>{negoce ? 'HENZO AGRO' : t('app.name')}</strong><small>AGROFARM PARTNERS</small></div>
        </div>
        <div className="login-lang"><ThemeSwitch className="icon-btn light" /><LanguageSwitch className="icon-btn light" /></div>
      </header>

      <main className="login-main" onPointerMove={incliner} onPointerLeave={redresser}>
        <form ref={carte} className="login-card" onSubmit={submit}>
          <span className="login-glare" aria-hidden="true" />
          <span className="login-card-logo"><img src="/logo-societe.png" alt="" /></span>
          <div>
            <h2>{t('auth.welcome1')} <em>{t('auth.welcome2')}</em></h2>
            <p className="login-sub">{negoce ? t('systeme.negoceSubtitle') : t('auth.subtitle')}</p>
            {site && <span className="login-site">{site}</span>}
          </div>
          {expired && <div className="alert warn"><Icon name="clock" size={18} />{t('auth.expired')}</div>}
          {/* Face ID first on a phone where it was activated, otherwise offered under the password form */}
          {faceIdActiveIci() && boutonFaceId && <>{boutonFaceId}<p className="login-or">{t('faceid.orPassword')}</p></>}
          <label className="login-field">
            <span>{t('auth.username')}</span>
            <div className="login-input">
              <Icon name="user" size={18} />
              <input type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck="false"
                required value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
          </label>
          <label className="login-field">
            <span>{t('auth.password')}</span>
            <div className="login-input">
              <Icon name="lock" size={18} />
              <input type={voir ? 'text' : 'password'} autoComplete="current-password" required value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              <button type="button" className="login-eye" onClick={() => setVoir(!voir)}
                aria-label={voir ? t('auth.hidePassword') : t('auth.showPassword')} title={voir ? t('auth.hidePassword') : t('auth.showPassword')}>
                <Icon name={voir ? 'eyeOff' : 'eye'} size={18} />
              </button>
            </div>
          </label>
          {error && <div className="alert danger"><Icon name="alert" size={18} />{error}</div>}
          <button type="submit" className="btn primary block login-submit" disabled={busy}>
            {busy ? t('common.loading') : <>{t('auth.submit')} <span aria-hidden="true">→</span></>}
          </button>
          {!faceIdActiveIci() && boutonFaceId && <><p className="login-or">{t('faceid.or')}</p>{boutonFaceId}</>}
        </form>
      </main>

      <footer className="login-foot">
        {onRetour && <button type="button" className="link-btn login-retour" onClick={onRetour}>← {t('systeme.back')}</button>}
        <span>© {new Date().getFullYear()} AGROFARM PARTNERS SARL · {t('version.label')} {APP_VERSION}</span>
        <button type="button" className="link-btn" onClick={forcerMiseAJour}>{t('version.force')}</button>
      </footer>
    </div>
  )
}
