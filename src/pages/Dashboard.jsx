import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'

export default function Dashboard() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  return (
    <section className="card">
      <h2>{t('dashboard.welcome', { name: profile.nom_complet ?? '' })}</h2>
      <p className="muted">{t('dashboard.role', { role: t(`roles.${profile.role}`) })}</p>
      <p>{t('common.comingSoon')}</p>
    </section>
  )
}
