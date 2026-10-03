import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { canAccess } from '../config'
import { useInstallPrompt, useOnline, usePendingCount } from '../hooks'
import LanguageSwitch from './LanguageSwitch'
import Icon, { Logo } from './Icon'

const SECTIONS = [
  { to: '/', key: 'dashboard', icon: 'home' },
  { to: '/saisie', key: 'saisie', icon: 'egg' },
  { to: '/production', key: 'production', icon: 'chart' },
  { to: '/finance', key: 'finance', icon: 'wallet' },
  { to: '/sync', key: 'sync', icon: 'sync' }
]

export default function Layout() {
  const { t } = useTranslation()
  const { role, profile, signOut } = useAuth()
  const online = useOnline()
  const pending = usePendingCount()
  const install = useInstallPrompt()

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <Logo size={38} />
            <div>
              <strong>{t('app.name')}</strong>
              <small>{profile?.nom_complet || t(`roles.${role}`)}</small>
            </div>
          </div>
          <div className="topbar-actions">
            <span className={`status ${online ? 'on' : 'off'}`}>
              <span className="dot" />{online ? t('status.online') : t('status.offline')}
            </span>
            {install && (
              <button className="icon-btn" onClick={install} title={t('status.install')}>
                <Icon name="download" size={18} /><span className="hide-sm">{t('status.install')}</span>
              </button>
            )}
            <LanguageSwitch />
            <button className="icon-btn" onClick={signOut} title={t('nav.logout')} aria-label={t('nav.logout')}>
              <Icon name="logout" size={18} />
            </button>
          </div>
        </div>
        <nav className="nav">
          {SECTIONS.filter((s) => canAccess(role, s.key)).map((s) => (
            <NavLink key={s.key} to={s.to} end={s.to === '/'} className="nav-item">
              <span className="nav-icon">
                <Icon name={s.icon} size={20} />
                {s.key === 'sync' && pending > 0 && <span className="bubble">{pending}</span>}
              </span>
              <span>{t(`nav.${s.key}`)}</span>
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="content"><Outlet /></main>
    </div>
  )
}
