import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'

// Background of the app behind the glass panels, chosen on each device: chicks, hen in the grass, or plain green.
export const FOND_KEY = 'henzo.fond'
export const FONDS = {
  poussins: '/dashboard-fond.webp',
  poule: '/login-fond.webp',
  uni: null
}
export const readFond = () => { try { const v = localStorage.getItem(FOND_KEY); return v in FONDS ? v : 'poussins' } catch { return 'poussins' } }
export const applyFond = (f = readFond()) => { document.body.dataset.fond = f }

export default function FondSwitch() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [fond, setFond] = useState(readFond)
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
    applyFond(f)
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
        </div>
      )}
    </div>
  )
}
