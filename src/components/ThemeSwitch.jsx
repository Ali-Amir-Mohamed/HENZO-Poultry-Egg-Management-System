import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'

// Theme: automatic (follows the phone / computer), light or dark. Remembered on this device.
// The choice is applied before the app loads by the small script in index.html (no white flash).
export const THEME_KEY = 'henzo.theme'
const ORDER = ['auto', 'light', 'dark']
const ICONS = { auto: 'contrast', light: 'sun', dark: 'moon' }

export function readTheme() {
  try { return ORDER.includes(localStorage.getItem(THEME_KEY)) ? localStorage.getItem(THEME_KEY) : 'auto' } catch { return 'auto' }
}

export function applyTheme(theme) {
  const root = document.documentElement
  if (theme === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  // Colour of the phone's status bar / browser bar
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1a2e' : '#132a47')
}

export default function ThemeSwitch({ className = 'icon-btn' }) {
  const { t } = useTranslation()
  const [theme, setTheme] = useState(readTheme)
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]
  const change = () => {
    try { next === 'auto' ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, next) } catch {}
    applyTheme(next)
    setTheme(next)
  }
  const label = `${t('theme.title')} : ${t(`theme.${theme}`)} → ${t(`theme.${next}`)}`
  return (
    <button type="button" className={className} onClick={change} title={label} aria-label={label}>
      <Icon name={ICONS[theme]} size={18} />
    </button>
  )
}
