import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { canAccess } from '../config'
import { SECTIONS } from '../components/Layout'
import Icon from '../components/Icon'

// Phone-only page listing the sections that do not fit in the bottom bar
export default function Plus() {
  const { t } = useTranslation()
  const { role, signOut } = useAuth()
  const sections = SECTIONS.filter((s) => canAccess(role, s.key)).slice(4)
  return (
    <section className="panel">
      <ul className="menu">
        {sections.map((s) => (
          <li key={s.key}><Link to={s.to}><Icon name={s.icon} size={20} />{t(`nav.${s.key}`)}<Icon name="chevron" size={18} /></Link></li>
        ))}
        <li><button onClick={signOut}><Icon name="logout" size={20} />{t('nav.logout')}</button></li>
      </ul>
    </section>
  )
}
