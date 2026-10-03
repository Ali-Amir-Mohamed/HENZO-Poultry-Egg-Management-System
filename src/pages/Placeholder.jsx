import { useTranslation } from 'react-i18next'

export default function Placeholder({ title }) {
  const { t } = useTranslation()
  return (
    <section className="card">
      <h2>{t(title)}</h2>
      <p className="muted">{t('common.comingSoon')}</p>
    </section>
  )
}
