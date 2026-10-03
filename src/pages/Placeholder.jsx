import { useTranslation } from 'react-i18next'
import Icon from '../components/Icon'

export default function Placeholder({ title, icon = 'chart' }) {
  const { t } = useTranslation()
  return (
    <section className="panel">
      <div className="empty">
        <span className="empty-icon"><Icon name={icon} size={28} /></span>
        <h2>{t(title)}</h2>
        <p className="muted">{t('common.comingSoon')}</p>
      </div>
    </section>
  )
}
