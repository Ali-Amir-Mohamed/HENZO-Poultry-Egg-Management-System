import { Navigate, Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from './auth/AuthProvider'
import { canAccess } from './config'
import Layout from './components/Layout'
import { Logo } from './components/Icon'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Saisie from './pages/Saisie'
import Ferme from './pages/Ferme'
import FicheBande from './pages/FicheBande'
import FicheLot from './pages/FicheLot'
import Argent from './pages/Argent'
import Stock from './pages/Stock'
import Reglages from './pages/Reglages'
import Sync from './pages/Sync'
import Plus from './pages/Plus'

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
        <Route path="stock" element={<Guard section="stock"><Stock /></Guard>} />
        <Route path="reglages" element={<Guard section="reglages"><Reglages /></Guard>} />
        <Route path="sync" element={<Guard section="sync"><Sync /></Guard>} />
        <Route path="plus" element={<Plus />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
