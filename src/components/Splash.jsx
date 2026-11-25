import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Shown for about two seconds right after signing in: the logo lights up over the chicks photo,
// « Bon retour, Ali » and a bar that fills up, then the app appears. Never shown on a simple page reload.
export const SPLASH_FLAG = 'henzo.splash'
export const demanderSplash = () => { try { sessionStorage.setItem(SPLASH_FLAG, '1') } catch { /* ignore */ } }

export default function Splash({ name }) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(() => { try { return sessionStorage.getItem(SPLASH_FLAG) === '1' } catch { return false } })
  const [pct, setPct] = useState(0)

  useEffect(() => {
    if (!visible) return
    try { sessionStorage.removeItem(SPLASH_FLAG) } catch { /* ignore */ }
    const duree = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 600 : 1900
    const debut = performance.now()
    let id
    const pas = (now) => {
      const p = Math.min(1, (now - debut) / duree)
      setPct(Math.round(p * 100))
      if (p < 1) id = requestAnimationFrame(pas)
      else id = setTimeout(() => setVisible(false), 250)
    }
    id = requestAnimationFrame(pas)
    return () => { cancelAnimationFrame(id); clearTimeout(id) }
  }, [visible])

  if (!visible) return null
  return (
    <div className={`splash ${pct >= 100 ? 'out' : ''}`} role="status" aria-live="polite">
      <span className="splash-top">HENZO · AGROFARM PARTNERS</span>
      <span className="splash-logo"><img src="/logo-societe.png" alt="" /></span>
      <h2>{t('splash.welcome', { name })}</h2>
      <p>{t('splash.opening')}</p>
      <span className="splash-bar"><i style={{ width: `${pct}%` }} /></span>
      <span className="splash-pct">{pct} %</span>
    </div>
  )
}
