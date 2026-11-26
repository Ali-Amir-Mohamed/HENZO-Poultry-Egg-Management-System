import { Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { sectionVisible, estNegoce, lireRefus, ecrireRefus } from '../lib/systeme'
import { useInstallPrompt, useOnline, usePendingCount } from '../hooks'
import LanguageSwitch from './LanguageSwitch'
import FondSwitch, { applyFond } from './FondSwitch'
import Notifications from './Notifications'
import SessionGuard from './SessionGuard'
import FarmSwitch from './FarmSwitch'
import ErrorBoundary from './ErrorBoundary'
import Splash from './Splash'
import Icon, { Logo } from './Icon'

export const SECTIONS = [
  { to: '/', key: 'dashboard', icon: 'home', groupe: 0 },
  { to: '/associes', key: 'associes', icon: 'users', groupe: 0 },
  { to: '/rapport', key: 'rapport', icon: 'note', groupe: 0 },
  { to: '/saisie', key: 'saisie', icon: 'plus', groupe: 0 },
  { to: '/ferme', key: 'ferme', icon: 'hen', groupe: 1 },
  { to: '/commandes', key: 'commandes', icon: 'calendar', groupe: 1 },
  { to: '/provenderie', key: 'provenderie', icon: 'box', groupe: 1 },
  { to: '/benefices', key: 'benefices', icon: 'chart', groupe: 2 },
  { to: '/argent', key: 'argent', icon: 'wallet', groupe: 2 },
  { to: '/compta', key: 'compta', icon: 'receipt', groupe: 2 },
  { to: '/planning', key: 'planning', icon: 'calendar', groupe: 1 },
  { to: '/analyses', key: 'analyses', icon: 'chart', groupe: 2 },
  { to: '/stock', key: 'stock', icon: 'box', groupe: 1 },
  { to: '/boutique', key: 'boutique', icon: 'cart', groupe: 1 },
  { to: '/administration', key: 'administration', icon: 'note', groupe: 3 },
  { to: '/reglages', key: 'reglages', icon: 'settings', groupe: 3 },
  { to: '/sync', key: 'sync', icon: 'sync', groupe: 3 }
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
  // End of a fixed-term contract or of a trial period: reminder to Ali and Dahirou, one month before
  useEffect(() => { if (['directeur', 'finance'].includes(role) && navigator.onLine) supabase.rpc('rappels_rh').then(() => {}, () => {}) }, [role])
  const needsMore = sections.length > MOBILE_SLOTS + 1
  // Glass look on every page: chicks photo behind, frosted panels (see .dash-sombre in styles.css)
  useEffect(() => {
    document.body.classList.add('dash-sombre')
    applyFond()
    return () => { document.body.classList.remove('dash-sombre'); delete document.body.dataset.fond }
  }, [])

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
            {!['employe', 'vendeur', 'comptable'].includes(role) && <Notifications />}
            <FondSwitch />
            <LanguageSwitch />
            <button className="icon-btn" onClick={signOut} title={t('nav.logout')} aria-label={t('nav.logout')}>
              <Icon name="logout" size={18} />
            </button>
          </div>
        </div>
        <nav className="nav">
          {/* Group titles: only in the computer side menu, where the items are sorted by group (CSS order) */}
          {[1, 2, 3].filter((g) => sections.some((s) => s.groupe === g)).map((g) => (
            <span key={`g${g}`} className="nav-group" style={{ '--o': g * 100 }}>{t(`nav.groupe${g}${negoce && g === 1 ? 'Negoce' : ''}`)}</span>
          ))}
          {sections.map((s, i) => (
            <NavLink key={s.key} to={s.to} end={s.to === '/'} style={{ '--o': s.groupe * 100 + i + 1 }}
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
      <Splash name={(profile?.nom_complet || '').split(' ')[0]} />
    </div>
  )
}
