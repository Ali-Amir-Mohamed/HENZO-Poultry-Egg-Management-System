import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { usePendingCount } from '../hooks'
import { changerFerme } from '../components/FarmSwitch'
import { marquerChoix } from '../lib/systeme'
import Portail from '../components/Portail'

// After signing in: 1) which system (HENZO or HENZO AGRO), 2) which site when the system has several (Yaoundé, Garoua…)
export default function ChoixSysteme({ societes, typeInitial, onChoisi }) {
  const { t } = useTranslation()
  const { profile, signOut } = useAuth()
  const pending = usePendingCount()
  const [type, setType] = useState(typeInitial ?? null)
  const [erreur, setErreur] = useState(null)
  const [busy, setBusy] = useState(null)
  const prenom = (profile?.nom_complet || '').split(' ')[0]

  const ouvrir = async (s) => {
    setErreur(null)
    marquerChoix()
    if (s.active) return onChoisi()
    if (pending > 0) return setErreur(t('fermes.pendingFirst', { count: pending }))
    setBusy(s.ferme_id)
    try { await changerFerme(s.ferme_id) } catch (err) { setErreur(err.message); setBusy(null) }
  }
  const choisirType = (c) => {
    const sites = societes.filter((s) => s.type_activite === c.type)
    if (sites.length === 1) return ouvrir(sites[0])
    setType(c.type)
  }

  const pied = (
    <>
      {type && !typeInitial ? <button type="button" className="portail-lien-pied" onClick={() => setType(null)}>← {t('systeme.back')}</button> : <span>{t('systeme.footer')}</span>}
      <button type="button" className="portail-lien-pied" onClick={signOut}>{t('nav.logout')}</button>
    </>
  )

  if (!type) {
    // step 1: one card per system
    const types = [...new Set(societes.map((s) => s.type_activite))].sort()
    const cartes = types.map((ty) => {
      const sites = societes.filter((s) => s.type_activite === ty)
      return { cle: ty, type: ty, nom: ty === 'negoce' ? sites[0].nom : 'HENZO', role: sites.length === 1 ? sites[0].role : null, actif: sites.some((s) => s.active) }
    })
    return <Portail sousTitre={t('systeme.subtitle', { name: prenom })} cartes={cartes} onChoisir={choisirType} erreur={erreur} pied={pied} />
  }
  // step 2: which site
  const sites = societes.filter((s) => s.type_activite === type)
  return (
    <Portail
      sousTitre={t('systeme.whichSite')}
      cartes={sites.map((s) => ({ cle: s.ferme_id, type: s.type_activite, nom: s.nom, role: s.role, actif: s.active, site: true }))}
      onChoisir={(c) => ouvrir(sites.find((s) => s.ferme_id === c.cle))} erreur={erreur} occupe={busy} pied={pied}
    />
  )
}
