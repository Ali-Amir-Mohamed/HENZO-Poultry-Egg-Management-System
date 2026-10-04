import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from './auth/AuthProvider'
import { canAccess } from './config'
import Layout from './components/Layout'
import { Logo } from './components/Icon'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Saisie from './pages/Saisie'
// Dashboard and field entry load at once (used every day, also offline);
// the other pages are downloaded when opened, and kept by the service worker for offline use
const Ferme = lazy(() => import('./pages/Ferme'))
const FicheBande = lazy(() => import('./pages/FicheBande'))
const FicheLot = lazy(() => import('./pages/FicheLot'))
const Argent = lazy(() => import('./pages/Argent'))
const Stock = lazy(() => import('./pages/Stock'))
const Planning = lazy(() => import('./pages/Planning'))
const Analyses = lazy(() => import('./pages/Analyses'))
const ReleveInvestisseur = lazy(() => import('./pages/argent/ReleveInvestisseur'))
const Reglages = lazy(() => import('./pages/Reglages'))
const FicheTiers = lazy(() => import('./pages/reglages/FicheTiers'))
const Sync = lazy(() => import('./pages/Sync'))
const Plus = lazy(() => import('./pages/Plus'))
const Recu = lazy(() => import('./pages/Recu'))

function Guard({ section, children }) {
  const { role } = useAuth()
  const { t } = useTranslation()
  return canAccess(role, section) ? children : <div className="panel empty">{t('common.forbidden')}</div>
}

export default function App() {
  const { session, profile, loading, signOut } = useAuth()
  const { t } = useTranslation()

  if (loading) {
    return <div className="splash"><Logo size={64} /><p>{t('common.loading')}</p></div>
  }
  if (!session) return <Login />
  if (!profile) {
    return (
      <div className="splash">
        <Logo size={64} />
        <p>{t('auth.noProfile')}</p>
        <button className="btn yolk" onClick={signOut}>{t('nav.logout')}</button>
      </div>
    )
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="saisie" element={<Guard section="saisie"><Saisie /></Guard>} />
        <Route path="ferme" element={<Guard section="ferme"><Ferme /></Guard>} />
        <Route path="ferme/bande/:id" element={<Guard section="ferme"><FicheBande /></Guard>} />
        <Route path="ferme/lot/:id" element={<Guard section="ferme"><FicheLot /></Guard>} />
        <Route path="argent" element={<Guard section="argent"><Argent /></Guard>} />
        <Route path="argent/investisseur/:id" element={<Guard section="argent"><ReleveInvestisseur /></Guard>} />
        <Route path="planning" element={<Guard section="planning"><Planning /></Guard>} />
        <Route path="analyses" element={<Guard section="analyses"><Analyses /></Guard>} />
        <Route path="stock" element={<Guard section="stock"><Stock /></Guard>} />
        <Route path="reglages" element={<Guard section="reglages"><Reglages /></Guard>} />
        <Route path="reglages/tiers/:id" element={<Guard section="reglages"><FicheTiers /></Guard>} />
        <Route path="sync" element={<Guard section="sync"><Sync /></Guard>} />
        <Route path="plus" element={<Plus />} />
        <Route path="recu/:id" element={<Recu />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
