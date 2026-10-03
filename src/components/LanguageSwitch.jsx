import { useTranslation } from 'react-i18next'

export default function LanguageSwitch() {
  const { i18n } = useTranslation()
  const next = i18n.resolvedLanguage === 'fr' ? 'en' : 'fr'
  return (
    <button className="link" onClick={() => i18n.changeLanguage(next)} aria-label="Language">
      {next.toUpperCase()}
    </button>
  )
}
