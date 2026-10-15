import { Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { sectionVisible, estNegoce, lireRefus, ecrireRefus } from '../lib/systeme'
import { useInstallPrompt, useOnline, usePendingCount } from '../hooks'
import LanguageSwitch from './LanguageSwitch'
import ThemeSwitch from './ThemeSwitch'
import Notifications from './Notifications'
import SessionGuard from './SessionGuard'
import FarmSwitch from './FarmSwitch'
import ErrorBoundary from './ErrorBoundary'
import Icon, { Logo } from './Icon'

export const SECTIONS = [
  { to: '/', key: 'dashboard', icon: 'home' },
  { to: '/saisie', key: 'saisie', icon: 'plus' },
  { to: '/ferme', key: 'ferme', icon: 'hen' },
  { to: '/argent', key: 'argent', icon: 'wallet' },
  { to: '/compta', key: 'compta', icon: 'receipt' },
  { to: '/planning', key: 'planning', icon: 'calendar' },
  { to: '/analyses', key: 'analyses', icon: 'chart' },
  { to: '/stock', key: 'stock', icon: 'box' },
  { to: '/boutique', key: 'boutique', icon: 'cart' },
  { to: '/administration', key: 'administration', icon: 'note' },
  { to: '/reglages', key: 'reglages', icon: 'settings' },
  { to: '/sync', key: 'sync', icon: 'sync' }
]

// On phones the bottom bar shows at most 4 sections + "More"
const MOBILE_SLOTS = 4

export default function Layout() {
  const { t, i18n } = useTranslation()
  const { role, profile, signOut } = useAuth()
  const location = useLocation()
  const online = useOnline()
  const pending = usePendingCount()
  const install = useInstallPrompt()
  const sections = SECTIONS.filter((s) => sectionVisible(s.key, role, profile))
  const negoce = estNegoce(profile)
  // HENZO AGRO: the cash boxes are not "chair" / "pondeuses" (a company switch reloads the app)
  if (negoce) for (const lng of ['fr', 'en']) i18n.addResourceBundle(lng, 'translation', { argent: { caisse: i18n.getResource(lng, 'translation', 'negoce.caisse') } }, true, true)
  const [refus, setRefus] = useState(lireRefus)
  // Administration reminders (also sent every morning by the database when pg_cron is on)
  useEffect(() => { if (role === 'directeur' && navigator.onLine) supabase.rpc('rappels_administration').then(() => {}, () => {}) }, [role])
  const needsMore = sections.length > MOBILE_SLOTS + 1

  return (
    <div className={`shell ${negoce ? 'negoce' : ''}`}>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <Logo size={38} />
            <div>
              <strong>{negoce ? profile.ferme.nom : t('app.name')}</strong>
              <NavLink to="/compte" className="account-link" title={t('compte.title')}>{profile?.nom_complet || t(`roles.${role}`)}</NavLink>
              <FarmSwitch />
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
            {!['employe', 'vendeur'].includes(role) && <Notifications />}
            <ThemeSwitch />
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
      <main className="content">
        {/* key: a page error is forgotten when changing page */}
        {refus && (
          <div className="alert warn"><Icon name="alert" size={18} />{t('systeme.noAccess', { nom: refus })}
            <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => { ecrireRefus(null); setRefus(null) }}>OK</button>
          </div>
        )}
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<p className="muted">{t('common.loading')}</p>}><Outlet /></Suspense>
        </ErrorBoundary>
      </main>
      <SessionGuard />
    </div>
  )
}
