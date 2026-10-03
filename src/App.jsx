import { Navigate, Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from './auth/AuthProvider'
import { canAccess } from './config'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Saisie from './pages/Saisie'
import Sync from './pages/Sync'
import Placeholder from './pages/Placeholder'

function Guard({ section, children }) {
  const { role } = useAuth()
  const { t } = useTranslation()
  return canAccess(role, section) ? children : <p className="card">{t('common.forbidden')}</p>
}

export default function App() {
  const { session, profile, loading, signOut } = useAuth()
  const { t } = useTranslation()

  if (loading) return <p className="center">{t('common.loading')}</p>
  if (!session) return <Login />
  if (!profile) {
    return (
      <div className="center">
        <p>{t('auth.noProfile')}</p>
        <button onClick={signOut}>{t('nav.logout')}</button>
      </div>
    )
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="saisie" element={<Guard section="saisie"><Saisie /></Guard>} />
        <Route path="production" element={<Guard section="production"><Placeholder title="nav.production" /></Guard>} />
        <Route path="finance" element={<Guard section="finance"><Placeholder title="nav.finance" /></Guard>} />
        <Route path="sync" element={<Guard section="sync"><Sync /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
