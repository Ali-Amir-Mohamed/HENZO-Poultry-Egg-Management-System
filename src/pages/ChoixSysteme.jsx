import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { usePendingCount } from '../hooks'
import { changerFerme } from '../components/FarmSwitch'
import { marquerChoix } from '../lib/systeme'
import Portail from '../components/Portail'

// After signing in, for accounts working in both systems (when no system was picked before signing in)
export default function ChoixSysteme({ societes, onChoisi }) {
  const { t } = useTranslation()
  const { profile, signOut } = useAuth()
  const pending = usePendingCount()
  const [erreur, setErreur] = useState(null)
  const [busy, setBusy] = useState(null)
  const prenom = (profile?.nom_complet || '').split(' ')[0]

  const choisir = async (c) => {
    setErreur(null)
    marquerChoix()
    if (c.actif) return onChoisi()
    if (pending > 0) return setErreur(t('fermes.pendingFirst', { count: pending }))
    setBusy(c.cle)
    try { await changerFerme(c.cle) } catch (err) { setErreur(err.message); setBusy(null) }
  }

  return (
    <Portail
      sousTitre={t('systeme.subtitle', { name: prenom })}
      cartes={societes.map((s) => ({ cle: s.ferme_id, type: s.type_activite, nom: s.nom, role: s.role, actif: s.active }))}
      onChoisir={choisir} erreur={erreur} occupe={busy}
      pied={<><span>{t('systeme.footer')}</span><button type="button" className="portail-lien-pied" onClick={signOut}>{t('nav.logout')}</button></>}
    />
  )
}
