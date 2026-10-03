import { useTranslation } from 'react-i18next'
import Icon from './Icon'

export default function LanguageSwitch({ className = 'icon-btn' }) {
  const { i18n } = useTranslation()
  const next = i18n.resolvedLanguage === 'fr' ? 'en' : 'fr'
  return (
    <button type="button" className={className} onClick={() => i18n.changeLanguage(next)} aria-label="Language">
      <Icon name="globe" size={18} />
      <span>{next.toUpperCase()}</span>
    </button>
  )
}
