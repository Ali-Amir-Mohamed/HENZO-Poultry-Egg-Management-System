import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { canAccess } from '../config'
import { SECTIONS } from '../components/Layout'
import Icon from '../components/Icon'
import { faceIdSupported, nomBiometrie } from '../lib/faceid'
import { APP_VERSION, forcerMiseAJour } from '../lib/version'

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
        <li><Link to="/compte"><Icon name="users" size={20} />{t('compte.title')}<Icon name="chevron" size={18} /></Link></li>
        {faceIdSupported() && (
          <li><Link to="/face-id"><Icon name="check" size={20} />{t('faceid.menu', { nom: nomBiometrie() })}<Icon name="chevron" size={18} /></Link></li>
        )}
        <li><button onClick={signOut}><Icon name="logout" size={20} />{t('nav.logout')}</button></li>
      </ul>
      <p className="muted small center">{t('version.label')} {APP_VERSION} · <button type="button" className="link-btn" onClick={forcerMiseAJour}>{t('version.force')}</button></p>
    </section>
  )
}
