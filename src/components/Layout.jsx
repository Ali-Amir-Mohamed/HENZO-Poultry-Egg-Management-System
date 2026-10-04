import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { canAccess } from '../config'
import { useInstallPrompt, useOnline, usePendingCount } from '../hooks'
import LanguageSwitch from './LanguageSwitch'
import Notifications from './Notifications'
import SessionGuard from './SessionGuard'
import Icon, { Logo } from './Icon'

export const SECTIONS = [
  { to: '/', key: 'dashboard', icon: 'home' },
  { to: '/saisie', key: 'saisie', icon: 'plus' },
  { to: '/ferme', key: 'ferme', icon: 'hen' },
  { to: '/argent', key: 'argent', icon: 'wallet' },
  { to: '/planning', key: 'planning', icon: 'calendar' },
  { to: '/analyses', key: 'analyses', icon: 'chart' },
  { to: '/stock', key: 'stock', icon: 'box' },
  { to: '/reglages', key: 'reglages', icon: 'settings' },
  { to: '/sync', key: 'sync', icon: 'sync' }
]

// On phones the bottom bar shows at most 4 sections + "More"
const MOBILE_SLOTS = 4

export default function Layout() {
  const { t } = useTranslation()
  const { role, profile, signOut } = useAuth()
  const online = useOnline()
  const pending = usePendingCount()
  const install = useInstallPrompt()
  const sections = SECTIONS.filter((s) => canAccess(role, s.key))
  const needsMore = sections.length > MOBILE_SLOTS + 1

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
              <span className="dot" /><span className="hide-xs">{online ? t('status.online') : t('status.offline')}</span>
            </span>
            {install && (
              <button className="icon-btn" onClick={install} title={t('status.install')}>
                <Icon name="download" size={18} /><span className="hide-sm">{t('status.install')}</span>
              </button>
            )}
            {role !== 'employe' && <Notifications />}
            <LanguageSwitch />
            <button className="icon-btn" onClick={signOut} title={t('nav.logout')} aria-label={t('nav.logout')}>
              <Icon name="logout" size={18} />
            </button>
          </div>
        </div>
        <nav className="nav">
          {sections.map((s, i) => (
            <NavLink key={s.key} to={s.to} end={s.to === '/'}
              className={`nav-item ${needsMore && i >= MOBILE_SLOTS ? 'desktop-only' : ''}`}>
              <span className="nav-icon">
                <Icon name={s.icon} size={20} />
                {s.key === 'sync' && pending > 0 && <span className="bubble">{pending}</span>}
              </span>
              <span>{t(`nav.${s.key}`)}</span>
            </NavLink>
          ))}
          {needsMore && (
            <NavLink to="/plus" className="nav-item mobile-only">
              <span className="nav-icon">
                <Icon name="more" size={20} />
                {pending > 0 && <span className="bubble">{pending}</span>}
              </span>
              <span>{t('nav.plus')}</span>
            </NavLink>
          )}
        </nav>
      </header>
      <main className="content"><Outlet /></main>
      <SessionGuard />
    </div>
  )
}
