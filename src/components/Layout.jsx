import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { canAccess } from '../config'
import { useInstallPrompt, useOnline, usePendingCount } from '../hooks'
import LanguageSwitch from './LanguageSwitch'

const SECTIONS = [
  { to: '/', key: 'dashboard' },
  { to: '/saisie', key: 'saisie' },
  { to: '/production', key: 'production' },
  { to: '/finance', key: 'finance' },
  { to: '/sync', key: 'sync' }
]

export default function Layout() {
  const { t } = useTranslation()
  const { role, signOut } = useAuth()
  const online = useOnline()
  const pending = usePendingCount()
  const install = useInstallPrompt()

  return (
    <div className="app">
      <header className="topbar">
        <strong>{t('app.name')}</strong>
        <span className={online ? 'badge ok' : 'badge off'}>
          {online ? t('status.online') : t('status.offline')}
        </span>
        {pending > 0 && <NavLink to="/sync" className="badge warn">{t('status.pending', { count: pending })}</NavLink>}
        <span className="spacer" />
        {install && <button className="link" onClick={install}>{t('status.install')}</button>}
        <LanguageSwitch />
        <button className="link" onClick={signOut}>{t('nav.logout')}</button>
      </header>
      <nav className="tabs">
        {SECTIONS.filter((s) => canAccess(role, s.key)).map((s) => (
          <NavLink key={s.key} to={s.to} end={s.to === '/'}>{t(`nav.${s.key}`)}</NavLink>
        ))}
      </nav>
      <main><Outlet /></main>
    </div>
  )
}
