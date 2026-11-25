import { useTranslation } from 'react-i18next'
import Icon from './Icon'

// FR / EN: one tap switches; the language in use is highlighted
export default function LanguageSwitch({ className = 'icon-btn' }) {
  const { i18n } = useTranslation()
  const cur = i18n.resolvedLanguage === 'en' ? 'en' : 'fr'
  const next = cur === 'fr' ? 'en' : 'fr'
  return (
    <button type="button" className={`${className} lang-switch`} onClick={() => i18n.changeLanguage(next)}
      aria-label={next === 'en' ? 'English' : 'Français'} title={next === 'en' ? 'English' : 'Français'}>
      <Icon name="globe" size={16} />
      <span className={cur === 'fr' ? 'on' : ''}>FR</span><span className={cur === 'en' ? 'on' : ''}>EN</span>
    </button>
  )
}
