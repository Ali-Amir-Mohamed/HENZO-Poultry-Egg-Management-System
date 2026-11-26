import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'

// Appearance on each device: the background behind the glass panels (chicks, hen in the grass, plain green)
// and the opacity of the panels (0 % = see-through glass as designed, 100 % = solid dark green, easiest to read).
export const FOND_KEY = 'henzo.fond'
export const OPACITE_KEY = 'henzo.opacite'
export const FONDS = {
  poussins: '/dashboard-fond.webp',
  poule: '/login-fond.webp',
  uni: null
}
export const readFond = () => { try { const v = localStorage.getItem(FOND_KEY); return v in FONDS ? v : 'poussins' } catch { return 'poussins' } }
export const readOpacite = () => { try { const v = Number(localStorage.getItem(OPACITE_KEY)); return v >= 0 && v <= 100 ? v : 0 } catch { return 0 } }
// the panels get a dark green layer: 0 → none, 100 → almost solid (see --vo in styles.css)
const applyOpacite = (o) => document.body.style.setProperty('--vo', String(Math.round(o * 0.92) / 100))
export const applyFond = (f = readFond(), o = readOpacite()) => { document.body.dataset.fond = f; applyOpacite(o) }

export default function FondSwitch() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [fond, setFond] = useState(readFond)
  const [opacite, setOpacite] = useState(readOpacite)
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
    try { o === 0 ? localStorage.removeItem(OPACITE_KEY) : localStorage.setItem(OPACITE_KEY, String(o)) } catch { /* ignore */ }
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
          <h3>{t('fond.opacity')}</h3>
          <label className="fond-opacite">
            <span className="small">{t('fond.clear')}</span>
            <input type="range" min="0" max="100" step="5" value={opacite} onChange={(e) => regler(Number(e.target.value))} aria-label={t('fond.opacity')} />
            <span className="small">{t('fond.solid')}</span>
          </label>
          <div className="fond-opacite-val"><strong>{opacite} %</strong>{opacite !== 0 && <button type="button" className="link-btn" onClick={() => regler(0)}>{t('fond.reset')}</button>}</div>
        </div>
      )}
    </div>
  )
}
