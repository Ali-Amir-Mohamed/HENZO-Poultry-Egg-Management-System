import { lazy, useEffect, useState } from 'react'
import ChoixSysteme from './pages/ChoixSysteme'
import { choixFait, ecrireRefus, ecrireVise, estNegoce, lireVise, marquerChoix } from './lib/systeme'
import { changerFerme } from './components/FarmSwitch'
import Portail from './components/Portail'
import LanguageSwitch from './components/LanguageSwitch'
import ThemeSwitch from './components/ThemeSwitch'
import { APP_VERSION, forcerMiseAJour } from './lib/version'
import { supabase } from './lib/supabase'
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
const FaceId = lazy(() => import('./pages/FaceId'))
const Boutique = lazy(() => import('./pages/Boutique'))
const RecuBoutique = lazy(() => import('./pages/boutique/RecuBoutique'))
const MonCompte = lazy(() => import('./pages/MonCompte'))
const Administration = lazy(() => import('./pages/Administration'))
const Compta = lazy(() => import('./pages/Compta'))
const Facture = lazy(() => import('./pages/Facture'))
const Bulletin = lazy(() => import('./pages/Bulletin'))
const AccueilNegoce = lazy(() => import('./pages/negoce/AccueilNegoce'))

function Guard({ section, children }) {
  const { role } = useAuth()
  const { t } = useTranslation()
  return canAccess(role, section) ? children : <div className="panel empty">{t('common.forbidden')}</div>
}

export default function App() {
  const { session, profile, loading, signOut, role } = useAuth()
  const { t } = useTranslation()
  // Two systems behind one link. Before signing in, the portal asks which one to open (HENZO or HENZO AGRO);
  // after signing in, that system's company is opened. Accounts already signed in and working in both
  // get the portal again at the start of each session.
  const [vise, setVise] = useState(lireVise)
  const [societes, setSocietes] = useState(null)
  const [choisi, setChoisi] = useState(choixFait)
  const [typeInitial, setTypeInitial] = useState(null)
  useEffect(() => {
    if (!session || !profile || choisi || !navigator.onLine) return
    supabase.rpc('mes_societes').then(({ data }) => {
      const liste = data ?? []
      const v = lireVise()
      if (!v) return setSocietes(liste)
      // a system was picked on the portal: open its company, ask which site if it has several, or say there is no access to it
      const cibles = liste.filter((s) => s.type_activite === v)
      const cible = cibles[0]
      ecrireVise(null)
      if (cibles.length > 1) { setTypeInitial(v); return setSocietes(liste) }
      marquerChoix()
      setChoisi(true)
      if (!cible) ecrireRefus(v)
      else if (!cible.active) changerFerme(cible.ferme_id).catch(() => {})
    }, () => setSocietes([]))
  }, [session, profile, choisi])
  const choisirAvantConnexion = (c) => { ecrireVise(c.type); setVise(c.type) }
  const retourPortail = () => { ecrireVise(null); setVise(null) }

  if (loading) {
    return <div className="splash"><Logo size={64} /><p>{t('common.loading')}</p></div>
  }
  if (!session) {
    if (vise) return <Login systeme={vise} onRetour={retourPortail} />
    return (
      <Portail
        sousTitre={t('systeme.subtitlePublic')}
        cartes={[{ cle: 'elevage', type: 'elevage', nom: 'HENZO' }, { cle: 'negoce', type: 'negoce', nom: 'HENZO AGRO' }]}
        onChoisir={choisirAvantConnexion}
        entete={<><ThemeSwitch className="icon-btn" /><LanguageSwitch className="icon-btn" /></>}
        pied={<><span>{t('systeme.footer')}</span><span>{t('version.label')} {APP_VERSION} · <button type="button" className="portail-lien-pied" onClick={forcerMiseAJour}>{t('version.force')}</button></span></>}
      />
    )
  }
  if (!profile) {
    return (
      <div className="splash">
        <Logo size={64} />
        <p>{t('auth.noProfile')}</p>
        <button className="btn yolk" onClick={signOut}>{t('nav.logout')}</button>
      </div>
    )
  }

  if (!choisi && societes && (typeInitial || new Set(societes.map((s) => s.type_activite)).size > 1 || societes.length > 1)) {
    return <ChoixSysteme societes={societes} typeInitial={typeInitial} onChoisi={() => setChoisi(true)} />
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        {/* a seller lands directly on his shop */}
        <Route index element={role === 'vendeur' ? <Navigate to="/boutique" replace /> : estNegoce(profile) ? <AccueilNegoce /> : <Dashboard />} />
        <Route path="boutique" element={<Guard section="boutique"><Boutique /></Guard>} />
        <Route path="recu-boutique/:id" element={<RecuBoutique />} />
        <Route path="saisie" element={<Guard section="saisie"><Saisie /></Guard>} />
        <Route path="ferme" element={<Guard section="ferme"><Ferme /></Guard>} />
        <Route path="ferme/bande/:id" element={<Guard section="ferme"><FicheBande /></Guard>} />
        <Route path="ferme/lot/:id" element={<Guard section="ferme"><FicheLot /></Guard>} />
        <Route path="argent" element={<Guard section="argent"><Argent /></Guard>} />
        <Route path="argent/investisseur/:id" element={<Guard section="argent"><ReleveInvestisseur /></Guard>} />
        <Route path="planning" element={<Guard section="planning"><Planning /></Guard>} />
        <Route path="analyses" element={<Guard section="analyses"><Analyses /></Guard>} />
        <Route path="stock" element={<Guard section="stock"><Stock /></Guard>} />
        <Route path="administration" element={<Guard section="administration"><Administration /></Guard>} />
        <Route path="compta" element={<Guard section="compta"><Compta /></Guard>} />
        <Route path="facture/:id" element={<Guard section="compta"><Facture /></Guard>} />
        <Route path="bulletin/:id" element={<Guard section="argent"><Bulletin /></Guard>} />
        <Route path="reglages" element={<Guard section="reglages"><Reglages /></Guard>} />
        <Route path="reglages/tiers/:id" element={<Guard section="reglages"><FicheTiers /></Guard>} />
        <Route path="sync" element={<Guard section="sync"><Sync /></Guard>} />
        <Route path="plus" element={<Plus />} />
        <Route path="recu/:id" element={<Recu />} />
        <Route path="face-id" element={<FaceId />} />
        <Route path="compte" element={<MonCompte />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
