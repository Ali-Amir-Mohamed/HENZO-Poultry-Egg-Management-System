import { Navigate, Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from './auth/AuthProvider'
import { canAccess } from './config'
import Layout from './components/Layout'
import { Logo } from './components/Icon'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Saisie from './pages/Saisie'
import Sync from './pages/Sync'
import Placeholder from './pages/Placeholder'

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
        <Route path="production" element={<Guard section="production"><Placeholder title="nav.production" icon="chart" /></Guard>} />
        <Route path="finance" element={<Guard section="finance"><Placeholder title="nav.finance" icon="wallet" /></Guard>} />
        <Route path="sync" element={<Guard section="sync"><Sync /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
