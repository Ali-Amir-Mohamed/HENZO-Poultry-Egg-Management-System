import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'

// Appearance on each device: the background behind the glass panels (chicks, hen in the grass, plain green)
// and the opacity of the panels: 0 % = fully transparent (no veil, no blur), 30 % = the frosted glass as designed (default),
// 100 % = solid dark green, easiest to read.
export const FOND_KEY = 'henzo.fond'
export const OPACITE_KEY = 'henzo.opacite'
export const FONDS = {
  poussins: '/dashboard-fond.webp',
  poule: '/login-fond.webp',
  uni: null
}
export const readFond = () => { try { const v = localStorage.getItem(FOND_KEY); return v in FONDS ? v : 'poussins' } catch { return 'poussins' } }
export const OPACITE_VERRE = 30
export const readOpacite = () => { try { const s = localStorage.getItem(OPACITE_KEY); const v = Number(s); return s !== null && v >= 0 && v <= 100 ? v : OPACITE_VERRE } catch { return OPACITE_VERRE } }
// up to 30: the white veil and the blur grow (--vw, --vb); beyond: a dark green layer covers the glass (--vo), see styles.css
const applyOpacite = (o) => {
  const verre = Math.min(o, OPACITE_VERRE) / OPACITE_VERRE
  const s = document.body.style
  s.setProperty('--vw', String(Math.round(verre * 14) / 100))
  s.setProperty('--vb', `${Math.round(verre * 18)}px`)
  s.setProperty('--vo', String(Math.round(Math.max(0, o - OPACITE_VERRE) / (100 - OPACITE_VERRE) * 92) / 100))
}
export const applyFond = (f = readFond(), o = readOpacite()) => { document.body.dataset.fond = f; applyOpacite(o) }

// Side menu on computers: « icones » (narrow column that opens under the mouse, default), « cache » (hidden, opens at the
// left edge or with ☰), « ouvert » (always open). Kept on each device; read by the CSS through body[data-menu].
export const MENU_KEY = 'henzo.menu'
export const MENUS = ['icones', 'cache', 'ouvert']
export const readMenu = () => { try { const v = localStorage.getItem(MENU_KEY); return MENUS.includes(v) ? v : 'icones' } catch { return 'icones' } }
export const applyMenu = (m = readMenu()) => {
  document.body.dataset.menu = m
  try { m === 'icones' ? localStorage.removeItem(MENU_KEY) : localStorage.setItem(MENU_KEY, m) } catch { /* ignore */ }
  window.dispatchEvent(new Event('henzo-menu'))
}

export default function FondSwitch() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [fond, setFond] = useState(readFond)
  const [opacite, setOpacite] = useState(readOpacite)
  const [menu, setMenu] = useState(readMenu)
  useEffect(() => { const maj = () => setMenu(readMenu()); window.addEventListener('henzo-menu', maj); return () => window.removeEventListener('henzo-menu', maj) }, [])
  const box = useRef(null)

  // Close when tapping outside, or with Escape
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const choisir = (f) => {
    try { f === 'poussins' ? localStorage.removeItem(FOND_KEY) : localStorage.setItem(FOND_KEY, f) } catch { /* ignore */ }
    setFond(f)
    applyFond(f, opacite)
  }
  const regler = (o) => {
    setOpacite(o)
    applyOpacite(o)   // seen at once while sliding
    try { o === OPACITE_VERRE ? localStorage.removeItem(OPACITE_KEY) : localStorage.setItem(OPACITE_KEY, String(o)) } catch { /* ignore */ }
  }

  return (
    <div className="theme-menu" ref={box}>
      <button type="button" className="icon-btn" onClick={() => setOpen(!open)} aria-expanded={open}
        title={t('fond.title')} aria-label={t('fond.title')}>
        <Icon name="image" size={18} />
      </button>
      {open && (
        <div className="theme-panel pop" role="dialog" aria-label={t('fond.title')}>
          <h3>{t('fond.title')}</h3>
          <div className="fond-choices">
            {Object.entries(FONDS).map(([f, img]) => (
              <button key={f} type="button" className="fond-choice" aria-pressed={fond === f} onClick={() => choisir(f)}>
                <span className="fond-thumb" style={img ? { backgroundImage: `url(${img})` } : undefined} />
                <span>{t(`fond.${f}`)}</span>
                {fond === f && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>
          <h3>{t('fond.menu')}</h3>
          <div className="segmented small" role="group" aria-label={t('fond.menu')}>
            {MENUS.map((m) => <button key={m} type="button" className={menu === m ? 'active' : ''} onClick={() => { applyMenu(m); setMenu(m) }}>{t(`fond.menus.${m}`)}</button>)}
          </div>
          <p className="small muted">{t(`fond.menuHint.${menu}`)}</p>
          <h3>{t('fond.opacity')}</h3>
          <label className="fond-opacite">
            <span className="small">{t('fond.clear')}</span>
            <input type="range" min="0" max="100" step="5" value={opacite} onChange={(e) => regler(Number(e.target.value))} aria-label={t('fond.opacity')} />
            <span className="small">{t('fond.solid')}</span>
          </label>
          <div className="fond-opacite-val"><strong>{opacite} %</strong>{opacite !== OPACITE_VERRE && <button type="button" className="link-btn" onClick={() => regler(OPACITE_VERRE)}>{t('fond.reset')}</button>}</div>
        </div>
      )}
    </div>
  )
}
