import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'

// Appearance of HENZO on this device: mode (automatic / light / dark) + colour palette.
// Both are applied before the app loads by the small script in index.html (no flash).
export const THEME_KEY = 'henzo.theme'
export const PALETTE_KEY = 'henzo.palette'
const MODES = ['auto', 'light', 'dark']
const MODE_ICONS = { auto: 'contrast', light: 'sun', dark: 'moon' }
// [main colour, accent] for the preview dots — values defined in styles.css
export const PALETTES = {
  marine: ['#132a47', '#f28c28'],
  foret: ['#14532d', '#f5b82e'],
  ocean: ['#0e4f55', '#ff7a59'],
  terre: ['#4a2a1a', '#e0a526'],
  violet: ['#2e1a4f', '#f472b6'],
  ardoise: ['#1f2937', '#34d399'],
  bordeaux: ['#5b1428', '#e9b949'],
  nuit: ['#111317', '#d4af37'],
  savane: ['#3f4a15', '#f08a24'],
  indigo: ['#25266b', '#fbbf24'],
  ciel: ['#0b4a7a', '#ffd23f'],
  sahel: ['#7c2d12', '#eab676'],
}

const read = (k, allowed, def) => { try { const v = localStorage.getItem(k); return allowed.includes(v) ? v : def } catch { return def } }
export const readTheme = () => read(THEME_KEY, MODES, 'auto')
export const readPalette = () => read(PALETTE_KEY, Object.keys(PALETTES), 'marine')

export function applyTheme(theme = readTheme(), palette = readPalette()) {
  const root = document.documentElement
  if (theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme)
  if (palette === 'marine') root.removeAttribute('data-palette'); else root.setAttribute('data-palette', palette)
  // Phone status bar / browser bar takes the main colour of the palette
  const css = getComputedStyle(root)
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  const bar = css.getPropertyValue(dark ? '--green-900' : '--green-800').trim()
  if (bar) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bar)
}

const save = (k, v, def) => { try { v === def ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch {} }

export default function ThemeSwitch({ className = 'icon-btn' }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState(readTheme)
  const [palette, setPalette] = useState(readPalette)
  const box = useRef(null)

  // Close when tapping outside
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  const chooseMode = (m) => { save(THEME_KEY, m, 'auto'); setTheme(m); applyTheme(m, palette) }
  const choosePalette = (p) => { save(PALETTE_KEY, p, 'marine'); setPalette(p); applyTheme(theme, p) }

  return (
    <div className="theme-menu" ref={box}>
      <button type="button" className={className} onClick={() => setOpen(!open)} aria-expanded={open}
        title={t('theme.title')} aria-label={t('theme.title')}>
        <Icon name={MODE_ICONS[theme]} size={18} />
      </button>
      {open && (
        <div className="theme-panel" role="dialog" aria-label={t('theme.title')}>
          <h3>{t('theme.mode')}</h3>
          <div className="theme-modes">
            {MODES.map((m) => (
              <button key={m} type="button" aria-pressed={theme === m} onClick={() => chooseMode(m)}>
                <Icon name={MODE_ICONS[m]} size={16} />{t(`theme.${m}`)}
              </button>
            ))}
          </div>
          <h3>{t('theme.colours')}</h3>
          <div className="theme-swatches">
            {Object.entries(PALETTES).map(([p, [main, accent]]) => (
              <button key={p} type="button" className="theme-swatch" aria-pressed={palette === p} onClick={() => choosePalette(p)}>
                <span className="theme-dot" style={{ background: `linear-gradient(135deg, ${main} 55%, ${accent} 55%)` }} />
                {t(`theme.palettes.${p}`)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
